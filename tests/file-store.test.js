import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileStore } from '../server/storage/file-store.js';

describe('file store', () => {
  it('persists cases and runs across store instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-store-'));
    const filePath = join(directory, 'store.json');
    const testCase = { id: 'case-1', name: '首页验证', target: 'web', steps: [] };
    const run = { id: 'run-1', caseId: 'case-1', status: 'passed' };

    try {
      const store = createFileStore(filePath);
      store.saveCase(testCase);
      store.saveRun(run);

      const reloaded = createFileStore(filePath);
      expect(reloaded.listCases()).toEqual([testCase]);
      expect(reloaded.getRun('run-1')).toEqual(run);
      expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({ cases: { 'case-1': testCase } });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('assigns an id when saving a new case', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-store-'));
    try {
      const saved = createFileStore(join(directory, 'store.json')).saveCase({ name: '新用例', target: 'web', steps: [] });
      expect(saved.id).toEqual(expect.any(String));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('repairs legacy saved cases that have no id', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-store-'));
    const filePath = join(directory, 'store.json');
    try {
      await writeFile(filePath, JSON.stringify({ cases: { legacy: { name: '旧用例', target: 'web', steps: [] } }, runs: {} }));
      const [legacy] = createFileStore(filePath).listCases();
      expect(legacy.id).toEqual(expect.any(String));
      expect(legacy.id).not.toBe('undefined');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
