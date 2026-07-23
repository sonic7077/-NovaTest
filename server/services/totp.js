import { createHmac } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(secret) {
  const normalized = String(secret || '').replace(/[\s-]/g, '').toUpperCase();
  if (!normalized || !/^[A-Z2-7]+=*$/.test(normalized)) throw new Error('invalid Google Authenticator secret');

  let bits = '';
  for (const character of normalized.replace(/=+$/, '')) bits += BASE32_ALPHABET.indexOf(character).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g)?.map((byte) => Number.parseInt(byte, 2)) || []);
}

export function generateTotp(base32Secret, { now = Date.now(), period = 30, digits = 6 } = {}) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / period)));
  const digest = createHmac('sha1', decodeBase32(base32Secret)).update(message).digest();
  const offset = digest.at(-1) & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits);
  return String(value).padStart(digits, '0');
}
