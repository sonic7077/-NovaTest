import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootstrapRuntimeConfig } from '../server/commands/bootstrap-runtime-config.js';
import { createSqliteStore } from '../server/storage/sqlite-store.js';
import { completeRuntimeConfig } from './helpers/runtime-config-fixture.js';

function environmentFromRuntimeConfig(config) {
  return {
    WUJI_BASE_URL: config.model.baseUrl,
    WUJI_MODEL: config.model.modelName,
    WUJI_MODEL_API_KEY: config.model.apiKey,
    MIDSCENE_MODEL_FAMILY: config.model.modelFamily,
    CMS_BASE_URL: config.cms.baseUrl,
    CMS_AES_KEY: config.cms.key,
    CMS_AES_IV: config.cms.iv,
    CMS_APP_KEY: config.cms.appKey,
    CMS_USERNAME: config.cms.username,
    CMS_PASSWORD: config.cms.password,
    CMS_GOOGLE_SECRET: config.cms.googleSecret,
    CMS_OAUTH_ID: config.cms.oauthId,
    CMS_OAUTH_TYPE: config.cms.oauthType,
    CMS_VERSION: config.cms.version,
    CMS_BUNDLE_ID: config.cms.bundleId,
    CMS_LANGUAGE: config.cms.language,
    CMS_VIA: config.cms.via,
    LIGHTHOUSE_PROJECT_NAME: config.lighthouse.projectName,
    LIGHTHOUSE_EMAIL: config.lighthouse.email,
    LIGHTHOUSE_PASSWORD: config.lighthouse.password,
    LIGHTHOUSE_TOTP_SECRET: config.lighthouse.totpSecret
  };
}

describe('runtime configuration bootstrap', () => {
  it('imports complete environment data only once into SQLite', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-runtime-bootstrap-'));
    const databasePath = join(directory, 'novatest.db');
    try {
      const environment = environmentFromRuntimeConfig(completeRuntimeConfig);

      expect(bootstrapRuntimeConfig({ env: environment, databasePath })).toEqual({ imported: true });
      expect(createSqliteStore({ databasePath }).getRuntimeConfig()).toEqual(completeRuntimeConfig);
      expect(bootstrapRuntimeConfig({ env: environment, databasePath })).toEqual({ imported: false });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
