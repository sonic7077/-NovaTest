import { buildRequestBody, decryptPayload, redactSecrets } from '../services/cms-crypto.js';

export class CmsApiRunner {
  constructor({ config, fetchImpl = fetch }) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async execute(step, context) {
    const { request } = step;
    if (request.safety === 'mutating' && !context.allowMutations) throw new Error('mutating API step requires allowMutations');
    const payload = {
      oauth_id: this.config.oauthId,
      oauth_type: this.config.oauthType,
      version: this.config.version,
      ...(request.action === 'loginByPassword' ? { username: this.config.username, password: this.config.password } : { token: context.variables.token }),
      ...request.payload
    };
    const encrypted = buildRequestBody(payload, this.config);
    const response = await this.fetchImpl(`${context.testCase.baseUrl}/api/remote/${request.action}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: encrypted.body
    });
    const outer = await response.json();
    if (!response.ok || outer.status !== request.expectedStatus) throw new Error(`API assertion failed: ${request.action}`);
    const data = outer.crypt ? JSON.parse(decryptPayload(outer.data, this.config)) : outer.data;
    const variables = request.action === 'loginByPassword' ? { token: data } : {};
    return { variables, api: { action: request.action, method: 'POST', httpStatus: response.status, businessStatus: outer.status, request: redactSecrets(payload), response: redactSecrets(data) } };
  }
}
