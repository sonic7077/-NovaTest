import express from 'express';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';
import multer from 'multer';
import { validateWebCase } from './domain/case.js';
import { renderReport } from './services/report-service.js';
import { BatchService } from './services/batch-service.js';
import { RunService } from './services/run-service.js';

export function createMemoryStore() {
  const cases = new Map();
  const runs = new Map();
  const batches = new Map();
  const projects = new Map([['default-project', { id: 'default-project', name: '默认项目', createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' }]]);
  function listProjects() {
    return [...projects.values()].map((project) => {
      const projectCases = [...cases.values()].filter((testCase) => testCase.projectId === project.id);
      return { ...project, caseCount: projectCases.length, webCaseCount: projectCases.filter((testCase) => testCase.target === 'web').length, apiCaseCount: projectCases.filter((testCase) => testCase.target === 'api').length };
    });
  }
  return {
    saveCase(testCase) { const saved = { ...testCase, id: testCase.id || crypto.randomUUID(), projectId: testCase.projectId || 'default-project' }; cases.set(saved.id, saved); return saved; },
    getCase(id) { return cases.get(id); },
    listCases(query = '', projectId = '') { return [...cases.values()].filter((testCase) => testCase.name.toLowerCase().includes(query.toLowerCase()) && (!projectId || testCase.projectId === projectId)); },
    listProjects,
    getProject(id) { return listProjects().find((project) => project.id === id); },
    saveProject(project) {
      const name = project?.name?.trim();
      if (!name) throw new Error('project name required');
      if ([...projects.values()].some((item) => item.id !== project.id && item.name.toLowerCase() === name.toLowerCase())) throw new Error('project name already exists');
      const timestamp = new Date().toISOString();
      const saved = { id: project.id || crypto.randomUUID(), name, createdAt: project.createdAt || timestamp, updatedAt: timestamp };
      if (project.id && !projects.has(project.id)) throw new Error('project not found');
      projects.set(saved.id, saved);
      return this.getProject(saved.id);
    },
    deleteProject(id) {
      if (!projects.has(id) || [...cases.values()].some((testCase) => testCase.projectId === id)) return false;
      return projects.delete(id);
    },
    saveRun(run) { runs.set(run.id, run); return run; },
    getRun(id) { return runs.get(id); },
    deleteCase(id) { return cases.delete(id); },
    saveBatch(batch) { const saved = { ...batch, projectId: batch.projectId || 'default-project' }; batches.set(saved.id, saved); return saved; },
    getBatch(id) { return batches.get(id); },
    listBatches(projectId = '') { return [...batches.values()].filter((batch) => !projectId || batch.projectId === projectId); }
  };
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function createApp({ runner, store = createMemoryStore(), staticDir = projectRoot, evidenceDir = join(projectRoot, 'data/evidence'), runnerStatus = { ready: true, message: 'ready' }, cmsRunnerStatus = { ready: false, message: 'CMS API runner is not configured' }, cmsSeedCases = [] }) {
  const app = express();
  const runService = new RunService(runner);
  const batchService = new BatchService({ runner, store });
  cmsSeedCases.forEach((testCase) => {
    if (!store.getCase(testCase.id)) store.saveCase(testCase);
  });
  app.use(express.json());
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

  app.get('/api/health', (_req, res) => res.json({ webRunner: runnerStatus, cmsRunner: cmsRunnerStatus }));

  app.get('/api/projects', (_req, res) => res.json(store.listProjects()));

  app.post('/api/projects', (req, res) => {
    try { return res.status(201).json(store.saveProject(req.body)); }
    catch (error) { return res.status(error.message === 'project name already exists' ? 409 : 400).json({ error: error.message }); }
  });

  app.put('/api/projects/:id', (req, res) => {
    if (!store.getProject(req.params.id)) return res.status(404).json({ error: 'project not found' });
    try { return res.json(store.saveProject({ ...req.body, id: req.params.id })); }
    catch (error) { return res.status(error.message === 'project name already exists' ? 409 : 400).json({ error: error.message }); }
  });

  app.delete('/api/projects/:id', (req, res) => {
    const project = store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'project not found' });
    if (project.caseCount > 0) return res.status(409).json({ error: 'project contains test cases' });
    return store.deleteProject(project.id) ? res.status(204).end() : res.status(404).json({ error: 'project not found' });
  });

  function validateProjectCase(input) {
    const testCase = validateWebCase(input);
    if (!store.getProject(testCase.projectId)) throw new Error('project not found');
    return testCase;
  }

  app.post('/api/cases', (req, res) => {
    try { res.status(201).json(store.saveCase(validateProjectCase(req.body))); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });

  app.get('/api/cases', (req, res) => res.json(store.listCases(req.query.q || '', req.query.projectId || '')));

  app.get('/api/cases/:id', (req, res) => {
    const testCase = store.getCase(req.params.id);
    return testCase ? res.json(testCase) : res.status(404).json({ error: 'test case not found' });
  });

  app.post('/api/cases/:id/assets', upload.single('file'), async (req, res) => {
    if (!store.getCase(req.params.id)) return res.status(404).json({ error: 'test case not found' });
    if (!req.file || !['image/png', 'image/jpeg', 'image/webp'].includes(req.file.mimetype)) return res.status(400).json({ error: 'invalid image file' });
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[req.file.mimetype];
    const id = crypto.randomUUID();
    const assetPath = `${req.params.id}/${id}.${extension}`;
    const directory = join(projectRoot, 'data/case-assets', req.params.id);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${id}.${extension}`), req.file.buffer);
    return res.status(201).json({ id, assetPath, source: 'upload' });
  });

  app.put('/api/cases/:id', (req, res) => {
    if (!store.getCase(req.params.id)) return res.status(404).json({ error: 'test case not found' });
    try { return res.json(store.saveCase({ ...validateProjectCase(req.body), id: req.params.id })); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.delete('/api/cases/:id', (req, res) => {
    return store.deleteCase(req.params.id) ? res.status(204).end() : res.status(404).json({ error: 'test case not found' });
  });

  app.post('/api/batches', async (req, res) => {
    const { caseIds } = req.body;
    if (!Array.isArray(caseIds) || caseIds.length === 0) return res.status(400).json({ error: 'select at least one test case' });
    if (new Set(caseIds).size !== caseIds.length) return res.status(400).json({ error: 'select unique test cases' });

    const cases = caseIds.map((id) => store.getCase(id));
    if (cases.some((testCase) => !testCase)) return res.status(400).json({ error: 'test case not found' });
    if (new Set(cases.map((testCase) => testCase.target)).size !== 1) return res.status(400).json({ error: 'batch cases must share one target' });
    if (new Set(cases.map((testCase) => testCase.projectId)).size !== 1) return res.status(409).json({ error: '批量执行只能选择同一项目的用例' });

    const name = typeof req.body.name === 'string' && req.body.name.trim()
      ? req.body.name.trim()
      : `批量执行 ${new Date().toLocaleString('zh-CN')}`;
    return res.status(202).json(await batchService.start({ name, projectId: cases[0].projectId, caseIds, cases }));
  });

  app.get('/api/batches', (req, res) => res.json(store.listBatches(req.query.projectId || '').reverse()));

  app.get('/api/batches/:id', (req, res) => {
    const batch = store.getBatch(req.params.id);
    if (!batch) return res.status(404).json({ error: 'batch not found' });
    return res.json({ ...batch, runs: batch.runIds.map((id) => store.getRun(id)).filter(Boolean) });
  });

  app.post('/api/cases/:id/runs', async (req, res) => {
    const testCase = store.getCase(req.params.id);
    if (!testCase) return res.status(404).json({ error: 'test case not found' });
    const run = { ...await runService.start(testCase), caseName: testCase.name };
    store.saveRun(run);
    return res.status(202).json(run);
  });

  app.get('/api/runs/:id', (req, res) => {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'run not found' });
    return res.json(run);
  });

  app.get('/api/runs/:runId/evidence/:fileName', (req, res) => {
    const run = store.getRun(req.params.runId);
    const fileName = req.params.fileName;
    const registered = new Set((run?.steps || []).flatMap((step) => [
      step.screenshot,
      ...(step.screenshots || []).map((evidence) => evidence.path)
    ]).filter(Boolean).map((path) => basename(path)));
    if (!run || basename(fileName) !== fileName || !registered.has(fileName)) return res.status(404).end();
    const filePath = join(evidenceDir, run.id, fileName);
    return existsSync(filePath) ? res.sendFile(filePath) : res.status(404).end();
  });

  app.get('/api/runs/:id/report', (req, res) => {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).send('report not found');
    return res.type('html').send(renderReport(run, run.caseName || store.getCase(run.caseId)?.name || '已删除用例'));
  });

  app.use(express.static(staticDir));

  return app;
}
