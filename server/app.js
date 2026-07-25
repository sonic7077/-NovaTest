import express from 'express';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';
import multer from 'multer';
import { validateWebCase } from './domain/case.js';
import { renderBatchReport, renderReport } from './services/report-service.js';
import { ExecutionService } from './services/execution-service.js';
import { hashPasswordSync, publicUser, validatePasswordChange, validateProfile, verifyPassword } from './services/auth-service.js';

export function createMemoryStore() {
  const cases = new Map();
  const runs = new Map();
  const batches = new Map();
  const users = new Map();
  const projects = new Map([['default-project', { id: 'default-project', name: '默认项目', createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' }]]);
  function listProjects() {
    return [...projects.values()].map((project) => {
      const projectCases = [...cases.values()].filter((testCase) => testCase.projectId === project.id);
      return { ...project, caseCount: projectCases.length, webCaseCount: projectCases.filter((testCase) => testCase.target === 'web').length, apiCaseCount: projectCases.filter((testCase) => testCase.target === 'api').length };
    });
  }
  function matches(item, { projectId = '', target = '', status = '' } = {}) {
    return (!projectId || item.projectId === projectId) && (!target || item.target === target) && (!status || item.status === status);
  }
  function rangeStart(range = '7d', now = Date.now()) {
    const date = new Date(now);
    return new Date(date.getTime() - (range === '30d' ? 30 : range === 'today' ? 1 : 7) * 86400000).toISOString();
  }
  function listExecutions(filters = {}) {
    const batchItems = [...batches.values()].filter((batch) => matches(batch, filters)).map((batch) => {
      const batchRuns = batch.runIds.map((id) => runs.get(id)).filter(Boolean);
      const steps = batchRuns.flatMap((run) => run.steps || []);
      return { ...batch, kind: 'batch', projectName: projects.get(batch.projectId)?.name, totalCases: batch.caseIds.length, completedCases: batchRuns.filter((run) => ['passed', 'failed', 'skipped'].includes(run.status)).length, totalSteps: steps.length, completedSteps: steps.filter((step) => ['passed', 'failed', 'skipped'].includes(step.status)).length, currentCaseName: batchRuns.find((run) => ['queued', 'running'].includes(run.status))?.caseName };
    });
    const runItems = [...runs.values()].filter((run) => !run.batchId && matches(run, filters)).map((run) => ({ ...run, kind: 'run', name: run.caseName, projectName: projects.get(run.projectId)?.name, totalCases: 1, completedCases: ['passed', 'failed', 'skipped'].includes(run.status) ? 1 : 0, totalSteps: run.steps.length, completedSteps: run.steps.filter((step) => ['passed', 'failed', 'skipped'].includes(step.status)).length, currentCaseName: run.caseName }));
    return [...batchItems, ...runItems].sort((first, second) => String(second.finishedAt || second.startedAt || '').localeCompare(String(first.finishedAt || first.startedAt || '')));
  }
  function listReports(filters = {}) {
    const start = rangeStart(filters.range, filters.now);
    const batchItems = [...batches.values()].filter((batch) => ['passed', 'failed', 'skipped'].includes(batch.status) && batch.finishedAt >= start && matches(batch, filters)).map((batch) => {
      const batchRuns = batch.runIds.map((id) => runs.get(id)).filter(Boolean);
      return { ...batch, kind: 'batch', projectName: projects.get(batch.projectId)?.name, passedCases: batchRuns.filter((run) => run.status === 'passed').length, failedCases: batchRuns.filter((run) => run.status === 'failed').length, skippedCases: batchRuns.filter((run) => run.status === 'skipped').length, reportUrl: `/api/batches/${batch.id}/report` };
    });
    const runItems = [...runs.values()].filter((run) => !run.batchId && ['passed', 'failed', 'skipped'].includes(run.status) && run.finishedAt >= start && matches(run, filters)).map((run) => ({ ...run, kind: 'run', name: run.caseName, projectName: projects.get(run.projectId)?.name, passedCases: run.status === 'passed' ? 1 : 0, failedCases: run.status === 'failed' ? 1 : 0, skippedCases: run.status === 'skipped' ? 1 : 0, reportUrl: `/api/runs/${run.id}/report` }));
    return [...batchItems, ...runItems].sort((first, second) => String(second.finishedAt).localeCompare(String(first.finishedAt)));
  }
  function getDashboard({ range = '7d', now } = {}) {
    const start = rangeStart(range, now);
    const complete = [...runs.values()].filter((run) => ['passed', 'failed'].includes(run.status) && run.finishedAt >= start);
    const passedRuns = complete.filter((run) => run.status === 'passed').length;
    const byTarget = ['web', 'api'].map((target) => ({ target, completedRuns: complete.filter((run) => run.target === target).length, passedRuns: complete.filter((run) => run.target === target && run.status === 'passed').length, failedRuns: complete.filter((run) => run.target === target && run.status === 'failed').length })).filter((item) => item.completedRuns);
    return { completedRuns: complete.length, passedRuns, failedRuns: complete.length - passedRuns, passRate: complete.length ? Number(((passedRuns / complete.length) * 100).toFixed(1)) : 0, averageDurationMs: complete.length ? Math.round(complete.reduce((total, run) => total + (new Date(run.finishedAt) - new Date(run.startedAt)), 0) / complete.length) : 0, automatedCaseCount: cases.size, daily: [], targets: byTarget, recentFailures: complete.filter((run) => run.status === 'failed').flatMap((run) => run.steps.filter((step) => step.status === 'failed').map((step) => ({ runId: run.id, caseName: run.caseName, projectName: projects.get(run.projectId)?.name, target: run.target, finishedAt: run.finishedAt, error: step.error }))), recentReports: listReports({ range, now }).slice(0, 8) };
  }
  function failInterruptedExecutions(message) {
    let count = 0;
    for (const run of runs.values()) if (['queued', 'running'].includes(run.status)) { run.status = 'failed'; run.finishedAt = new Date().toISOString(); run.steps.filter((step) => ['queued', 'running'].includes(step.status)).forEach((step) => { step.status = 'failed'; step.error ||= message; }); count += 1; }
    for (const batch of batches.values()) if (['queued', 'running'].includes(batch.status)) { batch.status = 'failed'; batch.finishedAt = new Date().toISOString(); count += 1; }
    return count;
  }
  function getUserByUsername(username) { return [...users.values()].find((user) => user.username.toLowerCase() === String(username).toLowerCase()); }
  function saveUser(user) {
    const timestamp = new Date().toISOString();
    const saved = { ...user, id: user.id || crypto.randomUUID(), email: user.email || '', createdAt: user.createdAt || timestamp, updatedAt: timestamp };
    users.set(saved.id, saved);
    return saved;
  }
  function ensureDefaultAdmin({ hash, salt }) { return getUserByUsername('admin') || saveUser({ username: 'admin', passwordHash: hash, passwordSalt: salt, displayName: 'admin', jobTitle: '平台管理员', email: '' }); }
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
    listBatches(projectId = '') { return [...batches.values()].filter((batch) => !projectId || batch.projectId === projectId); },
    listExecutions,
    getDashboard,
    listReports,
    getUserByUsername,
    getUser(id) { return users.get(id); },
    saveUser,
    ensureDefaultAdmin,
    failInterruptedExecutions
  };
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function createApp({ runner, store = createMemoryStore(), staticDir = projectRoot, evidenceDir = join(projectRoot, 'data/evidence'), runnerStatus = { ready: true, message: 'ready' }, cmsRunnerStatus = { ready: false, message: 'CMS API runner is not configured' }, cmsSeedCases = [], executionSchedule, authRequired = false } = {}) {
  const app = express();
  const sessions = new Map();
  if (authRequired) store.ensureDefaultAdmin(hashPasswordSync('admin123'));
  store.failInterruptedExecutions?.('服务重启导致任务中断');
  const executionService = new ExecutionService({ runner, store, ...(executionSchedule ? { schedule: executionSchedule } : {}) });
  cmsSeedCases.forEach((testCase) => {
    if (!store.getCase(testCase.id)) store.saveCase(testCase);
  });
  app.use(express.json());
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
  const requestedMutationAuthorization = (value) => value === true;

  app.get('/api/health', (_req, res) => res.json({ webRunner: runnerStatus, cmsRunner: cmsRunnerStatus }));

  function currentUser(req) {
    const sessionId = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('novatest_session='))?.slice('novatest_session='.length);
    const userId = sessionId && sessions.get(sessionId);
    return userId ? store.getUser(userId) : undefined;
  }

  function clearSession(res) {
    res.clearCookie('novatest_session', { httpOnly: true, sameSite: 'lax', path: '/' });
  }

  app.post('/api/auth/login', async (req, res) => {
    const user = store.getUserByUsername(req.body?.username || '');
    if (!user || !await verifyPassword(req.body?.password || '', { hash: user.passwordHash, salt: user.passwordSalt })) return res.status(401).json({ error: '用户名或密码错误' });
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, user.id);
    res.cookie('novatest_session', sessionId, { httpOnly: true, sameSite: 'lax', path: '/' });
    return res.json({ user: publicUser(user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    const sessionId = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('novatest_session='))?.slice('novatest_session='.length);
    if (sessionId) sessions.delete(sessionId);
    clearSession(res);
    return res.status(204).end();
  });

  app.get('/api/auth/session', (req, res) => {
    const user = currentUser(req);
    return user ? res.json({ user: publicUser(user) }) : res.status(401).json({ error: '请先登录' });
  });

  app.put('/api/auth/profile', (req, res) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: '请先登录' });
    try { return res.json({ user: publicUser(store.saveUser({ ...user, ...validateProfile(req.body) })) }); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.put('/api/auth/password', async (req, res) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: '请先登录' });
    try {
      const { currentPassword, newPassword } = validatePasswordChange(req.body);
      if (!await verifyPassword(currentPassword, { hash: user.passwordHash, salt: user.passwordSalt })) return res.status(401).json({ error: '当前密码错误' });
      const next = hashPasswordSync(newPassword);
      store.saveUser({ ...user, passwordHash: next.hash, passwordSalt: next.salt });
      [...sessions.entries()].filter(([, userId]) => userId === user.id).forEach(([sessionId]) => sessions.delete(sessionId));
      clearSession(res);
      return res.status(204).end();
    } catch (error) { return res.status(400).json({ error: error.message }); }
  });

  if (authRequired) app.use('/api', (req, res, next) => currentUser(req) ? next() : res.status(401).json({ error: '请先登录' }));

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

  app.post('/api/batches', (req, res) => {
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
    return res.status(202).json(executionService.queueBatch({ name, projectId: cases[0].projectId, target: cases[0].target, caseIds, cases, allowMutations: requestedMutationAuthorization(req.body.allowMutations) }));
  });

  app.get('/api/executions', (req, res) => res.json(store.listExecutions({ projectId: req.query.projectId || '', target: req.query.target || '', status: req.query.status || '' })));
  app.get('/api/executions/:id', (req, res) => {
    const batch = store.getBatch(req.params.id);
    if (batch) return res.json({ kind: 'batch', task: batch, runs: batch.runIds.map((id) => store.getRun(id)).filter(Boolean) });
    const run = store.getRun(req.params.id);
    if (run) return res.json({ kind: 'run', task: run, runs: [run] });
    return res.status(404).json({ error: 'execution not found' });
  });
  app.get('/api/dashboard', (req, res) => res.json(store.getDashboard({ range: req.query.range || '7d' })));
  app.get('/api/reports', (req, res) => res.json(store.listReports({ projectId: req.query.projectId || '', target: req.query.target || '', status: req.query.status || '', range: req.query.range || '7d' })));

  app.get('/api/batches', (req, res) => res.json(store.listBatches(req.query.projectId || '').reverse()));

  app.get('/api/batches/:id', (req, res) => {
    const batch = store.getBatch(req.params.id);
    if (!batch) return res.status(404).json({ error: 'batch not found' });
    return res.json({ ...batch, runs: batch.runIds.map((id) => store.getRun(id)).filter(Boolean) });
  });

  app.get('/api/batches/:id/report', (req, res) => {
    const batch = store.getBatch(req.params.id);
    if (!batch) return res.status(404).send('batch report not found');
    const runs = batch.runIds.map((id) => store.getRun(id)).filter(Boolean);
    return res.type('html').send(renderBatchReport(batch, runs));
  });

  app.post('/api/cases/:id/runs', (req, res) => {
    const testCase = store.getCase(req.params.id);
    if (!testCase) return res.status(404).json({ error: 'test case not found' });
    return res.status(202).json(executionService.queueRun(testCase, { allowMutations: requestedMutationAuthorization(req.body?.allowMutations) }));
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
