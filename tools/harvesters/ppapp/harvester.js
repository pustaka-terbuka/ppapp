#!/usr/bin/env node

/**
 * PustakaTerbuka - PPAPP (Perbadanan Perpustakaan Awam Pulau Pinang) Harvester
 * 
 * Harvests catalog records from the PPAPP Koha OPAC into MARCXML
 * following PustakaTerbuka Harvester Standards.
 * 
 * Normative Spec: master/docs/HARVESTER_DEVELOPER_GUIDE.md & docs/HARVESTERS.md
 * Output: harvest/inbox/ppapp/<run-id>/
 *   - manifest.json
 *   - partition_state.json
 *   - provenance.jsonl
 *   - records/batch_<n>.xml
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
export const SOURCE_CODE = 'ppapp';
export const SOURCE_NAME = 'Perbadanan Perpustakaan Awam Pulau Pinang';
export const SOURCE_BASE_URL = 'https://opac.penanglib.gov.my/';
export const TERMS_URL = 'https://www.penanglib.gov.my/';
export const BASE_EXPORT_URL = 'https://opac.penanglib.gov.my/cgi-bin/koha/opac-export.pl';
export const BASE_DETAIL_URL = 'https://opac.penanglib.gov.my/cgi-bin/koha/opac-detail.pl';
export const USER_AGENT = 'PustakaTerbuka-Harvester/1.0 (+https://github.com/pustaka-terbuka/ppapp; contact@pustakaterbuka.org)';
export const HARVESTER_NAME = 'ppapp-koha-harvester';
export const HARVESTER_VERSION = '1.0.0';
export const DEFAULT_MAX_BIB = 351871;

export function findRepoRoot(startDir) {
  let curr = path.resolve(startDir);
  while (curr !== path.parse(curr).root) {
    if (fs.existsSync(path.join(curr, 'package.json'))) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return startDir;
}

export function parseArgs(args) {
  const options = {
    startBib: 1,
    endBib: DEFAULT_MAX_BIB,
    batchSize: 100,
    delayMs: 2000,
    maxRecords: 0,
    maxConsecutiveMisses: 100,
    mode: 'full',
    outDir: null,
    freshRun: false,
    resumeTarget: 'auto',
    ingestMaster: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--start-bib' && i + 1 < args.length) {
      options.startBib = parseInt(args[++i], 10);
    } else if (arg === '--end-bib' && i + 1 < args.length) {
      options.endBib = parseInt(args[++i], 10);
    } else if (arg === '--batch-size' && i + 1 < args.length) {
      options.batchSize = parseInt(args[++i], 10);
    } else if (arg === '--delay' && i + 1 < args.length) {
      options.delayMs = parseInt(args[++i], 10);
    } else if (arg === '--max-records' && i + 1 < args.length) {
      options.maxRecords = parseInt(args[++i], 10);
    } else if (arg === '--mode' && i + 1 < args.length) {
      options.mode = args[++i];
    } else if (arg === '--out-dir' && i + 1 < args.length) {
      options.outDir = args[++i];
    } else if (arg === '--ingest-master') {
      options.ingestMaster = true;
    } else if (arg === '--fresh' || arg === '--no-resume' || arg === '--new') {
      options.freshRun = true;
      options.resumeTarget = null;
    } else if (arg === '--resume') {
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        options.resumeTarget = args[++i];
      } else {
        options.resumeTarget = 'auto';
      }
    }
  }

  return options;
}

export function printHelp() {
  console.log(`
PustakaTerbuka PPAPP Harvester (Node.js)

Usage:
  node tools/harvesters/ppapp/harvester.js [options]

Options:
  --start-bib <num>          First biblionumber to harvest (default: 1)
  --end-bib <num>            Last biblionumber to harvest (default: ${DEFAULT_MAX_BIB})
  --batch-size <num>         Records per XML file (default: 100)
  --delay <ms>               Delay between requests in ms (default: 2000)
  --max-records <num>        Limit total records saved this run (0 = unconstrained)
  --mode <full|incremental>  Harvest mode (default: "full")
  --out-dir <path>           Override output directory
  --resume [run-id|auto]     Resume latest incomplete run or specify run-id (default: auto)
  --fresh, --new             Start a new run without resuming
  -h, --help                 Show this help message
`);
}

export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch MARCXML record for a specific biblionumber from Koha opac-export.pl
 */
