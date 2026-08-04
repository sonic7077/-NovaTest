import { interpolate } from '../domain/case.js';
import { redactBusinessSecrets, redactTransportSecrets } from '../services/cms-crypto.js';
import { generateTotp } from '../services/totp.js';

export class EditorialPreconditionError extends Error {
  constructor(message, api) {
    super(message);
    this.name = 'EditorialPreconditionError';
    this.code = 'PRECONDITION_UNAVAILABLE';
    this.api = api;
  }
}

function jsonPathValue(value, path) {
  if (typeof path !== 'string' || !/^\$(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/.test(path)) throw new Error(`invalid JSON path: ${path}`);
  return path.slice(1).match(/\.[A-Za-z_$][\w$]*|\[\d+\]/g)?.reduce((current, segment) => {
    if (current === null || current === undefined) return undefined;
    return segment.startsWith('.') ? current[segment.slice(1)] : current[Number(segment.slice(1, -1))];
  }, value) ?? (path === '$' ? value : undefined);
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
    if (value === undefined) throw new EditorialPreconditionError(`前置数据不足：无法提取 ${name}`, api);
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
  if (!candidate) throw new EditorialPreconditionError('前置数据不足：没有可用于本次审核的待处理记录', api);
  const id = jsonPathValue(candidate, select.idPath);
  selectedApiIds.add(String(id));
  return {
    [select.variable]: id,
    ...Object.fromEntries(Object.entries(select.extract || {}).map(([name, path]) => {
      const value = jsonPathValue(candidate, path);
      if (value === undefined) throw new EditorialPreconditionError(`前置数据不足：无法提取 ${name}`, api);
      return [name, value];
    }))
  };
}

function editorialUrl(baseUrl, action, payload, method) {
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(action)) throw new Error(`invalid Editorial action: ${action}`);
  const url = new URL(`/api/editorial/${action}`, baseUrl);
  if (method === 'GET') {
    Object.entries(payload).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      (Array.isArray(value) ? value : [value]).forEach((item) => url.searchParams.append(key, String(item)));
    });
  }
  return url.toString();
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return { error: 'invalid JSON response' };
  }
}

function apiEvidence({ action, method, response, body, startedAt, payload }) {
  return {
    action,
    method,
    httpStatus: response.status,
    durationMs: Math.round(performance.now() - startedAt),
    request: redactTransportSecrets(payload),
    response: redactBusinessSecrets(body)
  };
}

function requestFailure(message, api) {
  const error = new Error(message);
  error.api = api;
  return error;
}

export class EditorialApiRunner {
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
    const payload = {
      username: this.config.username,
      password: this.config.password,
      totp_code: generateTotp(this.config.googleSecret)
    };
    const startedAt = performance.now();
    try {
      const response = await this.fetchImpl(new URL('/api/auth/login', baseUrl).toString(), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
      });
      const body = await parseJson(response);
      const api = apiEvidence({ action: 'auth/login', method: 'POST', response, body: '********', startedAt, payload: '********' });
      if (!response.ok || typeof body.access_token !== 'string' || !body.access_token) throw requestFailure('Editorial authentication failed', api);
      session.token = body.access_token;
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
    const payload = interpolate(request.payload || {}, context.variables);
    if (request.auth !== 'none') await this.authenticate(context.testCase.baseUrl, session);

    const startedAt = performance.now();
    const url = editorialUrl(context.testCase.baseUrl, request.action, payload, request.method);
    const response = await this.fetchImpl(url, {
      method: request.method,
      headers: {
        accept: 'application/json',
        ...(request.method === 'POST' ? { 'content-type': 'application/json' } : {}),
        ...(request.auth !== 'none' ? { authorization: `Bearer ${session.token}` } : {})
      },
      ...(request.method === 'POST' ? { body: JSON.stringify(payload) } : {})
    });
    const body = await parseJson(response);
    const api = apiEvidence({ action: request.action, method: request.method, response, body, startedAt, payload });
    if (!response.ok || response.status !== request.expectedStatus) throw requestFailure(`API assertion failed: ${request.action}`, api);

    try {
      const selectedVariables = selectListVariables(body, request.select, context.selectedApiIds ||= new Set(), api);
      assertJson(body, request.expectedJson, { ...context.variables, ...selectedVariables });
      return { variables: { ...extractVariables(body, request.extract, api), ...selectedVariables }, api };
    } catch (error) {
      error.api ||= api;
      throw error;
    }
  }
}
