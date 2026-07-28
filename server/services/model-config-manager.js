import { normalizeRuntimeConfig } from './runtime-config-service.js';
import { normalizeModelConfig, publicModelConfig } from './model-config-service.js';

export function createModelConfigManager({ store, runtimeConfig, createRunner, runner, runnerStatus }) {
  function savedRuntimeConfig() {
    return store.getRuntimeConfig?.() || runtimeConfig;
  }

  function publicConfig() {
    return publicModelConfig(savedRuntimeConfig()?.model);
  }

  return {
    getPublicConfig: publicConfig,
    async update(input) {
      const existing = savedRuntimeConfig();
      if (!existing) throw new Error('SQLite runtime configuration is unavailable');
      const next = normalizeRuntimeConfig({
        ...existing,
        model: normalizeModelConfig(input, existing.model)
      });
      const candidate = await createRunner({
        modelConfig: next.model,
        lighthouseCredentials: next.lighthouse
      });

      store.saveRuntimeConfig(next);
      await runner.replace(candidate);
      runtimeConfig = next;
      runnerStatus.ready = true;
      runnerStatus.message = 'Midscene Web runner is ready';
      return publicConfig();
    }
  };
}
