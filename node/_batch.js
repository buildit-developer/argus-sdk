'use strict'

/**
 * Generic batcher for Argus ingest records.
 *
 * Buffers items in memory and flushes them as a single batch when EITHER:
 *   - the buffer reaches BATCH_SIZE items, OR
 *   - FLUSH_MS elapse after the first un-sent item was added,
 * whichever comes first. It also flushes on graceful process exit
 * (`beforeExit`) so buffered records aren't lost on a clean shutdown.
 *
 * Delivery is best-effort: the timer is `unref()`'d so it never keeps the
 * process alive, and the sink is never allowed to throw into the caller.
 * Records buffered when the process is hard-killed (SIGKILL / power loss)
 * are lost — that's the trade-off for fewer HTTP round-trips.
 */

const BATCH_SIZE = 20
const FLUSH_MS = 5000

class Batcher {
  // sink(items[]) performs the actual delivery (e.g. the HTTP POST).
  // maxSize/flushMs default to the hardcoded constants; they are overridable
  // only to keep the unit tests fast — call sites never pass them.
  constructor(sink, { maxSize = BATCH_SIZE, flushMs = FLUSH_MS } = {}) {
    this._sink = sink
    this._maxSize = maxSize
    this._flushMs = flushMs
    this._buf = []
    this._timer = null
    this._exitHooked = false
  }

  add(item) {
    this._buf.push(item)
    if (this._buf.length >= this._maxSize) {
      this.flush()
      return
    }
    this._arm()
    this._hookExit()
  }

  _arm() {
    if (this._timer) return
    this._timer = setTimeout(() => {
      this._timer = null
      this.flush()
    }, this._flushMs)
    if (this._timer.unref) this._timer.unref()
  }

  _hookExit() {
    if (this._exitHooked) return
    this._exitHooked = true
    process.on('beforeExit', () => this.flush())
  }

  flush() {
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
    if (!this._buf.length) return
    const items = this._buf
    this._buf = []
    try {
      this._sink(items)
    } catch (_) {
      // delivery is best-effort; never throw into the caller
    }
  }
}

module.exports = { Batcher, BATCH_SIZE, FLUSH_MS }
