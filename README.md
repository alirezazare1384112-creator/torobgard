# Tehran Shopping Agent (طرب‌گارد)

A Persian shopping assistant for Tehran, grounded entirely in the Torob dataset.
Search, filters, offer comparison, and shop discovery run without any LLM, and a
Persian RTL web UI plus a multi-step LLM shopping agent sit on top of the same data.

**Status:** Phase 1–8 — data audit & import, core tools, stdlib HTTP API, tests,
Persian RTL Next.js frontend, TypeScript tool port, and a **multi-step agentic
assistant** (ReAct loop with tool chaining, cross-turn memory, live streamed
reasoning trace, and a Persian/English profanity moderation layer).

## Repository layout

This repo has two layers that share one SQLite database:

| Path | Layer | Language |
|---|---|---|
| `tehran_agent/` | Data import + core tools + HTTP API (source of truth) | Python |
| `tests/` | Tests for the Python tools and API | Python |
| `scripts/audit_dataset.py` | Dataset profiling | Python |
| `docs/DATA_AUDIT.md` | Schema, field reliability, limitations | — |
| `web/` | Persian RTL Next.js frontend + TS tool port + agentic LLM assistant | TypeScript |

The `web/` app ports `tehran_agent/tools.py` to TypeScript and reads the same
`data/torob.sqlite` produced by `tehran_agent/importer.py` — so the real dataset
drops in with no code changes. See [`web/README.md`](web/README.md) for run steps.

## Dataset setup

This repository supports two source formats:

1. Extracted folder containing `shops.csv`, `products.csv`, `offers.csv`
2. ZIP file containing those CSV files (for example: `starcoach-dataset-v16-cap300-csv.zip`)

By default, large raw data files are ignored from git (`data/raw/`, `data/*.sqlite`).
If you want to publish the dataset for other AI tools in GitHub, use Git LFS or release assets.

## Run the Python tools

Requires Python 3.10+ (standard library only; no pip installs needed).

```bash
# 1) Build SQLite from an extracted directory
python -m tehran_agent.importer --src data/raw/torob-dataset --db data/torob.sqlite

# 2) Build SQLite directly from the ZIP archive
python -m tehran_agent.importer --src data/raw/starcoach-dataset-v16-cap300-csv.zip --db data/torob.sqlite

# 3) Run tests
python -m unittest discover -s tests -v

# 4) Run HTTP API
python -m tehran_agent.api --db data/torob.sqlite --host 127.0.0.1 --port 8000
```

Open: [http://127.0.0.1:8000](http://127.0.0.1:8000)

Useful endpoints:
- `/health`
- `/api/meta`
- `/api/search?q=ماوس+بی+سیم&max_price=1000000&limit=10`
- `/api/product/<product_id>`
- `/api/compare/<product_id>?sort=distance&near=صادقیه&radius_km=5`
- `/api/shops?sort=matching_offers&category=هدفون، هدست و هندزفری`
- `/api/alternatives/<product_id>?budget_toman=3000000&limit=8`
- `/api/trip?product_id=<id1>&product_id=<id2>&near=صادقیه&max_shops=2`

## Run the web frontend

```bash
cd web
bun install
# Build a sample DB for development (or point at the real importer output):
node --experimental-strip-types scripts/seed-torob.ts
bun run dev   # http://localhost:3000
```

See [`web/README.md`](web/README.md) for details, including how to use the real
dataset and the phrase-match fix for «ماوس بی‌سیم» vs «ماوس با سیم».

## The agentic assistant (web)

`POST /api/agent` runs a ReAct-style loop: the model emits
`{"thinking","remember","action"}` JSON each step, the server executes the action
(search → compare → trip → …) and feeds the observation back, up to 4 steps per
turn. The response is an NDJSON stream of `{type:"step"}` events plus a final
`{type:"done"}` payload, so the UI shows the agent's live reasoning trace, inline
product/shop cards, verify panels, and proactive suggestion chips.

Safety & tone:
- The system prompt enforces polite Persian, dataset honesty (no invented
  prices/ids), and a strict no-profanity rule — insults are never mirrored.
- `web/src/lib/torob/moderation.ts` adds defense in depth: tolerant
  Persian/English profanity matching (ZWNJ/space/repetition obfuscation, common
  suffixes) applied server-side to replies/thinking/questions and re-applied in
  the client before render; clean text passes through byte-for-byte unchanged.

## Layout

- `tehran_agent/importer.py` — CSV/ZIP → normalized SQLite import with price status flags
- `tehran_agent/normalize.py` — Persian text, null handling, budget parsing
- `tehran_agent/tools.py` — `search_products`, `get_product_details`, `compare_offers`, `find_shops`, `find_alternatives`, `plan_shopping_trip`
- `tehran_agent/api.py` — stdlib HTTP API exposing the tools
- `tests/test_core.py` — unit and database tests for core logic
- `tests/test_api.py` — HTTP API integration tests
- `scripts/audit_dataset.py` — dataset profiling
- `docs/DATA_AUDIT.md` — schema, field reliability, and limitations
- `web/` — Next.js 16 + Tailwind 4 + shadcn/ui Persian RTL frontend, TS port of the tools, and the multi-step LLM agent over the tools

## Data limitations

See [docs/DATA_AUDIT.md](docs/DATA_AUDIT.md). In short: shop names and contacts are synthetic,
prices may be about a week old or older, stock is not in the data, and about 4.5% of offers have no price.

## Publishing dataset to GitHub (for other AI agents)

The official dataset is large; committing directly to Git may fail on GitHub size limits.
Recommended options:

1. **Git LFS**
   - Track `data/raw/*.zip` and commit pointers in git.
   - Other tools can pull the real file using LFS.

2. **GitHub Release asset**
   - Create a release and upload the ZIP there.
   - Keep a stable download URL in `docs/DATA_AUDIT.md` or README.

3. **External object storage with checksum**
   - Keep download URL + SHA256 in repo docs.

This project now works with either extracted CSVs or a ZIP path, so downstream tools can use whichever distribution method you publish.
