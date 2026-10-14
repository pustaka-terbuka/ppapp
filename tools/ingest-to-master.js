#!/usr/bin/env node

/**
 * PustakaTerbuka - Safe Sequential Master Ingestion Tool
 * 
 * Checks whether the master catalog repository is currently locked by another
 * provider or build job. If locked, waits sequentially until available.
 * Acquires the master lock, triggers the master catalog build, and safely releases.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { acquireMasterLock, findMasterRepo, isMasterLocked } from './lib/master-lock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const args = process.argv.slice(2);
  let provider = null;
  let wait = true;
  let timeoutMs = 600000; // 10 minutes default
  let dryRun = false;
  let scanSources = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider') provider = args[++i];
    else if (args[i] === '--no-wait') wait = false;
    else if (args[i] === '--timeout') timeoutMs = parseInt(args[++i], 10);
    else if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--scan-sources') scanSources = true;
  }

  // Detect provider from package.json or working dir
  if (!provider) {
    const cwd = process.cwd();
    if (cwd.includes('pnm')) provider = 'pnm';
    else if (cwd.includes('ppapp')) provider = 'ppapp';
    else provider = path.basename(cwd);
  }

  const masterPath = findMasterRepo(process.cwd());
  if (!masterPath) {
    console.error('[ERROR] Could not locate PustakaTerbuka master repository. Make sure ../master exists.');
    process.exit(1);
  }

  console.log(`=======================================================`);
  console.log(` PustakaTerbuka Safe Master Ingestion — ${provider.toUpperCase()}`);
  console.log(` Master Target: ${masterPath}`);
  console.log(`=======================================================`);

  // Pre-check lock status
  const currentStatus = isMasterLocked(masterPath);
  if (currentStatus.locked) {
    console.log(
      `[INFO] Master repository is currently busy with '${currentStatus.metadata.operation}' by provider '${currentStatus.metadata.provider}' (PID: ${currentStatus.metadata.pid}).`
    );
    if (!wait) {
      console.error(`[ERROR] Ingestion aborted because master is busy and --no-wait was specified.`);
      process.exit(1);
    }
    console.log(`[WAIT] Waiting sequentially for master lock to be released...`);
  }

  let lock = null;
  try {
    lock = await acquireMasterLock({
      masterPath,
      provider,
      operation: `ingest-${provider}`,
      wait,
      timeoutMs
    });

    console.log(`\n[LOCK ACQUIRED] Exclusive access granted to master for provider '${provider}'.`);

    if (dryRun) {
      console.log(`[DRY RUN] Lock verified successfully. Skipping actual build.`);
      return;
    }

    console.log(`\n[STEP] Triggering master build for source '${provider}'...`);
    const scanFlag = scanSources ? ' --scan-sources' : '';
    execSync(`node tools/build.js --source ${provider}${scanFlag} --skip-lock --skip-size-gate --skip-dumps`, {
      cwd: masterPath,
      stdio: 'inherit',
      env: { ...process.env, PUSTAKA_MASTER_LOCKED: '1' }
    });

    console.log(`\n=======================================================`);
    console.log(` Master Ingestion Completed Successfully for ${provider.toUpperCase()}!`);
    console.log(`=======================================================`);
  } catch (err) {
    console.error(`\n[ERROR] Master ingestion failed: ${err.message}`);
    process.exit(1);
  } finally {
    if (lock) {
      lock.release();
      console.log(`[LOCK RELEASED] Master repository is now available for other providers.`);
    }
  }
}

main();
