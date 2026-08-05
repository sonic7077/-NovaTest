import { interpolate } from '../domain/case.js';

const USER_AGENT = 'NovaTest/0.1 API Runner';
const jsonPathPattern = /^\$(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/;

export class FlywheelPreconditionError extends Error {
  constructor(message, api) {
    super(message);
    this.name = 'FlywheelPreconditionError';
    this.code = 'PRECONDITION_UNAVAILABLE';
    this.api = api;
  }
}

function jsonPathValue(value, path) {
  if (typeof path !== 'string' || !jsonPathPattern.test(path)) throw new Error(`invalid JSON path: ${path}`);
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
    if (value === undefined) throw new FlywheelPreconditionError(`前置数据不足：无法提取 ${name}`, api);
    return [name, value];
  }));
}

function redact(value, platformKey) {
  if (typeof value === 'string') return value.replaceAll(platformKey, '********');
  if (Array.isArray(value)) return value.map((item) => redact(item, platformKey));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /(?:key|token|authorization|password|secret)/i.test(key) ? '********' : redact(item, platformKey)
    ]));
  }
  return value;
}

function appendQuery(searchParams, payload) {
  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    (Array.isArray(value) ? value : [value]).forEach((item) => searchParams.append(key, String(item)));
  });
}

function flywheelUrl(baseUrl, action, payload, method) {
  if (typeof action !== 'string' || !action.startsWith('/')) throw new Error(`invalid Flywheel action: ${action}`);
  const base = new URL(baseUrl);
  const url = new URL(action, base);
  if (url.origin !== base.origin) throw new Error(`invalid Flywheel action: ${action}`);
  if (method === 'GET') appendQuery(url.searchParams, payload);
  return url.toString();
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return { error: 'invalid JSON response' };
  }
}

function expectedStatusMatches(actualStatus, expectedStatus) {
  return (Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus]).includes(actualStatus);
}

function pollSatisfied(body, poll) {
  if (!poll) return true;
  return poll.values.includes(jsonPathValue(body, poll.path));
}

function requestFailure(message, api) {
  const error = new Error(message);
  error.api = api;
  return error;
}

export class FlywheelApiRunner {
  constructor({ config, fetchImpl = fetch, userAgent = USER_AGENT, sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) }) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.userAgent = userAgent;
    this.sleep = sleep;
  }

  createSession() {
    return {};
  }

  async execute(step, context) {
    const { request } = step;
    if (request.safety === 'mutating' && !context.allowMutations) throw new Error('mutating API step requires allowMutations');
    const variables = { ...(context.variables || {}), platformId: this.config.platformId };
    const action = interpolate(request.action, variables);
    const payload = interpolate(request.payload || {}, variables);
    const platformKey = request.auth === 'invalid' ? 'invalid-platform-key' : this.config.platformKey;
    const startedAt = performance.now();
    const url = flywheelUrl(context.testCase.baseUrl, action, payload, request.method);
    const maxAttempts = request.poll?.maxAttempts || 1;
    let response;
    let body;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      response = await this.fetchImpl(url, {
        method: request.method,
        headers: {
          accept: 'application/json',
          'user-agent': this.userAgent,
          ...(request.auth !== 'none' ? { 'x-platform-key': platformKey } : {}),
          ...(request.method !== 'GET' ? { 'content-type': 'application/json' } : {})
        },
        ...(request.method !== 'GET' ? { body: JSON.stringify(payload) } : {})
      });
      body = await parseJson(response);
      if (!request.poll || !expectedStatusMatches(response.status, request.expectedStatus) || pollSatisfied(body, request.poll) || attempt === maxAttempts) break;
      await this.sleep(request.poll.intervalMs);
    }
    const api = {
      action,
      method: request.method,
      httpStatus: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      request: redact(payload, this.config.platformKey),
      response: redact(body, this.config.platformKey)
    };
    if (!expectedStatusMatches(response.status, request.expectedStatus)) throw requestFailure(`API assertion failed: ${action}`, api);

    try {
      assertJson(body, request.expectedJson, variables);
      return { variables: extractVariables(body, request.extract, api), api };
    } catch (error) {
      error.api ||= api;
      throw error;
    }
  }
}
