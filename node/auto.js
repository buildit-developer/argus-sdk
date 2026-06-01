'use strict'

const { randomBytes } = require('crypto')
const https = require('https')
const http = require('http')

const ENDPOINT = (process.env.ARGUS_ENDPOINT || 'https://api.buildit.sh').replace(/\/$/, '')
const API_KEY = process.env.ARGUS_KEY || ''
const DEBUG = process.env.ARGUS_DEBUG === '1'
const LANGCHAIN = process.env.ARGUS_LANGCHAIN === '1'

function _id(bytes) { return randomBytes(bytes).toString('hex') }

function _send(attempts) {
  if (!API_KEY || !attempts.length) return
  const body = JSON.stringify({ attempts })
  const url = new URL(ENDPOINT + '/api/argus/ingest')
  const req = (url.protocol === 'https:' ? https : http).request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-API-Key': API_KEY },
  }, res => {
    if (res.statusCode === 401) console.warn('[argus] Invalid API key — set ARGUS_KEY correctly')
    else if (DEBUG && res.statusCode >= 400) console.warn(`[argus] Ingest error ${res.statusCode}`)
    res.resume()
  })
  req.on('error', err => DEBUG && console.warn('[argus] Send failed:', err.message))
  req.write(body)
  req.end()
}

function _record({ provider, model, status, inputTokens, outputTokens, startMs }) {
  _send([{
    trace_id: _id(16), span_id: _id(8), op_name: 'chat',
    provider, model, status,
    input_tokens: inputTokens ?? null, output_tokens: outputTokens ?? null,
    latency_ms: Date.now() - startMs, start_ns: startMs * 1e6, options: [],
  }])
}

// ── Anthropic SDK ──────────────────────────────────────────────────────────
function patchAnthropic(mod) {
  const Anthropic = mod?.default || mod
  if (!Anthropic?.Messages?.prototype || Anthropic.Messages.__argus) return
  const orig = Anthropic.Messages.prototype.create
  Anthropic.Messages.prototype.create = async function (body, opts) {
    const startMs = Date.now()
    try {
      const result = await orig.call(this, body, opts)
      const u = result?.usage
      _record({ provider: 'anthropic', model: body.model, status: 'OK', inputTokens: u?.input_tokens, outputTokens: u?.output_tokens, startMs })
      return result
    } catch (err) {
      _record({ provider: 'anthropic', model: body.model, status: 'FAILED', startMs })
      throw err
    }
  }
  Anthropic.Messages.__argus = true
  if (DEBUG) console.log('[argus] patched @anthropic-ai/sdk')
}

// ── OpenAI SDK ─────────────────────────────────────────────────────────────
function patchOpenAI(mod) {
  const OpenAI = mod?.default || mod?.OpenAI || mod
  if (!OpenAI?.Chat?.Completions?.prototype || OpenAI.Chat.__argus) return
  const orig = OpenAI.Chat.Completions.prototype.create
  OpenAI.Chat.Completions.prototype.create = async function (body, opts) {
    const startMs = Date.now()
    try {
      const result = await orig.call(this, body, opts)
      const u = result?.usage
      _record({ provider: 'openai', model: body.model, status: 'OK', inputTokens: u?.prompt_tokens, outputTokens: u?.completion_tokens, startMs })
      return result
    } catch (err) {
      _record({ provider: 'openai', model: body.model, status: 'FAILED', startMs })
      throw err
    }
  }
  OpenAI.Chat.__argus = true
  if (DEBUG) console.log('[argus] patched openai')
}

