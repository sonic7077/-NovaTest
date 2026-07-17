import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSqliteStore } from '../server/storage/sqlite-store.js';

const webCase = {
  id: 'case-1',
  name: '结算验证',
  target: 'web',
  baseUrl: 'https://example.test',
  viewport: 'desktop',
  steps: [
    { id: 'step-1', kind: 'action', instruction: '打开结算页' },
    { id: 'step-2', kind: 'assert', instruction: '显示应付金额' }
  ]
};

describe('SQLite store', () => {
  it('persists a case with steps in position order across store instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-sqlite-'));
    const databasePath = join(directory, 'novatest.db');

    try {
      createSqliteStore({ databasePath }).saveCase({ ...webCase, steps: [webCase.steps[1], webCase.steps[0]] });
      const loaded = createSqliteStore({ databasePath }).getCase(webCase.id);

      expect(loaded).toMatchObject({ id: webCase.id, name: '结算验证' });
      expect(loaded.steps.map((step) => step.id)).toEqual(['step-2', 'step-1']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('atomically replaces obsolete steps when resaving a case', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-sqlite-'));
    const databasePath = join(directory, 'novatest.db');

    try {
      const store = createSqliteStore({ databasePath });
      store.saveCase(webCase);
      store.saveCase({ ...webCase, name: '结算验证 v2', steps: [webCase.steps[1]] });

      expect(store.getCase(webCase.id)).toMatchObject({ name: '结算验证 v2', steps: [webCase.steps[1]] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('persists run evidence and ordered batch links across instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-sqlite-'));
    const databasePath = join(directory, 'novatest.db');

    try {
      const store = createSqliteStore({ databasePath });
      store.saveCase(webCase);
      store.saveRun({
        id: 'run-1',
        caseId: webCase.id,
        status: 'failed',
        startedAt: '2026-07-17T00:00:00.000Z',
        finishedAt: '2026-07-17T00:01:00.000Z',
        variables: { orderId: 'A-1' },
        steps: [{
          id: 'step-1',
          status: 'failed',
          attempts: 2,
          error: 'missing',
          screenshot: 'evidence/a.png',
          screenshots: [
            { path: 'run-1/step-1-attempt-1.png', attempt: 1, phase: 'failed' },
            { path: 'run-1/step-1-attempt-2.png', attempt: 2, phase: 'passed' }
          ],
          logs: [{ level: 'warn', message: 'retrying' }]
        }]
      });
      store.saveBatch({
        id: 'batch-1',
        name: '回归',
        caseIds: [webCase.id],
        status: 'failed',
        runIds: ['run-1'],
        startedAt: '2026-07-17T00:00:00.000Z',
        finishedAt: '2026-07-17T00:01:00.000Z'
      });

      const reloaded = createSqliteStore({ databasePath });
      expect(reloaded.getRun('run-1')).toMatchObject({
        variables: { orderId: 'A-1' },
        steps: [{
          screenshot: 'evidence/a.png',
          screenshots: [
            { path: 'run-1/step-1-attempt-1.png', attempt: 1, phase: 'failed' },
            { path: 'run-1/step-1-attempt-2.png', attempt: 2, phase: 'passed' }
          ],
          logs: [{ message: 'retrying' }]
        }]
      });
      expect(reloaded.getBatch('batch-1')).toMatchObject({ caseIds: [webCase.id], runIds: ['run-1'] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves batch run order when runs share the same start time', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-sqlite-'));
    const databasePath = join(directory, 'novatest.db');
    const sameTime = '2026-07-17T00:00:00.000Z';

    try {
      const store = createSqliteStore({ databasePath });
      store.saveCase(webCase);
      store.saveRun({ id: 'run-z', caseId: webCase.id, status: 'passed', startedAt: sameTime, finishedAt: sameTime, variables: {}, steps: [] });
      store.saveRun({ id: 'run-a', caseId: webCase.id, status: 'passed', startedAt: sameTime, finishedAt: sameTime, variables: {}, steps: [] });
      store.saveBatch({ id: 'batch-1', name: '顺序回归', caseIds: [webCase.id], status: 'passed', runIds: ['run-z', 'run-a'], startedAt: sameTime, finishedAt: sameTime });

      expect(store.getBatch('batch-1').runIds).toEqual(['run-z', 'run-a']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('migrates legacy JSON once and saves a migrated backup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-sqlite-'));
    const databasePath = join(directory, 'novatest.db');
    const legacyJsonPath = join(directory, 'store.json');
    const legacyRun = {
      id: 'run-1',
      caseId: webCase.id,
      status: 'passed',
      startedAt: '2026-07-17T00:00:00.000Z',
      finishedAt: '2026-07-17T00:01:00.000Z',
      variables: {},
      steps: [{ id: 'step-1', status: 'passed', attempts: 1, logs: [] }]
    };
    const legacyBatch = {
      id: 'batch-1',
      name: '迁移回归',
      caseIds: [webCase.id],
      status: 'passed',
      runIds: [legacyRun.id],
      startedAt: legacyRun.startedAt,
      finishedAt: legacyRun.finishedAt
    };

    try {
      await writeFile(legacyJsonPath, JSON.stringify({ cases: { [webCase.id]: webCase }, runs: { [legacyRun.id]: legacyRun }, batches: { [legacyBatch.id]: legacyBatch } }));
      const store = createSqliteStore({ databasePath, legacyJsonPath });

      expect(store.getCase(webCase.id)).toMatchObject({ name: '结算验证', steps: webCase.steps });
      expect(store.getRun(legacyRun.id)).toMatchObject({ caseId: webCase.id, status: 'passed' });
      expect(store.getBatch(legacyBatch.id)).toMatchObject({ caseIds: [webCase.id], runIds: [legacyRun.id] });
      await expect(readFile(`${legacyJsonPath}.migrated`, 'utf8')).resolves.toContain('迁移回归');
      expect(existsSync(legacyJsonPath)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps malformed legacy JSON and imports no partial records', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-sqlite-'));
    const databasePath = join(directory, 'novatest.db');
    const legacyJsonPath = join(directory, 'store.json');

    try {
      await writeFile(legacyJsonPath, '{invalid');
      expect(() => createSqliteStore({ databasePath, legacyJsonPath })).toThrow();
      expect(existsSync(legacyJsonPath)).toBe(true);
      expect(createSqliteStore({ databasePath }).listCases()).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not overwrite an existing migrated JSON backup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-sqlite-'));
    const databasePath = join(directory, 'novatest.db');
    const legacyJsonPath = join(directory, 'store.json');
    const backupPath = `${legacyJsonPath}.migrated`;

    try {
      await writeFile(legacyJsonPath, JSON.stringify({ cases: { [webCase.id]: webCase }, runs: {}, batches: {} }));
      await writeFile(backupPath, 'original backup');
      const store = createSqliteStore({ databasePath, legacyJsonPath });

      expect(store.getCase(webCase.id)).toMatchObject({ name: '结算验证' });
      await expect(readFile(backupPath, 'utf8')).resolves.toBe('original backup');
      expect(existsSync(legacyJsonPath)).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('retains run and batch history after deleting a case definition', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-sqlite-'));
    const databasePath = join(directory, 'novatest.db');

    try {
      const store = createSqliteStore({ databasePath });
      store.saveCase(webCase);
      store.saveRun({ id: 'run-1', caseId: webCase.id, status: 'passed', startedAt: '2026-07-17T00:00:00.000Z', finishedAt: '2026-07-17T00:01:00.000Z', variables: {}, steps: [] });
      store.saveBatch({ id: 'batch-1', name: '删除历史', caseIds: [webCase.id], status: 'passed', runIds: ['run-1'], startedAt: '2026-07-17T00:00:00.000Z', finishedAt: '2026-07-17T00:01:00.000Z' });

      expect(store.deleteCase(webCase.id)).toBe(true);
      expect(store.getCase(webCase.id)).toBeUndefined();
      expect(store.getRun('run-1')).toMatchObject({ caseId: webCase.id, caseName: '结算验证' });
      expect(store.getBatch('batch-1').caseIds).toEqual([webCase.id]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('filters active cases by name', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-sqlite-'));
    const databasePath = join(directory, 'novatest.db');

    try {
      const store = createSqliteStore({ databasePath });
      store.saveCase(webCase);
      store.saveCase({ ...webCase, id: 'case-2', name: '登录验证' });

      expect(store.listCases('结算').map((testCase) => testCase.id)).toEqual([webCase.id]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
