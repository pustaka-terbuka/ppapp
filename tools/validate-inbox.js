import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseMarcXml, getDataFields } from './lib/marcxml.js';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function validateInbox(inboxPath, options = {}) {
  const allowPartial = options.allowPartial || false;
  const skipDropGate = options.skipDropGate || false;
  const sourcesStatePath = options.sourcesState || path.join(__dirname, '../data/state/sources-state.json');

  const errors = [];
  const logError = (msg) => errors.push(msg);

  // Infer expected source_code and run_id from path
  // path is harvest/inbox/<source-code>/<run-id>
  const absoluteInboxPath = path.resolve(inboxPath);
  const runIdDir = path.basename(absoluteInboxPath);
  const sourceCodeDir = path.basename(path.dirname(absoluteInboxPath));

  // 1. Check manifest.json
  const manifestPath = path.join(absoluteInboxPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    logError('manifest.json is missing.');
    return { valid: false, errors };
  }

  let manifest;
  try {
    const manifestStr = fs.readFileSync(manifestPath, 'utf8');
    manifest = JSON.parse(manifestStr);
  } catch (err) {
    logError(`manifest.json is not valid JSON: ${err.message}`);
    return { valid: false, errors };
  }

  // Validate manifest against schema
  const ajv = new Ajv();
  addFormats(ajv);
  const manifestSchemaStr = fs.readFileSync(path.join(__dirname, 'schemas/manifest.schema.json'), 'utf8');
  const manifestSchema = JSON.parse(manifestSchemaStr);
  const validateManifest = ajv.compile(manifestSchema);
  
  if (!validateManifest(manifest)) {
    logError(`manifest.json schema validation failed: ${ajv.errorsText(validateManifest.errors)}`);
  }

  // 9. source_code matches directory
  if (manifest.source_code !== sourceCodeDir) {
    logError(`manifest.source_code (${manifest.source_code}) does not match directory name (${sourceCodeDir}).`);
  }

  // 8. Status check
  if (manifest.status !== 'complete' && !allowPartial) {
    logError(`manifest status is '${manifest.status}', but only 'complete' is allowed (unless --allow-partial is used).`);
  }

  // Read XML files
  const recordsDir = path.join(absoluteInboxPath, 'records');
  if (!fs.existsSync(recordsDir)) {
    logError('records/ directory is missing.');
    return { valid: false, errors };
  }

  let xmlFiles = fs.readdirSync(recordsDir).filter(f => f.endsWith('.xml'));
  let totalRecordsFound = 0;

  for (const file of xmlFiles) {
    const filePath = path.join(recordsDir, file);
    
    // 7. UTF-8 check (no invalid byte sequences)
    const buf = fs.readFileSync(filePath);
    const text = buf.toString('utf8');
    if (text.includes('\uFFFD')) {
      logError(`${file} contains invalid UTF-8 byte sequences.`);
    }

    // 2. XML well-formedness
    const { XMLValidator } = await import('fast-xml-parser');
    const isValidXML = XMLValidator.validate(text);
    if (isValidXML !== true) {
      logError(`${file} is malformed: ${isValidXML.err.msg} at line ${isValidXML.err.line}`);
      continue;
    }

    // 3. MARCXML structure
    if (!text.includes('http://www.loc.gov/MARC21/slim')) {
      logError(`${file} is missing the correct MARC21 slim namespace.`);
    }

    let records;
    try {
      records = parseMarcXml(text);
      if (!Array.isArray(records)) {
        throw new Error("Parsed result is not an array of records.");
      }
    } catch (err) {
      logError(`${file} is malformed or invalid MARCXML: ${err.message}`);
      continue;
    }

    totalRecordsFound += records.length;

    // 6. Required MARC fields (245)
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const titleFields = getDataFields(rec, '245');
      if (!titleFields || titleFields.length === 0) {
        logError(`${file} record at index ${i} is missing required field 245.`);
      }
    }
  }

  // 4. Count consistency
  if (manifest.record_count !== totalRecordsFound) {
    logError(`manifest.record_count (${manifest.record_count}) does not match total records found in XML files (${totalRecordsFound}).`);
  }

  // 5. Provenance coverage
  const provenancePath = path.join(absoluteInboxPath, 'provenance.jsonl');
  let provenanceLines = 0;
  if (fs.existsSync(provenancePath)) {
    const provContent = fs.readFileSync(provenancePath, 'utf8').trim();
    if (provContent.length > 0) {
      const lines = provContent.split('\n');
      provenanceLines = lines.length;
      
      // Parse a few lines to validate
      const provSchemaStr = fs.readFileSync(path.join(__dirname, 'schemas/provenance-line.schema.json'), 'utf8');
      const provSchema = JSON.parse(provSchemaStr);
      const validateProv = ajv.compile(provSchema);

      for (let i = 0; i < lines.length; i++) {
        try {
          const l = JSON.parse(lines[i]);
          if (!validateProv(l)) {
            logError(`provenance.jsonl line ${i+1} schema validation failed: ${ajv.errorsText(validateProv.errors)}`);
          }
        } catch(e) {
           logError(`provenance.jsonl line ${i+1} is invalid JSON.`);
        }
      }
    }
  } else {
    logError('provenance.jsonl is missing.');
  }

  if (provenanceLines !== totalRecordsFound) {
    logError(`provenance.jsonl lines (${provenanceLines}) do not match total records found (${totalRecordsFound}).`);
  }

  // 10. Record-count drop gate
  if (!skipDropGate && manifest.source_code) {
    if (fs.existsSync(sourcesStatePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(sourcesStatePath, 'utf8'));
        const sourceState = state[manifest.source_code];
        if (sourceState && sourceState.lastCount !== undefined) {
          const threshold = 0.05; // 5% configurable
          const prevCount = sourceState.lastCount;
          const newCount = manifest.record_count || 0;
          
          if (newCount < prevCount) {
            const dropRatio = (prevCount - newCount) / prevCount;
            if (dropRatio > threshold) {
              logError(`Drop gate triggered: Record count dropped by ${(dropRatio*100).toFixed(2)}% (from ${prevCount} to ${newCount}), which is above the 5% threshold.`);
            }
          }
        }
      } catch (err) {
        logError(`Failed to read or parse sources-state.json: ${err.message}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// CLI wrapper
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const inboxPath = args.find(a => !a.startsWith('--'));
  
  if (!inboxPath) {
    console.error('Usage: node tools/validate-inbox.js <inbox-path> [options]');
    process.exit(2);
  }

  const options = {
    allowPartial: args.includes('--allow-partial'),
    skipDropGate: args.includes('--skip-drop-gate'),
  };

  const sourcesStateIdx = args.indexOf('--sources-state');
  if (sourcesStateIdx !== -1 && args.length > sourcesStateIdx + 1) {
    options.sourcesState = args[sourcesStateIdx + 1];
  }

  validateInbox(inboxPath, options).then(result => {
    if (result.valid) {
      console.log('✅ All checks passed.');
      process.exit(0);
    } else {
      console.error('❌ Validation errors found:');
      result.errors.forEach(e => console.error(`  - ${e}`));
      process.exit(1);
    }
  }).catch(err => {
    console.error('❌ Fatal error:', err.message);
    process.exit(2);
  });
}
