import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';

const SECRET_MASK = '********';
const TRANSPORT_SECRET_KEY = /token|password|data|sign|key|iv/i;
const BUSINESS_SECRET_KEY = /token|password|sign|key|iv/i;

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

function redactByKey(value, secretKey) {
  if (Array.isArray(value)) return value.map((item) => redactByKey(item, secretKey));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? SECRET_MASK : redactByKey(item, secretKey)]));
}

export const redactTransportSecrets = (value) => redactByKey(value, TRANSPORT_SECRET_KEY);
export const redactBusinessSecrets = (value) => redactByKey(value, BUSINESS_SECRET_KEY);
export const redactSecrets = redactTransportSecrets;
