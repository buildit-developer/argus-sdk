'use strict'
/**
 * Argus OpenTelemetry span processor.
 * Receives gen_ai.* spans from Vercel AI SDK and ships them to Argus ingest.
 *
 * Usage (manual setup):
 *   import { ArgusSpanProcessor } from '@buildit-developer/argus-node/otel'
 *   const sdk = new NodeSDK({ spanProcessors: [new ArgusSpanProcessor()] })
 *
 * Usage (automatic via argus CLI):
 *   argus node dist/main.js   ← ArgusSpanProcessor is registered automatically
 */

const { randomBytes } = require('crypto')
const https = require('https')
const http = require('http')
const { Batcher } = require('./_batch')

const DEFAULT_ENDPOINT = 'https://api.buildit.sh'

class ArgusSpanProcessor {
  constructor({ apiKey, endpoint } = {}) {
    this._apiKey = apiKey || process.env.ARGUS_KEY || ''
    this._endpoint = (endpoint || process.env.ARGUS_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/$/, '')
    this._debug = process.env.ARGUS_DEBUG === '1'
    // Buffers spans and POSTs them in batches via _send (see _batch.js).
    this._batcher = new Batcher((attempts) => this._send(attempts))
  }

  // Called when a span starts — nothing to do
  onStart() {}

  // Called when a span ends — this is where we capture LLM calls
  onEnd(span) {
    try {
      const attrs = span.attributes || {}

      if (this._debug) {
        console.log(`[argus] span: ${span.name} | attrs: ${JSON.stringify(Object.keys(attrs))}`)
      }

      // Only process inner execution spans — outer wrappers (ai.streamText,
      // ai.generateText, ai.generateObject) emit duplicate records for the same
      // LLM call and use different token key names. The *.doGenerate / *.doStream
      // inner spans have the canonical gen_ai.* attributes.
      const name = span.name || ''
      if (!name.endsWith('.doGenerate') && !name.endsWith('.doStream')) return

      // Only track gen_ai spans (LLM calls from Vercel AI SDK)
      const provider = attrs['gen_ai.system'] || attrs['ai.model.provider']
      const model = attrs['gen_ai.request.model'] || attrs['ai.model.id']
      if (!provider && !model) return

      const inputTokens = attrs['gen_ai.usage.input_tokens']
        ?? attrs['gen_ai.usage.prompt_tokens']
        ?? attrs['ai.usage.promptTokens']
        ?? attrs['ai.usage.inputTokens']
      const outputTokens = attrs['gen_ai.usage.output_tokens']
        ?? attrs['gen_ai.usage.completion_tokens']
        ?? attrs['ai.usage.completionTokens']
        ?? attrs['ai.usage.outputTokens']
      const cachedInputTokens = attrs['ai.usage.cachedInputTokens'] ?? null

      const startMs = Math.floor(Number(span.startTime[0]) * 1000 + Number(span.startTime[1]) / 1e6)
      const endMs = Math.floor(Number(span.endTime[0]) * 1000 + Number(span.endTime[1]) / 1e6)
      const latencyMs = endMs - startMs

      const status = span.status?.code === 2 /* ERROR */ ? 'FAILED' : 'OK'
      const opName = name

      const meta = attrs['ai.telemetry.metadata.userId'] != null ? {
        user_id: attrs['ai.telemetry.metadata.userId'] ?? null,
        session_id: attrs['ai.telemetry.metadata.sessionId'] ?? null,
        agent_type: attrs['ai.telemetry.metadata.agentType'] ?? null,
      } : {}

      this._batcher.add({
        trace_id: span.spanContext().traceId || randomBytes(16).toString('hex'),
        span_id: span.spanContext().spanId || randomBytes(8).toString('hex'),
        op_name: opName,
        provider: String(provider || 'unknown').toLowerCase(),
        model: String(model || 'unknown'),
        status,
        input_tokens: inputTokens != null ? Number(inputTokens) : null,
        output_tokens: outputTokens != null ? Number(outputTokens) : null,
        cached_input_tokens: cachedInputTokens != null ? Number(cachedInputTokens) : null,
        latency_ms: latencyMs,
        ms_to_first_chunk: attrs['ai.response.msToFirstChunk'] != null ? Number(attrs['ai.response.msToFirstChunk']) : null,
        finish_reason: attrs['ai.response.finishReason'] ?? null,
        start_ns: startMs * 1e6,
        options: [],
        ...meta,
      })
    } catch (e) {
      if (this._debug) console.warn('[argus] span processing error:', e.message)
    }
  }

  _send(attempts) {
    if (!this._apiKey || !attempts.length) return
    const body = JSON.stringify({ attempts })
    const url = new URL(this._endpoint + '/api/argus/ingest')
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-API-Key': this._apiKey,
        'User-Agent': 'argus-node/otel',
      },
    }, res => {
      if (res.statusCode === 401) console.warn('[argus] Invalid API key — check ARGUS_KEY')
      else if (res.statusCode >= 400) {
        let body = ''
        res.on('data', d => { body += d })
        res.on('end', () => console.warn(`[argus] Ingest error ${res.statusCode}: ${body}`))
      } else {
        res.resume()
      }
    })
    req.on('error', err => this._debug && console.warn('[argus] Send failed:', err.message))
    if (this._debug) console.log(`[argus] sending ${attempts.length} attempt(s) to ingest`)
    req.write(body)
    req.end()
  }

  // Required by OTel SpanProcessor interface — flush buffered spans on demand
  // and at shutdown so nothing is left un-sent on a graceful exit.
  async shutdown() { this._batcher.flush() }
  async forceFlush() { this._batcher.flush() }
}

/**
 * Sets up an OTel NodeSDK with ArgusSpanProcessor.
 * Called automatically by the argus CLI bin when ARGUS_KEY is set.
 */
function setupArgusOtel({ apiKey, endpoint } = {}) {
  if (!apiKey && !process.env.ARGUS_KEY) return null
  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node')
    const processor = new ArgusSpanProcessor({ apiKey, endpoint })
    const sdk = new NodeSDK({ spanProcessors: [processor] })
    sdk.start()
    if (process.env.ARGUS_DEBUG === '1') console.log('[argus] OTel provider registered')

    const shutdown = async () => { try { await sdk.shutdown() } catch {} }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
    return sdk
  } catch (e) {
    if (process.env.ARGUS_DEBUG === '1') console.warn('[argus] OTel setup failed:', e.message)
    return null
  }
}

module.exports = { ArgusSpanProcessor, setupArgusOtel }
