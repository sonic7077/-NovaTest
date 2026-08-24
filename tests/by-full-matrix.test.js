import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSqliteStore } from '../server/storage/sqlite-store.js';
import { seedByCases } from '../server/seed/by-cases.js';
import { seedByAdminCases } from '../server/seed/by-admin-cases.js';

describe('BY full API matrix persistence', () => {
  it('persists at least 220 unique BY assets without credential values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-by-matrix-'));
    const databasePath = join(directory, 'novatest.db');
    try {
      const store = createSqliteStore({ databasePath });
      const project = store.saveProject({ name: 'BY项目' });
      seedByCases(store, { projectId: project.id, baseUrl: 'https://by.example.test' });
      seedByAdminCases(store, { projectId: project.id, baseUrl: 'https://by.example.test' });

      const cases = createSqliteStore({ databasePath }).listCases('', project.id);
      const serialized = JSON.stringify(cases);
      expect(cases.length).toBeGreaterThanOrEqual(220);
      expect(new Set(cases.map((testCase) => testCase.id)).size).toBe(cases.length);
      expect(cases.every((testCase) => testCase.target === 'api')).toBe(true);
      expect(serialized).not.toMatch(/private-password|jwt-secret|totp-secret/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
