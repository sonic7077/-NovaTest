import { describe, expect, it } from 'vitest';
import { buildRequestBody, decryptPayload, encryptPayload, redactSecrets } from '../server/services/cms-crypto.js';

const config = { key: '1234567890abcdef', iv: 'abcdef1234567890', appKey: 'app-key' };

describe('CMS crypto transport', () => {
  it('encrypts and decrypts a JSON payload with AES-CBC', () => {
    const encrypted = encryptPayload(JSON.stringify({ action: 'config' }), config);

    expect(encrypted).not.toContain('config');
    expect(JSON.parse(decryptPayload(encrypted, config))).toEqual({ action: 'config' });
  });

  it('builds a signed form request and redacts sensitive values', () => {
    const request = buildRequestBody({ token: 'secret-token', password: 'secret-password' }, config, 1700000000);

    expect(request.body).toContain('timestamp=1700000000');
    expect(request.body).toContain('data=');
    expect(request.body).toContain('sign=');
    expect(redactSecrets({
      token: 'secret-token',
      password: 'secret-password',
      data: request.data,
      sign: request.sign,
      nested: { key: 'nested-secret', ok: true }
    })).toEqual({
      token: '********',
      password: '********',
      data: '********',
      sign: '********',
      nested: { key: '********', ok: true }
    });
  });
});
