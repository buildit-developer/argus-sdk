/**
 * Argus Node SDK — smoke test
 *
 * Usage:
 *   ARGUS_ENDPOINT=https://api.buildit.sh ARGUS_KEY=bld_live_xxx node test.js
 *
 * Or hardcode below for a quick run.
 */

const argus = require('./index')

// -- Configure (reads from env by default) --
argus.init({
  endpoint: process.env.ARGUS_ENDPOINT || 'https://api.buildit.sh',
  apiKey: process.env.ARGUS_KEY || '',
})

async function main() {
  console.log('Sending a test call to Argus...')

  // Simulate a successful Anthropic call
  const result = await argus.track({
    provider: 'anthropic',
    model: 'claude-3-5-haiku-20241022',
    opName: 'chat',
    fn: async () => {
      // Simulated response — replace with a real Anthropic call if you want
      await new Promise((r) => setTimeout(r, 120)) // fake 120ms latency
      return {
        usage: { input_tokens: 42, output_tokens: 18 },
        content: [{ text: 'Hello from Argus test!' }],
      }
    },
  })

  console.log('Response:', result.content[0].text)

  // Simulate a failed OpenAI call (fallback scenario)
  try {
    await argus.track({
      provider: 'openai',
      model: 'gpt-4o-mini',
      opName: 'chat',
      fn: async () => {
        await new Promise((r) => setTimeout(r, 60))
        throw new Error('simulated failure')
      },
    })
  } catch {
    console.log('Simulated failure tracked (expected).')
  }

  // Wait briefly for fire-and-forget sends to complete
  await new Promise((r) => setTimeout(r, 500))
  console.log('Done — check the Argus dashboard.')
}

main().catch(console.error)
