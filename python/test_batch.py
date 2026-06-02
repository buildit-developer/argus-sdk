"""Unit test for the Argus Python batcher (no network).

Run: python3 test_batch.py
"""
import time
import argus


def reset(batch_size, flush_ms, captured):
    """Point the SDK at a capturing sink and tune batch params for the test."""
    argus._buf.clear()
    argus._timer = None
    argus._BATCH_SIZE = batch_size
    argus._FLUSH_MS = flush_ms
    argus._send = lambda items: captured.append(("sync", list(items)))
    argus._send_async = lambda items: captured.append(("async", list(items)))


def main():
    passed = 0

    # 1. Below batch size: buffered, nothing sent.
    captured = []
    reset(5, 10_000, captured)
    argus._enqueue({"n": 1})
    argus._enqueue({"n": 2})
    assert captured == [], "should buffer below batch size"
    assert len(argus._buf) == 2
    print("  ok: buffers below batch size"); passed += 1

    # 2. Size trigger: hitting batch size flushes one batch with all items.
    captured = []
    reset(3, 10_000, captured)
    argus._enqueue({"n": 1}); argus._enqueue({"n": 2}); argus._enqueue({"n": 3})
    assert len(captured) == 1, f"expected 1 flush, got {len(captured)}"
    assert len(captured[0][1]) == 3, "batch should hold all 3 items"
    assert len(argus._buf) == 0, "buffer reset after flush"
    print("  ok: flushes one batch on size trigger and resets buffer"); passed += 1

    # 3. Timer trigger: a single item flushes after FLUSH_MS.
    captured = []
    reset(100, 50, captured)  # 50ms
    argus._enqueue({"n": 1})
    assert captured == [], "not sent immediately"
    time.sleep(0.12)
    assert len(captured) == 1, "flushed after timer"
    assert len(captured[0][1]) == 1
    print("  ok: flushes on timer trigger"); passed += 1

    # 4. _flush_sync (atexit path) sends buffered items synchronously.
    captured = []
    reset(100, 10_000, captured)
    argus._enqueue({"n": 1}); argus._enqueue({"n": 2})
    argus._flush_sync()
    assert len(captured) == 1, "flush_sync sends buffered items"
    assert captured[0][0] == "sync", "atexit flush uses the synchronous sender"
    assert len(captured[0][1]) == 2
    argus._flush_sync()
    assert len(captured) == 1, "flush on empty buffer is a no-op"
    print("  ok: atexit flush_sync sends synchronously, empty flush is a no-op"); passed += 1

    print(f"\n{passed} checks passed")


if __name__ == "__main__":
    main()
