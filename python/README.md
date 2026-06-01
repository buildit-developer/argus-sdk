# buildit-argus

Track per-call LLM cost and latency for Python apps — powered by the [Argus](https://app.buildit.sh/argus) observability dashboard.

Zero dependencies. Works with Anthropic, OpenAI, or any provider via manual tracking.

---

## Installation

```bash
pip install buildit-argus
```

---

## Quick start

```python
import argus

argus.init(
    endpoint='https://api.buildit.sh',
    api_key='bld_live_...',  # Settings → API Keys on app.buildit.sh
)
```

---

## Usage

### Anthropic

Wrap your Anthropic client once — every `messages.create` call is tracked automatically.

```python
import anthropic
import argus

argus.init(endpoint='https://api.buildit.sh', api_key='bld_live_...')

client = argus.wrap_anthropic(anthropic.Anthropic())

msg = client.messages.create(
    model='claude-haiku-4-5-20251001',
    max_tokens=1024,
    messages=[{'role': 'user', 'content': 'Hello'}],
)
```

### OpenAI

```python
from openai import OpenAI
import argus

argus.init(endpoint='https://api.buildit.sh', api_key='bld_live_...')

client = argus.wrap_openai(OpenAI())

res = client.chat.completions.create(
    model='gpt-4o-mini',
    messages=[{'role': 'user', 'content': 'Hello'}],
)
```

### Manual tracking

```python
result = argus.track(
    provider='my-provider',
    model='my-model-v1',
    fn=lambda: my_llm_call(),
    op_name='chat',  # optional label shown in dashboard
)
```

---

## API

### `argus.init(endpoint, api_key)`

| Param | Default | Description |
|---|---|---|
| `endpoint` | `ARGUS_ENDPOINT` env var | Your Argus ingest URL |
| `api_key` | `ARGUS_KEY` env var | API key from buildit.sh |

### `argus.wrap_anthropic(client)`

Patches `client.messages.create` to auto-track every call. Returns the same client.

### `argus.wrap_openai(client)`

Patches `client.chat.completions.create` to auto-track every call. Returns the same client.

### `argus.track(provider, model, fn, op_name, options)`

| Param | Type | Description |
|---|---|---|
| `provider` | `str` | Provider name (e.g. `anthropic`, `openai`) |
| `model` | `str` | Model ID |
| `fn` | `callable` | The call to wrap |
| `op_name` | `str` | Optional label shown in dashboard |
| `options` | `list` | Optional feature flags |

---

## Environment variables

```bash
export ARGUS_ENDPOINT=https://api.buildit.sh
export ARGUS_KEY=bld_live_...
```

If set, you don't need to call `argus.init()`.

---

## Get an API key

1. Sign in at [app.buildit.sh](https://app.buildit.sh)
2. Go to **Settings → API Keys**
3. Click **Create key**
4. Pass it to `argus.init()` or set `ARGUS_KEY` in your environment

---

## License

MIT
