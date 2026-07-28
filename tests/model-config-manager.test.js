import { describe, expect, it, vi } from 'vitest';
import { createModelConfigManager } from '../server/services/model-config-manager.js';

describe('model configuration manager', () => {
  const encryptionKey = 'b'.repeat(32);

  it('keeps persisted configuration and runner unchanged when candidate creation fails', async () => {
    const existing = { source: 'PLATFORM', baseUrl: 'https://old.example', modelName: 'old', modelFamily: '', encryptedApiKey: '' };
    const store = { getModelConfig: () => existing, saveModelConfig: vi.fn() };
    const runner = { replace: vi.fn() };
    const manager = createModelConfigManager({
      store,
      fallbackConfig: {},
      fallbackEnv: {},
      encryptionKey,
      createRunner: async () => { throw new Error('model unavailable'); },
      runner,
      runnerStatus: { ready: true, message: 'ready' }
    });

    await expect(manager.update({ baseUrl: 'https://new.example', modelName: 'new' })).rejects.toThrow('model unavailable');
    expect(store.saveModelConfig).not.toHaveBeenCalled();
    expect(runner.replace).not.toHaveBeenCalled();
  });

  it('persists only after a candidate runner is ready and returns a redacted key', async () => {
    let saved;
    const replacement = { execute: vi.fn() };
    const manager = createModelConfigManager({
      store: { getModelConfig: () => saved, saveModelConfig: (config) => { saved = config; return config; } },
      fallbackConfig: { source: 'MIDSCENE', baseUrl: 'https://old.example', modelName: 'old', modelFamily: '', apiKey: 'old-secret' },
      fallbackEnv: {},
      encryptionKey,
      createRunner: async () => replacement,
      runner: { replace: vi.fn(async () => replacement) },
      runnerStatus: { ready: false, message: 'not ready' }
    });

    const result = await manager.update({ baseUrl: 'https://new.example', modelName: 'new', apiKey: 'new-secret' });

    expect(saved).toMatchObject({ baseUrl: 'https://new.example', modelName: 'new' });
    expect(saved.encryptedApiKey).not.toContain('new-secret');
    expect(result).toMatchObject({ apiKey: 'new****************', hasApiKey: true });
  });
});
