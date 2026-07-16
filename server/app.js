import express from 'express';
import { fileURLToPath } from 'node:url';
import { validateWebCase } from './domain/case.js';
import { renderReport } from './services/report-service.js';
import { RunService } from './services/run-service.js';

export function createMemoryStore() {
  const cases = new Map();
  const runs = new Map();
  const batches = new Map();
  return {
    saveCase(testCase) { const saved = { ...testCase, id: testCase.id || crypto.randomUUID() }; cases.set(saved.id, saved); return saved; },
    getCase(id) { return cases.get(id); },
    listCases() { return [...cases.values()]; },
    saveRun(run) { runs.set(run.id, run); return run; },
    getRun(id) { return runs.get(id); },
    saveBatch(batch) { batches.set(batch.id, batch); return batch; },
    getBatch(id) { return batches.get(id); },
    listBatches() { return [...batches.values()]; }
  };
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function createApp({ runner, store = createMemoryStore(), staticDir = projectRoot, runnerStatus = { ready: true, message: 'ready' } }) {
  const app = express();
  const runService = new RunService(runner);
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ webRunner: runnerStatus }));

  app.post('/api/cases', (req, res) => {
    try { res.status(201).json(store.saveCase(validateWebCase(req.body))); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });

  app.get('/api/cases', (_req, res) => res.json(store.listCases()));

  app.post('/api/cases/:id/runs', async (req, res) => {
    const testCase = store.getCase(req.params.id);
    if (!testCase) return res.status(404).json({ error: 'test case not found' });
    const run = await runService.start(testCase);
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
    const testCase = run && store.getCase(run.caseId);
    if (!run || !testCase) return res.status(404).send('report not found');
    return res.type('html').send(renderReport(run, testCase));
  });

  app.use(express.static(staticDir));

  return app;
}
