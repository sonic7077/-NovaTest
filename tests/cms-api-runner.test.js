import { describe, expect, it } from 'vitest';
import { encryptPayload } from '../server/services/cms-crypto.js';
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
});
