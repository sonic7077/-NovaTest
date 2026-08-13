import { describe, expect, it, vi } from 'vitest';
import { createRuntimeServices } from '../server/services/runtime-services.js';
import { completeRuntimeConfig } from './helpers/runtime-config-fixture.js';

describe('runtime services', () => {
  it('constructs Web UI, CMS, and Lighthouse runners from SQLite configuration', async () => {
    const webRunner = { execute: vi.fn() };
    const createWebRunner = vi.fn(async () => webRunner);
    const CmsRunner = vi.fn(function CmsRunner({ config }) { this.config = config; this.execute = vi.fn(); });
    const store = { getRuntimeConfig: () => completeRuntimeConfig, saveRuntimeConfig: vi.fn() };

    const services = await createRuntimeServices({ runtimeConfig: completeRuntimeConfig, store, createWebRunner, CmsRunner });

    expect(createWebRunner).toHaveBeenCalledWith(expect.objectContaining({
      modelConfig: completeRuntimeConfig.model,
      lighthouseCredentials: completeRuntimeConfig.lighthouse
    }));
    expect(CmsRunner).toHaveBeenCalledWith({ config: completeRuntimeConfig.cms });
    expect(services.runnerStatus).toMatchObject({ ready: true });
    expect(services.cmsRunnerStatus).toMatchObject({ ready: true });
  });

  it('keeps the application available when the SQLite runtime configuration is absent', async () => {
    const services = await createRuntimeServices({ runtimeConfig: undefined, store: { getRuntimeConfig: () => undefined } });

    expect(services.runnerStatus).toMatchObject({ ready: false, message: 'SQLite runtime configuration is unavailable' });
    expect(services.cmsRunnerStatus).toMatchObject({ ready: false, message: 'SQLite runtime configuration is unavailable' });
    await expect(services.runner.web.execute()).rejects.toThrow('SQLite runtime configuration is unavailable');
  });

  it('constructs a Flywheel runner only when SQLite includes Flywheel configuration', async () => {
    const flywheel = { baseUrl: 'https://flywheel.example.test', platformKey: 'private-platform-key', platformId: 'tenant-a' };
    const FlywheelRunner = vi.fn(function FlywheelRunner({ config }) { this.config = config; this.execute = vi.fn(); });
    const createWebRunner = vi.fn(async () => ({ execute: vi.fn() }));

    const services = await createRuntimeServices({
      runtimeConfig: { ...completeRuntimeConfig, flywheel }, store: { saveRuntimeConfig: vi.fn() },
      createWebRunner, FlywheelRunner
    });

    expect(FlywheelRunner).toHaveBeenCalledWith({ config: flywheel });
    expect(services.flywheelRunnerStatus).toMatchObject({ ready: true });
    expect(services.flywheelBaseUrl).toBe(flywheel.baseUrl);
    expect(services.flywheelPlatformId).toBe(flywheel.platformId);
  });

  it('constructs a Daygf runner only when SQLite includes Daygf configuration', async () => {
    const daygf = { baseUrl: 'https://daygf.example.test', username: 'daygf-user', password: 'daygf-password' };
    const DaygfRunner = vi.fn(function DaygfRunner({ config }) { this.config = config; this.execute = vi.fn(); });
    const createWebRunner = vi.fn(async () => ({ execute: vi.fn() }));

    const services = await createRuntimeServices({
      runtimeConfig: { ...completeRuntimeConfig, daygf }, store: { saveRuntimeConfig: vi.fn() },
      createWebRunner, DaygfRunner
    });

    expect(DaygfRunner).toHaveBeenCalledWith({ config: daygf });
    expect(services.daygfRunnerStatus).toMatchObject({ ready: true });
    expect(services.daygfBaseUrl).toBe(daygf.baseUrl);
  });
});
