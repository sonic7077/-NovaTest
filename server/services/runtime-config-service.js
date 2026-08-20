import { DEFAULT_MODEL_USER_AGENT } from './model-config-service.js';

const cmsFields = ['baseUrl', 'key', 'iv', 'appKey', 'username', 'password', 'googleSecret', 'oauthId', 'oauthType', 'version', 'bundleId', 'language', 'via'];
const lighthouseFields = ['projectName', 'email', 'password', 'totpSecret'];
const editorialFields = ['baseUrl', 'username', 'password', 'googleSecret'];
const flywheelFields = ['baseUrl', 'platformKey', 'platformId'];
const daygfFields = ['baseUrl', 'username', 'password'];
const byAdminFields = ['baseUrl', 'username', 'password', 'totpSecret'];

function requiredText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`runtime configuration is incomplete: ${field}`);
  if (text.length > 500) throw new Error(`runtime configuration is invalid: ${field}`);
  return text;
}

function requiredUrl(value, field) {
  const url = requiredText(value, field);
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new Error(`runtime configuration is invalid: ${field}`);
  }
  return url.replace(/\/$/, '');
}

function normalizeModel(input = {}) {
  return {
    baseUrl: requiredUrl(input.baseUrl, 'model.baseUrl'),
    modelName: requiredText(input.modelName, 'model.modelName'),
    modelFamily: typeof input.modelFamily === 'string' ? input.modelFamily.trim() : '',
    apiKey: requiredText(input.apiKey, 'model.apiKey'),
    userAgent: typeof input.userAgent === 'string' && input.userAgent.trim()
      ? requiredText(input.userAgent, 'model.userAgent')
      : DEFAULT_MODEL_USER_AGENT
  };
}

function normalizeGroup(input, fields, group, urlField) {
  return Object.fromEntries(fields.map((field) => [field, field === urlField
    ? requiredUrl(input?.[field], `${group}.${field}`)
    : requiredText(input?.[field], `${group}.${field}`)]));
}

function normalizeOptionalGroup(input, fields, group, urlField) {
  if (input === undefined) return undefined;
  return normalizeGroup(input, fields, group, urlField);
}

export function normalizeRuntimeConfig(input = {}) {
  const editorial = normalizeOptionalGroup(input.editorial, editorialFields, 'editorial', 'baseUrl');
  const flywheel = normalizeOptionalGroup(input.flywheel, flywheelFields, 'flywheel', 'baseUrl');
  const daygf = normalizeOptionalGroup(input.daygf, daygfFields, 'daygf', 'baseUrl');
  const byAdmin = normalizeOptionalGroup(input.byAdmin, byAdminFields, 'byAdmin', 'baseUrl');
  return {
    model: normalizeModel(input.model),
    cms: normalizeGroup(input.cms, cmsFields, 'cms', 'baseUrl'),
    lighthouse: normalizeGroup(input.lighthouse, lighthouseFields, 'lighthouse'),
    ...(editorial ? { editorial } : {}),
    ...(flywheel ? { flywheel } : {}),
    ...(daygf ? { daygf } : {}),
    ...(byAdmin ? { byAdmin } : {})
  };
}

export function runtimeConfigFromEnvironment(env = {}) {
  const editorial = {
    baseUrl: env.EDITORIAL_BASE_URL,
    username: env.EDITORIAL_USERNAME,
    password: env.EDITORIAL_PASSWORD,
    googleSecret: env.EDITORIAL_GOOGLE_SECRET
  };
  const flywheel = {
    baseUrl: env.FLYWHEEL_BASE_URL,
    platformKey: env.FLYWHEEL_PLATFORM_KEY,
    platformId: env.FLYWHEEL_PLATFORM_ID
  };
  const daygf = {
    baseUrl: env.DAYGF_BASE_URL,
    username: env.DAYGF_USERNAME,
    password: env.DAYGF_PASSWORD
  };
  const byAdmin = {
    baseUrl: env.BY_ADMIN_BASE_URL,
    username: env.BY_ADMIN_USERNAME,
    password: env.BY_ADMIN_PASSWORD,
    totpSecret: env.BY_ADMIN_TOTP_SECRET
  };
  return normalizeRuntimeConfig({
    model: {
      baseUrl: env.MIDSCENE_MODEL_BASE_URL || env.WUJI_BASE_URL,
      modelName: env.MIDSCENE_MODEL_NAME || env.WUJI_MODEL,
      modelFamily: env.MIDSCENE_MODEL_FAMILY,
      apiKey: env.MIDSCENE_MODEL_API_KEY || env.WUJI_MODEL_API_KEY
    },
    cms: {
      baseUrl: env.CMS_BASE_URL, key: env.CMS_AES_KEY, iv: env.CMS_AES_IV, appKey: env.CMS_APP_KEY,
      username: env.CMS_USERNAME, password: env.CMS_PASSWORD, googleSecret: env.CMS_GOOGLE_SECRET,
      oauthId: env.CMS_OAUTH_ID, oauthType: env.CMS_OAUTH_TYPE, version: env.CMS_VERSION,
      bundleId: env.CMS_BUNDLE_ID, language: env.CMS_LANGUAGE, via: env.CMS_VIA
    },
    lighthouse: {
      projectName: env.LIGHTHOUSE_PROJECT_NAME || '默认项目', email: env.LIGHTHOUSE_EMAIL,
      password: env.LIGHTHOUSE_PASSWORD, totpSecret: env.LIGHTHOUSE_TOTP_SECRET
    },
    ...(Object.values(editorial).some(Boolean) ? { editorial } : {}),
    ...(Object.values(flywheel).some(Boolean) ? { flywheel } : {}),
    ...(Object.values(daygf).some(Boolean) ? { daygf } : {}),
    ...(Object.values(byAdmin).some(Boolean) ? { byAdmin } : {})
  });
}
