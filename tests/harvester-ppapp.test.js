import { test } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import {
  parseArgs,
  validateRecordContent,
  inspectBatches,
  repairProvenance,
  runHarvest
} from '../tools/harvesters/ppapp/harvester.js';

test('PPAPP Harvester handles CLI argument parsing', () => {
  const args = ['--start-bib', '100', '--end-bib', '200', '--delay', '1500', '--max-records', '50'];
  const opts = parseArgs(args);
  assert.strictEqual(opts.startBib, 100);
  assert.strictEqual(opts.endBib, 200);
  assert.strictEqual(opts.delayMs, 1500);
  assert.strictEqual(opts.maxRecords, 50);
});

test('PPAPP Harvester validates mandatory MARC tags (001 and 245)', () => {
  const validXml = '<record><controlfield tag="001">123</controlfield><datafield tag="245"><subfield code="a">Title</subfield></datafield></record>';
  const missing001 = '<record><datafield tag="245"><subfield code="a">Title</subfield></datafield></record>';
  const missing245 = '<record><controlfield tag="001">123</controlfield></record>';

  assert.strictEqual(validateRecordContent(validXml), true);
  assert.strictEqual(validateRecordContent(missing001), false);
  assert.strictEqual(validateRecordContent(missing245), false);
});

test('PPAPP Harvester inspectBatches self-heals corrupted XML batches', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppapp-test-'));
  const recordsDir = path.join(tmpDir, 'records');
  fs.mkdirSync(recordsDir, { recursive: true });

  // Valid batch
  fs.writeFileSync(path.join(recordsDir, 'batch_0.xml'), '<collection xmlns="http://www.loc.gov/MARC21/slim"><record></record></collection>', 'utf8');
  // Corrupt batch (missing closing collection tag)
  fs.writeFileSync(path.join(recordsDir, 'batch_1.xml'), '<collection xmlns="http://www.loc.gov/MARC21/slim"><record></record>', 'utf8');

  const inspected = inspectBatches(recordsDir);
  assert.strictEqual(inspected.highestPage, 0);
  assert.strictEqual(inspected.validBatches.has('batch_0.xml'), true);
  assert.strictEqual(inspected.validBatches.has('batch_1.xml'), false);
  assert.strictEqual(fs.existsSync(path.join(recordsDir, 'batch_1.xml')), false, 'Corrupt batch file should be unlinked');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('PPAPP Harvester handles --help gracefully', async () => {
  const code = await runHarvest({ help: true });
  assert.strictEqual(code, 0);
});

test('PPAPP Harvester parses --chunk-size and --master-digest flags', () => {
  const opts = parseArgs(['--chunk-size', '5000', '--master-digest', '--sitemap']);
  assert.strictEqual(opts.chunkSize, 5000);
  assert.strictEqual(opts.ingestMaster, true);
  assert.strictEqual(opts.useSitemap, true);
});

test('PPAPP Harvester chunk output passes inbox validation', async () => {
  const { validateInbox } = await import('../tools/validate-inbox.js');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppapp-chunk-test-'));
  const chunkRunId = '20261011-000000-chunk-001';
  const chunkDir = path.join(tmpDir, 'ppapp', chunkRunId);
  const recordsDir = path.join(chunkDir, 'records');
  fs.mkdirSync(recordsDir, { recursive: true });

  const validRecordXml = `<?xml version="1.0" encoding="UTF-8"?>
<collection xmlns="http://www.loc.gov/MARC21/slim">
  <record>
    <leader>00000nam a2200000Ia 4500</leader>
    <controlfield tag="001">331738</controlfield>
    <controlfield tag="003">PPAPP</controlfield>
    <datafield tag="245" ind1="0" ind2="0">
      <subfield code="a">Sejarah Pulau Pinang</subfield>
    </datafield>
    <datafield tag="996" ind1=" " ind2=" ">
      <subfield code="a">ppapp</subfield>
    </datafield>
  </record>
</collection>`;
  fs.writeFileSync(path.join(recordsDir, 'batch_0.xml'), validRecordXml, 'utf8');

  const prov = {
    source_001: '331738',
    source_url: 'https://opac.penanglib.gov.my/cgi-bin/koha/opac-detail.pl?biblionumber=331738',
    harvested_at: '2026-10-11T12:00:00.000Z',
    file: 'batch_0.xml',
    index: 0
  };
  fs.writeFileSync(path.join(chunkDir, 'provenance.jsonl'), JSON.stringify(prov) + '\n', 'utf8');

  const manifest = {
    schema_version: '1.0',
    source_code: 'ppapp',
    source_name: 'Perbadanan Perpustakaan Awam Pulau Pinang',
    source_base_url: 'https://opac.penanglib.gov.my/',
    terms_url: 'https://www.penanglib.gov.my/',
    terms_verified_on: '2026-10-11',
    harvester_name: 'ppapp-koha-harvester',
    harvester_version: '1.1.0',
    run_id: chunkRunId,
    mode: 'full',
    started_at: '2026-10-11T12:00:00.000Z',
    finished_at: '2026-10-11T12:15:00.000Z',
    record_count: 1,
    error_count: 0,
    status: 'complete',
    user_agent: 'PustakaTerbuka Harvester',
    notes: 'PPAPP harvest chunk 1 completed successfully.'
  };
  fs.writeFileSync(path.join(chunkDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const res = await validateInbox(chunkDir, { skipDropGate: true });
  assert.strictEqual(res.valid, true, `Expected valid chunk, got errors: ${res.errors.join(', ')}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Master sequential lock utility can find master repo from PPAPP', async () => {
  const { findMasterRepo, isMasterLocked } = await import('../tools/lib/master-lock.js');
  const masterPath = findMasterRepo(process.cwd());
  assert.ok(masterPath, 'Must locate master repo');
  const status = isMasterLocked(masterPath);
  assert.strictEqual(status.locked, false, 'Master repo should be unlocked when idle');
});

