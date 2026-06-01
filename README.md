# Argus SDK

Track per-call LLM cost and latency across Anthropic and OpenAI — for Node.js and Python.

Built for [buildit.sh](https://buildit.sh) Argus observability dashboard.

---

## Node.js

```bash
npm install argus-node
```

```js
const argus = require('argus-node')

argus.init({
  endpoint: 'https://api.buildit.sh',
  apiKey: 'bld_live_...',   // from buildit.sh → Settings → API Keys
})

// Wrap your Anthropic client — all calls tracked automatically
const Anthropic = require('@anthropic-ai/sdk')
const client = argus.wrapAnthropic(new Anthropic())

const msg = await client.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello' }],
})
```

Also works with OpenAI:

```js
const { OpenAI } = require('openai')
const client = argus.wrapOpenAI(new OpenAI())
```

Manual tracking for any other provider:

```js
const result = await argus.track({
  provider: 'my-provider',
  model: 'my-model',
  opName: 'chat',
  fn: () => myLLMCall(),
})
```

---

## Python

```bash
pip install argus-python
```

```python
import argus

argus.init(endpoint='https://api.buildit.sh', api_key='bld_live_...')

import anthropic
client = argus.wrap_anthropic(anthropic.Anthropic())

msg = client.messages.create(
    model='claude-haiku-4-5-20251001',
    max_tokens=1024,
    messages=[{'role': 'user', 'content': 'Hello'}],
)
```

---

## Get an API key

1. Go to [app.buildit.sh](https://app.buildit.sh) → Settings → API Keys
2. Create a key
3. Pass it to `argus.init()`
