import { describe, expect, it } from 'vitest';
import { decryptPayload, encryptPayload } from '../server/services/cms-crypto.js';
import { CmsApiRunner } from '../server/runners/cms-api-runner.js';

const cryptoConfig = { key: '1234567890abcdef', iv: 'abcdef1234567890', appKey: 'app-key' };

function encryptedResponse(data) {
  return { status: 1, crypt: true, data: encryptPayload(JSON.stringify(data), cryptoConfig) };
}

describe('CMS API runner', () => {
  it('logs in, decrypts responses, and injects the token into later requests', async () => {
    const bodies = [];
    const runner = new CmsApiRunner({
      config: { ...cryptoConfig, username: 'admin', password: 'password', oauthId: 'qa', oauthType: 'pc', version: '1.0.0' },
      fetchImpl: async (_url, options) => {
        bodies.push(options.body);
        return { ok: true, status: 200, json: async () => bodies.length === 1 ? encryptedResponse('token-1') : encryptedResponse({ list: [] }) };
      }
    });
    const context = { testCase: { baseUrl: 'https://example.test/api.php' }, variables: {} };

    const login = await runner.execute({ id: 'login', request: { action: 'loginByPassword', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } }, context);
    const list = await runner.execute({ id: 'list', request: { action: 'list_post', method: 'POST', payload: { status: 10 }, expectedStatus: 1, safety: 'readonly' } }, context);

    expect(login.variables).toEqual({ token: 'token-1' });
    expect(list.api).toMatchObject({ action: 'list_post', businessStatus: 1, response: { list: [] } });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toContain('token-1');
  });

  it('refuses mutating requests without explicit permission', async () => {
    const runner = new CmsApiRunner({ config: cryptoConfig, fetchImpl: async () => { throw new Error('must not fetch'); } });

    await expect(runner.execute({ id: 'delete', request: { action: 'del_post', method: 'POST', payload: {}, expectedStatus: 1, safety: 'mutating' } }, { testCase: { baseUrl: 'https://example.test/api.php' }, variables: {} })).rejects.toThrow('mutating API step requires allowMutations');
  });

  it('interpolates payloads, asserts decrypted JSON paths, and extracts response variables', async () => {
    const runner = new CmsApiRunner({
      config: { ...cryptoConfig, oauthId: 'qa', oauthType: 'pc', version: '1.0.0' },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => encryptedResponse({ page: { id: 'post-42' }, token: 'secret-token' }) })
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
    expect(result.api.request.token).toBe('[REDACTED]');
    expect(result.api.response.token).toBe('[REDACTED]');
  });

  it('fails an API step when a decrypted JSON assertion does not match', async () => {
    const runner = new CmsApiRunner({
      config: { ...cryptoConfig, oauthId: 'qa', oauthType: 'pc', version: '1.0.0' },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => encryptedResponse({ page: { id: 'post-42' } }) })
    });

    await expect(runner.execute({
      id: 'post-detail',
      request: { action: 'list_post', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly', expectedJson: [{ path: '$.page.id', equals: 'post-99' }] }
    }, { testCase: { baseUrl: 'https://example.test/api.php' }, variables: {} })).rejects.toThrow('JSON assertion failed: $.page.id');
  });

  it('sends configured CMS public client parameters with each request', async () => {
    let submittedPayload;
    const runner = new CmsApiRunner({
      config: { ...cryptoConfig, oauthId: 'qa-pc', oauthType: 'web', version: '1.0.0', bundleId: 'com.example.cms', language: 'zh', via: 'web' },
      fetchImpl: async (_url, options) => {
        submittedPayload = JSON.parse(decryptPayload(new URLSearchParams(options.body).get('data'), cryptoConfig));
        return { ok: true, status: 200, json: async () => encryptedResponse({}) };
      }
    });

    await runner.execute({ id: 'config', request: { action: 'config', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } }, { testCase: { baseUrl: 'https://example.test/api.php' }, variables: {} });

    expect(submittedPayload).toMatchObject({ oauth_id: 'qa-pc', oauth_type: 'web', version: '1.0.0', bundleId: 'com.example.cms', language: 'zh', via: 'web' });
  });

  it('accepts the white-bag errcode success protocol and keeps its token', async () => {
    const runner = new CmsApiRunner({
      config: { ...cryptoConfig, username: 'admin', password: 'password', oauthId: 'qa', oauthType: 'web', version: '1.0.0' },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ errcode: 0, data: 'token-1' }) })
    });

    const result = await runner.execute({ id: 'login', request: { action: 'loginByPassword', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } }, { testCase: { baseUrl: 'https://example.test/api.php' }, variables: {} });

    expect(result.variables).toEqual({ token: 'token-1' });
    expect(result.api.businessStatus).toBe(1);
  });
});
