import { describe, expect, it } from 'vitest';
import { normalizeRuntimeConfig, runtimeConfigFromEnvironment } from '../server/services/runtime-config-service.js';
import { completeRuntimeConfig } from './helpers/runtime-config-fixture.js';

describe('runtime configuration service', () => {
  it('normalizes complete model, CMS, and Lighthouse groups', () => {
    expect(normalizeRuntimeConfig(completeRuntimeConfig)).toEqual(completeRuntimeConfig);
  });

  it('rejects incomplete configuration without exposing a provided secret', () => {
    const secret = 'do-not-return-this';
    expect(() => normalizeRuntimeConfig({ ...completeRuntimeConfig, cms: { ...completeRuntimeConfig.cms, password: '' }, lighthouse: { ...completeRuntimeConfig.lighthouse, password: secret } }))
      .toThrow('runtime configuration is incomplete: cms.password');
    try {
      normalizeRuntimeConfig({ ...completeRuntimeConfig, cms: { ...completeRuntimeConfig.cms, password: '' }, lighthouse: { ...completeRuntimeConfig.lighthouse, password: secret } });
    } catch (error) {
      expect(error.message).not.toContain(secret);
    }
  });

  it('maps the existing environment names only for one-time bootstrap', () => {
    expect(runtimeConfigFromEnvironment({
      WUJI_BASE_URL: completeRuntimeConfig.model.baseUrl,
      WUJI_MODEL: completeRuntimeConfig.model.modelName,
      WUJI_MODEL_API_KEY: completeRuntimeConfig.model.apiKey,
      MIDSCENE_MODEL_FAMILY: completeRuntimeConfig.model.modelFamily,
      CMS_BASE_URL: completeRuntimeConfig.cms.baseUrl,
      CMS_AES_KEY: completeRuntimeConfig.cms.key,
      CMS_AES_IV: completeRuntimeConfig.cms.iv,
      CMS_APP_KEY: completeRuntimeConfig.cms.appKey,
      CMS_USERNAME: completeRuntimeConfig.cms.username,
      CMS_PASSWORD: completeRuntimeConfig.cms.password,
      CMS_GOOGLE_SECRET: completeRuntimeConfig.cms.googleSecret,
      CMS_OAUTH_ID: completeRuntimeConfig.cms.oauthId,
      CMS_OAUTH_TYPE: completeRuntimeConfig.cms.oauthType,
      CMS_VERSION: completeRuntimeConfig.cms.version,
      CMS_BUNDLE_ID: completeRuntimeConfig.cms.bundleId,
      CMS_LANGUAGE: completeRuntimeConfig.cms.language,
      CMS_VIA: completeRuntimeConfig.cms.via,
      LIGHTHOUSE_PROJECT_NAME: completeRuntimeConfig.lighthouse.projectName,
      LIGHTHOUSE_EMAIL: completeRuntimeConfig.lighthouse.email,
      LIGHTHOUSE_PASSWORD: completeRuntimeConfig.lighthouse.password,
      LIGHTHOUSE_TOTP_SECRET: completeRuntimeConfig.lighthouse.totpSecret
    })).toEqual(completeRuntimeConfig);
  });
});
