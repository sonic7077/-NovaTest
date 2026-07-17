import { mkdtemp, rm } from 'node:fs/promises';
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
        steps: [{ screenshot: 'evidence/a.png', logs: [{ message: 'retrying' }] }]
      });
      expect(reloaded.getBatch('batch-1')).toMatchObject({ caseIds: [webCase.id], runIds: ['run-1'] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
