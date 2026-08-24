const maxFieldLength = 500;
export const DEFAULT_MODEL_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

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

export function normalizeModelConfig(input = {}, existing = {}) {
  const baseUrl = validateBaseUrl(input.baseUrl);
  const modelName = asBoundedText(input.modelName, 'modelName', { required: true });
  const apiKey = asBoundedText(input.apiKey, 'apiKey') || asBoundedText(existing.apiKey, 'apiKey', { required: true });
  return {
    baseUrl,
    modelName,
    modelFamily: asBoundedText(input.modelFamily, 'modelFamily'),
    apiKey,
    userAgent: asBoundedText(existing.userAgent, 'userAgent') || DEFAULT_MODEL_USER_AGENT
  };
}

export function publicModelConfig(config = {}, { fallback = {} } = {}) {
  const apiKey = String(config.apiKey || fallback.apiKey || '');
  return {
    source: config.source || fallback.source || 'PLATFORM',
    baseUrl: config.baseUrl || fallback.baseUrl || '',
    modelName: config.modelName || fallback.modelName || '',
    modelFamily: config.modelFamily || fallback.modelFamily || '',
    apiKey: redactApiKey(apiKey),
    hasApiKey: Boolean(apiKey)
  };
}
