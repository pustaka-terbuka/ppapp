# Pustaka Terbuka — PPAPP Data Provider

> **PustakaTerbuka: an open, shared MARC catalog for Malaysian schools and libraries.**  
> *Official Perbadanan Perpustakaan Awam Pulau Pinang (PPAPP) Bibliographic Dataset and Harvester.*

This repository contains the MARCXML bibliographic catalog harvested from **Perbadanan Perpustakaan Awam Pulau Pinang (PPAPP)** for consumption by the Pustaka Terbuka Union Catalog ([`pustaka-terbuka/master`](https://github.com/pustaka-terbuka/master)).

---

## Catalog Overview

- **Source Code:** `ppapp`
- **Organization:** Perbadanan Perpustakaan Awam Pulau Pinang (Penang Public Library Corporation)
- **Source Priority:** 8
- **ILS Platform:** Koha ILS
- **OPAC Portal:** `https://opac.penanglib.gov.my/`
- **Catalog Size:** ~351,000+ records

---

## Harvesting & Integration

The PPAPP collection is harvested via Koha's direct MARCXML export interface following Pustaka Terbuka Harvester Standards.

- `tools/harvesters/ppapp/harvester.js` — Harvester engine with rate-limiting, exponential backoff, and self-healing resumption.
- `docs/HARVESTER.md` — Detailed execution and resumption runbook.
- `harvest/inbox/ppapp/` — Intake directory for harvested batches (`manifest.json`, `records/*.xml`, `provenance.jsonl`).

To run a sample harvest:
```bash
npm run harvest:sample
```
