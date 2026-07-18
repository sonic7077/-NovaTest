import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileStore } from '../server/storage/file-store.js';

describe('file store', () => {
  it('migrates legacy cases into the default project and filters by project', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-store-'));
    const filePath = join(directory, 'store.json');
    try {
      await writeFile(filePath, JSON.stringify({ cases: { legacy: { name: '旧用例', target: 'web', steps: [] } } }));
      const store = createFileStore(filePath);
      const [defaultProject] = store.listProjects();
      const [legacy] = store.listCases('', defaultProject.id);
      expect(defaultProject).toMatchObject({ name: '默认项目', caseCount: 1 });
      expect(legacy).toMatchObject({ id: 'legacy', projectId: defaultProject.id });

      const project = store.saveProject({ name: '社区 CMS' });
      store.saveCase({ id: 'api-1', name: '帖子列表', target: 'api', projectId: project.id, steps: [] });
      expect(store.listCases('', project.id).map((testCase) => testCase.id)).toEqual(['api-1']);
      expect(store.deleteProject(project.id)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

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
      expect(reloaded.listCases()).toMatchObject([testCase]);
      expect(reloaded.listCases()[0].projectId).toEqual(expect.any(String));
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

  it('persists batches across store instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-store-'));
    const filePath = join(directory, 'store.json');
    const batch = {
      id: 'batch-1',
      name: '冒烟回归',
      caseIds: ['case-1'],
      status: 'queued',
      runIds: [],
      startedAt: null,
      finishedAt: null
    };

    try {
      createFileStore(filePath).saveBatch(batch);
      const reloaded = createFileStore(filePath);
      const stored = reloaded.getBatch(batch.id);
      expect(stored).toMatchObject(batch);
      expect(stored.projectId).toEqual(expect.any(String));
      expect(reloaded.listBatches(stored.projectId)).toMatchObject([stored]);
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
