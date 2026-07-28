import {
  decryptModelApiKey,
  encryptModelApiKey,
  modelConfigRunnerEnv,
  normalizeModelConfig,
  publicModelConfig
} from './model-config-service.js';

export function createModelConfigManager({ store, fallbackConfig = {}, fallbackEnv = {}, encryptionKey, createRunner, runner, runnerStatus }) {
  function savedConfig() {
    return store.getModelConfig?.();
  }

  function publicConfig() {
    const saved = savedConfig();
    if (!saved) return publicModelConfig(fallbackConfig);
    return publicModelConfig(saved, {
      decryptApiKey: (encryptedApiKey) => decryptModelApiKey(encryptedApiKey, encryptionKey)
    });
  }

  return {
    getPublicConfig: publicConfig,
    async update(input) {
      const persisted = savedConfig();
      const existing = persisted || {
        ...fallbackConfig,
        encryptedApiKey: fallbackConfig.apiKey ? encryptModelApiKey(fallbackConfig.apiKey, encryptionKey) : ''
      };
      const next = normalizeModelConfig(input, existing, { encryptionKey });
      const candidate = await createRunner({ env: modelConfigRunnerEnv(next, encryptionKey, fallbackEnv) });

      store.saveModelConfig(next);
      await runner.replace(candidate);
      runnerStatus.ready = true;
      runnerStatus.message = 'Midscene Web runner is ready';
      return publicConfig();
    }
  };
}
