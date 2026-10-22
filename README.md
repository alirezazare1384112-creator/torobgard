# Tehran Shopping Agent (ترب‌گرد)

A Persian shopping assistant for Tehran, grounded entirely in the Torob dataset.
Search, filters, offer comparison, and shop discovery run without any LLM, and a
Persian RTL web UI plus an optional LLM shopping agent sit on top of the same data.

**Status:** Phase 1–2 (data audit, import, core tools, tests) **+ Phase 3 (Persian RTL
Next.js frontend, TypeScript tool port, LLM agent UI)**.

## Repository layout

This repo has two layers that share one SQLite database:

| Path | Layer | Language |
|---|---|---|
| `tehran_agent/` | Data import + core tools (source of truth) | Python |
| `tests/` | Tests for the Python tools | Python |
| `scripts/audit_dataset.py` | Dataset profiling | Python |
| `docs/DATA_AUDIT.md` | Schema, field reliability, limitations | — |
| `web/` | Persian RTL Next.js frontend + TS tool port + LLM agent UI | TypeScript |

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

## Layout

- `tehran_agent/importer.py` — CSV/ZIP → normalized SQLite import with price status flags
- `tehran_agent/normalize.py` — Persian text, null handling, budget parsing
- `tehran_agent/tools.py` — `search_products`, `get_product_details`, `compare_offers`, `find_shops`, `find_alternatives`, `plan_shopping_trip`
- `tehran_agent/api.py` — stdlib HTTP API exposing the tools
- `tests/test_core.py` — unit and database tests for core logic
- `tests/test_api.py` — HTTP API integration tests
- `scripts/audit_dataset.py` — dataset profiling
- `docs/DATA_AUDIT.md` — schema, field reliability, and limitations
- `web/` — Next.js 16 + Tailwind 4 + shadcn/ui Persian RTL frontend, TS port of the tools, and an LLM agent over the 6 tools

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
