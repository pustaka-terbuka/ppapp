export function stripMarcPunctuation(str) {
  if (!str) return '';
  return str.replace(/[\/;:,\.=]\s*$/, '').trim();
}

export function normalizeWhitespace(str) {
  if (!str) return '';
  return str.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function stripArticles(str) {
  const articles = ['the', 'a', 'an', 'sang', 'si', 'para'];
  const words = str.split(' ');
  if (words.length > 1 && articles.includes(words[0])) {
    return words.slice(1).join(' ');
  }
  return str;
}

export function normalizeTitle(title) {
  if (!title) return '';
  let str = normalizeWhitespace(title);
  str = stripMarcPunctuation(str);
  // Do it again just in case there was punctuation before whitespace
  str = str.replace(/[\/;:,\.=]+\s*$/, '').trim();
  str = stripArticles(str);
  return str;
}

export function normalizeAuthor(author) {
  if (!author) return '';
  let str = normalizeWhitespace(author);
  str = stripMarcPunctuation(str);
  return str;
}

export function normalizePublisher(publisher) {
  if (!publisher) return '';
  let str = normalizeWhitespace(publisher);
  str = stripMarcPunctuation(str);
  return str;
}

export function getField(record, tag) {
  if (!record || !record.fields) return null;
  return record.fields.find(f => Object.keys(f)[0] === tag);
}

export function getSubfield(field, code) {
  if (!field) return '';
  const tag = Object.keys(field)[0];
  const fieldData = field[tag];
  if (!fieldData || !fieldData.subfields) return '';
  const subfield = fieldData.subfields.find(s => Object.keys(s)[0] === code);
  return subfield ? subfield[code] : '';
}

export function extractYear(record) {
  const f008 = getField(record, '008');
  if (f008) {
    const val = f008['008'];
    if (typeof val === 'string' && val.length >= 11) {
      const year = val.substring(7, 11);
      if (year && year !== '    ' && year !== '||||' && /^\d{4}$/.test(year)) {
        return year;
      }
    }
  }

  const f260 = getField(record, '260');
  let valC = getSubfield(f260, 'c');
  if (!valC) {
    // 264 ind2=1
    const fields264 = record.fields?.filter(f => Object.keys(f)[0] === '264') || [];
    for (let f of fields264) {
      if (f['264'].ind2 === '1') {
        valC = getSubfield(f, 'c');
        break;
      }
    }
  }

  if (valC) {
    const m = valC.match(/\d{4}/);
    if (m) return m[0];
  }

  return '';
}

export function generateFallbackKey(record) {
  const f245 = getField(record, '245');
  if (!f245) return null;
  const titleA = getSubfield(f245, 'a');
  if (!titleA) return null;
  const titleB = getSubfield(f245, 'b');
  const title = normalizeTitle(`${titleA} ${titleB}`.trim());

  let author = '';
  const f100 = getField(record, '100');
  if (f100) author = normalizeAuthor(getSubfield(f100, 'a'));
  else {
    const f110 = getField(record, '110');
    if (f110) author = normalizeAuthor(getSubfield(f110, 'a'));
    else {
      const f111 = getField(record, '111');
      if (f111) author = normalizeAuthor(getSubfield(f111, 'a'));
    }
  }

  let publisher = '';
  const f260 = getField(record, '260');
  if (f260) publisher = normalizePublisher(getSubfield(f260, 'b'));
  else {
    const fields264 = record.fields?.filter(f => Object.keys(f)[0] === '264') || [];
    for (let f of fields264) {
      if (f['264'].ind2 === '1') {
        publisher = normalizePublisher(getSubfield(f, 'b'));
        break;
      }
    }
  }

  const year = extractYear(record);

  return `${title}|${author}|${publisher}|${year}`;
}
