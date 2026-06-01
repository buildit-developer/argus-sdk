// Loaded via: NODE_OPTIONS="--import @buildit-developer/argus-node/register"
// Works for ESM apps (NestJS, Vercel AI SDK, LangChain, etc.)
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

if (process.env.ARGUS_KEY) {
  const { patchAll, patchAnthropic, patchOpenAI, patchAiSdkProvider } = require('./auto.js')

  // Patch CJS modules via module loader hook
  patchAll()

  // Also patch ESM modules by importing and patching the cached instance
  // ESM cache is shared — patches here are visible to all importers in the app
  const providers = ['anthropic', 'openai', 'google', 'mistral', 'cohere']
  for (const p of providers) {
    try {
      const mod = await import(`@ai-sdk/${p}`)
      const wrapped = patchAiSdkProvider(mod.default || mod, p)
      if (wrapped !== (mod.default || mod) && process.env.ARGUS_DEBUG === '1') {
        console.log(`[argus] patched @ai-sdk/${p}`)
      }
    } catch {}
  }

  try {
    const mod = await import('@anthropic-ai/sdk')
    patchAnthropic(mod)
  } catch {}

  try {
    const mod = await import('openai')
    patchOpenAI(mod)
  } catch {}
}
