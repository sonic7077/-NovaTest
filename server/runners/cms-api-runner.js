import { buildRequestBody, decryptPayload, redactSecrets } from '../services/cms-crypto.js';
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

export class CmsApiRunner {
  constructor({ config, fetchImpl = fetch }) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async execute(step, context) {
    const { request } = step;
    if (request.safety === 'mutating' && !context.allowMutations) throw new Error('mutating API step requires allowMutations');
    const startedAt = performance.now();
    const payload = {
      oauth_id: this.config.oauthId,
      oauth_type: this.config.oauthType,
      version: this.config.version,
      bundleId: this.config.bundleId,
      language: this.config.language,
      via: this.config.via,
      ...(request.action === 'loginByPassword' ? { username: this.config.username, password: this.config.password } : { token: context.variables.token }),
      ...interpolate(request.payload || {}, context.variables)
    };
    const encrypted = buildRequestBody(payload, this.config);
    const response = await this.fetchImpl(`${context.testCase.baseUrl}/api/remote/${request.action}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: encrypted.body
    });
    const outer = await response.json();
    const businessStatus = outer.status ?? (outer.errcode === 0 ? 1 : outer.errcode);
    if (!response.ok || businessStatus !== request.expectedStatus) throw new Error(`API assertion failed: ${request.action}`);
    const data = outer.crypt ? JSON.parse(decryptPayload(outer.data, this.config)) : outer.data;
    assertJson(data, request.expectedJson);
    const variables = {
      ...(request.action === 'loginByPassword' ? { token: data } : {}),
      ...extractVariables(data, request.extract)
    };
    return {
      variables,
      api: {
        action: request.action,
        method: 'POST',
        httpStatus: response.status,
        businessStatus,
        durationMs: Math.round(performance.now() - startedAt),
        request: redactSecrets(payload),
        response: redactSecrets(data)
      }
    };
  }
}
