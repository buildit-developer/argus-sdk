'use strict'

/**
 * End-to-end batching test for the Node SDK.
 * Spins up a local HTTP server, points the SDK at it, fires 23 track() calls,
 * and asserts they arrive as 2 batched POSTs (20 via size trigger, 3 via timer)
 * — NOT 23 separate requests.
 *
 * Run: node test-e2e.js   (~6s — waits out the real 5s flush timer)
 */

const http = require('http')
const assert = require('assert')

const requests = [] // one entry per POST = number of attempts it carried

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', () => {
    try { requests.push(JSON.parse(body).attempts.length) }
    catch { requests.push(-1) }
    res.statusCode = 200
    res.end('{}')
  })
})

server.listen(0, async () => {
  const port = server.address().port
  const argus = require('./index')
  argus.init({ endpoint: `http://localhost:${port}`, apiKey: 'test-key' })

  const call = (i) => argus.track({
    provider: 'anthropic', model: 'claude-test', opName: 'chat',
    fn: async () => ({ usage: { input_tokens: i, output_tokens: i } }),
  })

  // Size trigger: 20 calls → exactly one batch of 20.
  for (let i = 0; i < 20; i++) await call(i)
  // 3 more → buffered, flushed by the 5s timer.
  for (let i = 0; i < 3; i++) await call(i)

  await new Promise((r) => setTimeout(r, 6000)) // wait past FLUSH_MS

  console.log('23 track() calls made')
  console.log('HTTP POSTs received:', requests.length)
  console.log('Attempts per POST:  ', requests)
  try {
    assert.strictEqual(requests.length, 2, '23 calls should produce 2 POSTs, not 23')
    assert.strictEqual(requests[0], 20, 'first POST = size-triggered batch of 20')
    assert.strictEqual(requests[1], 3, 'second POST = timer-triggered batch of 3')
    console.log('\n✓ PASS — 23 calls collapsed into 2 batched POSTs (20 + 3)')
    server.close(() => process.exit(0))
  } catch (e) {
    console.error('\n✗ FAIL:', e.message)
    server.close(() => process.exit(1))
  }
})
