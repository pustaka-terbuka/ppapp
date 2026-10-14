import fs from 'fs';
import path from 'path';

export function loadManifest(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Error loading manifest ${filePath}:`, err.message);
    return {};
  }
}

export function saveManifest(filePath, manifest) {
  // Sort keys
  const sortedKeys = Object.keys(manifest).sort();
  const sortedManifest = {};
  for (const key of sortedKeys) {
    sortedManifest[key] = manifest[key];
  }
  
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const content = JSON.stringify(sortedManifest, null, 2) + '\n';
  let saved = false;
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.writeFileSync(filePath, content, 'utf8');
      saved = true;
      break;
    } catch (err) {
      lastErr = err;
      const start = Date.now();
      while (Date.now() - start < 150) {}
    }
  }
  if (!saved && lastErr) {
    throw lastErr;
  }
}

export function hasChanged(manifest, recordId, hash) {
  return manifest[recordId] !== hash;
}
