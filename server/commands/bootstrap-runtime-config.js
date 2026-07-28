import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { createSqliteStore } from '../storage/sqlite-store.js';
import { runtimeConfigFromEnvironment } from '../services/runtime-config-service.js';

export function bootstrapRuntimeConfig({ env = process.env, databasePath = 'data/novatest.db' } = {}) {
  const store = createSqliteStore({ databasePath });
  if (store.getRuntimeConfig()) return { imported: false };
  store.saveRuntimeConfig(runtimeConfigFromEnvironment(env));
  return { imported: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = bootstrapRuntimeConfig();
    console.log(result.imported ? 'runtime configuration imported' : 'runtime configuration already exists');
  } catch (error) {
    console.error(`runtime configuration import failed: ${error.message}`);
    process.exitCode = 1;
  }
}
