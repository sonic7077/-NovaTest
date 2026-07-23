import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('production entrypoint', () => {
  it('uses the SQLite Store in production', async () => {
    const source = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');

    expect(source).toContain("createSqliteStore({ databasePath: 'data/novatest.db', legacyJsonPath: 'data/store.json' })");
    expect(source).not.toContain("createFileStore('data/store.json')");
  });
});
