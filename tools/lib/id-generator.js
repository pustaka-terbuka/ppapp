import crypto from 'crypto';

const CROCKFORD_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export function generateId(existingIds) {
  let id;
  do {
    const bytes = crypto.randomBytes(10);
    id = '';
    for (let i = 0; i < 10; i++) {
      id += CROCKFORD_ALPHABET[bytes[i] % 32];
    }
  } while (existingIds && existingIds.has(id));
  return id;
}

export function isValidId(id) {
  if (typeof id !== 'string' || id.length !== 10) return false;
  const regex = new RegExp(`^[${CROCKFORD_ALPHABET}]{10}$`);
  return regex.test(id);
}

export function getShard(id) {
  if (!isValidId(id)) throw new Error('Invalid ID');
  return id.substring(0, 2);
}
