import express from 'express';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';
import multer from 'multer';
import { validateWebCase } from './domain/case.js';
import { publicAccountPool, validateAccountPool, validatePerformanceAsset } from './domain/performance.js';
import { normalizeProjectWebAuth } from './domain/project-auth.js';
import { renderBatchReport, renderReport } from './services/report-service.js';
import { ExecutionService } from './services/execution-service.js';
import { hashPasswordSync, publicUser, validatePasswordChange, validateProfile, verifyPassword } from './services/auth-service.js';
import { createCaseAssetService } from './services/case-asset-service.js';
import { publicModelConfig } from './services/model-config-service.js';
import { PerformanceService } from './services/performance-service.js';

export function createMemoryStore() {
  const cases = new Map();
  const runs = new Map();
  const batches = new Map();
  const performancePools = new Map();
  const performanceAssets = new Map();
  const performanceRuns = new Map();
  const users = new Map();
  let modelConfig;
  const projects = new Map([['default-project', { id: 'default-project', name: '默认项目', webAuth: undefined, createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' }]]);
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
      return { ...batch, kind: 'batch', projectName: projects.get(batch.projectId)?.name, totalCases: batch.plannedCaseCount || batch.caseIds.length, completedCases: batchRuns.filter((run) => ['passed', 'failed', 'skipped'].includes(run.status)).length, totalSteps: batch.plannedStepCount || steps.length, completedSteps: steps.filter((step) => ['passed', 'failed', 'skipped'].includes(step.status)).length, currentCaseName: batchRuns.find((run) => ['queued', 'running'].includes(run.status))?.caseName };
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
    const saved = { id: project.id || crypto.randomUUID(), name, webAuth: normalizeProjectWebAuth(project.webAuth), createdAt: project.createdAt || timestamp, updatedAt: timestamp };
      if (project.id && !projects.has(project.id)) throw new Error('project not found');
      projects.set(saved.id, saved);
    return this.getProject(saved.id);
  },
    ensureProjectWebAuth({ name, webAuth }) {
      const project = [...projects.values()].find((item) => item.name === name);
      if (!project) throw new Error('project not found');
      project.webAuth = normalizeProjectWebAuth(webAuth);
      project.updatedAt = new Date().toISOString();
      return project.id;
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
    getModelConfig() { return modelConfig; },
    saveModelConfig(config) { modelConfig = { ...config }; return modelConfig; },
    savePerformanceAccountPool(pool) {
      const valid = validateAccountPool(pool);
      if (!projects.has(valid.projectId)) throw new Error('project not found');
      const timestamp = new Date().toISOString();
      const saved = { ...valid, id: valid.id || crypto.randomUUID(), createdAt: valid.createdAt || timestamp, updatedAt: timestamp };
      performancePools.set(saved.id, saved);
      return publicAccountPool(saved);
    },
    getPerformanceAccountPool(id) {
      const pool = performancePools.get(id);
      return pool && publicAccountPool(pool);
    },
    listPerformanceAccountPools(projectId = '') {
      return [...performancePools.values()].filter((pool) => !projectId || pool.projectId === projectId).map(publicAccountPool);
    },
    getPerformanceAccountPoolCredentials(id) { return structuredClone(performancePools.get(id)?.accounts); },
    savePerformanceAsset(asset) {
      if (!asset?.projectId || !projects.has(asset.projectId) || !asset?.name?.trim() || !asset?.protocol || !asset?.config) throw new Error('invalid performance asset');
      const timestamp = new Date().toISOString();
      const saved = { ...asset, id: asset.id || crypto.randomUUID(), createdAt: asset.createdAt || timestamp, updatedAt: timestamp };
      performanceAssets.set(saved.id, saved);
      return structuredClone(saved);
    },
    getPerformanceAsset(id) { return structuredClone(performanceAssets.get(id)); },
    listPerformanceAssets(projectId = '') { return [...performanceAssets.values()].filter((asset) => !projectId || asset.projectId === projectId).map((asset) => structuredClone(asset)); },
    savePerformanceRun(run) {
      const existing = performanceRuns.get(run.id);
      const saved = { ...existing, ...run, summary: { ...(existing?.summary || {}), ...(run.summary || {}) }, samples: existing?.samples || [] };
      performanceRuns.set(saved.id, saved);
      return structuredClone(saved);
    },
    getPerformanceRun(id) { return structuredClone(performanceRuns.get(id)); },
    listPerformanceRuns({ projectId = '', status = '' } = {}) {
      return [...performanceRuns.values()].filter((run) => (!projectId || run.projectId === projectId) && (!status || run.status === status))
        .map((run) => structuredClone(run));
    },
    appendPerformanceSample(id, sample) {
      const run = performanceRuns.get(id);
      if (!run) return undefined;
      run.samples.push(structuredClone(sample));
      return structuredClone(run);
    },
    failInterruptedExecutions
  };
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

function sanitizeModelConfig(modelConfig) {
  return publicModelConfig(modelConfig);
}

function reportFilename(name) {
  const base = String(name || '测试报告')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || '测试报告';
  return `${base}-测试报告.html`;
}

function sendHtmlDownload(res, filename, html) {
  return res
    .type('html')
    .set('Content-Disposition', `attachment; filename="report.html"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    .send(html);
}

export function createApp({ runner, performanceRunner = { run: async () => { throw new Error('k6 runner is unavailable'); } }, store = createMemoryStore(), staticDir = projectRoot, evidenceDir = join(projectRoot, 'data/evidence'), caseAssetsDir = join(projectRoot, 'data/case-assets'), runnerStatus = { ready: true, message: 'ready' }, cmsRunnerStatus = { ready: false, message: 'CMS API runner is not configured' }, modelConfig = { source: 'MIDSCENE', baseUrl: '', modelName: '', modelFamily: '', apiKey: '' }, modelConfigManager, cmsSeedCases = [], executionSchedule, performanceSchedule, authRequired = false } = {}) {
  const app = express();
  const sessions = new Map();
  if (authRequired) store.ensureDefaultAdmin(hashPasswordSync('admin123'));
  store.failInterruptedExecutions?.('服务重启导致任务中断');
  const executionService = new ExecutionService({ runner, store, ...(executionSchedule ? { schedule: executionSchedule } : {}) });
  const performanceService = new PerformanceService({ store, runner: performanceRunner, ...(performanceSchedule ? { schedule: performanceSchedule } : {}) });
  cmsSeedCases.forEach((testCase) => {
    if (!store.getCase(testCase.id)) store.saveCase(testCase);
  });
  app.use(express.json());
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
  const assetService = createCaseAssetService({ caseAssetsDir, store });
  const requestedMutationAuthorization = (value) => value === true;
  const resolvedModelConfigManager = modelConfigManager || {
    getPublicConfig: () => sanitizeModelConfig(modelConfig),
    async update() { throw new Error('model configuration updates are unavailable'); }
  };

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

  function savePublicPerformanceAsset(input, id) {
    const asset = validatePerformanceAsset(input);
    if (id && !store.getPerformanceAsset(id)) throw new Error('performance asset not found');
    return store.savePerformanceAsset({
      id, projectId: asset.projectId, name: asset.name, protocol: asset.protocol,
      config: { ...asset, id: undefined }
    });
  }

  app.get('/api/performance/pools', (req, res) => res.json(store.listPerformanceAccountPools(req.query.projectId || '')));
  app.post('/api/performance/pools', (req, res) => {
    try { return res.status(201).json(store.savePerformanceAccountPool(req.body)); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });
  app.get('/api/performance/assets', (req, res) => res.json(store.listPerformanceAssets(req.query.projectId || '')));
  app.post('/api/performance/assets', (req, res) => {
    try { return res.status(201).json(savePublicPerformanceAsset(req.body)); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });
  app.get('/api/performance/assets/:id', (req, res) => {
    const asset = store.getPerformanceAsset(req.params.id);
    return asset ? res.json(asset) : res.status(404).json({ error: 'performance asset not found' });
  });
  app.put('/api/performance/assets/:id', (req, res) => {
    try { return res.json(savePublicPerformanceAsset(req.body, req.params.id)); }
    catch (error) { return res.status(error.message === 'performance asset not found' ? 404 : 400).json({ error: error.message }); }
  });
  app.post('/api/performance/assets/:id/runs', (req, res) => {
    try { return res.status(202).json(performanceService.queue(req.params.id)); }
    catch (error) { return res.status(error.code === 'PRECONDITION' ? 409 : error.message === 'performance asset not found' ? 404 : 400).json({ error: error.message }); }
  });
  app.get('/api/performance/runs', (req, res) => res.json(store.listPerformanceRuns({ projectId: req.query.projectId || '', status: req.query.status || '' })));
  app.get('/api/performance/runs/:id', (req, res) => {
    const run = store.getPerformanceRun(req.params.id);
    return run ? res.json(run) : res.status(404).json({ error: 'performance run not found' });
  });
  app.post('/api/performance/runs/:id/stop', (req, res) => {
    try { return res.json(performanceService.stop(req.params.id)); }
    catch (error) { return res.status(error.message === 'performance run not found' ? 404 : 400).json({ error: error.message }); }
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
    const directory = join(caseAssetsDir, req.params.id);
    await mkdir(directory, { recursive: true });
    await writeFile(assetService.uploadPath(req.params.id, `${id}.${extension}`), req.file.buffer);
    return res.status(201).json({ id, assetPath, source: 'upload' });
  });

  app.get('/api/cases/:caseId/assets/:fileName', (req, res) => {
    const filePath = assetService.resolve({ caseId: req.params.caseId, fileName: req.params.fileName, runId: req.query.runId });
    return filePath ? res.sendFile(filePath) : res.status(404).end();
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
    if (cases[0].target === 'api') {
      const protocols = new Set(cases.flatMap((testCase) => testCase.steps.map((step) => step.request?.protocol || 'cms')));
      if (protocols.size !== 1) return res.status(409).json({ error: '批量执行只能选择同一接口协议的用例' });
    }

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
  app.get('/api/model-config', (_req, res) => res.json(resolvedModelConfigManager.getPublicConfig()));
  app.put('/api/model-config', async (req, res) => {
    try { return res.json(await resolvedModelConfigManager.update(req.body || {})); }
    catch (error) { return res.status(400).json({ error: error.message || '模型配置保存失败' }); }
  });
  app.get('/api/reports', (req, res) => res.json(store.listReports({ projectId: req.query.projectId || '', target: req.query.target || '', status: req.query.status || '', range: req.query.range || '7d' })));

  app.get('/api/batches', (req, res) => res.json(store.listBatches(req.query.projectId || '').reverse()));

  app.get('/api/batches/:id', (req, res) => {
    const batch = store.getBatch(req.params.id);
    if (!batch) return res.status(404).json({ error: 'batch not found' });
    return res.json({ ...batch, runs: batch.runIds.map((id) => store.getRun(id)).filter(Boolean) });
  });

  app.get('/api/batches/:id/report/download', (req, res) => {
    const batch = store.getBatch(req.params.id);
    if (!batch) return res.status(404).send('batch report not found');
    const runs = batch.runIds.map((id) => store.getRun(id)).filter(Boolean);
    return sendHtmlDownload(res, reportFilename(batch.name), renderBatchReport(batch, runs));
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

  app.get('/api/runs/:id/report/download', (req, res) => {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).send('report not found');
    const caseName = run.caseName || store.getCase(run.caseId)?.name || '已删除用例';
    return sendHtmlDownload(res, reportFilename(caseName), renderReport(run, caseName));
  });

  app.get('/api/runs/:id/report', (req, res) => {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).send('report not found');
    return res.type('html').send(renderReport(run, run.caseName || store.getCase(run.caseId)?.name || '已删除用例'));
  });

  app.use(express.static(staticDir));

  return app;
}
