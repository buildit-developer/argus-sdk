'use strict'

/**
 * Unit test for the Argus batcher (no network).
 * Run: node test-batch.js
 */

const assert = require('assert')
const { Batcher, BATCH_SIZE, FLUSH_MS } = require('./_batch')

let passed = 0
function ok(name) { console.log(`  ✓ ${name}`); passed++ }

async function run() {
  // 1. Production defaults are the agreed hardcoded values.
  assert.strictEqual(BATCH_SIZE, 20, 'BATCH_SIZE should be 20')
  assert.strictEqual(FLUSH_MS, 5000, 'FLUSH_MS should be 5000')
  ok('defaults are 20 / 5000ms')

  // 2. Below maxSize: nothing is flushed yet (buffered).
  {
    const sent = []
    const b = new Batcher((items) => sent.push(items), { maxSize: 5, flushMs: 10_000 })
    b.add({ n: 1 })
    b.add({ n: 2 })
    assert.strictEqual(sent.length, 0, 'should buffer, not send, below maxSize')
    ok('buffers below maxSize')
  }

  // 3. Size trigger: hitting maxSize flushes exactly one batch with all items.
  {
    const sent = []
    const b = new Batcher((items) => sent.push(items), { maxSize: 3, flushMs: 10_000 })
    b.add({ n: 1 }); b.add({ n: 2 }); b.add({ n: 3 })
    assert.strictEqual(sent.length, 1, 'one flush on reaching maxSize')
    assert.strictEqual(sent[0].length, 3, 'batch contains all 3 items')
    b.add({ n: 4 })
    assert.strictEqual(sent.length, 1, 'buffer reset after flush — 4th item not yet sent')
    ok('flushes one batch on size trigger and resets buffer')
  }

  // 4. Timer trigger: a single item flushes after flushMs.
  {
    const sent = []
    const b = new Batcher((items) => sent.push(items), { maxSize: 100, flushMs: 50 })
    b.add({ n: 1 })
    assert.strictEqual(sent.length, 0, 'not sent immediately')
    await new Promise((r) => setTimeout(r, 90))
    assert.strictEqual(sent.length, 1, 'flushed after timer')
    assert.strictEqual(sent[0].length, 1, 'timer batch has the buffered item')
    ok('flushes on timer trigger')
  }

  // 5. Manual flush (stands in for beforeExit/forceFlush): sends what's buffered.
  {
    const sent = []
    const b = new Batcher((items) => sent.push(items), { maxSize: 100, flushMs: 10_000 })
    b.add({ n: 1 }); b.add({ n: 2 })
    b.flush()
    assert.strictEqual(sent.length, 1, 'manual flush sends buffered items')
    assert.strictEqual(sent[0].length, 2, 'flush batch has both items')
    b.flush()
    assert.strictEqual(sent.length, 1, 'flush on empty buffer is a no-op')
    ok('manual flush sends, empty flush is a no-op')
  }

  // 6. A throwing sink never propagates to the caller.
  {
    const b = new Batcher(() => { throw new Error('boom') }, { maxSize: 1, flushMs: 10_000 })
    assert.doesNotThrow(() => b.add({ n: 1 }), 'sink errors are swallowed')
    ok('sink errors do not throw into caller')
  }

  console.log(`\n${passed} checks passed`)
}

run().catch((e) => { console.error('FAILED:', e); process.exit(1) })
