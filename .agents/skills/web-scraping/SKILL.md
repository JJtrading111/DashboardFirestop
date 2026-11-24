---
name: web-scraping
description: Build and validate website scrapers and import extracted project data into the Bouwberichten Dashboard. Use for website extraction, scraper development, and preparing Crawlee or Apify jobs.
license: MIT
---

# Web scraping

Adapted from [yfe404/web-scraper](https://github.com/yfe404/web-scraper), pinned in `UPSTREAM.json`. The original entrypoint is preserved in [UPSTREAM-SKILL.md](UPSTREAM-SKILL.md); its workflow, strategy guides, examples, and MIT license are included.

For the Bouwberichten Dashboard, first read [the project integration](references/bouwberichten.md). Use its import contract instead of creating leads through a browser administrator session.

## Choose an extraction method from evidence

Start with a small HTTP assessment of the supplied target URL. Look for a documented API or export, structured data, raw HTML, and pagination. Use a browser only when the required information needs rendering or authorized interaction. Confirm each selector or JSON path against real source data before calling it implemented.

Use the tools actually available in the session. Upstream functions such as `proxy_start` and `interceptor_chrome_*` describe a separate Proxy-MCP integration; installing this skill does not install those tools. For computer or browser interaction, follow the available computer-use interface. The upstream reconnaissance and implementation files remain useful as strategy references.

Start with a limited batch, validate completeness and field meaning, then handle pagination and retries. Keep source record identity and provenance. Leave unavailable contact information empty. Distinguish a prepared import from a scraper that has successfully fetched real data.

## Supporting guidance

- For assessment and method selection, read `workflows/reconnaissance.md` and the applicable file under `strategies/`.
- For scraper code, read `workflows/implementation.md` and the closest example under `examples/`.
- For an Apify job, read `workflows/productionization.md` and `apify/cli-workflow.md`. Use Crawlee and TypeScript where appropriate, and test a small local run before publishing.

Keep source credentials in the scraper's secret store and import credentials in its environment. Do not put either into source code, fixtures, command-line arguments, logs, or screenshots.