import { describe, expect, it } from 'vitest';
import { FlywheelApiRunner } from '../server/runners/flywheel-api-runner.js';

const config = {
  baseUrl: 'https://flywheel.example.test', platformKey: 'private-platform-key', platformId: 'tenant-a'
};

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function step(action, options = {}) {
  return {
    id: action.replaceAll('/', '-'), kind: 'apiRequest', instruction: action,
    request: {
      protocol: 'flywheel', action, method: options.method || 'GET', payload: options.payload || {},
      expectedStatus: options.expectedStatus ?? 200, safety: options.safety || 'readonly', ...options
    }
  };
}

describe('Flywheel API runner', () => {
  it('sends encoded GET parameters with platform authentication and redacted evidence', async () => {
    const calls = [];
    const runner = new FlywheelApiRunner({
      config,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(200, { items: [] });
      }
    });

    const result = await runner.execute(step('/api/v1/feed', {
      payload: { user_id: 'u-1', size: 10, exclude: ['c-1', 'c-2'] }
    }), { testCase: { baseUrl: config.baseUrl }, variables: {} });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://flywheel.example.test/api/v1/feed?user_id=u-1&size=10&exclude=c-1&exclude=c-2');
    expect(calls[0].options.headers['x-platform-key']).toBe(config.platformKey);
    expect(calls[0].options.headers['user-agent']).toContain('NovaTest');
    expect(JSON.stringify(result.api)).not.toContain(config.platformKey);
  });

  it('sends JSON bodies for POST and interpolates prior variables', async () => {
    const calls = [];
    const runner = new FlywheelApiRunner({
      config,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(200, { ok: true });
      }
    });

    await runner.execute(step('/api/v1/feedback', {
      method: 'POST', safety: 'mutating', payload: { user_id: '{{userId}}', event: 'like' }
    }), { testCase: { baseUrl: config.baseUrl }, variables: { userId: 'tenant-a-user' }, allowMutations: true });

    expect(calls[0]).toMatchObject({
      url: 'https://flywheel.example.test/api/v1/feedback',
      options: { method: 'POST', headers: expect.objectContaining({ 'content-type': 'application/json' }) }
    });
    expect(JSON.parse(calls[0].options.body)).toEqual({ user_id: 'tenant-a-user', event: 'like' });
  });

  it('provides the configured platform ID for seed-case variables without persisting the Key', async () => {
    const calls = [];
    const runner = new FlywheelApiRunner({
      config,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(200, { ok: true });
      }
    });

    await runner.execute(step('/api/v1/users/{{platformId}}-novatest-{{runId}}', {
      method: 'PUT', safety: 'mutating', payload: { region: 'CN' }
    }), { testCase: { baseUrl: config.baseUrl }, variables: { runId: 'run-1' }, allowMutations: true });

    expect(calls[0].url).toBe('https://flywheel.example.test/api/v1/users/tenant-a-novatest-run-1');
  });

  it('requires mutation authorization before sending a write request', async () => {
    const runner = new FlywheelApiRunner({ config, fetchImpl: async () => { throw new Error('must not fetch'); } });

    await expect(runner.execute(step('/api/v1/users/u-1', { method: 'PUT', safety: 'mutating' }), {
      testCase: { baseUrl: config.baseUrl }, variables: {}
    })).rejects.toThrow('mutating API step requires allowMutations');
  });

  it('accepts an expected unauthenticated 401 probe without sending platform authentication', async () => {
    const calls = [];
    const runner = new FlywheelApiRunner({
      config,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(401, { detail: 'missing platform key' });
      }
    });

    const result = await runner.execute(step('/api/v1/feed', { auth: 'none', expectedStatus: 401 }), {
      testCase: { baseUrl: config.baseUrl }, variables: {}
    });

    expect(result.api.httpStatus).toBe(401);
    expect(calls[0].options.headers).not.toHaveProperty('x-platform-key');
  });

  it('uses a synthetic value for an invalid-key probe instead of the configured key', async () => {
    const calls = [];
    const runner = new FlywheelApiRunner({
      config,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(401, { detail: 'invalid platform key' });
      }
    });

    await runner.execute(step('/api/v1/feed', { auth: 'invalid', expectedStatus: 401 }), {
      testCase: { baseUrl: config.baseUrl }, variables: {}
    });

    expect(calls[0].options.headers['x-platform-key']).not.toBe(config.platformKey);
  });

  it('keeps the platform Key out of failed request evidence', async () => {
    const runner = new FlywheelApiRunner({
      config,
      fetchImpl: async () => response(500, { detail: `failed with ${config.platformKey}` })
    });

    const failure = await runner.execute(step('/api/v1/feed'), {
      testCase: { baseUrl: config.baseUrl }, variables: {}
    }).catch((error) => error);

    expect(failure.api).toBeDefined();
    expect(JSON.stringify(failure.api)).not.toContain(config.platformKey);
  });
});
