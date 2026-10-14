import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

/**
 * Loads holdings from a CSV file.
 * @param {string} filePath 
 * @returns {Array<Object>} 
 */
export function loadHoldings(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  
  return records.map(record => ({
    record: record.record,
    org: record.org,
    scheme: record.scheme,
    classNumber: record.class_number,
    itemNumber: record.item_number,
    fullCallNumber: record.full_call_number,
    location: record.location || ''
  }));
}

/**
 * Saves holdings to a CSV file.
 * @param {string} filePath 
 * @param {Array<Object>} rows 
 */
export function saveHoldings(filePath, rows) {
  // Sort rows by record, then fullCallNumber
  const sortedRows = [...rows].sort((a, b) => {
    if (a.record !== b.record) return a.record.localeCompare(b.record);
    return (a.fullCallNumber || '').localeCompare(b.fullCallNumber || '');
  });

  const output = sortedRows.map(r => ({
    record: r.record,
    org: r.org,
    scheme: r.scheme,
    class_number: r.classNumber,
    item_number: r.itemNumber,
    full_call_number: r.fullCallNumber,
    location: r.location
  }));

  const csv = stringify(output, {
    header: true,
    columns: ['record', 'org', 'scheme', 'class_number', 'item_number', 'full_call_number', 'location']
  });

  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, csv, 'utf8');
}

/**
 * Resolves any ISBN values in the `record` column to permanent IDs using the alias table.
 * Returns resolved rows and a report of unresolvable entries.
 * @param {Array<Object>} rows 
 * @param {Map} aliasMap 
 */
export function resolveHoldingsRecords(rows, aliasMap) {
  const resolved = [];
  const unresolvable = [];

  for (const row of rows) {
    let finalId = row.record;
    
    if (aliasMap && aliasMap.has(row.record)) {
      finalId = aliasMap.get(row.record).id;
    }

    // Check if it looks like an ISBN (10 or 13 digits, ignoring hyphens).
    // Or if it's still an unresolved alias that hasn't mapped.
    // If it's not known in alias map and looks like ISBN, it's unresolved ISBN
    // Otherwise assume it's already a permanent ID or a legitimate local ID.
    // Actually, just checking if it's in the aliasMap if it's not a permanent ID structure.
    // We'll consider it unresolvable if it is an ISBN but not in aliasMap.
    const isIsbn = /^(978|979)?\d{9}[\dX]$/i.test(row.record.replace(/-/g, ''));
    
    if (isIsbn && !aliasMap.has(row.record)) {
      unresolvable.push(row);
      // Still push with original id
      resolved.push({ ...row, record: row.record });
    } else {
      resolved.push({ ...row, record: finalId });
    }
  }

  return { resolved, unresolvable };
}

/**
 * Returns all holdings rows for a given record ID across all orgs.
 * @param {Map<string, Array>} allHoldings 
 * @param {string} recordId 
 */
export function getHoldingsForRecord(allHoldings, recordId) {
  const result = [];
  for (const [orgCode, rows] of allHoldings.entries()) {
    for (const row of rows) {
      if (row.record === recordId) {
        result.push(row);
      }
    }
  }
  return result;
}

/**
 * Returns all holdings rows for a given org.
 * @param {Map<string, Array>} allHoldings 
 * @param {string} orgCode 
 */
export function getHoldingsForOrg(allHoldings, orgCode) {
  return allHoldings.get(orgCode) || [];
}

/**
 * Loads all CSV files from data/holdings/. Returns a Map<orgCode, rows[]>.
 * @param {string} holdingsDir 
 */
export function loadAllHoldings(holdingsDir) {
  const allHoldings = new Map();
  if (!fs.existsSync(holdingsDir)) {
    return allHoldings;
  }
  
  const files = fs.readdirSync(holdingsDir);
  for (const file of files) {
    if (file.endsWith('.csv')) {
      const orgCode = path.basename(file, '.csv');
      const rows = loadHoldings(path.join(holdingsDir, file));
      allHoldings.set(orgCode, rows);
    }
  }
  
  return allHoldings;
}
