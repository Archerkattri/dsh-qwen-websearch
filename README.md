# dsh-qwen-websearch

Web search for **DeepSeek Harness (dsh)** backed by **Qwen Token Plan**.

It registers a DSH `WebSearchProvider` that runs Qwen's native web search
(Responses API + built-in `web_search` tool) on your Token Plan credits and
summarizes results with **Qwen3.8 Flash**, returning the search call's own
source URLs as citations. No DeepSeek per-search endpoint is used.

## Why this provider

- **Native search, real sources.** Retrieval and summarization happen in one
  Qwen request; the web search call reports the URLs it used, so `web_search`
  lists sources the way the tool expects.
- **No DeepSeek per-search fee.** Searches are billed as Token Plan tokens.
- **No scraping.** The original community plugin scraped DuckDuckGo, which now
  responds to server-side fetches with a bot-challenge page. This provider uses
  Qwen's server-side search instead.

## Install

From GitHub:

```bash
dsh plugin --profile <your-profile> add github:archerkattri/dsh-qwen-websearch
```

Or open **Plugins → Add plugin** and choose the checked-out directory.

## Configure

1. Store a Qwen Token Plan API key (`sk-sp-...`).
   - Easiest: **Settings → Models → Qwen4 (Token Plan)** (or any Qwen Token Plan
     provider) and save the key. It lands in the DSH credential store.
   - Or export `QWEN_TOKEN_PLAN_API_KEY`, or `QWEN_TOKEN_PLAN_INDIVIDUAL_API_KEY`.
   - The plugin tries `apiKeyEnv` first, then `QWEN_TOKEN_PLAN_API_KEY`, then
     `QWEN_TOKEN_PLAN_INDIVIDUAL_API_KEY`, then `DASHSCOPE_API_KEY`.
2. Nothing else is required: the bundle pins `web.searchProvider` to
   `qwen-token-plan`, so the existing `web_search` tool uses it immediately.
3. Optionally set the summarizer model in the provider row (`model:`, default
   `qwen3.8-flash`).

Check **Settings → Web search**: the provider appears as **Qwen Token Plan**.

## Configuration reference

Bundle patch:

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: qwen-token-plan
    fetchProvider: http
- insert:
    - id: web-search-qwen
      name: 'dsh-qwen-websearch'
      config:
        baseURL: https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
        model: qwen3.8-flash
```

Provider options (row `config`):

| Field | Default | Meaning |
|---|---|---|
| `apiKeyEnv` | `QWEN_TOKEN_PLAN_API_KEY` | First credential reference to try |
| `apiKey` | — | Literal key (prefer `apiKeyEnv`) |
| `baseURL` | `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` | Qwen Token Plan endpoint |
| `model` | `qwen3.8-flash` | Summarizer model |
| `effort` | `low` | Thinking effort for the search request (`low`/`medium`/`xhigh`) |
| `maxToolCalls` | `2` | Cap on server-side search calls per query |
| `systemPrompt` | built in | Search-answer instructions |

Calling Qwen: `POST {baseURL}/responses` with `tools: [{ "type": "web_search" }]`,
`reasoning_effort`, and `max_tool_calls`.

### Speed and timeouts

Measured against the Singapore Token Plan endpoint: a forced web search takes
~35 s at the model's default thinking level, ~22 s at `low`, and ~11 s with
`max_tool_calls: 2` — the shipped defaults. Disabling thinking entirely
(`enable_thinking: false`) makes search queries hang, so the provider keeps
thinking on at `low`. Each request also has a hard 110 s client-side ceiling
that fails with `WEB_SEARCH_TIMEOUT` instead of stalling.

DSH's `web_search` tool has its own timeout budget (`tool-web`
`searchTimeoutMs`, default 30 s). If searches time out, raise it, e.g. in your
profile patch:

```yaml
- id: tool-web
  config:
    searchTimeoutMs: 120000
```

## Notes and limitations

- The bundle overrides the `web` row to pin the search provider and keep
  `fetchProvider: http`. If you use a different fetch provider, delete that
  override or change the value; otherwise `web_fetch` becomes ambiguous.
- If another search provider is also usable and you remove the pin, DSH reports
  `WEB_PROVIDER_AMBIGUOUS` until you pin one in **Settings → Web search**.
- Each search is a full Qwen request (search results included in the prompt), so
  it consumes Token Plan tokens; there is no separate per-search fee.
- Requires a Token Plan key; pay-as-you-go keys are not interchangeable.

## Credits

Provider structure based on
[umicorn07/dsh-web-search-qwen](https://github.com/umicorn07/dsh-web-search-qwen)
(MIT), with DuckDuckGo retrieval replaced by Qwen's native Responses `web_search`
tool and Qwen3.8 Flash summarization.

## Related

- [dsh-qwen4-effort](https://github.com/Archerkattri/dsh-qwen4-effort) — official Qwen4 effort levels for Qwen4 models on an existing Qwen Token Plan route.

## License

MIT
