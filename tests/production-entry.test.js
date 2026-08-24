import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('production entrypoint', () => {
  it('uses the SQLite Store in production', async () => {
    const source = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');

    expect(source).toContain("createSqliteStore({ databasePath: 'data/novatest.db', legacyJsonPath: 'data/store.json' })");
    expect(source).not.toContain("createFileStore('data/store.json')");
    expect(source).not.toContain('process.env.CMS_');
    expect(source).not.toContain('process.env.LIGHTHOUSE_');
    expect(source).not.toContain('process.env.MIDSCENE_');
  });

  it('seeds the Flywheel project only from SQLite runtime configuration', async () => {
    const source = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');

    expect(source).toContain("import { seedFlywheelCases } from './seed/flywheel-cases.js'");
    expect(source).toContain("store.saveProject({ name: '飞轮引擎' })");
    expect(source).toContain('seedFlywheelCases(store, {');
    expect(source).toContain('services.flywheelBaseUrl');
    expect(source).not.toContain('process.env.FLYWHEEL_');
  });

  it('seeds the Daygf project only from SQLite runtime configuration', async () => {
    const source = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');

    expect(source).toContain("import { seedDaygfCases } from './seed/daygf-cases.js'");
    expect(source).toContain("store.saveProject({ name: '一日女友' })");
    expect(source).toContain('services.daygfBaseUrl');
    expect(source).not.toContain('process.env.DAYGF_');
  });
});
