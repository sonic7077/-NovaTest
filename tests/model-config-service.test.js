import { describe, expect, it } from 'vitest';
import {
  decryptModelApiKey,
  encryptModelApiKey,
  normalizeModelConfig,
  publicModelConfig,
  modelConfigRunnerEnv
} from '../server/services/model-config-service.js';

describe('model configuration service', () => {
  const encryptionKey = 'a'.repeat(32);

  it('encrypts an API key and exposes only a redacted public value', () => {
    const encrypted = encryptModelApiKey('model-secret', encryptionKey);

    expect(encrypted).not.toContain('model-secret');
    expect(decryptModelApiKey(encrypted, encryptionKey)).toBe('model-secret');
    expect(publicModelConfig({ encryptedApiKey: encrypted }, { decryptApiKey: (value) => decryptModelApiKey(value, encryptionKey) })).toMatchObject({
      apiKey: 'mod****************',
      hasApiKey: true
    });
  });

  it('retains or clears the existing key only as requested', () => {
    const existing = { encryptedApiKey: 'saved-key' };

    expect(normalizeModelConfig({ baseUrl: 'https://model.example', modelName: 'vision', apiKey: '' }, existing, { encryptionKey }))
      .toMatchObject({ encryptedApiKey: 'saved-key' });
    expect(normalizeModelConfig({ baseUrl: 'https://model.example', modelName: 'vision', apiKey: '', clearApiKey: true }, existing, { encryptionKey }))
      .toMatchObject({ encryptedApiKey: '' });
  });

  it('rejects an unsupported model endpoint before it can be saved', () => {
    expect(() => normalizeModelConfig({ baseUrl: 'ftp://model.example', modelName: 'vision' }, {}, { encryptionKey }))
      .toThrow('baseUrl must use HTTP or HTTPS');
  });

  it('does not restore an environment key after an administrator clears the saved key', () => {
    const env = modelConfigRunnerEnv({ baseUrl: 'https://model.example', modelName: 'vision', encryptedApiKey: '' }, encryptionKey, { MIDSCENE_MODEL_API_KEY: 'environment-secret' });

    expect(env.MIDSCENE_MODEL_API_KEY).toBe('');
  });
});
