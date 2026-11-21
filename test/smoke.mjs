import assert from 'node:assert/strict'
import { apply, extractContent, extractSources, PROVIDER_ID } from '../index.js'

// A Responses payload with two web searches and one message.
const payload = {
  output: [
    {
      type: 'web_search_call',
      action: {
        type: 'search',
        sources: [
          { type: 'url', url: 'https://github.com/deepseek-ai/deepseek-harness/releases' },
          { type: 'url', url: 'https://example.com/duplicate' },
        ],
      },
    },
    {
      type: 'web_search_call',
      action: {
        sources: [
          { type: 'url', url: 'https://example.com/duplicate' },
          { type: 'url', url: 'https://www.deepseek.com/en/harness/' },
          { type: 'url', url: 'not-a-url' },
        ],
      },
    },
    {
      type: 'message',
      content: [
        {
          type: 'output_text',
          text: 'Latest release is picked from the sources.',
          annotations: [{ type: 'url_citation', url_citation: { url: 'https://docs.example.org/page', title: 'Docs' } }],
        },
      ],
    },
  ],
}

const sources = extractSources(payload)
assert.deepEqual(
  sources.map((s) => s.url),
  [
    'https://github.com/deepseek-ai/deepseek-harness/releases',
    'https://example.com/duplicate',
    'https://www.deepseek.com/en/harness/',
    'https://docs.example.org/page',
  ],
)
assert.equal(sources[3].title, 'Docs')
assert.equal(extractContent(payload), 'Latest release is picked from the sources.')

assert.equal(extractContent({ output: [] }), undefined)
assert.deepEqual(extractSources({ output: [] }), [])

// Applying registers exactly one search provider with the expected id.
let registered
const ctx = {
  get: () => undefined,
  web: { registerSearchProvider: (provider) => { registered = provider } },
  logger: { warn() {}, info() {}, error() {} },
}
apply(ctx, { apiKey: 'test-key' })
assert.ok(registered, 'provider was not registered')
assert.equal(registered.id, PROVIDER_ID)
assert.equal(registered.id, 'qwen-token-plan')
assert.equal(typeof registered.search, 'function')
assert.equal(registered.available(), true)

console.log('smoke: dsh-qwen-websearch ok')
