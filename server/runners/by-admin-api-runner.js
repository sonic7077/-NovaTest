import { interpolate } from '../domain/case.js';
import { generateTotp } from '../services/totp.js';

const ACTION_PATTERN = /^\/admin-api\/v1\/[A-Za-z0-9_/-]+$/;
const JSON_PATH_PATTERN = /^\$(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/;
const SECRET_KEY_PATTERN = /(?:password|token|authorization|secret|credential|contact|hash|api[_-]?id|qrcode|setup)/i;
const BROWSER_USER_AGENT = 'Mozilla/5.0 (compatible; NovaTest/1.0; +https://example.invalid)';

export class ByAdminPreconditionError extends Error {
  constructor(message, api) {
    super(message);
    this.name = 'ByAdminPreconditionError';
    this.code = 'PRECONDITION_UNAVAILABLE';
    this.api = api;
  }
}

function redact(value) {
  if (typeof value === 'string') return value.replace(/(Bearer\s+)[^\s]+/gi, '$1********')
    .replace(/([?&](?:token|authorization|password|secret|signature|key)=)[^&#\s]*/gi, '$1********');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEY_PATTERN.test(key) ? '********' : redact(item)]));
  return value;
}

function jsonPathValue(value, path) {
  if (typeof path !== 'string' || !JSON_PATH_PATTERN.test(path)) throw new Error(`invalid JSON path: ${path}`);
  return path.slice(1).match(/\.[A-Za-z_$][\w$]*|\[\d+\]/g)?.reduce((current, segment) => {
    if (current === null || current === undefined) return undefined;
    return segment.startsWith('.') ? current[segment.slice(1)] : current[Number(segment.slice(1, -1))];
  }, value) ?? (path === '$' ? value : undefined);
}

function appendQuery(searchParams, payload) {
  Object.entries(payload).forEach(([key, value]) => (Array.isArray(value) ? value : [value])
    .filter((item) => item !== undefined && item !== null)
    .forEach((item) => searchParams.append(key, String(item))));
}

function adminUrl(baseUrl, action, payload, method) {
  if (typeof action !== 'string' || !ACTION_PATTERN.test(action)) throw new Error(`invalid BY admin action: ${action}`);
  const base = new URL(baseUrl);
  const url = new URL(action, base);
  if (url.origin !== base.origin) throw new Error(`invalid BY admin action: ${action}`);
  if (method === 'GET') appendQuery(url.searchParams, payload);
  return url.toString();
}

function expectedMatches(actual, expected) {
  return (Array.isArray(expected) ? expected : [expected]).includes(actual);
}

async function parseJson(response) {
  try { return await response.json(); } catch { return { code: undefined, msg: 'invalid JSON response', data: null }; }
}

function apiEvidence({ action, method, response, body, startedAt, payload, session }) {
  return {
    action, method, httpStatus: response.status, businessStatus: body?.code,
    durationMs: Math.round(performance.now() - startedAt), request: redact(payload), response: redact(body),
    authentication: session ? { reused: Boolean(session.reused), loginCount: session.loginCount || 0, refreshCount: session.refreshCount || 0 } : undefined
  };
}

function requestFailure(message, api) {
  const error = new Error(message);
  error.api = api;
  return error;
}

function assertJson(data, expectedJson = [], variables = {}) {
  expectedJson.forEach((expectation) => {
    const value = jsonPathValue(data, expectation.path);
    if (expectation.exists !== undefined && Boolean(value !== undefined) !== expectation.exists) throw new Error(`JSON assertion failed: ${expectation.path}`);
    if (Object.hasOwn(expectation, 'equals') && value !== expectation.equals) throw new Error(`JSON assertion failed: ${expectation.path}`);
    if (Object.hasOwn(expectation, 'equalsVariable')) {
      if (!(expectation.equalsVariable in variables)) throw new Error(`missing assertion variable: ${expectation.equalsVariable}`);
      if (value !== variables[expectation.equalsVariable]) throw new Error(`JSON assertion failed: ${expectation.path}`);
    }
  });
}

function extractVariables(data, extract = {}, api) {
  return Object.fromEntries(Object.entries(extract).map(([name, path]) => {
    const value = jsonPathValue(data, path);
    if (value === undefined) throw new ByAdminPreconditionError(`前置数据不足：无法提取 ${name}`, api);
    return [name, value];
  }));
}

export class ByAdminApiRunner {
  constructor({ config, fetchImpl = fetch } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  createSession() {
    return { token: undefined, loginCount: 0, refreshCount: 0, reused: false };
  }

  async authenticate(baseUrl, session, config) {
    if (session.token) { session.reused = true; return session; }
    const resolved = config || this.config;
    if (!resolved?.username || !resolved?.password) throw new ByAdminPreconditionError('前置认证配置缺失：BY 后台测试账号未配置');
    const payload = {
      username: resolved.username,
      password: resolved.password,
      ...(resolved.totpSecret ? { totpCode: generateTotp(resolved.totpSecret) } : {})
    };
    const startedAt = performance.now();
    const response = await this.fetchImpl(adminUrl(baseUrl, '/admin-api/v1/auth/login', {}, 'POST'), {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': BROWSER_USER_AGENT }, body: JSON.stringify(payload)
    });
    const body = await parseJson(response);
    const api = apiEvidence({ action: '/admin-api/v1/auth/login', method: 'POST', response, body, startedAt, payload, session });
    const token = body?.token || body?.data?.token;
    if (!response.ok || typeof token !== 'string' || !token) throw requestFailure('BY admin authentication failed', api);
    session.token = token;
    session.loginCount += 1;
    session.reused = false;
    return session;
  }

  async request(step, context, { retried = false } = {}) {
    const { request } = step;
    const session = context.apiSession ||= this.createSession();
    const variables = context.variables || {};
    const action = interpolate(request.action, variables);
    const payload = interpolate(request.payload || {}, variables);
    const requiresAuth = request.auth !== 'none';
    if (requiresAuth) await this.authenticate(context.testCase.baseUrl, session, context.byAdminConfig);
    const startedAt = performance.now();
    const response = await this.fetchImpl(adminUrl(context.testCase.baseUrl, action, payload, request.method), {
      method: request.method,
      headers: {
        accept: 'application/json', 'user-agent': BROWSER_USER_AGENT,
        ...(requiresAuth ? { authorization: `Bearer ${session.token}` } : {}),
        ...(request.method !== 'GET' ? { 'content-type': 'application/json' } : {})
      },
      ...(request.method !== 'GET' ? { body: JSON.stringify(payload) } : {})
    });
    const body = await parseJson(response);
    const api = apiEvidence({ action, method: request.method, response, body, startedAt, payload, session });
    if (requiresAuth && response.status === 401 && !retried) {
      session.token = undefined;
      session.refreshCount += 1;
      return this.request(step, context, { retried: true });
    }
    if (!expectedMatches(response.status, request.expectedStatus)) throw requestFailure(`BY admin API assertion failed: ${action}`, api);
    if (request.expectedCode !== undefined && !expectedMatches(body?.code, request.expectedCode)) throw requestFailure(`BY admin business assertion failed: ${action}`, api);
    try {
      assertJson(body, request.expectedJson, variables);
      return { variables: extractVariables(body, request.extract, api), api };
    } catch (error) {
      error.api ||= api;
      throw error;
    }
  }

  async execute(step, context) {
    if (step.request.safety === 'mutating' && !context.allowMutations) throw new Error('mutating API step requires allowMutations');
    if (typeof step.request.action !== 'string' || !ACTION_PATTERN.test(step.request.action)) throw new Error(`invalid BY admin action: ${step.request.action}`);
    return this.request(step, context);
  }
}
