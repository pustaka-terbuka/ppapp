# Master Harvester Architecture & Lifecycle Specification

This normative specification defines the complete end-to-end behavior of harvesters in **PustakaTerbuka**, covering acquisition protocols, transformation algorithms, resilience mechanisms, chunked lifecycles, consolidated shard storage, ephemeral execution (zero permanent local repository), and deployment automation.

Every harvester implementation (including the Node.js implementation in `tools/harvesters/pnm/harvester.js` and the C# implementation in `tools/harvesters/pnm/Harvester.cs`) must strictly adhere to this behavior.

---

## 1. System Overview & Core Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Target: Perpustakaan Negara Malaysia                 │
│               Innovative Interfaces Vega Discover REST API             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS POST JSON (Rate Limited: 2000ms)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Harvester Engine: Node.js / C# (.NET)                    │
│                                                                        │
│   ┌─────────────────────────────┐   ┌──────────────────────────────┐   │
│   │   Query Partition Plan      │   │   Self-Healing State Store   │   │
│   │   (1,732 API query buckets) │   │   (partition_state.json)     │   │
│   └──────────────┬──────────────┘   └──────────────▲───────────────┘   │
│                  ▼                                 │                   │
│   ┌────────────────────────────────────────────────┴───────────────┐   │
│   │              MARCXML Conversion & Validation Gate              │   │
│   │   (Vega JSON -> MARC 21 Slim XML + provenance.jsonl)           │   │
│   └──────────────┬─────────────────────────────────────────────────┘   │
│                  ▼                                                     │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │              Discrete 10k Lifecycle Chunk Manager              │   │
│   │       harvest/inbox/pnm/<run-id>-chunk-<001..N>/               │   │
│   └──────────────┬─────────────────────────────────────────────────┘   │
└──────────────────┼─────────────────────────────────────────────────────┘
                   │ When Chunk >= 10,000 Records
                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Pipeline & Deployment Cycle                      │
│                                                                        │
│   1. validate-inbox   ──► Schema & Provenance Integrity Gate           │
│   2. merge            ──► Deduplicate into 1,024 Consolidated Shards   │
│   3. build            ──► Pagefind Index & Static Site into dist/      │
│   4. git push main    ──► Commit data/ & Push to origin/main           │
│   5. git push gh-pages──► Force Deploy dist/ to origin/gh-pages        │
│   6. purge scratch    ──► Wipe Ephemeral Cache (Zero Permanent Disk)  │
└──────────────────┬─────────────────────────────────────────────────────┘
                   │
                   ▼ (Resume)
        [Open Chunk N+1 & Continue Harvest Loop]
```

---

## 2. API Communication & Network Protocol

### 2.1 Endpoint & Headers
- **Base Endpoint:** `https://ap.iiivega.com/api/search-result/search/format-groups`
- **Method:** `POST`
- **Required Request Headers:**
  - `Content-Type: application/json`
  - `iii-customer-domain: pnm.ap.iiivega.com`
  - `iii-host-domain: opac.pnm.gov.my`
  - `api-version: 2`
  - `User-Agent: PustakaTerbuka Harvester (+https://github.com/aplikasi-perpustakaan/pustaka-terbuka)`

### 2.2 Payload Structure
```json
{
  "searchText": "*",
  "searchType": "everything",
  "pageNum": 0,
  "pageSize": 100,
  "resourceType": "FormatGroup",
  "dateFrom": 2024,
  "dateTo": 2024
}
```

### 2.3 Politeness, Rate Limiting & Backoff
1. **Request Throttling:** Harvesters must enforce a minimum delay of **2,000 ms** between successive requests to the same host.
2. **Timeout:** Requests use an explicit 60-second abort timeout.
3. **Exponential Backoff:** On network timeouts, connection resets, or HTTP `429` / `5xx` responses, the harvester retries up to 5 times:
   $$\text{Backoff (ms)} = \min\left(300000,\, 5000 \times 2^{\text{attempt}-1}\right)$$
   (i.e., 5s, 10s, 20s, 40s, 80s... capped at 5 minutes).
4. **Retry-After Header:** If the remote server responds with a `Retry-After` header, the harvester pauses for the explicitly requested duration instead of the calculated backoff.
5. **OpenSearch 10k Ceiling Interception:** If the server returns `HTTP 400 Bad Request` on `pageNum >= 100`, the harvester intercepts the error (recognizing it as the OpenSearch `max_result_window` boundary), logs a warning, caps the partition gracefully with `{ data: [], totalResults: 10000 }`, and advances to the next partition without terminating the run.

---

## 3. Query Partitioning Algorithm

Because OpenSearch forbids requesting results past index 10,000 in a single query, the catalog search space is split into **1,732 discrete query partitions**:

```
Total Partitions: 1,732
  ├── Modern Era (1980–2024): 45 years × 36 characters (a-z, 0-9)  = 1,620 partitions
  ├── Current Accessions (2025–2026): 2 years × 36 characters     =    72 partitions
  ├── Mid-Century (1950–1979): 30 single years (query: "*")        =    30 partitions
  └── Historical & Future Eras: 10 year-range buckets             =    10 partitions
```

### 3.1 Historical & Future Era Breakdown
1. `era_1941_1949` (`dateFrom: 1941, dateTo: 1949, query: "*"`)
2. `era_1931_1940` (`dateFrom: 1931, dateTo: 1940, query: "*"`)
3. `era_1921_1930` (`dateFrom: 1921, dateTo: 1930, query: "*"`)
4. `era_1900_1920` (`dateFrom: 1900, dateTo: 1920, query: "*"`)
5. `era_1850_1899` (`dateFrom: 1850, dateTo: 1899, query: "*"`)
6. `era_1800_1849` (`dateFrom: 1800, dateTo: 1849, query: "*"`)
7. `era_1700_1799` (`dateFrom: 1700, dateTo: 1799, query: "*"`)
8. `era_1001_1699` (`dateFrom: 1001, dateTo: 1699, query: "*"`)
9. `era_1_1000` (`dateFrom: 1, dateTo: 1000, query: "*"`)
10. `era_2027_2050` (`dateFrom: 2027, dateTo: 2050, query: "*"`)

### 3.2 Partition State File (`partition_state.json`)
Located in the source root inbox directory (`harvest/inbox/pnm/partition_state.json`), tracking persistent state across runs:
```json
{
  "completedPartitions": ["year_2024_a", "year_2024_b"],
  "nextBatchNumber": 105,
  "totalRecordsSaved": 10500,
  "completedChunks": [1],
  "currentChunkIndex": 2
}
```

### 3.3 Incremental Delta Mode (`--mode incremental`)
Once the complete historical catalog has been harvested, running all 1,732 query partitions daily is unnecessary.
- When invoked with `--mode incremental`:
  1. The harvester calculates the current accession window (the current publication year and previous year, e.g. 2025–2026).
  2. Partitions are constrained only to the active accession window:
     - `year_current_a*` through `year_current_z*`
     - Recent additions query: `*` with `dateFrom: <currentYear>`
  3. Skips the historical partitions (1980 down to era 1).
  4. Reduces daily sync runtime from ~30 hours down to **2–5 minutes**.

---

## 4. Ingestion & MARCXML Transformation Rules

Raw JSON objects returned by Vega Discover are transformed into standard **MARC 21 Slim XML**:

### 4.1 Field Transformation Matrix

| MARC Tag | Indicators | Subfield | Source JSON Property / Logic |
| :--- | :--- | :--- | :--- |
| **Leader** | — | — | `00000na<m\|s> a2200000Ia 4500`. Byte 7 is `s` if any `materialTabs[].issuance` contains `"serial"`; otherwise `m` (monograph). |
| **001** | — | — | Control Number: `identifiers.local` (e.g. VTLS number `vtls000437338`). If missing, falls back to `item.id` (Vega UUID). |
| **020** | ` ` / ` ` | `$a` | ISBNs: Extracted from `identifiers.isbn` and `materialTabs[].identifiedBy.isbn`. De-duplicated across the record. |
| **022** | ` ` / ` ` | `$a` | ISSN: Extracted from `identifiers.issn`. |
| **035** | ` ` / ` ` | `$a` | Secondary local identifiers: `materialTabs[].identifiedBy.local` where value $\ne$ `001`. |
| **041** | ` ` / ` ` | `$a` | Language code: `item.language` (e.g. `may`, `eng`). |
| **100** | `1` / ` ` | `$a` | Author / Primary Agent: `item.primaryAgent.label`. |
| **245** | `0` / `0` | `$a` | Title: `item.title`. |
| **250** | ` ` / ` ` | `$a` | Edition: `materialTabs[].editions[].edition`. |
| **264** | ` ` / `1` | `$c` | Publication Date: `item.publicationDate`. |
| **490** | `0` / ` ` | `$a` | Series Title: `item.seriesTitle`. |
| **520** | ` ` / ` ` | `$a` | Summary / Description: `materialTabs[].description`. |
| **655** | ` ` / `7` | `$a`<br>`$2` | Material Format: `materialTabs[].name`<br>Source: `"local"`. |
| **852** | ` ` / ` ` | `$h`<br>`$b` | Call Number: `materialTabs[].editions[].callNumber`<br>Location: `materialTabs[].locations[].label`. |
| **856** | `4` / `0` | `$u` | URLs: `materialTabs[].availability.urls` and `materialTabs[].multimediaLinks[].url`. |

### 4.2 Minimum Record Validation Gate
Before a converted record is accepted into an XML batch, it must pass the mandatory field check:
1. Must possess a valid non-empty **Control Number (001)**.
2. Must possess a valid non-empty **Title (245)**.
- If either is missing, the harvester logs a warning (`[WARN] Skipping invalid record: missing title (245)`), discards the record, and increments `error_count` in the manifest.

### 4.3 XML Escaping & Encoding
- Files must be UTF-8 without Byte Order Mark (BOM).
- Special characters must be escaped: `&` $\rightarrow$ `&amp;`, `<` $\rightarrow$ `&lt;`, `>` $\rightarrow$ `&gt;`, `"` $\rightarrow$ `&quot;`, `'` $\rightarrow$ `&apos;`.
- Replacement character `\uFFFD` must be stripped.

### 4.4 Takedown & Tombstone Enforcement
Per `docs/TAKEDOWN.md`, PustakaTerbuka respects copyright, privacy, and institutional takedown notices.
- Before ingesting a converted record, the harvester/merger checks `data/tombstones.json` and retired IDs in `data/aliases.jsonl.gz`.
- If a remote record matches a tombstoned control number (`001`), ISBN (`020`), or system ID, the record is **silently ignored** or logged as tombstoned.
- This guarantees that automated re-harvests of PNM or external sources never resurrect legally removed or retired catalog items.

---

## 5. Storage & Inbox Contract (Discrete 10k Chunks)

Each 10,000-record lifecycle batch is isolated in its own directory:
`harvest/inbox/<source-code>/<run-id>-chunk-<index>/`

### 5.1 Batch XML Files (`records/batch_<n>.xml`)
- Each file holds up to 100 records wrapped in `<collection xmlns="http://www.loc.gov/MARC21/slim">`.
- File naming: `batch_0.xml`, `batch_1.xml`, etc., numbered sequentially.

### 5.2 Provenance Log (`provenance.jsonl`)
Append-only JSON lines recording exact origin for every individual record:
```json
{
  "source_001": "vtls000437338",
  "source_url": "https://opac.pnm.gov.my/search/resource/01543883-93e1-5e26-a9ba-26fce7c09347",
  "harvested_at": "2026-10-10T08:15:30.123Z",
  "file": "batch_0.xml",
  "index": 42
}
```

### 5.3 Manifest Schema (`manifest.json`)
```json
{
  "schema_version": "1.0",
  "source_code": "pnm",
  "source_name": "Perpustakaan Negara Malaysia",
  "source_base_url": "https://opac.pnm.gov.my/",
  "terms_url": "https://www.pnm.gov.my/",
  "terms_verified_on": "2026-10-10",
  "harvester_name": "pnm-vega-scraper-node",
  "harvester_version": "1.0.0",
  "run_id": "20261010-080000Z-chunk-001",
  "mode": "full",
  "started_at": "2026-10-10T08:00:00.000Z",
  "finished_at": "2026-10-10T08:25:00.000Z",
  "record_count": 10000,
  "error_count": 0,
  "status": "complete",
  "user_agent": "PustakaTerbuka Harvester (+https://github.com/aplikasi-perpustakaan/pustaka-terbuka)",
  "notes": "Harvest chunk 1 completed successfully."
}
```

---

## 6. Consolidated Shard Storage Architecture (Solving 422k File Bloat)

### 6.1 The Problem with Loose XML Files
In the legacy storage layout, records were stored as individual loose files:
`data/bib/<shard>/<id>.xml` (e.g. `data/bib/zz/zzzzsmmqxr.xml`).
- At 422,000+ records across 1,024 Crockford base32 shards ($32 \times 32$), this created **422,000+ separate files** on disk.
- On Windows NTFS filesystems, this causes severe cluster slack, high inode counts, and slow git index operations (`git status` taking 30+ seconds).

### 6.2 Consolidated Shard Specifications
Under Consolidated Shard Storage, each 2-character shard is stored as **a single sorted file**:
- Path: `data/bib/shard_<shard>.jsonl` (e.g. `shard_00.jsonl` through `shard_zz.jsonl`).
- Total catalog files: **1,024 files total** (a 99.8% reduction in file count).
- Total repository footprint drops from several gigabytes down to **~150–250 MB**.

### 6.3 Internal Shard Format (Sorted NDJSON / JSONL)
Each line represents one canonical bibliographic record, sorted alphabetically by 10-character canonical ID:
```json
{"id":"00027wq0ph","hash":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","marcxml":"<record>...</record>"}
```
- **Git Diff Friendliness:** When a new book is added or updated in a 10k harvest, Git only detects 1 added or changed line in that shard file.
- **Instant Search & In-Memory Loading:** Merging and building reads 1,024 continuous files in milliseconds instead of opening and closing 422,000 individual OS file handles.

---

## 7. Ephemeral Harvester Mode (Zero Permanent Local Repository)

To allow the harvester to run on any machine (such as a developer laptop, lightweight VPS, or container) **without holding a permanent multi-gigabyte repository on local disk**, the harvester supports **Ephemeral Scratch Execution**:

```
[Start Harvester / New 10k Chunk]
        │
        ▼
   1. Ephemeral Scratch Directory Created (in %TEMP% or RAM)
        │
        ▼
   2. Fetch Shallow Remote State
      - Pulls latest `aliases.jsonl.gz` (~35 MB) and shallow shards
      - (Takes ~5-10 seconds over HTTPS because repo is only ~150 MB)
        │
        ▼
   3. Harvest 10,000 Records
      - Saved only in local temporary memory/scratch
        │
        ▼
   4. Self-Process & Merge Locally
      - Updates affected consolidated shard files
      - Checkpoints aliases & manifest
        │
        ▼
   5. Run Build
      - Builds `dist/` & Pagefind index in scratch directory
      - (10x faster now because reading 1,024 files is instant vs 422k files)
        │
        ▼
   6. Direct Push to GitHub
      - Pushes updated shards to `origin main`
      - Force pushes `dist/` to `origin gh-pages`
        │
        ▼
   7. Wipe Ephemeral Scratch Cache
      - Local temporary directory is purged from disk
        │
        ▼
   [Repeat for Next 10k Chunk]
```

### 7.1 Ephemeral Execution Mechanics
1. **No Permanent Clone:** The machine requires only the harvester script/binary and git credentials.
2. **Authentication via `GITHUB_TOKEN` (Option C — `.env.local`):**
   - The harvester automatically loads credentials from `.env.local` in the project root (checked first), followed by `.env`, and finally system environment variables (`GITHUB_TOKEN` or `GH_TOKEN`).
   - `.env.local` is strictly ignored by git via `.gitignore` (`.env.*`), preventing accidental secret leakage.
   - Example `.env.local`:
     ```env
     GITHUB_TOKEN=ghp_your_personal_access_token_here
     ```
   - In ephemeral scratch execution, the harvester configures remote authentication dynamically using this token:
     ```bash
     git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/aplikasi-perpustakaan/pustaka-terbuka.git"
     ```
   - Falls back to the local system's default Git credential manager if no token is found.
3. **On-Demand Shallow Sync:**
   ```bash
   git clone --depth 1 --filter=blob:none https://github.com/aplikasi-perpustakaan/pustaka-terbuka.git <scratch-dir>
   ```
4. **Local In-Memory / Temp Processing:**
   - Harvester writes `harvest/inbox/pnm/<run-id>-chunk-<N>/` inside `<scratch-dir>`.
   - Runs `validate-inbox`, `merge`, and `build` entirely inside `<scratch-dir>`.
5. **Direct Push & Purge:**
   - Executes `git push origin main` (for `data/`) and `git push origin gh-pages --force` (for `dist/`).
   - Automatically deletes `<scratch-dir>` immediately following successful pushes.
   - Result: Between runs, local disk usage is **0 MB**.

---

## 8. Self-Healing Resume & File Purging

When restarting after an interruption, the harvester validates existing data integrity before making any new network requests:

1. **Batch Validation:** Reads every `batch_<n>.xml` in `records/`. If a file lacks the closing `</collection>` tag (indicating an aborted write during power loss or kill signal), the file is identified as corrupt and immediately **unlinked from disk** (`unlinkSync`).
2. **Provenance Scrubbing:** Re-reads `provenance.jsonl` and scrubs any lines that point to unlinked/corrupted batch files, rewriting a sanitized file.
3. **Cursor Computation:**
   - Evaluates the highest numbered valid batch (`highestPage`).
   - Sets the resumption pointer to `highestPage + 1`.
   - Re-reads existing `manifest.json` to restore previous `started_at` and cumulative `error_count`.

---

## 9. The 10k Chunk Pipeline & Deployment Lifecycle

When a chunk reaches **10,000 records** (or all partitions have completed):

```mermaid
sequenceDiagram
    autonumber
    actor Harvester as Harvester Engine
    participant Scratch as Ephemeral Scratch Dir
    participant Validate as tools/validate-inbox.js
    participant Merge as tools/merge.js (Consolidated)
    participant Master as Master Digest (Sequential Mutex)
    participant Build as tools/build.js
    participant Git as GitHub Remote

    Harvester->>Scratch: Seal manifest.json (status: 'complete')
    Harvester->>Validate: npm run validate-inbox -- "<chunkDir>"
    Validate-->>Harvester: Exit 0 (Pass)
    Harvester->>Merge: npm run merge -- "<chunkDir>"
    Merge-->>Harvester: Exit 0 (Local catalog updated)
    Harvester->>Master: npm run ingest:master (acquireMasterLock & Pagefind build)
    Master-->>Harvester: Exit 0 (Master search index & OPAC updated)
    Harvester->>Build: npm run build
    Build-->>Harvester: Exit 0 (dist/ & Pagefind ready)
    Harvester->>Git: git add data/ && git commit && git push origin main
    Harvester->>Git: git push origin gh-pages --force (Deploy dist/)
    Harvester->>Scratch: Purge scratch cache / reset chunk counter
    Harvester->>Harvester: Open Chunk N+1 & Resume Next Partition
```

### Step-by-Step Commands:
1. **Seal Chunk:** Close write stream, write `manifest.json` with status `"complete"`.
2. **Validate:** `npm run validate-inbox -- "<scratchDir>/harvest/inbox/pnm/<run-id>-chunk-<N>"`
3. **Merge (Consolidated Shards):** `npm run merge -- "<scratchDir>/harvest/inbox/pnm/<run-id>-chunk-<N>"`
   - Updates `data/bib/shard_<shard>.jsonl` (or loose shards in `data/bib/`).
   - Rewrites and compresses `data/aliases.jsonl.gz`.
   - Checkpoints `data/bib/manifest.json`.
4. **Master Digest (Incremental Indexing & Search):** `npm run ingest:master`
   - Acquires sequential mutex lock (`master-lock.js`) on `master`.
   - Rebuilds master static search site and Pagefind search index (`node tools/build.js --source pnm --scan-sources`).
   - Releases lock for concurrent state libraries.
5. **Build Local Site:** `npm run build`
   - Generates local `dist/` and local search index.
6. **Git Push (Choice B):**
   - **Pre-Push Rebase Guard (Main branch):**
     To prevent `non-fast-forward` push rejections if remote `main` received commits during the fetch:
     ```bash
     git pull --rebase origin main
     ```
   - **Commit & Push (Main branch):**
     ```bash
     git add data/
     git commit -m "data(pnm): merge chunk <N> (10,000 records)"
     git push origin main
     ```
   - **GitHub Pages branch (Live Deployment):**
     Initializes/updates a worktree for `dist/` and force-pushes to `origin gh-pages`:
     ```bash
     git push origin gh-pages --force
     ```
7. **Purge & Resume:** Wipe ephemeral scratch folder, increment chunk counter, reset `chunkRecords = 0`, open chunk `N+1`, and continue.

---

## 10. CLI Interface & Execution Flags

Both the Node.js and C# harvesters support the following CLI flags:

| Flag | Argument | Default | Description |
| :--- | :--- | :--- | :--- |
| `--partitioned` | *flag* | `false` | Run partitioned query plan across the entire catalog (bypassing OpenSearch 10k ceiling). |
| `--chunk-size` | `<num>` | `10000` | Target records per lifecycle chunk before triggering validate/merge/build/push. |
| `--ephemeral` | *flag* | `false` | Run in ephemeral mode (zero permanent local repo: shallow sync, process, push, purge). |
| `--consolidated-shards`| *flag* | `true` | Store and merge records using 1,024 consolidated shard files instead of loose XML files. |
| `--page-size` | `<num>` | `100` | Records fetched per API request (max 100). |
| `--delay` | `<ms>` | `2000` | Delay between page requests in milliseconds. |
| `--max-pages` | `<num>` | `0` | Page limit (0 = harvest until query or catalog completes). |
| `--query` | `<str>` | `"*"` | Search query text (used in unpartitioned mode). |
| `--date-from` | `<year>` | `null` | Start year filter. |
| `--date-to` | `<year>` | `null` | End year filter. |
| `--resume` | `[id]` | `'auto'` | Resume latest incomplete run or specify a target run ID. |
| `--fresh` / `--new` | *flag* | `false` | Do not resume; force a brand new run ID and state. |
| `--skip-pipeline` | *flag* | `false` | Do not trigger validation, merge, build, or git push. |
| `--no-push` | *flag* | `false` | Run validation, merge, and build, but skip git push. |
| `--no-deploy` | *flag* | `false` | Push `data/` to `main`, but skip pushing `dist/` to `gh-pages`. |
| `--mode` | `<full\|incremental>` | `'full'` | Harvest mode: 'full' crawls complete catalog plan; 'incremental' syncs only active accession window (2-5 min). |
| `--help` / `-h` | *flag* | — | Display CLI help menu. |

---

## 11. Error Classification & Exit Codes

- **Status `complete`:** All requested records fetched, validated, merged, and pushed. Exit code `0`.
- **Status `partial`:** Network failure, timeout, or user interrupt after successfully saving at least 1 record. Exit code `1`.
- **Status `failed`:** Fatal error occurring before any records were saved. Exit code `1`.
- **Validation Failure:** If `validate-inbox` fails on a chunk, the harvester halts immediately with exit code `1` and does **not** proceed to merge or push, preventing catalog corruption.

---

## 12. Extension Points for Future Behaviors

Future capabilities must hook into this specification as follows:
- **Pre-Fetch Hook:** Inspect `provenance.jsonl` or content hashes to skip unchanged remote records.
- **Post-Chunk Hook:** Intercept chunk completion events prior to or following the Git push step.
- **Source Adapter Interface:** Implement the query partitioning, API pagination, and JSON-to-MARCXML mapping matrix while reusing the chunk lifecycle manager.
