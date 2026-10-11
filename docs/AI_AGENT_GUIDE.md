# AI Agent Operational Guide — PPAPP Provider Repository

> **Authoritative System Guide for Autonomous & Assisted AI Agents Working on Pustaka Terbuka — PPAPP Data Provider.**

Welcome, AI Agent. This document is your operational blueprint for the **PPAPP provider repository** (`pustaka-terbuka/ppapp`). It defines provider invariants, harvester lifecycles, and concurrency rules within the broader Pustaka Terbuka ecosystem.

---

## 1. Provider Identity & Ecosystem Role

* **Institution:** Perbadanan Perpustakaan Awam Pulau Pinang (Penang Public Library Corporation)
* **Provider Code:** `ppapp`
* **Union Catalog Priority:** **8** (Public library regional collection)
* **Target ILS:** Koha Integrated Library System
* **Host Domain:** `https://opac.penanglib.gov.my/`
* **Master Union Catalog:** [`pustaka-terbuka/master`](https://github.com/pustaka-terbuka/master)

This repository is dedicated exclusively to harvesting, validating, and maintaining bibliographic data from PPAPP.

---

## 2. Core Invariants & Rules

1. **Native Tag & Holding Fidelity:**
   - Preserve all original tags extracted from Koha export:
     - `001`: Koha sequential `biblionumber` (e.g. `331738`).
     - `003`: Organization code (`PPAPP`).
     - `020`: ISBN strings.
     - `082` / `090`: Dewey Decimal (DDC) call numbers.
     - `952`: Branch holdings, item barcodes, shelf locations (`PUS`, `GT`, `BIP`, etc.).
2. **Politeness & Rate-Limiting:**
   - Harvester requests must enforce a **minimum 2,000 ms sleep delay** between HTTP GET requests to `opac.penanglib.gov.my`.
   - Never remove or reduce this delay during automated runs.
3. **No Direct Overwrite of Master:**
   - Never commit `master` build artifacts or attempt to modify `pustaka-terbuka/master` files from within this repository.
   - All cross-institution deduplication, Crockford Base32 ID assignment, and Pagefind indexing are managed downstream in `master`.

---

## 3. Multi-Organization Harvester Concurrency & Conflict Prevention

### 3.1 Why Concurrent Harvesters Do Not Conflict
Pustaka Terbuka is intentionally architected with **decoupled, per-organization repositories**. You can run the PPAPP harvester concurrently with harvesters from other institutions (such as PNM or other state libraries) on the same machine without collisions:
* **Separate Filesystem:** Scrapers write strictly into their own `harvest/inbox/<source-code>/` directory trees.
* **Separate OPAC Hosts:** PPAPP queries `opac.penanglib.gov.my`, whereas PNM queries `ap.iiivega.com`. They do not share network sockets or API rate limits.
* **Deterministic Priority Deduplication:** If PPAPP and PNM have records for the same book, `master` automatically applies the priority matrix (`PNM=10`, `PPAPP=8`), keeping the higher-priority bibliographic description while safely retaining PPAPP's holdings (`952`).

### 3.2 The 3 Golden Operational Rules
1. **Rule 1: Maximum One Active Harvester Worker for PPAPP.**
   - While you can run PPAPP and PNM simultaneously in separate terminals, **never run multiple crawler processes against PPAPP's Koha endpoint at the same time**. Spawning multiple concurrent scrapers against Koha will trigger server-side rate limits or firewall blocks.
2. **Rule 2: Sequential Master Ingestion.**
   - Harvesting runs in parallel, but union ingestion inside `master` (`node tools/build.js`) must be executed sequentially.
3. **Rule 3: Machine Resource Budgeting.**
   - With a 2,000 ms politeness delay, the PPAPP Node.js scraper spends ~95% of its time idling and consumes under 80 MB RAM. Running multiple provider scrapers in parallel is very light on system resources.

---

## 4. Execution Runbook

```bash
# 1. Run unit test suite
npm test

# 2. Run sample test crawl (10 records)
npm run harvest:sample

# 3. Run production crawl
npm run harvest

# 4. Resume interrupted crawl
node tools/harvesters/ppapp/harvester.js --resume auto
```

---

## 5. Directory Structure Map

```text
ppapp/
├── docs/
│   ├── AI_AGENT_GUIDE.md        # This operational manual
│   └── HARVESTER.md             # Institution-specific runbook
├── harvest/
│   └── inbox/ppapp/<run-id>/    # Output batches (manifest.json, records/, provenance.jsonl)
├── tests/
│   └── harvester-ppapp.test.js  # Automated tests (Node test runner)
├── tools/
│   └── harvesters/ppapp/
│       └── harvester.js         # Koha MARCXML crawler engine
├── package.json
└── README.md
```
