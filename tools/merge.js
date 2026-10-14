import path from 'path';
import { fileURLToPath } from 'url';
import { mergeInbox } from './lib/merge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const args = process.argv.slice(2);
  let inboxPath = null;
  const options = {
    dataDir: path.join(process.cwd(), 'data'),
    sourcesPath: path.join(process.cwd(), 'data', 'sources.json'),
    dryRun: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--data-dir') {
      options.dataDir = args[++i];
    } else if (arg === '--sources') {
      options.sourcesPath = args[++i];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (!arg.startsWith('--') && !inboxPath) {
      inboxPath = arg;
    }
  }

  if (!inboxPath) {
    console.error('Usage: node tools/merge.js <inbox-path> [--sources <path>] [--data-dir <path>] [--dry-run]');
    process.exit(1);
  }

  try {
    console.log(`Starting merge process for inbox: ${inboxPath}`);
    if (options.dryRun) console.log('[DRY RUN MODE] No changes will be saved');
    
    const report = await mergeInbox(inboxPath, options);
    
    console.log('\nMerge Report:');
    console.log(`- New records:              ${report.new}`);
    console.log(`- Updated records:          ${report.updated}`);
    console.log(`- Unchanged records:        ${report.unchanged}`);
    console.log(`- Merged into existing:     ${report.mergedIntoExisting}`);
    console.log(`- Ambiguous (skipped):      ${report.ambiguous}`);
    console.log(`- Errors:                   ${report.errors}`);
    
  } catch (err) {
    console.error('Merge failed:', err);
    process.exit(1);
  }
}

main();
