import { describe, expect, it } from 'vitest';
import { assertMidsceneConfig } from '../server/runners/production-runner.js';

describe('Midscene configuration', () => {
  it('reports every missing model setting before starting a browser', () => {
    expect(() => assertMidsceneConfig({})).toThrow('MIDSCENE_MODEL_BASE_URL, MIDSCENE_MODEL_API_KEY, MIDSCENE_MODEL_NAME, MIDSCENE_MODEL_FAMILY');
  });

  it('accepts a complete model configuration', () => {
    expect(() => assertMidsceneConfig({
      MIDSCENE_MODEL_BASE_URL: 'https://model.example/v1',
      MIDSCENE_MODEL_API_KEY: 'key',
      MIDSCENE_MODEL_NAME: 'model',
      MIDSCENE_MODEL_FAMILY: 'qwen-vl'
    })).not.toThrow();
  });
});
