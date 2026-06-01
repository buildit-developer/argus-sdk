# @buildit-developer/argus-node

Track per-call LLM cost and latency for Node.js apps — powered by the [Argus](https://app.buildit.sh/argus) observability dashboard.

Zero dependencies. Works with Anthropic, OpenAI, or any provider via manual tracking.

---

## Installation

```bash
npm install @buildit-developer/argus-node
```

---

## Quick start

```js
const argus = require('@buildit-developer/argus-node')

argus.init({
  endpoint: 'https://api.buildit.sh',
  apiKey: 'bld_live_...',  // Settings → API Keys on app.buildit.sh
})
```

---

## Usage

### Anthropic

Wrap your Anthropic client once — every `messages.create` call is tracked automatically.

```js
const Anthropic = require('@anthropic-ai/sdk')
const argus = require('@buildit-developer/argus-node')

argus.init({ endpoint: 'https://api.buildit.sh', apiKey: process.env.ARGUS_KEY })

const client = argus.wrapAnthropic(new Anthropic())

const msg = await client.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello' }],
})
```

### OpenAI

```js
const { OpenAI } = require('openai')
const argus = require('@buildit-developer/argus-node')

argus.init({ endpoint: 'https://api.buildit.sh', apiKey: process.env.ARGUS_KEY })

const client = argus.wrapOpenAI(new OpenAI())

const res = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello' }],
})
```

### Manual tracking

For any other provider or custom call:

```js
const result = await argus.track({
  provider: 'my-provider',
  model: 'my-model-v1',
  opName: 'chat',           // optional label shown in the dashboard
  fn: () => myLLMCall(),    // the async function to run and track
})
```

---

## API

### `argus.init(options)`

| Option | Type | Default | Description |
|---|---|---|---|
| `endpoint` | `string` | `process.env.ARGUS_ENDPOINT` | Your Argus ingest URL |
| `apiKey` | `string` | `process.env.ARGUS_KEY` | API key from buildit.sh |

### `argus.wrapAnthropic(client)`

Patches `client.messages.create` to auto-track every call. Returns the same client.

### `argus.wrapOpenAI(client)`

Patches `client.chat.completions.create` to auto-track every call. Returns the same client.

### `argus.track(options)`

| Option | Type | Description |
|---|---|---|
| `provider` | `string` | Provider name (e.g. `anthropic`, `openai`) |
| `model` | `string` | Model ID |
| `fn` | `async function` | The call to wrap |
| `opName` | `string` | Optional label shown in dashboard |
| `options` | `string[]` | Optional feature flags (e.g. `['diarization']`) |

---

## Environment variables

```bash
ARGUS_ENDPOINT=https://api.buildit.sh
ARGUS_KEY=bld_live_...
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
