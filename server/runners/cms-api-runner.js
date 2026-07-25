import { buildRequestBody, decryptPayload, redactBusinessSecrets, redactTransportSecrets } from '../services/cms-crypto.js';
import { interpolate } from '../domain/case.js';
import { generateTotp } from '../services/totp.js';

export class PreconditionError extends Error {
  constructor(message, api) {
    super(message);
    this.name = 'PreconditionError';
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
    const { path, exists, equals, equalsVariable } = expectation;
    const value = jsonPathValue(data, path);
    if (exists !== undefined && Boolean(value !== undefined) !== exists) throw new Error(`JSON assertion failed: ${path}`);
    if (Object.hasOwn(expectation, 'equals') && value !== equals) throw new Error(`JSON assertion failed: ${path}`);
    if (Object.hasOwn(expectation, 'equalsVariable')) {
      if (!(equalsVariable in variables)) throw new Error(`missing assertion variable: ${equalsVariable}`);
      if (value !== variables[equalsVariable]) throw new Error(`JSON assertion failed: ${path}`);
    }
  });
}

function extractVariables(data, extract = {}, api) {
  return Object.fromEntries(Object.entries(extract).map(([name, path]) => {
    const value = jsonPathValue(data, path);
    if (value === undefined) throw new PreconditionError(`前置数据不足：无法提取 ${name}`, api);
    return [name, value];
  }));
}

function selectListVariable(data, select, selectedApiIds, api) {
  const list = jsonPathValue(data, select.listPath);
  const candidate = Array.isArray(list) && list.find((item) => {
    const id = jsonPathValue(item, select.idPath);
    return id !== undefined && !selectedApiIds.has(String(id));
  });
  if (!candidate) throw new PreconditionError('前置数据不足：没有可用于本次审核的待处理记录', api);
  const id = jsonPathValue(candidate, select.idPath);
  selectedApiIds.add(String(id));
  return { [select.variable]: id };
}

function parseEncryptedResponse(data, config) {
  return JSON.parse(decryptPayload(data, config));
}

function responseData(outer, config) {
  if (outer.crypt) return parseEncryptedResponse(outer.data, config);
  if (typeof outer.data !== 'string') return outer.data;
  try { return parseEncryptedResponse(outer.data, config); }
  catch { return outer.data; }
}

function resolvedBusinessStatus(outer, data) {
  if (data && typeof data === 'object') {
    if (typeof data.status === 'number') return data.status;
    if (data.errcode === 0) return 1;
    if (typeof data.errcode === 'number') return data.errcode;
  }
  return outer.status ?? (outer.errcode === 0 ? 1 : outer.errcode);
}

function sessionToken(data) {
  if (typeof data === 'string' && data.trim()) return data;
  if (data && typeof data === 'object' && typeof data.data === 'string' && data.data.trim()) return data.data;
  return null;
}

export class CmsApiRunner {
  constructor({ config, fetchImpl = fetch }) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  createSession() {
    return {};
  }

  clientPayload(payload = {}) {
    return {
      oauth_id: this.config.oauthId,
      oauth_type: this.config.oauthType,
      version: this.config.version,
      bundleId: this.config.bundleId,
      language: this.config.language,
      via: this.config.via,
      ...payload
    };
  }

  async request(action, payload, baseUrl, expectedStatus) {
    const startedAt = performance.now();
    const encrypted = buildRequestBody(payload, this.config);
    const response = await this.fetchImpl(`${baseUrl}/api/remote/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: encrypted.body
    });
    const outer = await response.json();
    const data = responseData(outer, this.config);
    const businessStatus = resolvedBusinessStatus(outer, data);
    const api = {
      action,
      method: 'POST',
      httpStatus: response.status,
      businessStatus,
      durationMs: Math.round(performance.now() - startedAt),
      request: redactTransportSecrets(payload),
      response: action === 'loginByPassword' ? '********' : redactBusinessSecrets(data)
    };
    if (!response.ok || businessStatus !== expectedStatus) {
      const error = new Error(`API assertion failed: ${action}`);
      error.api = api;
      throw error;
    }
    return { api, data };
  }

  async authenticate(baseUrl, session) {
    if (session.authenticationError) throw new Error(session.authenticationError);
    if (session.token) return session;
    try {
      const result = await this.request('loginByPassword', this.clientPayload({
        username: this.config.username,
        password: this.config.password,
        secret: generateTotp(this.config.googleSecret)
      }), baseUrl, 1);
      const token = sessionToken(result.data);
      if (!token) {
        const error = new Error('CMS authentication returned no token');
        error.api = result.api;
        throw error;
      }
      session.token = token;
      session.loginApi = result.api;
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
    if (request.action === 'loginByPassword') {
      await this.authenticate(context.testCase.baseUrl, session);
      return { variables: {}, api: session.loginApi };
    }

    const skipSession = request.auth === 'none';
    const payload = this.clientPayload(interpolate(request.payload || {}, context.variables));
    if (!skipSession) {
      await this.authenticate(context.testCase.baseUrl, session);
      payload.token = session.token;
    }
    const result = await this.request(request.action, payload, context.testCase.baseUrl, request.expectedStatus);
    try {
      const selectedVariables = request.select
        ? selectListVariable(result.data, request.select, context.selectedApiIds ||= new Set(), result.api)
        : {};
      assertJson(result.data, request.expectedJson, { ...context.variables, ...selectedVariables });
      return { variables: { ...extractVariables(result.data, request.extract, result.api), ...selectedVariables }, api: result.api };
    } catch (error) {
      error.api = result.api;
      throw error;
    }
  }
}
