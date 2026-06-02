'use strict'

const { randomBytes } = require('crypto')
const https = require('https')
const http = require('http')
const { Batcher } = require('./_batch')

let _endpoint = (process.env.ARGUS_ENDPOINT || 'https://api.buildit.sh').replace(/\/$/, '')
let _apiKey = process.env.ARGUS_KEY || ''

function init({ endpoint, apiKey } = {}) {
  if (endpoint) _endpoint = endpoint.replace(/\/$/, '')
  if (apiKey) _apiKey = apiKey
}

function _id(bytes) {
  return randomBytes(bytes).toString('hex')
}

function _send(attempts) {
  if (!_apiKey || !attempts.length) return Promise.resolve()
  const body = JSON.stringify({ attempts })
  const url = new URL(_endpoint + '/api/argus/ingest')
  const opts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-API-Key': _apiKey,
    },
  }
  return new Promise((resolve) => {
    const lib = url.protocol === 'https:' ? https : http
    const req = lib.request(url, opts, (res) => {
      if (res.statusCode === 401) {
        console.warn('[argus] Invalid or missing API key — calls are not being tracked. Check your ARGUS_KEY.')
      } else if (res.statusCode && res.statusCode >= 400) {
        console.warn(`[argus] Ingest failed with status ${res.statusCode}`)
      }
      res.resume()
      resolve()
    })
    req.on('error', (err) => {
      console.warn('[argus] Could not reach ingest endpoint:', err.message)
      resolve()
    })
    req.write(body)
    req.end()
  })
}

// Buffers attempts and POSTs them in batches via _send (see _batch.js).
const _batcher = new Batcher(_send)

// Core tracking function — wraps any async fn
async function track({ provider, model, fn, opName, options } = {}) {
  const traceId = _id(16)
  const spanId = _id(8)
  const startMs = Date.now()
  let status = 'OK'
  let inputTokens, outputTokens, result

  try {
    result = await fn()
    const usage = result?.usage
    if (usage) {
      inputTokens = usage.input_tokens ?? usage.prompt_tokens
      outputTokens = usage.output_tokens ?? usage.completion_tokens
    }
  } catch (err) {
    status = 'FAILED'
    throw err
  } finally {
    const latencyMs = Date.now() - startMs
    _batcher.add({
      trace_id: traceId,
      span_id: spanId,
      op_name: opName || 'model_request',
      provider,
      model,
      status,
      input_tokens: inputTokens ?? null,
      output_tokens: outputTokens ?? null,
      latency_ms: latencyMs,
      start_ns: startMs * 1e6,
      options: options || [],
    })
  }
  return result
}

// Wrap an Anthropic SDK client (messages.create)
function wrapAnthropic(client) {
  const orig = client.messages.create.bind(client.messages)
  client.messages.create = (params, ...rest) =>
    track({
      provider: 'anthropic',
      model: params.model,
      opName: 'chat',
      fn: () => orig(params, ...rest),
    })
  return client
}

// Wrap an OpenAI SDK client (chat.completions.create)
function wrapOpenAI(client) {
  const orig = client.chat.completions.create.bind(client.chat.completions)
  client.chat.completions.create = (params, ...rest) =>
    track({
      provider: 'openai',
      model: params.model,
      opName: 'chat',
      fn: () => orig(params, ...rest),
    })
  return client
}

module.exports = { init, track, wrapAnthropic, wrapOpenAI }
