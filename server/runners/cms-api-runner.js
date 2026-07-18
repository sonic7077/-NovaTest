import { buildRequestBody, decryptPayload, redactBusinessSecrets, redactTransportSecrets } from '../services/cms-crypto.js';
import { interpolate } from '../domain/case.js';

function jsonPathValue(value, path) {
  if (typeof path !== 'string' || !/^\$(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/.test(path)) throw new Error(`invalid JSON path: ${path}`);
  return path.slice(1).match(/\.[A-Za-z_$][\w$]*|\[\d+\]/g)?.reduce((current, segment) => {
    if (current === null || current === undefined) return undefined;
    return segment.startsWith('.') ? current[segment.slice(1)] : current[Number(segment.slice(1, -1))];
  }, value) ?? (path === '$' ? value : undefined);
}

function assertJson(data, expectedJson = []) {
  expectedJson.forEach(({ path, equals }) => {
    if (jsonPathValue(data, path) !== equals) throw new Error(`JSON assertion failed: ${path}`);
  });
}

function extractVariables(data, extract = {}) {
  return Object.fromEntries(Object.entries(extract).map(([name, path]) => [name, jsonPathValue(data, path)]));
}

function parseEncryptedResponse(data, config) {
  return JSON.parse(decryptPayload(data, config));
}

function responseData(outer, config, autoDecrypt = true) {
  if (outer.crypt) return parseEncryptedResponse(outer.data, config);
  if (!autoDecrypt) return outer.data;
  if (typeof outer.data !== 'string') return outer.data;
  try { return parseEncryptedResponse(outer.data, config); }
  catch { return outer.data; }
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
    const businessStatus = outer.status ?? (outer.errcode === 0 ? 1 : outer.errcode);
    if (!response.ok || businessStatus !== expectedStatus) throw new Error(`API assertion failed: ${action}`);
    const data = responseData(outer, this.config, action !== 'loginByPassword');
    return {
      api: {
        action,
        method: 'POST',
        httpStatus: response.status,
        businessStatus,
        durationMs: Math.round(performance.now() - startedAt),
        request: redactTransportSecrets(payload),
        response: action === 'loginByPassword' ? '********' : redactBusinessSecrets(data)
      },
      data
    };
  }

  async authenticate(baseUrl, session) {
    if (session.authenticationError) throw new Error(session.authenticationError);
    if (session.token) return session;
    try {
      const result = await this.request('loginByPassword', this.clientPayload({ username: this.config.username, password: this.config.password }), baseUrl, 1);
      if (typeof result.data !== 'string' || !result.data.trim()) throw new Error('CMS authentication returned no token');
      session.token = result.data;
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

    await this.authenticate(context.testCase.baseUrl, session);
    const payload = this.clientPayload({ token: session.token, ...interpolate(request.payload || {}, context.variables) });
    const result = await this.request(request.action, payload, context.testCase.baseUrl, request.expectedStatus);
    assertJson(result.data, request.expectedJson);
    return { variables: extractVariables(result.data, request.extract), api: result.api };
  }
}
