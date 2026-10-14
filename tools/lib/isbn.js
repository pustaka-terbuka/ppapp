export function validateIsbn10(isbn10) {
  if (typeof isbn10 !== 'string') return false;
  const clean = isbn10.replace(/[-\s]/g, '').toUpperCase();
  if (!/^\d{9}[\dX]$/.test(clean)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(clean[i]) * (10 - i);
  }
  const check = clean[9] === 'X' ? 10 : parseInt(clean[9]);
  sum += check;
  return sum % 11 === 0;
}

export function validateIsbn13(isbn13) {
  if (typeof isbn13 !== 'string') return false;
  const clean = isbn13.replace(/[-\s]/g, '');
  if (!/^\d{13}$/.test(clean)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const digit = parseInt(clean[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return sum % 10 === 0;
}

export function isbn10to13(isbn10) {
  if (!validateIsbn10(isbn10)) return null;
  const clean = isbn10.replace(/[-\s]/g, '').toUpperCase().substring(0, 9);
  const prefix = '978' + clean;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(prefix[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return prefix + check;
}

export function isbn13to10(isbn13) {
  if (!validateIsbn13(isbn13)) return null;
  const clean = isbn13.replace(/[-\s]/g, '');
  if (!clean.startsWith('978')) return null; // Only 978 prefix can be converted to ISBN-10
  const core = clean.substring(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(core[i]) * (10 - i);
  }
  const rem = sum % 11;
  const check = (11 - rem) % 11;
  const checkDigit = check === 10 ? 'X' : check.toString();
  return core + checkDigit;
}

export function normalizeIsbn(raw) {
  if (typeof raw !== 'string') {
    return { isbn13: null, valid: false, original: raw, reason: 'Not a string' };
  }
  
  // Extract just the ISBN part, stripping qualifiers like (pbk.)
  // Match first sequence of digits, X, hyphens, and spaces
  const match = raw.match(/([\d\-\sX]+)/i);
  if (!match) {
    return { isbn13: null, valid: false, original: raw, reason: 'No ISBN pattern found' };
  }
  
  let clean = match[1].replace(/[-\s]/g, '').toUpperCase();
  
  if (clean.length === 10) {
    if (validateIsbn10(clean)) {
      return {
        isbn13: isbn10to13(clean),
        isbn10: clean,
        valid: true,
        original: raw
      };
    } else {
      return { isbn13: null, valid: false, original: raw, reason: 'Invalid ISBN-10 checksum' };
    }
  } else if (clean.length === 13) {
    if (validateIsbn13(clean)) {
      return {
        isbn13: clean,
        isbn10: clean.startsWith('978') ? isbn13to10(clean) : null,
        valid: true,
        original: raw
      };
    } else {
      return { isbn13: null, valid: false, original: raw, reason: 'Invalid ISBN-13 checksum' };
    }
  } else {
    return { isbn13: null, valid: false, original: raw, reason: 'Invalid length' };
  }
}

export function extractIsbns(record) {
  const isbns = [];
  if (!record || !record.dataFields) return isbns;
  
  for (const field of record.dataFields) {
    if (field.tag === '020' && field.subfields) {
      for (const subfield of field.subfields) {
        if (subfield.code === 'a') {
          const norm = normalizeIsbn(subfield.value);
          if (norm.valid) {
            isbns.push(norm);
          }
        }
      }
    }
  }
  return isbns;
}
