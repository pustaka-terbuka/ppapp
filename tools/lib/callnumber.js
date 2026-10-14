export function parseDDC(callNumber) {
  if (!callNumber || typeof callNumber !== 'string') return createOther(callNumber);
  
  const tokens = callNumber.trim().split(/\s+/);
  if (tokens.length === 0) return createOther(callNumber);

  let prefix = '';
  let classNumber = '';
  let cutter = [];

  let idx = 0;
  if (/^[A-Za-z]+$|^\[[A-Za-z]\]$/.test(tokens[0])) {
    prefix = tokens[0].toUpperCase();
    idx++;
  }

  if (idx < tokens.length && /^\d+(?:\.\d+)?$/.test(tokens[idx])) {
    classNumber = tokens[idx];
    idx++;
  }

  while (idx < tokens.length) {
    cutter.push(tokens[idx]);
    idx++;
  }

  const cutterStr = cutter.join(' ');
  const isNumeric = classNumber !== '';

  if (!isNumeric && !prefix) {
    return createOther(callNumber);
  }

  let sortKey = '';
  if (isNumeric) {
    let [intPart, decPart] = classNumber.split('.');
    intPart = intPart.padStart(3, '0');
    decPart = (decPart || '').padEnd(10, '0');
    sortKey = `${intPart}.${decPart}`;
    if (cutterStr) sortKey += ` ${cutterStr.toUpperCase()}`;
    if (prefix) sortKey = `${sortKey} ${prefix}`; // Or prefix at front? Standard doesn't specify, let's just append or keep it as is. Wait, if prefix is [B], it usually goes with class. Let's just use numeric.
  } else {
    // Sort after all numeric DDC
    sortKey = `ZZZ ${prefix} ${cutterStr.toUpperCase()}`.trim();
  }

  const searchTokens = [];
  if (classNumber) {
    searchTokens.push(classNumber);
    if (classNumber.includes('.')) {
      searchTokens.push(classNumber.split('.')[0]);
    }
  }
  if (cutterStr) searchTokens.push(...cutterStr.split(' '));
  if (prefix) searchTokens.push(prefix);

  // According to requirement:
  // parseDDC(callNumber) -> { scheme: 'DDC', classNumber: '005.133', itemNumber: 'ABC', fullCallNumber: '...', parsed: true, sortKey: '...', searchTokens: [...] }
  return {
    scheme: 'DDC',
    classNumber: classNumber || undefined,
    itemNumber: cutterStr || undefined,
    prefix: prefix || undefined,
    fullCallNumber: callNumber,
    parsed: true,
    sortKey: sortKey,
    searchTokens: searchTokens
  };
}

