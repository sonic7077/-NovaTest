import express from 'express';
import { fileURLToPath } from 'node:url';
import { validateWebCase } from './domain/case.js';
import { renderReport } from './services/report-service.js';
import { BatchService } from './services/batch-service.js';
import { RunService } from './services/run-service.js';

export function createMemoryStore() {
  const cases = new Map();
  const runs = new Map();
  const batches = new Map();
  return {
    saveCase(testCase) { const saved = { ...testCase, id: testCase.id || crypto.randomUUID() }; cases.set(saved.id, saved); return saved; },
    getCase(id) { return cases.get(id); },
    listCases(query = '') { return [...cases.values()].filter((testCase) => testCase.name.toLowerCase().includes(query.toLowerCase())); },
    saveRun(run) { runs.set(run.id, run); return run; },
    getRun(id) { return runs.get(id); },
    deleteCase(id) { return cases.delete(id); },
    saveBatch(batch) { batches.set(batch.id, batch); return batch; },
    getBatch(id) { return batches.get(id); },
    listBatches() { return [...batches.values()]; }
  };
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function createApp({ runner, store = createMemoryStore(), staticDir = projectRoot, runnerStatus = { ready: true, message: 'ready' } }) {
  const app = express();
  const runService = new RunService(runner);
  const batchService = new BatchService({ runner, store });
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ webRunner: runnerStatus }));

  app.post('/api/cases', (req, res) => {
    try { res.status(201).json(store.saveCase(validateWebCase(req.body))); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });

  app.get('/api/cases', (req, res) => res.json(store.listCases(req.query.q || '')));

  app.get('/api/cases/:id', (req, res) => {
    const testCase = store.getCase(req.params.id);
    return testCase ? res.json(testCase) : res.status(404).json({ error: 'test case not found' });
  });

  app.put('/api/cases/:id', (req, res) => {
    if (!store.getCase(req.params.id)) return res.status(404).json({ error: 'test case not found' });
    try { return res.json(store.saveCase({ ...validateWebCase(req.body), id: req.params.id })); }
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

    const name = typeof req.body.name === 'string' && req.body.name.trim()
      ? req.body.name.trim()
      : `批量执行 ${new Date().toLocaleString('zh-CN')}`;
    return res.status(202).json(await batchService.start({ name, caseIds, cases }));
  });

  app.get('/api/batches', (_req, res) => res.json(store.listBatches().reverse()));

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

  app.get('/api/runs/:id/report', (req, res) => {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).send('report not found');
    return res.type('html').send(renderReport(run, run.caseName || store.getCase(run.caseId)?.name || '已删除用例'));
  });

  app.use(express.static(staticDir));

  return app;
}
