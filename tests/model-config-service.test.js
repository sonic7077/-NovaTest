import { describe, expect, it } from 'vitest';
import {
  normalizeModelConfig,
  publicModelConfig
} from '../server/services/model-config-service.js';

describe('model configuration service', () => {
  it('keeps the API key in the SQLite runtime record and exposes only a redacted public value', () => {
    expect(publicModelConfig({ apiKey: 'model-secret' })).toMatchObject({
      apiKey: 'mod****************',
      hasApiKey: true
    });
  });

  it('retains the current API key when an administrator leaves it blank', () => {
    const existing = { apiKey: 'saved-key' };

    expect(normalizeModelConfig({ baseUrl: 'https://model.example', modelName: 'vision', apiKey: '' }, existing))
      .toMatchObject({ apiKey: 'saved-key' });
  });

  it('rejects an unsupported model endpoint before it can be saved', () => {
    expect(() => normalizeModelConfig({ baseUrl: 'ftp://model.example', modelName: 'vision' }, {}))
      .toThrow('baseUrl must use HTTP or HTTPS');
  });
});
