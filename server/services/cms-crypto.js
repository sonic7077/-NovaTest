import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function md5(value) {
  return createHash('md5').update(value).digest('hex');
}

export function encryptPayload(payload, { key, iv }) {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(iv));
  return Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]).toString('base64');
}

export function decryptPayload(payload, { key, iv }) {
  const decipher = createDecipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(iv));
  return Buffer.concat([decipher.update(Buffer.from(payload, 'base64')), decipher.final()]).toString('utf8');
}

export function buildRequestBody(payload, config, timestamp = Math.floor(Date.now() / 1000)) {
  const data = encryptPayload(JSON.stringify(payload), config);
  const sign = md5(`${sha256(`data=${data}&timestamp=${timestamp}${config.appKey}`)}`);
  return { data, sign, body: new URLSearchParams({ timestamp: String(timestamp), data, sign }).toString() };
}

export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|password|data|sign|key|iv/i.test(key) ? '[REDACTED]' : redactSecrets(item)]));
}