export async function fetchRecordMarcXml(bibNumber, options = {}, maxRetries = 5) {
  const url = `${BASE_EXPORT_URL}?op=export&bib=${bibNumber}&format=marcxml`;
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/xml, text/xml, */*'
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'manual', // Do not automatically follow 302 to 404 page
        signal: AbortSignal.timeout(30000)
      });

      // Status 302 or 404 indicates record does not exist
      if (response.status === 302 || response.status === 404) {
        return null;
      }

      if (response.ok) {
        const text = await response.text();
        if (text && text.includes('<record') && text.includes('</record>')) {
          // Extract the <record>...</record> content
          const match = text.match(/<record[\s\S]*?<\/record>/);
          if (match) {
            return match[0];
          }
        }
        return null;
      }

      // Handle backoff on rate limits or server errors
      let backoffMs = Math.min(300000, 5000 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 2000);
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) {
        const parsed = parseInt(retryAfter, 10);
        if (!isNaN(parsed)) backoffMs = parsed * 1000;
      }

      console.warn(`[WARN] HTTP ${response.status} on bib ${bibNumber} (attempt ${attempt}/${maxRetries}). Backing off ${Math.round(backoffMs / 1000)}s...`);
      if (attempt === maxRetries) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      await sleep(backoffMs);
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const backoffMs = Math.min(300000, 5000 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 2000);
      console.warn(`[WARN] Network error on bib ${bibNumber} (attempt ${attempt}/${maxRetries}): ${err.message}. Backing off ${Math.round(backoffMs / 1000)}s...`);
      await sleep(backoffMs);
    }
  }

  return null;
}

export function validateRecordContent(recordXml) {
  if (!recordXml) return false;
  // Must contain non-empty title (245)
  if (!recordXml.includes('tag="245"')) return false;
  // Must contain control number 001
  if (!recordXml.includes('tag="001"')) return false;
  return true;
}

export function inspectBatches(recordsDir) {
  const validBatches = new Set();
  let highestPage = -1;
  let recordCount = 0;
  if (!fs.existsSync(recordsDir)) return { validBatches, highestPage, recordCount };

  const files = fs.readdirSync(recordsDir).filter(f => f.startsWith('batch_') && f.endsWith('.xml'));
  for (const file of files) {
    const match = file.match(/^batch_(\d+)\.xml$/);
    if (match) {
      const pNum = parseInt(match[1], 10);
      const filePath = path.join(recordsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');

      if (content.includes('</collection>')) {
        validBatches.add(file);
        if (pNum > highestPage) highestPage = pNum;
        const count = (content.match(/<record[\s>]/g) || []).length;
        recordCount += count;
      } else {
        console.warn(`[REPAIR] Batch ${file} missing closing </collection>. Removing corrupt file.`);
        try { fs.unlinkSync(filePath); } catch {}
      }
    }
  }

  return { validBatches, highestPage, recordCount };
}

export function repairProvenance(provPath, validBatches) {
  if (!fs.existsSync(provPath)) return;
  const content = fs.readFileSync(provPath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  const cleanLines = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.file && validBatches.has(obj.file)) {
        cleanLines.push(line);
      }
    } catch {}
  }

  if (cleanLines.length !== lines.length) {
    console.warn(`[REPAIR] Scrubbed ${lines.length - cleanLines.length} orphan entries from provenance.jsonl.`);
    fs.writeFileSync(provPath, cleanLines.join('\n') + (cleanLines.length > 0 ? '\n' : ''), 'utf8');
  }
}

export function findLatestIncompleteRun(baseDir) {
  if (!fs.existsSync(baseDir)) return null;
  const entries = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .reverse();

  for (const name of entries) {
    const fullPath = path.join(baseDir, name);
    const manifestPath = path.join(fullPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      if (fs.existsSync(path.join(fullPath, 'records'))) return fullPath;
    } else {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.status !== 'complete') return fullPath;
      } catch {
        return fullPath;
      }
    }
  }
  return null;
}

export async function runHarvest(userOptions = {}) {
  const options = { ...parseArgs(process.argv.slice(2)), ...userOptions };
  if (options.help) {
    printHelp();
    return 0;
  }

  const repoRoot = findRepoRoot(__dirname);
  const inboxBaseDir = options.outDir
    ? path.resolve(options.outDir)
    : path.join(repoRoot, 'harvest', 'inbox', SOURCE_CODE);

  fs.mkdirSync(inboxBaseDir, { recursive: true });

  // Determine run ID & resumption
  let runId = null;
  let inboxDir = null;
  let isResumed = false;

  if (!options.freshRun && options.resumeTarget) {
    if (options.resumeTarget === 'auto') {
      const latest = findLatestIncompleteRun(inboxBaseDir);
      if (latest) {
        inboxDir = latest;
        runId = path.basename(latest);
        isResumed = true;
      }
    } else {
      const targetDir = path.isAbsolute(options.resumeTarget)
        ? options.resumeTarget
        : path.join(inboxBaseDir, options.resumeTarget);
      if (fs.existsSync(targetDir)) {
        inboxDir = targetDir;
        runId = path.basename(targetDir);
        isResumed = true;
      }
    }
  }

  if (!isResumed) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    runId = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
    inboxDir = path.join(inboxBaseDir, runId);
    fs.mkdirSync(inboxDir, { recursive: true });
  }

  const recordsDir = path.join(inboxDir, 'records');
  fs.mkdirSync(recordsDir, { recursive: true });

  console.log(`=======================================================`);
  console.log(` PustakaTerbuka PPAPP Koha Harvester`);
  console.log(` Run ID:     ${runId}`);
  console.log(` Output:     ${inboxDir}`);
  console.log(` Resumed:    ${isResumed}`);
  console.log(` Range:      Bib ${options.startBib} -> ${options.endBib}`);
  console.log(` Politeness: ${options.delayMs} ms delay between requests`);
  console.log(`=======================================================\n`);

  // State inspection & self-healing
  const stateFile = path.join(inboxDir, 'partition_state.json');
  let state = { lastBibNumber: options.startBib - 1, nextBatchNumber: 0, totalRecordsSaved: 0 };
  if (fs.existsSync(stateFile)) {
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  }

  const inspected = inspectBatches(recordsDir);
  const provPath = path.join(inboxDir, 'provenance.jsonl');
  repairProvenance(provPath, inspected.validBatches);

  let batchNumber = Math.max(inspected.highestPage + 1, state.nextBatchNumber || 0);
  let totalSaved = Math.max(inspected.recordCount, state.totalRecordsSaved || 0);
  let startBib = Math.max(options.startBib, (state.lastBibNumber || 0) + 1);

  const startedAt = isResumed && fs.existsSync(path.join(inboxDir, 'manifest.json'))
    ? (JSON.parse(fs.readFileSync(path.join(inboxDir, 'manifest.json'), 'utf8')).started_at || new Date().toISOString())
    : new Date().toISOString();

  let errorCount = 0;
  let batchBuffer = [];
  let harvestStatus = 'complete';
  let failureReason = null;

  function flushBatch() {
    if (batchBuffer.length === 0) return;
    const xmlLines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<collection xmlns="http://www.loc.gov/MARC21/slim">'
    ];

    const provLines = [];
    let idx = 0;
    for (const item of batchBuffer) {
      xmlLines.push(item.xml);
      const prov = {
        source_001: String(item.bib),
        source_url: `${BASE_DETAIL_URL}?biblionumber=${item.bib}`,
        harvested_at: item.timestamp,
        file: `batch_${batchNumber}.xml`,
        index: idx
      };
      provLines.push(JSON.stringify(prov));
      idx++;
    }

    xmlLines.push('</collection>');
    const xmlPath = path.join(recordsDir, `batch_${batchNumber}.xml`);
    fs.writeFileSync(xmlPath, xmlLines.join('\n'), { encoding: 'utf8' });
    fs.appendFileSync(provPath, provLines.join('\n') + '\n', { encoding: 'utf8' });

    totalSaved += batchBuffer.length;
    console.log(`[SAVE] Wrote ${batchBuffer.length} records to batch_${batchNumber}.xml (Total Saved: ${totalSaved})`);

    batchNumber++;
    batchBuffer = [];

    // Checkpoint state
    state.nextBatchNumber = batchNumber;
    state.totalRecordsSaved = totalSaved;
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
  }

  try {
    let currentBib = startBib;
    let savedThisRun = 0;

    while (currentBib <= options.endBib) {
      if (options.maxRecords > 0 && savedThisRun >= options.maxRecords) {
        console.log(`\n[INFO] Reached requested max records limit (${options.maxRecords}). Stopping.`);
        break;
      }

      const recordXml = await fetchRecordMarcXml(currentBib, options);

      if (recordXml) {
        if (validateRecordContent(recordXml)) {
          batchBuffer.push({
            bib: currentBib,
            xml: recordXml,
            timestamp: new Date().toISOString()
          });
          savedThisRun++;

          if (batchBuffer.length >= options.batchSize) {
            flushBatch();
          }
        } else {
          console.warn(`[WARN] Bib ${currentBib} failed validation (missing 245 title or 001). Skipping.`);
          errorCount++;
        }
      }

      state.lastBibNumber = currentBib;
      currentBib++;

      if (currentBib <= options.endBib && (options.maxRecords <= 0 || savedThisRun < options.maxRecords)) {
        await sleep(options.delayMs);
      }
    }

    // Flush any remaining records in buffer
    flushBatch();

  } catch (err) {
    console.error(`\n[ERROR] Harvest interrupted: ${err.message}`);
    failureReason = err.message;
    harvestStatus = totalSaved > 0 ? 'partial' : 'failed';
    flushBatch();
  } finally {
    // Checkpoint state
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');

    // Seal manifest.json
    const manifest = {
      schema_version: '1.0',
      source_code: SOURCE_CODE,
      source_name: SOURCE_NAME,
      source_base_url: SOURCE_BASE_URL,
      terms_url: TERMS_URL,
      terms_verified_on: '2026-10-11',
      harvester_name: HARVESTER_NAME,
      harvester_version: HARVESTER_VERSION,
      run_id: runId,
      mode: options.mode,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      record_count: totalSaved,
      error_count: errorCount,
      status: harvestStatus,
      user_agent: USER_AGENT,
      notes: failureReason ? `Run stopped: ${failureReason}` : `PPAPP harvest ${harvestStatus}. Total: ${totalSaved}`
    };

    const manifestPath = path.join(inboxDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    console.log(`\n=======================================================`);
    console.log(` Harvest Status:    ${harvestStatus}`);
    console.log(` Total Saved:       ${totalSaved} records`);
    console.log(` Manifest Sealed:   ${manifestPath}`);
    console.log(`=======================================================`);

    if (harvestStatus === 'complete' && options.ingestMaster) {
      const { execSync } = await import('child_process');
      console.log(`\n[Master Ingestion] Checking master sequential lock...`);
      execSync(`npm run ingest:master`, { cwd: repoRoot, stdio: 'inherit' });
    }
  }

  return harvestStatus === 'complete' ? 0 : 1;
}

// Direct execution from CLI
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectRun) {
  runHarvest().then(code => process.exit(code)).catch(err => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
}
