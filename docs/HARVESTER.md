# Perbadanan Perpustakaan Awam Pulau Pinang (PPAPP) Harvester Runbook

> **Operational guide for harvesting and synchronizing bibliographic records from Perbadanan Perpustakaan Awam Pulau Pinang.**

For universal ecosystem contracts, adapter architecture, and schema definitions, refer to the upstream specifications:
* [Master Harvester Ingestion Standards](https://github.com/pustaka-terbuka/master/blob/main/docs/HARVESTERS.md)
* [Universal Harvester Developer Guide](https://github.com/pustaka-terbuka/master/blob/main/docs/HARVESTER_DEVELOPER_GUIDE.md)

---

## 1. Target System Profile

* **Institution:** Perbadanan Perpustakaan Awam Pulau Pinang (Penang Public Library Corporation)
* **Organization Code:** `ppapp` (Priority: 8)
* **Catalog Software:** Koha ILS
* **OPAC URL:** `https://opac.penanglib.gov.my/`
* **Direct MARCXML Endpoint:**
  `https://opac.penanglib.gov.my/cgi-bin/koha/opac-export.pl?op=export&bib={biblionumber}&format=marcxml`
* **Catalog Range:** Sequential accession numbers from `1` to `~351,871+`
* **Politeness Delay:** Minimum 2,000 ms between requests

---

## 2. Ingestion & Conversion Rules

* **Output Inbox:** `harvest/inbox/ppapp/<run-id>/`
* **MARC Format:** Native MARC 21 Slim XML wrapped in `<collection xmlns="http://www.loc.gov/MARC21/slim">`
* **Tag Preservation:**
  * Control number `001`: Auto-incrementing Koha `biblionumber` (e.g., `331738`).
  * Organization identifier `003`: `PPAPP`.
  * Classification `082`: Dewey Decimal (DDC).
  * Bibliographic fields: Title `245`, Author `100`, Imprint `260`/`264`, ISBN `020`.
  * Local holdings `952`: Branch codes, barcodes, call numbers, and shelf locations.

---

## 3. Execution Commands

### Run Full Harvest
```bash
node tools/harvesters/ppapp/harvester.js
```

### Resume Incomplete Run
```bash
node tools/harvesters/ppapp/harvester.js --resume auto
```

### Run Sample / Verification Crawl (10 Records)
```bash
node tools/harvesters/ppapp/harvester.js --max-records 10
```

### Harvest Specific Range
```bash
node tools/harvesters/ppapp/harvester.js --start-bib 331700 --end-bib 331800
```

---

## 4. State & Resumption

* **`partition_state.json`**: Located in the active inbox directory. Tracks `lastBibNumber`, `nextBatchNumber`, and `totalRecordsSaved`.
* **Corrupt Batch Scrubbing:** The harvester validates existing batch XML files upon resumption, automatically removing broken files and repairing `provenance.jsonl`.

---

## 5. Ecosystem Concurrency & Conflict Prevention

* **Safe Multi-Provider Concurrency:** You can safely run this PPAPP harvester alongside other library scrapers (e.g. PNM, PPAS). Each institution lives in an isolated repository and queries distinct OPAC servers.
* **Single Worker Rule:** Run strictly **one** crawler instance against the PPAPP Koha endpoint (`opac.penanglib.gov.my`). Do not run parallel workers against Koha to avoid triggering server firewalls or rate throttling.
* **Master Merge:** Harvested records are merged downstream in `pustaka-terbuka/master`. PPAPP holds Priority 8 in the union catalog; matching bibliographic records retain PPAPP holdings while resolving metadata against higher authority sources.