export function parseLCC(callNumber) {
  if (!callNumber || typeof callNumber !== 'string') return createOther(callNumber);
  
  // Basic LCC regex: 1-3 letters, then numbers, then optional decimals, then cutters, then date.
  // We can extract parts more carefully.
  // Clean up extra spaces around dots
  let cleaned = callNumber.trim().replace(/\s*\.\s*/g, '.');
  
  const match = cleaned.match(/^([A-Za-z]{1,3})\s*(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) {
    // maybe just letters? like "QA76" with no spaces handled by regex above? Yes, \d+ handles it.
    // What if it's just "QA"?
    const matchLetters = cleaned.match(/^([A-Za-z]{1,3})$/);
    if (matchLetters) {
       return {
         scheme: 'LCC',
         classLetters: matchLetters[1].toUpperCase(),
         classNumber: undefined,
         cutters: [],
         date: undefined,
         fullCallNumber: callNumber,
         parsed: true,
         sortKey: matchLetters[1].toUpperCase().padEnd(3, ' ') + ' 00000.000000',
         searchTokens: [matchLetters[1].toUpperCase()]
       };
    }
    return createOther(callNumber);
  }

  const classLetters = match[1].toUpperCase();
  const classNumStr = match[2];
  let rest = match[3];

  const classNumber = parseFloat(classNumStr);

  // Parse cutters and date
  // Cutters look like .V27 or just V27. Date is usually a 4-digit number at the end.
  const cutters = [];
  let date = undefined;

  // Extract date from the end if it's a 4-digit number separated by space
  const dateMatch = rest.match(/(.*?)\s+(\d{4})$/);
  if (dateMatch) {
    rest = dateMatch[1];
    date = dateMatch[2];
  } else {
    // might be just a date?
    if (/^\d{4}$/.test(rest)) {
      date = rest;
      rest = '';
    }
  }

  // extract cutters. they start with optional dot, then letter, then numbers
  // But could be just tokens. Let's split by space or dot.
  // "V27 A12" or ".V27 A12" or ".V27.A12"
  const cutterRegex = /(?:\.?\s*([A-Za-z]\d+(?:\.\d+)?))/g;
  let cMatch;
  let lastIndex = 0;
  
  // A simpler way: we just extract all things that look like cutters
  // If there's something else, it might be unparsed
  let searchTokens = [];
  searchTokens.push(classLetters + classNumStr);
  searchTokens.push(classLetters + classNumStr.split('.')[0]);
  searchTokens.push(classLetters);

  let rawCutters = [];
  let tokenRegex = /\.?([A-Za-z]+\d*(?:\.\d+)?)/g;
  let tMatch;
  while ((tMatch = tokenRegex.exec(rest)) !== null) {
      rawCutters.push(tMatch[0]);
  }
  // The exact logic from instruction: QA76.73.V27 A12 2019
  // Output cutters: ['.V27', ' A12']  Wait, the prompt says `.V27`, ` A12`.
  // We can just find them in the original string!
  
  // Let's refine LCC cutters.
  const allCutters = [];
  const cutterTokens = [];
  let restTokens = rest.split(/(?=[. ])/); // split keeping delimiters at start
  for (let t of restTokens) {
    if (t.trim() === '') continue;
    allCutters.push(t);
    // clean for search token
    cutterTokens.push(t.replace(/[^A-Za-z0-9]/g, ''));
  }

  // Sort key:
  // Class letters: right-pad to 3 chars with spaces
  // Class number: pad integer to 5 digits, decimal to 6 digits
  // Each cutter: normalize letter + padded number
  // Date: 4 digits
  let sortKey = classLetters.padEnd(3, ' ') + ' ';
  let [intP, decP] = classNumStr.split('.');
  intP = intP.padStart(5, '0');
  decP = (decP || '').padEnd(6, '0');
  sortKey += `${intP}.${decP}`;

  for (let c of allCutters) {
    let cleanC = c.replace(/[^A-Za-z0-9]/g, '');
    if (!cleanC) continue;
    let cLet = cleanC.match(/^[A-Za-z]+/)?.[0] || '';
    let cNum = cleanC.substring(cLet.length);
    sortKey += ` ${cLet.toUpperCase()}${cNum.padEnd(6, '0')}`;
  }

  if (date) {
    sortKey += ` ${date}`;
    searchTokens.push(date);
  }

  // remove duplicates from searchTokens and add cutter tokens
  for (let c of cutterTokens) {
    if (c) searchTokens.push(c);
  }

  searchTokens = [...new Set(searchTokens)];

  return {
    scheme: 'LCC',
    classLetters,
    classNumber,
    cutters: allCutters,
    date,
    fullCallNumber: callNumber,
    parsed: true,
    sortKey: sortKey,
    searchTokens
  };
}

function createOther(callNumber) {
  const str = String(callNumber || '');
  return {
    scheme: 'other',
    fullCallNumber: str,
    parsed: false,
    sortKey: str.toLowerCase(),
    searchTokens: [str]
  };
}

export function parseCallNumber(callNumber, scheme) {
  if (scheme === 'LCC') return parseLCC(callNumber);
  if (scheme === 'DDC') return parseDDC(callNumber);
  return createOther(callNumber);
}

export function compareCallNumbers(a, b) {
  const keyA = a.sortKey || '';
  const keyB = b.sortKey || '';
  if (keyA < keyB) return -1;
  if (keyA > keyB) return 1;
  return 0;
}

const DDC_DIVISIONS = {
  "000": "000 Computer science, information & general works",
  "100": "100 Philosophy & psychology",
  "200": "200 Religion",
  "300": "300 Social sciences",
  "400": "400 Language",
  "500": "500 Science",
  "600": "600 Technology",
  "700": "700 Arts & recreation",
  "800": "800 Literature",
  "900": "900 History & geography"
};

const LCC_CLASSES = {
  "A": "A General Works",
  "B": "B Philosophy, Psychology, Religion",
  "C": "C Auxiliary Sciences of History",
  "D": "D World History",
  "E": "E History of the Americas",
  "F": "F History of the Americas",
  "G": "G Geography, Anthropology, Recreation",
  "H": "H Social Sciences",
  "J": "J Political Science",
  "K": "K Law",
  "L": "L Education",
  "M": "M Music",
  "N": "N Fine Arts",
  "P": "P Language and Literature",
  "Q": "Q Science",
  "R": "R Medicine",
  "S": "S Agriculture",
  "T": "T Technology",
  "U": "U Military Science",
  "V": "V Naval Science",
  "Z": "Z Bibliography, Library Science"
};

export function getTopLevelClass(parsed) {
  if (parsed.scheme === 'DDC' && parsed.classNumber) {
    const firstDigit = parsed.classNumber.charAt(0);
    return DDC_DIVISIONS[firstDigit + "00"] || null;
  }
  if (parsed.scheme === 'LCC' && parsed.classLetters) {
    const firstLetter = parsed.classLetters.charAt(0).toUpperCase();
    return LCC_CLASSES[firstLetter] || null;
  }
  return null;
}
