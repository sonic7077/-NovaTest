import { describe, expect, it } from 'vitest';
import { buildRequestBody, decryptPayload, encryptPayload, redactBusinessSecrets, redactSecrets } from '../server/services/cms-crypto.js';

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

  it('preserves business data objects while redacting business secrets', () => {
    expect(redactBusinessSecrets({ data: { config: { featureEnabled: true } }, sign: 'secret-sign', token: 'secret-token' })).toEqual({
      data: { config: { featureEnabled: true } }, sign: '********', token: '********'
    });
  });

  it('masks login secret values in every API evidence boundary', () => {
    expect(redactSecrets({ secret: '123456' })).toEqual({ secret: '********' });
    expect(redactBusinessSecrets({ secret: '123456' })).toEqual({ secret: '********' });
  });
});
