/**
 * `dsh-qwen-websearch`
 *
 * A DeepSeek Harness `WebSearchProvider` backed by Qwen Token Plan's native web
 * search (Responses API + built-in `web_search` tool). Retrieval and
 * summarization run on prepaid Token Plan credits, with no DeepSeek per-search
 * fee, and the search call's own sources become the tool's citations.
 *
 * Plain JavaScript, no runtime imports, so it loads in any DSH profile.
 * Provider structure derived from umicorn07/dsh-web-search-qwen (MIT); the free
 * DuckDuckGo scrape was replaced with Qwen's native search because DuckDuckGo
 * now answers server-side scrapes with a bot-challenge page.
 */

export const name = 'web-search-qwen'

/** Required service injected from the DSH runtime. */
export const inject = ['web']

/** Stable provider id registered in `ctx.web`. */
export const PROVIDER_ID = 'qwen-token-plan'

const DEFAULT_API_KEY_ENV = 'QWEN_TOKEN_PLAN_API_KEY'
const DEFAULT_BASE_URL = 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'
const DEFAULT_MODEL = 'qwen3.8-flash'
const DEFAULT_SYSTEM_PROMPT = 'Search the live web to answer the query. Be concise and accurate.'
// Hard client-side ceiling below the tool's timeout budget, so a hung gateway
// fails with a clear error instead of stalling the tool call.
const REQUEST_TIMEOUT_MS = 110_000

function optionsOf(config) {
  return {
    apiKey: config?.apiKey,
    apiKeyEnv: config?.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
    baseURL: config?.baseURL ?? DEFAULT_BASE_URL,
    model: config?.model ?? DEFAULT_MODEL,
    systemPrompt: config?.systemPrompt,
    // Thinking at low effort keeps searches fast; disabling thinking entirely
    // makes the gateway hang on search queries, so `off` is not offered.
    effort: config?.effort ?? 'low',
    maxToolCalls: config?.maxToolCalls ?? 2,
  }
}

async function resolveKey(ctx, options) {
  if (typeof options.apiKey === 'string' && options.apiKey.length > 0) {
    return { value: options.apiKey, ref: 'apiKey' }
  }

  const refs = [...new Set([
    options.apiKeyEnv,
    'QWEN_TOKEN_PLAN_API_KEY',
    'QWEN_TOKEN_PLAN_INDIVIDUAL_API_KEY',
  ])]

  const credentials = (() => {
    try {
      return ctx.get?.('credentials')
    } catch {
      return undefined
    }
  })()

  for (const ref of refs) {
    if (credentials?.resolve) {
      try {
        const resolved = await credentials.resolve(ref)
        if (resolved?.value) return { value: resolved.value, ref }
      } catch {
        // Credential store unavailable for this reference; try the environment.
      }
    }
    if (process.env[ref]) return { value: process.env[ref], ref }
  }

  if (process.env.DASHSCOPE_API_KEY) {
    return { value: process.env.DASHSCOPE_API_KEY, ref: 'DASHSCOPE_API_KEY' }
  }
  return undefined
}

/**
 * Pull the answer text and citations out of a Responses API payload.
 * Web search results arrive as `web_search_call` items whose `action.sources`
 * list the URLs the search used; inline URL citations also count.
 */
export function extractSources(data) {
  const found = []
  const push = (url, title) => {
    if (typeof url !== 'string' || !url.startsWith('http')) return
    found.push({ url, title: title || url })
  }

  for (const item of data?.output ?? []) {
    if (item?.type === 'web_search_call') {
      for (const source of item.action?.sources ?? []) push(source?.url, source?.title)
    }
    if (item?.type === 'message') {
      for (const part of item.content ?? []) {
        for (const annotation of part?.annotations ?? []) {
          const citation = annotation?.url_citation ?? annotation
          push(citation?.url, citation?.title)
        }
      }
    }
  }

  const seen = new Set()
  return found.filter((source) => (seen.has(source.url) ? false : (seen.add(source.url), true)))
}

/** Concatenate the assistant message text from a Responses API payload. */
export function extractContent(data) {
  const parts = []
  for (const item of data?.output ?? []) {
    if (item?.type !== 'message') continue
    for (const part of item.content ?? []) {
      if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.length > 0) {
        parts.push(part.text)
      }
    }
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

function providerFor(ctx, config) {
  const options = optionsOf(config)

  return {
    id: PROVIDER_ID,
    title: 'Qwen Token Plan',
    description: 'Native Qwen web search on Token Plan credits; no DeepSeek per-search fee.',
    available() {
      return URL.canParse(options.baseURL) && options.model.length > 0
    },
    async search(request, signal) {
      const key = await resolveKey(ctx, options)
      if (!key) {
        const error = new Error(
          `Qwen web search needs a Token Plan API key. Store one under "${options.apiKeyEnv}" in Settings → Models, or export it.`,
        )
        error.code = 'WEB_PROVIDER_CREDENTIAL_MISSING'
        throw error
      }

      const endpoint = `${options.baseURL.replace(/\/+$/, '')}/responses`
      const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      const requestSignal = signal !== undefined ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
      let response
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          headers: {
            Authorization: `Bearer ${key.value}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            instructions: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
            input: request.query,
            tools: [{ type: 'web_search' }],
            reasoning_effort: options.effort,
            max_tool_calls: options.maxToolCalls,
          }),
          signal: requestSignal,
        })
      } catch (error) {
        if (signal?.aborted) throw error
        const timedOut = timeoutSignal.aborted
        const wrapped = new Error(
          timedOut
            ? `Qwen web search timed out after ${REQUEST_TIMEOUT_MS / 1000}s; retry or simplify the query.`
            : `Qwen web search request failed: ${String(error?.message ?? error)}`,
        )
        wrapped.code = timedOut ? 'WEB_SEARCH_TIMEOUT' : 'WEB_SEARCH_FAILED'
        throw wrapped
      }

      const text = await response.text()
      if (!response.ok) {
        const error = new Error(`Qwen web search failed (HTTP ${response.status}): ${text.slice(0, 300)}`)
        error.code = 'WEB_SEARCH_FAILED'
        throw error
      }

      let data
      try {
        data = JSON.parse(text)
      } catch {
        const error = new Error('Qwen web search returned a non-JSON body.')
        error.code = 'WEB_SEARCH_FAILED'
        throw error
      }
      if (data?.error) {
        const error = new Error(`Qwen web search failed: ${data.error.message ?? JSON.stringify(data.error).slice(0, 300)}`)
        error.code = 'WEB_SEARCH_FAILED'
        throw error
      }

      return {
        content: extractContent(data),
        sources: extractSources(data),
        truncated: false,
      }
    },
  }
}

export function apply(ctx, config = {}) {
  ctx.web.registerSearchProvider(providerFor(ctx, config))
}
