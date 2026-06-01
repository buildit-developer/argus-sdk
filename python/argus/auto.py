"""Auto-instrumentation — activated by ARGUS_KEY env var via .pth file."""
import os
import time
import uuid
import functools
from argus import _send_async

DEBUG = os.environ.get('ARGUS_DEBUG') == '1'
LANGCHAIN = os.environ.get('ARGUS_LANGCHAIN') == '1'


def _record(provider, model, status, input_tokens, output_tokens, start_ms):
    _send_async([{
        'trace_id': uuid.uuid4().hex + uuid.uuid4().hex[:16],
        'span_id': uuid.uuid4().hex[:16],
        'op_name': 'chat',
        'provider': provider,
        'model': model,
        'status': status,
        'input_tokens': input_tokens,
        'output_tokens': output_tokens,
        'latency_ms': int((time.time() * 1000) - start_ms),
        'start_ns': int(start_ms * 1e6),
        'options': [],
    }])


def _wrap(fn, provider, model_fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        start_ms = time.time() * 1000
        model = model_fn(args, kwargs)
        try:
            result = fn(*args, **kwargs)
            u = getattr(result, 'usage', None)
            _record(provider, model, 'OK',
                    getattr(u, 'input_tokens', None) or getattr(u, 'prompt_tokens', None),
                    getattr(u, 'output_tokens', None) or getattr(u, 'completion_tokens', None),
                    start_ms)
            return result
        except Exception:
            _record(provider, model, 'FAILED', None, None, start_ms)
            raise

    @functools.wraps(fn)
    async def async_wrapper(*args, **kwargs):
        start_ms = time.time() * 1000
        model = model_fn(args, kwargs)
        try:
            result = await fn(*args, **kwargs)
            u = getattr(result, 'usage', None)
            _record(provider, model, 'OK',
                    getattr(u, 'input_tokens', None) or getattr(u, 'prompt_tokens', None),
                    getattr(u, 'output_tokens', None) or getattr(u, 'completion_tokens', None),
                    start_ms)
            return result
        except Exception:
            _record(provider, model, 'FAILED', None, None, start_ms)
            raise

    import asyncio
    return async_wrapper if asyncio.iscoroutinefunction(fn) else wrapper


def _patch_anthropic():
    try:
        import anthropic
        if getattr(anthropic.resources.Messages, '__argus', False):
            return
        orig = anthropic.resources.Messages.create
        anthropic.resources.Messages.create = _wrap(
            orig, 'anthropic',
            lambda a, k: k.get('model') or (a[1] if len(a) > 1 else 'unknown')
        )
        anthropic.resources.Messages.__argus = True
        if DEBUG:
            print('[argus] patched anthropic')
    except Exception as e:
        if DEBUG:
            print(f'[argus] anthropic patch failed: {e}')


def _patch_openai():
    try:
        import openai
        if getattr(openai.resources.chat.Completions, '__argus', False):
            return
        orig = openai.resources.chat.Completions.create
        openai.resources.chat.Completions.create = _wrap(
            orig, 'openai',
            lambda a, k: k.get('model') or (a[1] if len(a) > 1 else 'unknown')
        )
        openai.resources.chat.Completions.__argus = True
        if DEBUG:
            print('[argus] patched openai')
    except Exception as e:
        if DEBUG:
            print(f'[argus] openai patch failed: {e}')


def _patch_langchain():
    try:
        from langchain.callbacks.base import BaseCallbackHandler
        from langchain.callbacks import set_handler

        class ArgusCallback(BaseCallbackHandler):
            def __init__(self):
                super().__init__()
                self._starts = {}

            def on_llm_start(self, serialized, prompts, *, run_id, **kwargs):
                name = (serialized.get('id') or ['unknown'])[-1]
                self._starts[str(run_id)] = {'start_ms': time.time() * 1000, 'model': name}

            def on_llm_end(self, response, *, run_id, **kwargs):
                s = self._starts.pop(str(run_id), None)
                if not s:
                    return
                u = getattr(response, 'llm_output', {}) or {}
                token_usage = u.get('token_usage') or u.get('usage') or {}
                _record('langchain', s['model'], 'OK',
                        token_usage.get('prompt_tokens') or token_usage.get('input_tokens'),
                        token_usage.get('completion_tokens') or token_usage.get('output_tokens'),
                        s['start_ms'])

            def on_llm_error(self, error, *, run_id, **kwargs):
                s = self._starts.pop(str(run_id), None)
                if s:
                    _record('langchain', s['model'], 'FAILED', None, None, s['start_ms'])

        set_handler(ArgusCallback())
        if DEBUG:
            print('[argus] patched langchain')
    except Exception as e:
        if DEBUG:
            print(f'[argus] langchain patch failed: {e}')


def patch_all():
    _patch_anthropic()
    _patch_openai()
    if LANGCHAIN:
        _patch_langchain()
    if DEBUG:
        print('[argus] auto-instrumentation active')
