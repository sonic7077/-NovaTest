import { interpolate } from '../domain/case.js';

const SECRET_KEY_PATTERN = /(?:password|token|authorization|secret|credential)/i;
const JSON_PATH_PATTERN = /^\$(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/;

export class DaygfPreconditionError extends Error {
  constructor(message, api) {
    super(message);
    this.name = 'DaygfPreconditionError';
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

function restUrl(baseUrl, action, payload, method) {
  if (typeof action !== 'string' || !action.startsWith('/api/')) throw new Error(`invalid Daygf action: ${action}`);
  const base = new URL(baseUrl);
  const url = new URL(action, base);
  if (url.origin !== base.origin) throw new Error(`invalid Daygf action: ${action}`);
  if (method === 'GET' || method === 'DELETE') appendQuery(url.searchParams, payload);
  return url.toString();
}

function expectedStatusMatches(actualStatus, expectedStatus) {
  return (Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus]).includes(actualStatus);
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return { error: 'invalid JSON response' };
  }
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
    if (value === undefined) throw new DaygfPreconditionError(`前置数据不足：无法提取 ${name}`, api);
    return [name, value];
  }));
}

function selectListVariables(data, select, selectedApiIds, api) {
  if (!select) return {};
  const list = jsonPathValue(data, select.listPath);
  const candidate = Array.isArray(list) && list.find((item) => {
    const id = jsonPathValue(item, select.idPath);
    return id !== undefined && !selectedApiIds.has(String(id));
  });
  if (!candidate) throw new DaygfPreconditionError('前置数据不足：没有可用于本次执行的记录', api);
  const id = jsonPathValue(candidate, select.idPath);
  selectedApiIds.add(String(id));
  return {
    [select.variable]: id,
    ...Object.fromEntries(Object.entries(select.extract || {}).map(([name, path]) => {
      const value = jsonPathValue(candidate, path);
      if (value === undefined) throw new DaygfPreconditionError(`前置数据不足：无法提取 ${name}`, api);
      return [name, value];
    }))
  };
}

function apiEvidence({ action, method, response, body, startedAt, payload }) {
  return {
    action,
    method,
    httpStatus: response.status,
    durationMs: Math.round(performance.now() - startedAt),
    request: redact(payload),
    response: redact(body)
  };
}

export class DaygfApiRunner {
  constructor({ config, fetchImpl = fetch }) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  createSession() {
    return {};
  }

  async authenticate(baseUrl, session) {
    if (session.authenticationError) throw new Error(session.authenticationError);
    if (session.token) return session;
    const payload = { username: this.config.username, password: this.config.password };
    const startedAt = performance.now();
    try {
      const response = await this.fetchImpl(restUrl(baseUrl, '/api/login', {}, 'POST'), {
        method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(payload)
      });
      const body = await parseJson(response);
      const api = apiEvidence({ action: '/api/login', method: 'POST', response, body, startedAt, payload });
      if (!response.ok || typeof body?.token !== 'string' || !body.token) throw requestFailure('Daygf authentication failed', api);
      session.token = body.token;
      session.refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : undefined;
      session.loginApi = api;
      return session;
    } catch (error) {
      session.authenticationError = error.message;
      throw error;
    }
  }

  async execute(step, context) {
    const { request } = step;
    if (request.safety === 'mutating' && !context.allowMutations) throw new Error('mutating API step requires allowMutations');
    const session = context.apiSession ||= this.createSession();
    const payload = interpolate(request.payload || {}, context.variables || {});
    const isSessionRequest = request.auth !== 'none' && request.auth !== 'invalid';
    if (isSessionRequest) await this.authenticate(context.testCase.baseUrl, session);

    const token = request.auth === 'invalid' ? 'invalid-token' : session.token;
    const startedAt = performance.now();
    const url = restUrl(context.testCase.baseUrl, request.action, payload, request.method);
    const response = await this.fetchImpl(url, {
      method: request.method,
      headers: {
        accept: 'application/json',
        ...(['POST', 'PUT'].includes(request.method) ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'x-token': token, authorization: `Bearer ${token}` } : {})
      },
      ...(['POST', 'PUT'].includes(request.method) ? { body: JSON.stringify(payload) } : {})
    });
    const body = await parseJson(response);
    const api = apiEvidence({ action: request.action, method: request.method, response, body, startedAt, payload });
    if (!expectedStatusMatches(response.status, request.expectedStatus)) throw requestFailure(`API assertion failed: ${request.action}`, api);

    try {
      const selectedVariables = selectListVariables(body, request.select, context.selectedApiIds ||= new Set(), api);
      assertJson(body, request.expectedJson, { ...(context.variables || {}), ...selectedVariables });
      return { variables: { ...extractVariables(body, request.extract, api), ...selectedVariables }, api };
    } catch (error) {
      error.api ||= api;
      throw error;
    }
  }
}
