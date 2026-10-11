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
