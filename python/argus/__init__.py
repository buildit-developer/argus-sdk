import os
import time
import uuid
import json
import threading
import urllib.request
from typing import Callable, Any, Optional

_endpoint: str = os.getenv("ARGUS_ENDPOINT", "").rstrip("/")
_api_key: str = os.getenv("ARGUS_KEY", "")


def init(endpoint: str = "", api_key: str = "") -> None:
    global _endpoint, _api_key
    if endpoint:
        _endpoint = endpoint.rstrip("/")
    if api_key:
        _api_key = api_key


def _send(attempts: list) -> None:
    if not _endpoint or not _api_key or not attempts:
        return
    body = json.dumps({"attempts": attempts}).encode()
    req = urllib.request.Request(
        f"{_endpoint}/api/argus/ingest",
        data=body,
        headers={"Content-Type": "application/json", "X-API-Key": _api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5):
            pass
    except Exception:
        pass


def _send_async(attempts: list) -> None:
    threading.Thread(target=_send, args=(attempts,), daemon=True).start()


def track(
    provider: str,
    model: str,
    fn: Callable[[], Any],
    op_name: str = "model_request",
    options: Optional[list] = None,
) -> Any:
    trace_id = uuid.uuid4().hex + uuid.uuid4().hex[:16]
    span_id = uuid.uuid4().hex[:16]
    start_ms = time.time()
    status = "OK"
    input_tokens = output_tokens = None
    result = None

    try:
        result = fn()
        usage = getattr(result, "usage", None)
        if usage:
            input_tokens = getattr(usage, "input_tokens", None) or getattr(usage, "prompt_tokens", None)
            output_tokens = getattr(usage, "output_tokens", None) or getattr(usage, "completion_tokens", None)
    except Exception:
        status = "FAILED"
        raise
    finally:
        latency_ms = int((time.time() - start_ms) * 1000)
        _send_async([{
            "trace_id": trace_id,
            "span_id": span_id,
            "op_name": op_name,
            "provider": provider,
            "model": model,
            "status": status,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "latency_ms": latency_ms,
            "start_ns": int(start_ms * 1e9),
            "options": options or [],
        }])
    return result


def wrap_anthropic(client):
    """Patch an Anthropic client so messages.create is auto-tracked."""
    original = client.messages.create

    def patched(model, **kwargs):
        return track(
            provider="anthropic",
            model=model,
            op_name="chat",
            fn=lambda: original(model=model, **kwargs),
        )

    client.messages.create = patched
    return client


def wrap_openai(client):
    """Patch an OpenAI client so chat.completions.create is auto-tracked."""
    original = client.chat.completions.create

    def patched(*args, **kwargs):
        model = kwargs.get("model") or (args[0] if args else "unknown")
        return track(
            provider="openai",
            model=model,
            op_name="chat",
            fn=lambda: original(*args, **kwargs),
        )

    client.chat.completions.create = patched
    return client