// ── Vercel AI SDK providers (@ai-sdk/anthropic, @ai-sdk/openai, etc.) ──────
function patchAiSdkProvider(mod, provider) {
  if (!mod || mod.__argus) return
  // Vercel AI SDK providers export a function that returns a LanguageModelV1
  // We wrap that function to intercept doGenerate / doStream on the returned model
  const wrapModel = (model) => {
    if (!model || model.__argus) return model
    const wrapFn = (origFn, fnName) => async function (...args) {
      const startMs = Date.now()
      try {
        const result = await origFn.apply(this, args)
        const u = result?.usage
        _record({
          provider, model: this.modelId || args[0]?.modelId || 'unknown', status: 'OK',
          inputTokens: u?.promptTokens ?? u?.inputTokens, outputTokens: u?.completionTokens ?? u?.outputTokens, startMs,
        })
        return result
      } catch (err) {
        _record({ provider, model: this.modelId || 'unknown', status: 'FAILED', startMs })
        throw err
      }
    }
    if (model.doGenerate) model.doGenerate = wrapFn(model.doGenerate, 'doGenerate')
    if (model.doStream) model.doStream = wrapFn(model.doStream, 'doStream')
    model.__argus = true
    return model
  }

  // The provider is typically a function: anthropic('claude-...') → model
  if (typeof mod === 'function') {
    const orig = mod
    const wrapped = function (...args) { return wrapModel(orig(...args)) }
    Object.assign(wrapped, mod) // copy static props
    mod.__argus = true
    if (DEBUG) console.log(`[argus] patched @ai-sdk/${provider}`)
    return wrapped
  }
  return mod
}

// ── LangChain global callback ──────────────────────────────────────────────
async function patchLangChain() {
  try {
    const { BaseCallbackHandler } = await import('langchain/callbacks')

    class ArgusHandler extends BaseCallbackHandler {
      name = 'argus'
      constructor() { super(); this._starts = new Map() }

      handleLLMStart(llm, _prompts, runId) {
        this._starts.set(runId, { startMs: Date.now(), model: llm?.name || llm?.id?.[llm.id.length - 1] || 'unknown' })
      }

      handleLLMEnd(output, runId) {
        const s = this._starts.get(runId); if (!s) return
        this._starts.delete(runId)
        const u = output?.llmOutput?.tokenUsage || output?.llmOutput?.usage
        _record({
          provider: 'langchain', model: s.model, status: 'OK',
          inputTokens: u?.promptTokens ?? u?.prompt_tokens,
          outputTokens: u?.completionTokens ?? u?.completion_tokens,
          startMs: s.startMs,
        })
      }

      handleLLMError(_err, runId) {
        const s = this._starts.get(runId); if (!s) return
        this._starts.delete(runId)
        _record({ provider: 'langchain', model: s.model, status: 'FAILED', startMs: s.startMs })
      }
    }

    const { CallbackManager } = await import('langchain/callbacks')
    if (CallbackManager?.configure) {
      CallbackManager.configure([new ArgusHandler()])
      if (DEBUG) console.log('[argus] patched langchain callbacks')
    }
  } catch (e) {
    if (DEBUG) console.warn('[argus] LangChain patch failed:', e.message)
  }
}

// ── CJS module interceptor ─────────────────────────────────────────────────
function patchModuleLoader() {
  const Module = require('module')
  const origLoad = Module._load
  Module._load = function (request, parent, isMain) {
    const exports = origLoad.apply(this, arguments)
    if (request === '@anthropic-ai/sdk') patchAnthropic(exports)
    if (request === 'openai') patchOpenAI(exports)
    return exports
  }
}

// ── Main entry ─────────────────────────────────────────────────────────────
function patchAll() {
  if (!API_KEY) {
    if (DEBUG) console.log('[argus] ARGUS_KEY not set — skipping auto-instrumentation')
    return
  }
  patchModuleLoader()
  // Also try to patch already-loaded modules
  try { patchAnthropic(require('@anthropic-ai/sdk')) } catch {}
  try { patchOpenAI(require('openai')) } catch {}
  if (LANGCHAIN) patchLangChain().catch(() => {})
  if (DEBUG) console.log('[argus] auto-instrumentation active')
}

module.exports = { patchAll, patchAnthropic, patchOpenAI, patchAiSdkProvider, _send, _record }
