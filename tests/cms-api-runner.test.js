import { describe, expect, it } from 'vitest';
import { decryptPayload, encryptPayload } from '../server/services/cms-crypto.js';
import { CmsApiRunner } from '../server/runners/cms-api-runner.js';

const cryptoConfig = { key: '1234567890abcdef', iv: 'abcdef1234567890', appKey: 'app-key' };
const googleSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

function encryptedResponse(data) {
  return { status: 1, crypt: true, data: encryptPayload(JSON.stringify(data), cryptoConfig) };
}

function unmarkedEncryptedResponse(data) {
  return { status: 1, data: encryptPayload(JSON.stringify(data), cryptoConfig) };
}

function apiStep(action, payload = {}) {
  return { id: action, kind: 'apiRequest', instruction: action, request: { action, method: 'POST', payload, expectedStatus: 1, safety: 'readonly' } };
}

describe('CMS API runner', () => {
  it('logs in, decrypts responses, and injects the token into later requests', async () => {
    const bodies = [];
    const runner = new CmsApiRunner({
      config: { ...cryptoConfig, googleSecret, username: 'admin', password: 'password', oauthId: 'qa', oauthType: 'pc', version: '1.0.0' },
      fetchImpl: async (_url, options) => {
        bodies.push(options.body);
        return { ok: true, status: 200, json: async () => bodies.length === 1 ? encryptedResponse('token-1') : encryptedResponse({ list: [] }) };
      }
    });
    const context = { testCase: { baseUrl: 'https://example.test/api.php' }, variables: {} };

    const login = await runner.execute({ id: 'login', request: { action: 'loginByPassword', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } }, context);
    const list = await runner.execute({ id: 'list', request: { action: 'list_post', method: 'POST', payload: { status: 10 }, expectedStatus: 1, safety: 'readonly' } }, context);

    expect(login.variables).toEqual({});
    expect(context.apiSession).toMatchObject({ token: 'token-1' });
    expect(list.api).toMatchObject({ action: 'list_post', businessStatus: 1, response: { list: [] } });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toContain('token-1');
  });

  it('sends a generated code only on encrypted login', async () => {
    const payloads = [];
    const runner = new CmsApiRunner({
      config: {
        ...cryptoConfig,
        username: 'synthetic-user',
        password: 'synthetic-password',
        googleSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
      },
      fetchImpl: async (url, options) => {
        payloads.push(JSON.parse(decryptPayload(new URLSearchParams(options.body).get('data'), cryptoConfig)));
        const action = new URL(url).pathname.split('/').at(-1);
        return { ok: true, status: 200, json: async () => encryptedResponse(action === 'loginByPassword' ? 'synthetic-token' : { ok: true }) };
      }
    });

    await runner.execute(apiStep('config'), { testCase: { baseUrl: 'https://example.test' }, variables: {} });

    expect(payloads[0]).toMatchObject({ username: 'synthetic-user', password: 'synthetic-password', secret: expect.stringMatching(/^\d{6}$/) });
    expect(payloads[1]).not.toHaveProperty('secret');
  });

  it('decrypts an unmarked encrypted business response and preserves its data object', async () => {
    const runner = new CmsApiRunner({
      config: { ...cryptoConfig, googleSecret, username: 'admin', password: 'password', oauthId: 'qa', oauthType: 'web', version: '1.0.0' },
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        json: async () => new URL(url).pathname.endsWith('/loginByPassword')
          ? { status: 1, data: 'token-1' }
          : unmarkedEncryptedResponse({ data: { config: { featureEnabled: true } }, token: 'secret-token' })
      })
    });

    const result = await runner.execute({ id: 'config', request: { action: 'config', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } }, { testCase: { baseUrl: 'https://example.test' }, variables: {} });

    expect(result.api.response).toEqual({ data: { config: { featureEnabled: true } }, token: '********' });
  });

  it('decrypts an unmarked encrypted login token before reusing the session', async () => {
    let submittedConfigPayload;
    const syntheticSessionValue = 'synthetic-session-value';
    const runner = new CmsApiRunner({
      config: { ...cryptoConfig, googleSecret, username: 'admin', password: 'password', oauthId: 'qa', oauthType: 'web', version: '1.0.0' },
      fetchImpl: async (url, options) => {
        const action = new URL(url).pathname.split('/').at(-1);
        if (action === 'config') submittedConfigPayload = JSON.parse(decryptPayload(new URLSearchParams(options.body).get('data'), cryptoConfig));
        return {
          ok: true,
          status: 200,
          json: async () => action === 'loginByPassword'
            ? { errcode: 0, data: encryptPayload(JSON.stringify(syntheticSessionValue), cryptoConfig) }
            : unmarkedEncryptedResponse({ data: { config: { featureEnabled: true } } })
        };
      }
    });

    const result = await runner.execute(apiStep('config'), { testCase: { baseUrl: 'https://example.test' }, variables: {} });

    expect(submittedConfigPayload.token).toBe(syntheticSessionValue);
    expect(result.api.response).toEqual({ data: { config: { featureEnabled: true } } });
  });

  it('reuses the session value from a nested login envelope', async () => {
    let submittedConfigPayload;
    const runner = new CmsApiRunner({
      config: { ...cryptoConfig, googleSecret, username: 'admin', password: 'password' },
      fetchImpl: async (url, options) => {
        const action = new URL(url).pathname.split('/').at(-1);
        if (action === 'config') submittedConfigPayload = JSON.parse(decryptPayload(new URLSearchParams(options.body).get('data'), cryptoConfig));
        return {
          ok: true,
          status: 200,
          json: async () => action === 'loginByPassword'
            ? encryptedResponse({ status: 1, crypt: true, data: 'nested-session-token', msg: 'ok' })
            : encryptedResponse({ data: { config: { featureEnabled: true } } })
        };
      }
    });

    await runner.execute(apiStep('config'), { testCase: { baseUrl: 'https://example.test' }, variables: {} });

    expect(submittedConfigPayload.token).toBe('nested-session-token');
  });

  it('fails when a decrypted business body overrides an outer success status', async () => {
    const runner = new CmsApiRunner({
      config: { ...cryptoConfig, googleSecret, username: 'admin', password: 'password', oauthId: 'qa', oauthType: 'web', version: '1.0.0' },
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        json: async () => new URL(url).pathname.endsWith('/loginByPassword')
          ? encryptedResponse('synthetic-session-value')
          : encryptedResponse({ status: 0, msg: 'token invalid' })
      })
    });

    await expect(runner.execute(apiStep('list_post'), { testCase: { baseUrl: 'https://example.test' }, variables: {} })).rejects.toThrow('API assertion failed: list_post');
  });

  it('attaches redacted evidence when a business assertion fails', async () => {
    const runner = new CmsApiRunner({
      config: { ...cryptoConfig, googleSecret, username: 'synthetic-user', password: 'synthetic-password' },
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        json: async () => new URL(url).pathname.endsWith('/loginByPassword')
          ? encryptedResponse('synthetic-token')
          : encryptedResponse({ status: 0, secret: '123456', token: 'synthetic-token' })
      })
    });

    const error = await runner.execute(apiStep('list_post'), { testCase: { baseUrl: 'https://example.test' }, variables: {} }).catch((caught) => caught);

    expect(error).toMatchObject({
      message: 'API assertion failed: list_post',
      api: {
        action: 'list_post',
        businessStatus: 0,
        request: { token: '********' },
        response: { status: 0, secret: '********', token: '********' }
      }
    });
  });

  it('refuses mutating requests without explicit permission', async () => {
    const runner = new CmsApiRunner({ config: cryptoConfig, fetchImpl: async () => { throw new Error('must not fetch'); } });

    await expect(runner.execute({ id: 'delete', request: { action: 'del_post', method: 'POST', payload: {}, expectedStatus: 1, safety: 'mutating' } }, { testCase: { baseUrl: 'https://example.test/api.php' }, variables: {} })).rejects.toThrow('mutating API step requires allowMutations');
  });

  it('interpolates payloads, asserts decrypted JSON paths, and extracts response variables', async () => {
    const runner = new CmsApiRunner({
      config: { ...cryptoConfig, googleSecret, oauthId: 'qa', oauthType: 'pc', version: '1.0.0' },
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        json: async () => encryptedResponse(new URL(url).pathname.endsWith('/loginByPassword') ? 'token-1' : { page: { id: 'post-42' }, token: 'secret-token' })
      })
    });

    const result = await runner.execute({
      id: 'post-detail',
      request: {
        action: 'list_post', method: 'POST', payload: { id: '{{selectedPost}}' }, expectedStatus: 1, safety: 'readonly',
        expectedJson: [{ path: '$.page.id', equals: 'post-42' }],
        extract: { postId: '$.page.id' }
      }
    }, { testCase: { baseUrl: 'https://example.test/api.php' }, variables: { selectedPost: 'post-42' } });

    expect(result.variables).toEqual({ postId: 'post-42' });
    expect(result.api).toMatchObject({ durationMs: expect.any(Number), response: { page: { id: 'post-42' } } });
    expect(result.api.request.token).toBe('********');
    expect(result.api.response.token).toBe('********');
  });

  it('fails an API step when a decrypted JSON assertion does not match', async () => {
    const runner = new CmsApiRunner({
      config: { ...cryptoConfig, googleSecret, oauthId: 'qa', oauthType: 'pc', version: '1.0.0' },
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        json: async () => encryptedResponse(new URL(url).pathname.endsWith('/loginByPassword') ? 'token-1' : { page: { id: 'post-42' } })
      })
    });

    await expect(runner.execute({
      id: 'post-detail',
      request: { action: 'list_post', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly', expectedJson: [{ path: '$.page.id', equals: 'post-99' }] }
    }, { testCase: { baseUrl: 'https://example.test/api.php' }, variables: {} })).rejects.toThrow('JSON assertion failed: $.page.id');
  });

  it('sends configured CMS public client parameters with each request', async () => {
    let submittedPayload;
    const runner = new CmsApiRunner({
      config: { ...cryptoConfig, googleSecret, oauthId: 'qa-pc', oauthType: 'web', version: '1.0.0', bundleId: 'com.example.cms', language: 'zh', via: 'web' },
      fetchImpl: async (url, options) => {
        submittedPayload = JSON.parse(decryptPayload(new URLSearchParams(options.body).get('data'), cryptoConfig));
        return { ok: true, status: 200, json: async () => encryptedResponse(new URL(url).pathname.endsWith('/loginByPassword') ? 'token-1' : {}) };
      }
    });

    await runner.execute({ id: 'config', request: { action: 'config', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } }, { testCase: { baseUrl: 'https://example.test/api.php' }, variables: {} });

    expect(submittedPayload).toMatchObject({ oauth_id: 'qa-pc', oauth_type: 'web', version: '1.0.0', bundleId: 'com.example.cms', language: 'zh', via: 'web' });
  });

  it('accepts the white-bag errcode success protocol and keeps its token', async () => {
    const runner = new CmsApiRunner({
      config: { ...cryptoConfig, googleSecret, username: 'admin', password: 'password', oauthId: 'qa', oauthType: 'web', version: '1.0.0' },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ errcode: 0, data: 'token-1' }) })
    });

    const context = { testCase: { baseUrl: 'https://example.test/api.php' }, variables: {} };
    const result = await runner.execute({ id: 'login', request: { action: 'loginByPassword', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } }, context);

    expect(result.variables).toEqual({});
    expect(context.apiSession).toMatchObject({ token: 'token-1' });
    expect(result.api.businessStatus).toBe(1);
  });

  it('authenticates once for a shared session and keeps its token out of run variables', async () => {
    const payloads = [];
    const runner = new CmsApiRunner({
      config: { ...cryptoConfig, googleSecret, username: 'admin', password: 'password', oauthId: 'qa', oauthType: 'web', version: '1.0.0' },
      fetchImpl: async (url, options) => {
        const payload = JSON.parse(decryptPayload(new URLSearchParams(options.body).get('data'), cryptoConfig));
        const action = new URL(url).pathname.split('/').at(-1);
        payloads.push({ action, ...payload });
        const data = action === 'loginByPassword' ? 'token-1' : { ok: true };
        return { ok: true, status: 200, json: async () => encryptedResponse(data) };
      }
    });
    const context = { testCase: { baseUrl: 'https://example.test/api.php' }, variables: {}, apiSession: {} };

    const config = await runner.execute({ id: 'config', request: { action: 'config', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } }, context);
    const posts = await runner.execute({ id: 'posts', request: { action: 'list_post', method: 'POST', payload: { status: 10 }, expectedStatus: 1, safety: 'readonly' } }, context);

    expect(payloads.map((payload) => payload.action)).toEqual(['loginByPassword', 'config', 'list_post']);
    expect(payloads.slice(1).map((payload) => payload.token)).toEqual(['token-1', 'token-1']);
    expect(config.variables).toEqual({});
    expect(posts.variables).toEqual({});
    expect(context.apiSession).toMatchObject({ token: 'token-1' });
  });

  it('does not send business requests after shared authentication fails', async () => {
    const actions = [];
    const runner = new CmsApiRunner({
      config: { ...cryptoConfig, googleSecret, username: 'admin', password: 'password', oauthId: 'qa', oauthType: 'web', version: '1.0.0' },
      fetchImpl: async (url, options) => {
        const payload = JSON.parse(decryptPayload(new URLSearchParams(options.body).get('data'), cryptoConfig));
        actions.push(new URL(url).pathname.split('/').at(-1));
        return { ok: true, status: 200, json: async () => ({ status: 0, data: 'denied' }) };
      }
    });
    const context = { testCase: { baseUrl: 'https://example.test/api.php' }, variables: {}, apiSession: {} };
    const config = { id: 'config', request: { action: 'config', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } };
    const posts = { id: 'posts', request: { action: 'list_post', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } };

    await expect(runner.execute(config, context)).rejects.toThrow('API assertion failed: loginByPassword');
    await expect(runner.execute(posts, context)).rejects.toThrow('API assertion failed: loginByPassword');
    expect(actions).toEqual(['loginByPassword']);
  });
});
