import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Checks whether a given process ID is actively running.
 * Cross-platform (Windows, Linux, macOS).
 * @param {number} pid 
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number' || isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // EPERM means process exists, but no permission to signal
  }
}

function isMasterDirectory(dir) {
  try {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name === 'pustaka-terbuka-master') return true;
    }
    if (path.basename(dir) === 'master' && fs.existsSync(path.join(dir, 'tools', 'build.js'))) {
      return true;
    }
  } catch (_) {}
  return false;
}

/**
 * Locates the master repository root from a given directory.
 * @param {string} [startDir=process.cwd()]
 * @returns {string|null}
 */
export function findMasterRepo(startDir = process.cwd()) {
  const current = path.resolve(startDir);

  // Check current directory
  if (isMasterDirectory(current)) {
    return current;
  }

  // Check sibling ../master
  const siblingMaster = path.resolve(current, '..', 'master');
  if (isMasterDirectory(siblingMaster)) {
    return siblingMaster;
  }

  // Check parent
  const parent = path.dirname(current);
  if (isMasterDirectory(parent)) {
    return parent;
  }

  // Check grandparent ../../master
  const grandSiblingMaster = path.resolve(current, '../..', 'master');
  if (isMasterDirectory(grandSiblingMaster)) {
    return grandSiblingMaster;
  }

  return null;
}

/**
 * Resolves the absolute path to the master lock file.
 * @param {string} masterPath 
 * @returns {string}
 */
export function getLockFilePath(masterPath) {
  const stateDir = path.join(masterPath, 'data', 'state');
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  return path.join(stateDir, 'master.lock');
}

/**
 * Checks the status of the master lock without acquiring it.
 * @param {string} masterPath 
 * @param {number} [staleThresholdMs=3600000] - Default 1 hour
 * @returns {{ locked: boolean, isStale: boolean, metadata: object|null, lockPath: string }}
 */
export function isMasterLocked(masterPath, staleThresholdMs = 3600000) {
  const lockPath = getLockFilePath(masterPath);
  if (!fs.existsSync(lockPath)) {
    return { locked: false, isStale: false, metadata: null, lockPath };
  }

  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const metadata = JSON.parse(raw);
    const ageMs = Date.now() - new Date(metadata.timestamp).getTime();
    const alive = isProcessAlive(metadata.pid);

    const isStale = !alive || ageMs > staleThresholdMs;
    return {
      locked: !isStale,
      isStale,
      metadata,
      lockPath
    };
  } catch (err) {
    // Corrupted lock file is treated as stale
    return {
      locked: false,
      isStale: true,
      metadata: null,
      lockPath
    };
  }
}

/**
 * Acquires an exclusive lock on the master repository.
 * 
 * @param {object} options
 * @param {string} [options.masterPath] - Path to master repo (auto-discovered if omitted)
 * @param {string} [options.provider='master'] - Name of the provider acquiring the lock
 * @param {string} [options.operation='ingest'] - Operation description (e.g. 'build', 'merge', 'ingest')
 * @param {boolean} [options.wait=true] - Whether to wait if currently locked
 * @param {number} [options.timeoutMs=600000] - Max wait time in ms (default 10 min)
 * @param {number} [options.retryIntervalMs=2000] - Poll interval in ms
 * @param {number} [options.staleThresholdMs=3600000] - Stale threshold (default 1 hr)
 * @returns {Promise<{ release: Function, lockPath: string, metadata: object }>}
 */
export async function acquireMasterLock(options = {}) {
  const masterPath = options.masterPath || findMasterRepo(process.cwd());
  if (!masterPath) {
    throw new Error('Could not locate master repository for lock acquisition.');
  }

  const provider = options.provider || 'unknown';
  const operation = options.operation || 'ingest';
  const wait = options.wait !== false;
  const timeoutMs = options.timeoutMs ?? 600000;
  const retryIntervalMs = options.retryIntervalMs ?? 2000;
  const staleThresholdMs = options.staleThresholdMs ?? 3600000;
  const lockPath = getLockFilePath(masterPath);

  const startTime = Date.now();
  let announcedWait = false;

  while (true) {
    let fd = null;
    try {
      // Atomic file creation with 'wx' flag
      fd = fs.openSync(lockPath, 'wx');
      
      const metadata = {
        provider,
        operation,
        pid: process.pid,
        hostname: os.hostname(),
        timestamp: new Date().toISOString()
      };

      fs.writeFileSync(fd, JSON.stringify(metadata, null, 2), 'utf8');
      fs.closeSync(fd);
      fd = null;

      // Register cleanup hook
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        try {
          if (fs.existsSync(lockPath)) {
            const cur = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
            if (cur.pid === process.pid) {
              fs.unlinkSync(lockPath);
            }
          }
        } catch (_) {}
      };

      const exitHandler = () => release();
      process.once('exit', exitHandler);

      return {
        release: () => {
          process.removeListener('exit', exitHandler);
          release();
        },
        lockPath,
        metadata
      };
    } catch (err) {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch (_) {}
      }

      if (err.code !== 'EEXIST') {
        throw err;
      }

      // Lock file already exists. Inspect if it is stale.
      const status = isMasterLocked(masterPath, staleThresholdMs);

      if (status.isStale) {
        console.warn(`[WARN] Found stale master lock from provider '${status.metadata?.provider || "unknown"}' (PID ${status.metadata?.pid}, started ${status.metadata?.timestamp}). Overriding stale lock.`);
        try {
          fs.unlinkSync(lockPath);
        } catch (_) {}
        continue; // Retry atomic creation immediately
      }

      // Lock is active and valid.
      if (!wait) {
        throw new Error(
          `Master repository is locked by '${status.metadata.provider}' for '${status.metadata.operation}' (PID: ${status.metadata.pid}, started: ${status.metadata.timestamp}). Sequential ingestion required.`
        );
      }

      // Check timeout
      if (Date.now() - startTime >= timeoutMs) {
        throw new Error(
          `Timed out after ${timeoutMs}ms waiting for master lock held by '${status.metadata.provider}' (PID: ${status.metadata.pid}).`
        );
      }

      if (!announcedWait) {
        console.log(
          `[WAIT] Master repository is currently busy with '${status.metadata.operation}' by provider '${status.metadata.provider}' (PID: ${status.metadata.pid}). Waiting for lock to be released...`
        );
        announcedWait = true;
      }

      await new Promise(r => setTimeout(r, retryIntervalMs));
    }
  }
}
