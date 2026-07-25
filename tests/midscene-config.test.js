import { describe, expect, it } from 'vitest';
import { withWujiMidsceneConfig } from '../server/services/midscene-config.js';

describe('WuJi Midscene configuration', () => {
  it('maps WuJi provider settings into missing Midscene settings', () => {
    expect(withWujiMidsceneConfig({
      WUJI_BASE_URL: 'https://model.example/api',
      WUJI_MODEL: 'vision-model',
      WUJI_MODEL_API_KEY: 'test-key',
      MIDSCENE_MODEL_FAMILY: 'gemini'
    })).toMatchObject({
      MIDSCENE_MODEL_BASE_URL: 'https://model.example/api',
      MIDSCENE_MODEL_NAME: 'vision-model',
      MIDSCENE_MODEL_API_KEY: 'test-key',
      MIDSCENE_MODEL_FAMILY: 'gemini'
    });
  });

  it('keeps explicit Midscene settings over WuJi provider settings', () => {
    expect(withWujiMidsceneConfig({
      WUJI_BASE_URL: 'https://model.example/api',
      WUJI_MODEL: 'provider-model',
      WUJI_MODEL_API_KEY: 'provider-key',
      MIDSCENE_MODEL_BASE_URL: 'https://explicit.example/api',
      MIDSCENE_MODEL_NAME: 'explicit-model',
      MIDSCENE_MODEL_API_KEY: 'explicit-key'
    })).toMatchObject({
      MIDSCENE_MODEL_BASE_URL: 'https://explicit.example/api',
      MIDSCENE_MODEL_NAME: 'explicit-model',
      MIDSCENE_MODEL_API_KEY: 'explicit-key'
    });
  });
});
