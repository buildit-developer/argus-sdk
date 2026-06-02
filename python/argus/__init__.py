import os
import time
import uuid
import json
import atexit
import threading
import urllib.request
from typing import Callable, Any, Optional

_endpoint: str = os.getenv("ARGUS_ENDPOINT", "https://api.buildit.sh").rstrip("/")
_api_key: str = os.getenv("ARGUS_KEY", "")


def init(endpoint: str = "", api_key: str = "") -> None:
    global _endpoint, _api_key
    if endpoint:
        _endpoint = endpoint.rstrip("/")
    if api_key:
        _api_key = api_key


def _send(attempts: list) -> None:
    if not _api_key or not attempts:
        return
    body = json.dumps({"attempts": attempts}).encode()
    req = urllib.request.Request(
        f"{_endpoint}/api/argus/ingest",
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-API-Key": _api_key,
            "User-Agent": "argus-python/sdk",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5):
            pass
    except Exception:
        pass


def _send_async(attempts: list) -> None:
    threading.Thread(target=_send, args=(attempts,), daemon=True).start()


# ── Batching ────────────────────────────────────────────────────────────────
# Buffer attempts and POST them as one batch when the buffer fills (BATCH_SIZE)
# or FLUSH_MS elapse after the first un-sent attempt, whichever comes first.
# An atexit hook flushes synchronously on interpreter shutdown so buffered
# attempts aren't lost on a clean exit. Attempts buffered when the process is
# hard-killed are lost — the trade-off for fewer HTTP round-trips.
_BATCH_SIZE = 20
_FLUSH_MS = 5000
_buf: list = []
_buf_lock = threading.Lock()
_timer: Optional[threading.Timer] = None


def _enqueue(attempt: dict) -> None:
    global _timer
    to_send = None
    with _buf_lock:
        _buf.append(attempt)
        if len(_buf) >= _BATCH_SIZE:
            to_send = _buf[:]
            _buf.clear()
            if _timer is not None:
                _timer.cancel()
                _timer = None
        elif _timer is None:
            _timer = threading.Timer(_FLUSH_MS / 1000.0, _flush_timer)
            _timer.daemon = True
            _timer.start()
    if to_send is not None:
        _send_async(to_send)


def _flush_timer() -> None:
    global _timer
    with _buf_lock:
        _timer = None
        if not _buf:
            return
        batch = _buf[:]
        _buf.clear()
    _send_async(batch)


def _flush_sync() -> None:
    # Runs at interpreter exit — send on the current thread so it completes
    # before shutdown (a freshly spawned daemon thread might be killed mid-flight).
    global _timer
    with _buf_lock:
        if _timer is not None:
            _timer.cancel()
            _timer = None
        if not _buf:
            return
        batch = _buf[:]
        _buf.clear()
    _send(batch)


atexit.register(_flush_sync)


def track(
    provider: str,
    model: str,
    fn: Callable[[], Any],
    op_name: str = "model_request",
    options: Optional[list] = None,
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
    agent_type: Optional[str] = None,
) -> Any:
    trace_id = uuid.uuid4().hex + uuid.uuid4().hex[:16]
    span_id = uuid.uuid4().hex[:16]
    start_ms = time.time()
    status = "OK"
    input_tokens = output_tokens = cached_input_tokens = None
    finish_reason = None
    result = None

    try:
        result = fn()
        usage = getattr(result, "usage", None)
        if usage:
            input_tokens = getattr(usage, "input_tokens", None) or getattr(usage, "prompt_tokens", None)
            output_tokens = getattr(usage, "output_tokens", None) or getattr(usage, "completion_tokens", None)
            # Anthropic prompt cache
            cache_read = getattr(usage, "cache_read_input_tokens", None)
            cache_creation = getattr(usage, "cache_creation_input_tokens", None)
            if cache_read is not None or cache_creation is not None:
                cached_input_tokens = (cache_read or 0) + (cache_creation or 0)
        # stop_reason on Anthropic, finish_reason on OpenAI
        finish_reason = getattr(result, "stop_reason", None) or getattr(result, "finish_reason", None)
        if finish_reason is None:
            choices = getattr(result, "choices", None)
            if choices:
                finish_reason = getattr(choices[0], "finish_reason", None)
    except Exception:
        status = "FAILED"
        raise
    finally:
        latency_ms = int((time.time() - start_ms) * 1000)
        attempt = {
            "trace_id": trace_id,
            "span_id": span_id,
            "op_name": op_name,
            "provider": provider,
            "model": model,
            "status": status,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cached_input_tokens": cached_input_tokens,
            "finish_reason": finish_reason,
            "latency_ms": latency_ms,
            "start_ns": int(start_ms * 1e9),
            "options": options or [],
        }
        if user_id is not None:
            attempt["user_id"] = user_id
        if session_id is not None:
            attempt["session_id"] = session_id
        if agent_type is not None:
            attempt["agent_type"] = agent_type
        _enqueue(attempt)
    return result


def wrap_anthropic(client, user_id: Optional[str] = None, session_id: Optional[str] = None):
    """Patch an Anthropic client so messages.create is auto-tracked."""
    original = client.messages.create

    def patched(model, **kwargs):
        return track(
            provider="anthropic",
            model=model,
            op_name="messages.create",
            fn=lambda: original(model=model, **kwargs),
            user_id=user_id,
            session_id=session_id,
        )

    client.messages.create = patched
    return client


def wrap_openai(client, user_id: Optional[str] = None, session_id: Optional[str] = None):
    """Patch an OpenAI client so chat.completions.create is auto-tracked."""
    original = client.chat.completions.create

    def patched(*args, **kwargs):
        model = kwargs.get("model") or (args[0] if args else "unknown")
        return track(
            provider="openai",
            model=model,
            op_name="chat.completions.create",
            fn=lambda: original(*args, **kwargs),
            user_id=user_id,
            session_id=session_id,
        )

    client.chat.completions.create = patched
    return client
