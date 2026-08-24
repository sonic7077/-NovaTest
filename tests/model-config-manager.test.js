import { describe, expect, it, vi } from 'vitest';
import { createModelConfigManager } from '../server/services/model-config-manager.js';
import { completeRuntimeConfig } from './helpers/runtime-config-fixture.js';

const completeCmsConfig = () => structuredClone(completeRuntimeConfig.cms);
const completeLighthouseConfig = () => structuredClone(completeRuntimeConfig.lighthouse);

describe('model configuration manager', () => {
  it('keeps persisted configuration and runner unchanged when candidate creation fails', async () => {
    const existing = { model: { baseUrl: 'https://old.example', modelName: 'old', modelFamily: '', apiKey: 'old-key' }, cms: completeCmsConfig(), lighthouse: completeLighthouseConfig() };
    const store = { getRuntimeConfig: () => existing, saveRuntimeConfig: vi.fn() };
    const runner = { replace: vi.fn() };
    const manager = createModelConfigManager({
      store,
      runtimeConfig: existing,
      createRunner: async () => { throw new Error('model unavailable'); },
      runner,
      runnerStatus: { ready: true, message: 'ready' }
    });

    await expect(manager.update({ baseUrl: 'https://new.example', modelName: 'new' })).rejects.toThrow('model unavailable');
    expect(store.saveRuntimeConfig).not.toHaveBeenCalled();
    expect(runner.replace).not.toHaveBeenCalled();
  });

  it('updates only the stored model group after a candidate runner is ready', async () => {
    const existing = { model: { baseUrl: 'https://old.example', modelName: 'old', modelFamily: '', apiKey: 'old-key' }, cms: completeCmsConfig(), lighthouse: completeLighthouseConfig() };
    let saved;
    const replacement = { execute: vi.fn() };
    const manager = createModelConfigManager({
      store: { getRuntimeConfig: () => saved || existing, saveRuntimeConfig: (config) => { saved = config; return config; } },
      runtimeConfig: existing,
      createRunner: async () => replacement,
      runner: { replace: vi.fn(async () => replacement) },
      runnerStatus: { ready: false, message: 'not ready' }
    });

    const result = await manager.update({ baseUrl: 'https://new.example', modelName: 'new', apiKey: 'new-secret' });

    expect(saved).toMatchObject({ model: { baseUrl: 'https://new.example', modelName: 'new', apiKey: 'new-secret' }, cms: completeCmsConfig(), lighthouse: completeLighthouseConfig() });
    expect(result).toMatchObject({ apiKey: 'new****************', hasApiKey: true });
  });
});
