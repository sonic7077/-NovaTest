import { interpolate } from '../domain/case.js';

const ACTION_PATTERN = /^\/c-api\/v1\/[A-Za-z0-9_/-]+$/;
const JSON_PATH_PATTERN = /^\$(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/;
const SECRET_KEY_PATTERN = /(?:password|token|authorization|secret|credential|contact)/i;
const BROWSER_USER_AGENT = 'Mozilla/5.0 (compatible; NovaTest/1.0; +https://example.invalid)';

export class ByPreconditionError extends Error {
  constructor(message, api) {
    super(message);
    this.name = 'ByPreconditionError';
    this.code = 'PRECONDITION_UNAVAILABLE';
    this.api = api;
  }
}

function jsonPathValue(value, path) {
  if (typeof path !== 'string' || !JSON_PATH_PATTERN.test(path)) throw new Error(`invalid JSON path: ${path}`);
  return path.slice(1).match(/\.[A-Za-z_$][\w$]*|\[\d+\]/g)?.reduce((current, segment) => {
    if (current === null || current === undefined) return undefined;
    return segment.startsWith('.') ? current[segment.slice(1)] : current[Number(segment.slice(1, -1))];
  }, value) ?? (path === '$' ? value : undefined);
}

function redact(value) {
  if (typeof value === 'string') {
    return value.replace(/([?&](?:auth(?:entication)?[_-]?key|token|access[_-]?token|refresh[_-]?token|signature|sign)=)[^&#\s]*/gi, '$1********');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, SECRET_KEY_PATTERN.test(key) ? '********' : redact(item)
  ]));
  return value;
}

function appendQuery(searchParams, payload) {
  Object.entries(payload).forEach(([key, value]) => {
    (Array.isArray(value) ? value : [value]).filter((item) => item !== undefined && item !== null)
      .forEach((item) => searchParams.append(key, String(item)));
  });
}

function byUrl(baseUrl, action, payload, method) {
  if (typeof action !== 'string' || !ACTION_PATTERN.test(action)) throw new Error(`invalid BY action: ${action}`);
  const base = new URL(baseUrl);
  const url = new URL(action, base);
  if (url.origin !== base.origin) throw new Error(`invalid BY action: ${action}`);
  if (method === 'GET') appendQuery(url.searchParams, payload);
  return url.toString();
}

function expectedMatches(actual, expected) {
  return (Array.isArray(expected) ? expected : [expected]).includes(actual);
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return { code: undefined, msg: 'invalid JSON response', data: null };
  }
}

function apiEvidence({ action, method, response, body, startedAt, payload }) {
  return {
    action,
    method,
    httpStatus: response.status,
    businessStatus: body?.code,
    durationMs: Math.round(performance.now() - startedAt),
    request: redact(payload),
    response: redact(body)
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
    if (value === undefined) throw new ByPreconditionError(`前置数据不足：无法提取 ${name}`, api);
    return [name, value];
  }));
}

export class ByApiRunner {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetchImpl = fetchImpl;
  }

  createSession() {
    return {};
  }

  async execute(step, context) {
    const { request } = step;
    if (request.safety === 'mutating' && !context.allowMutations) throw new Error('mutating API step requires allowMutations');

    const payload = interpolate(request.payload || {}, context.variables || {});
    const startedAt = performance.now();
    const response = await this.fetchImpl(byUrl(context.testCase.baseUrl, request.action, payload, request.method), {
      method: request.method,
      headers: {
        accept: 'application/json',
        'user-agent': BROWSER_USER_AGENT,
        ...(request.method === 'POST' ? { 'content-type': 'application/json' } : {})
      },
      ...(request.method === 'POST' ? { body: JSON.stringify(payload) } : {})
    });
    const body = await parseJson(response);
    const api = apiEvidence({ action: request.action, method: request.method, response, body, startedAt, payload });

    if (!expectedMatches(response.status, request.expectedStatus)) throw requestFailure(`API assertion failed: ${request.action}`, api);
    if (!expectedMatches(body?.code, request.expectedCode)) throw requestFailure(`BY business assertion failed: ${request.action}`, api);

    try {
      assertJson(body, request.expectedJson, context.variables || {});
      return { variables: extractVariables(body, request.extract, api), api };
    } catch (error) {
      error.api ||= api;
      throw error;
    }
  }
}
