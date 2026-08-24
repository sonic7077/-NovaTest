import { describe, expect, it, vi } from 'vitest';
import { ByAdminApiRunner } from '../server/runners/by-admin-api-runner.js';

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function step(action, options = {}) {
  return { request: {
    protocol: 'byAdmin', action, method: options.method || 'GET', payload: options.payload || {},
    expectedStatus: options.expectedStatus ?? 200, safety: options.safety || 'readonly', auth: options.auth || 'session', ...options
  } };
}

function context(options = {}) {
  return {
    testCase: { baseUrl: 'https://by.example.test' }, variables: {}, allowMutations: false,
    apiSession: {}, byAdminConfig: { username: 'operator', password: 'private-password' }, ...options
  };
}

describe('BY admin API runner', () => {
  it('logs in once and reuses the token within one API session', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/auth/login')) return response(200, { token: 'jwt-secret', expireAt: 9999999999 });
      return response(200, { id: 1, username: 'operator' });
    });
    const runner = new ByAdminApiRunner({ fetchImpl });
    const execution = context({ apiSession: runner.createSession() });

    await runner.execute(step('/admin-api/v1/auth/info'), execution);
    await runner.execute(step('/admin-api/v1/auth/routes'), execution);

    expect(calls.filter((call) => call.url.endsWith('/auth/login'))).toHaveLength(1);
    expect(calls[1].init.headers.authorization).toBe('Bearer jwt-secret');
  });

  it('redacts credentials and rejects unsafe requests before fetch', async () => {
    const fetchImpl = vi.fn(async () => response(400, { code: 40000, token: 'never-expose', contact: 'private' }));
    const runner = new ByAdminApiRunner({ fetchImpl });

    await expect(runner.execute(step('/admin-api/v1/members', { method: 'POST', safety: 'mutating', payload: { password: 'private-password' } }), context()))
      .rejects.toThrow('mutating API step requires allowMutations');
    await expect(runner.execute(step('/c-api/v1/members'), context())).rejects.toThrow('invalid BY admin action');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('re-authenticates only once after a 401 response', async () => {
    let infoCalls = 0;
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/auth/login')) return response(200, { token: `jwt-${fetchImpl.mock.calls.filter(([call]) => call.endsWith('/auth/login')).length}` });
      infoCalls += 1;
      return infoCalls === 1 ? response(401, { code: 40100 }) : response(200, { id: 1 });
    });
    const runner = new ByAdminApiRunner({ fetchImpl });

    await runner.execute(step('/admin-api/v1/auth/info'), context({ apiSession: runner.createSession() }));

    expect(fetchImpl.mock.calls.filter(([url]) => url.endsWith('/auth/login'))).toHaveLength(2);
    expect(infoCalls).toBe(2);
  });

  it('validates the business code for a documented HTTP 500 envelope', async () => {
    const runner = new ByAdminApiRunner({
      fetchImpl: async () => response(500, { code: 50000, msg: 'field "username" is not set', data: null })
    });

    await expect(runner.execute(
      step('/admin-api/v1/auth/login', { auth: 'none', expectedStatus: 500, expectedCode: 50000 }),
      context()
    )).resolves.toMatchObject({ api: { httpStatus: 500, businessStatus: 50000 } });
  });
});
