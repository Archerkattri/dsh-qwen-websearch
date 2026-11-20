# Qwen web search

Adds a Qwen Token Plan search provider to DeepSeek Harness and pins `web_search`
to it.

## What it does

- Registers provider id `qwen-token-plan` with DSH's web service.
- Calls Qwen's Responses API with the built-in `web_search` tool, so Qwen does
  the retrieval and writes the answer.
- Summarizes with `qwen3.8-flash` by default and reports the search call's own
  source URLs as citations.
- Uses your Token Plan credits; DeepSeek's per-search endpoint is not used.

## Install

```bash
dsh plugin --profile <your-profile> add github:archerkattri/dsh-qwen-websearch
```

## Configure

Store a Qwen Token Plan key in the DSH credential store (Settings → Models, any
Qwen Token Plan provider) or export one of:

- `QWEN_TOKEN_PLAN_API_KEY`
- `QWEN_TOKEN_PLAN_INDIVIDUAL_API_KEY`

Then reload the page. `web_search` calls now run through Qwen; the provider is
listed as **Qwen Token Plan** in Settings → Web search.

## Limitations

- Needs a Token Plan key (`sk-sp-...`), not a pay-as-you-go key.
- The bundle pins the search provider by overriding the `web` row; a custom
  fetch provider must be preserved there or `web_fetch` becomes ambiguous.
- Each search consumes Token Plan tokens (search context + answer).
