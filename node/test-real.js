'use strict'

const Anthropic = require('@anthropic-ai/sdk')
const argus = require('./index')

const ARGUS_KEY = process.env.ARGUS_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

if (!ARGUS_KEY) { console.error('Set ARGUS_KEY env var'); process.exit(1) }
if (!ANTHROPIC_KEY) { console.error('Set ANTHROPIC_API_KEY env var'); process.exit(1) }

argus.init({
  endpoint: process.env.ARGUS_ENDPOINT || 'https://api.buildit.sh',
  apiKey: ARGUS_KEY,
})

const client = argus.wrapAnthropic(new Anthropic({ apiKey: ANTHROPIC_KEY }))

async function main() {
  console.log('Making real Anthropic call (tracked by Argus)...\n')

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'Reply with exactly: Argus is watching.' }],
  })

  console.log('Response:', msg.content[0].text)
  console.log('Tokens  :', msg.usage)

  // Give the fire-and-forget send a moment to complete
  await new Promise((r) => setTimeout(r, 600))
  console.log('\nDone — check the Argus dashboard for the tracked call.')
}

main().catch(console.error)
