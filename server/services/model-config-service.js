import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const maxFieldLength = 500;

function encryptionKey(secret) {
  const value = String(secret || '');
  if (value.length < 32) throw new Error('PLATFORM_CONFIG_ENCRYPTION_KEY must contain at least 32 characters');
  return createHash('sha256').update(value).digest();
}

function asBoundedText(value, field, { required = false } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (required && !normalized) throw new Error(`${field} is required`);
  if (normalized.length > maxFieldLength) throw new Error(`${field} must not exceed ${maxFieldLength} characters`);
  return normalized;
}

function validateBaseUrl(value) {
  const baseUrl = asBoundedText(value, 'baseUrl', { required: true });
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('baseUrl must be a valid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('baseUrl must use HTTP or HTTPS');
  return baseUrl.replace(/\/$/, '');
}

function redactApiKey(apiKey) {
  return apiKey ? `${apiKey.slice(0, 3)}****************` : '';
}

export function encryptModelApiKey(apiKey, secret) {
  const plaintext = asBoundedText(apiKey, 'apiKey', { required: true });
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptModelApiKey(encryptedApiKey, secret) {
  const [ivValue, tagValue, ciphertextValue, ...extra] = String(encryptedApiKey || '').split('.');
  if (!ivValue || !tagValue || !ciphertextValue || extra.length) throw new Error('stored model API key cannot be decrypted');
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('stored model API key cannot be decrypted');
  }
}

export function normalizeModelConfig(input = {}, existing = {}, { encryptionKey: secret } = {}) {
  const apiKey = asBoundedText(input.apiKey, 'apiKey');
  const clearApiKey = input.clearApiKey === true;
  let encryptedApiKey = String(existing.encryptedApiKey || '');
  if (clearApiKey) encryptedApiKey = '';
  else if (apiKey) encryptedApiKey = encryptModelApiKey(apiKey, secret);

  return {
    source: 'PLATFORM',
    baseUrl: validateBaseUrl(input.baseUrl),
    modelName: asBoundedText(input.modelName, 'modelName', { required: true }),
    modelFamily: asBoundedText(input.modelFamily, 'modelFamily'),
    encryptedApiKey
  };
}

export function publicModelConfig(config = {}, { decryptApiKey, fallback = {} } = {}) {
  const encryptedApiKey = String(config.encryptedApiKey || '');
  const apiKey = encryptedApiKey && decryptApiKey ? decryptApiKey(encryptedApiKey) : String(config.apiKey || fallback.apiKey || '');
  return {
    source: config.source || fallback.source || 'MIDSCENE',
    baseUrl: config.baseUrl || fallback.baseUrl || '',
    modelName: config.modelName || fallback.modelName || '',
    modelFamily: config.modelFamily || fallback.modelFamily || '',
    apiKey: redactApiKey(apiKey),
    hasApiKey: Boolean(apiKey)
  };
}

export function modelConfigRunnerEnv(config, secret, fallbackEnv = {}) {
  const hasSavedKeySetting = Object.hasOwn(config, 'encryptedApiKey');
  const apiKey = config.encryptedApiKey
    ? decryptModelApiKey(config.encryptedApiKey, secret)
    : (hasSavedKeySetting ? '' : String(fallbackEnv.MIDSCENE_MODEL_API_KEY || ''));
  return {
    ...fallbackEnv,
    MIDSCENE_MODEL_BASE_URL: config.baseUrl || fallbackEnv.MIDSCENE_MODEL_BASE_URL || '',
    MIDSCENE_MODEL_NAME: config.modelName || fallbackEnv.MIDSCENE_MODEL_NAME || '',
    MIDSCENE_MODEL_FAMILY: config.modelFamily || fallbackEnv.MIDSCENE_MODEL_FAMILY || '',
    MIDSCENE_MODEL_API_KEY: apiKey
  };
}
