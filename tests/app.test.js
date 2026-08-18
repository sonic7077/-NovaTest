import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, createMemoryStore } from '../server/app.js';
import { DEFAULT_DAYGF_SCENARIO } from '../server/domain/performance.js';
import { renderBatchReport, renderReport } from '../server/services/report-service.js';
import { cmsWhitebagCases } from '../server/seed/cms-whitebag-cases.js';

const webCase = {
  projectId: 'default-project',
  name: '首页验证',
  target: 'web',
  baseUrl: 'https://example.test',
  viewport: 'desktop',
  steps: [{ id: 's1', kind: 'assert', instruction: '页面显示标题' }]
};

const apiCase = {
  projectId: 'default-project',
  name: '帖子列表',
  target: 'api',
  baseUrl: 'https://example.test/api.php',
  viewport: 'desktop',
  steps: [{ id: 'api-1', kind: 'apiRequest', instruction: '查询帖子', request: { action: 'list_post', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } }]
};

async function waitForTerminal(app, path) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await request(app).get(path).expect(200);
    if (['passed', 'failed'].includes(response.body.status)) return response.body;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`execution did not finish: ${path}`);
}

describe('execution API', () => {
  it('creates public performance assets and rejects runs until the selected pool is sufficient', async () => {
    const app = createApp({ runner: {}, store: createMemoryStore(), performanceSchedule: () => {} });
    const project = (await request(app).post('/api/projects').send({ name: '一日女友性能' }).expect(201)).body;
    const asset = {
      projectId: project.id, name: '登录浏览点赞基线', protocol: 'daygf', baseUrl: 'https://daygf.example.test', accountPoolId: 'pool-1',
      dataset: { postIds: [101], historyContentIds: [201] }, securityProbe: { enabled: false, postId: 999 }, ...DEFAULT_DAYGF_SCENARIO
    };

    const created = await request(app).post('/api/performance/assets').send(asset).expect(201);
    expect(created.body).toMatchObject({ projectId: project.id, protocol: 'daygf' });
    await request(app).post(`/api/performance/assets/${created.body.id}/runs`).expect(409);

    const pool = await request(app).post('/api/performance/pools').send({
      id: 'pool-1', projectId: project.id, name: '100 VU 账号池',
      accounts: Array.from({ length: 100 }, (_, index) => ({ username: `vu-${index}`, password: 'private-password' }))
    }).expect(201);
    expect(JSON.stringify(pool.body)).not.toContain('private-password');
    const run = await request(app).post(`/api/performance/assets/${created.body.id}/runs`).expect(202)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'queued', projectId: project.id }));
    await request(app).get(`/api/performance/runs/${run.body.id}/report`).expect(200).expect('content-type', /html/)
      .expect(({ text }) => expect(text).toContain('登录浏览点赞基线'));
    await request(app).get(`/api/performance/runs/${run.body.id}/report/download`).expect(200)
      .expect('content-disposition', /attachment/);
  });

  it('protects platform APIs and supports login, profile updates, password changes and logout', async () => {
    const app = createApp({ runner: {}, store: createMemoryStore(), authRequired: true });
    const agent = request.agent(app);

    await request(app).get('/api/projects').expect(401).expect({ error: '请先登录' });
    await agent.post('/api/auth/login').send({ username: 'admin', password: 'admin123' }).expect(200).expect(({ body }) => expect(body.user).toMatchObject({ username: 'admin', displayName: 'admin' }));
    await agent.put('/api/auth/profile').send({ displayName: '先锋营管理员', jobTitle: '质量负责人', email: 'admin@example.test' }).expect(200).expect(({ body }) => expect(body.user).toMatchObject({ displayName: '先锋营管理员' }));
    await agent.put('/api/auth/password').send({ currentPassword: 'admin123', newPassword: 'admin1234' }).expect(204);
    await agent.get('/api/projects').expect(401);
    await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin1234' }).expect(200);
  });
  it('manages projects and only returns the selected project cases', async () => {
    const app = createApp({ runner: {}, store: createMemoryStore() });
    const project = (await request(app).post('/api/projects').send({ name: '社区 CMS' }).expect(201)).body;
    const otherProject = (await request(app).post('/api/projects').send({ name: '商城 Web' }).expect(201)).body;
    const first = (await request(app).post('/api/cases').send({ ...webCase, projectId: project.id }).expect(201)).body;
    await request(app).post('/api/cases').send({ ...apiCase, projectId: otherProject.id }).expect(201);

    await request(app).get(`/api/cases?projectId=${project.id}`).expect(200).expect(({ body }) => {
      expect(body).toMatchObject([{ id: first.id, projectId: project.id }]);
    });
    await request(app).put(`/api/cases/${first.id}`).send({ ...webCase, projectId: 'missing-project' }).expect(400);
    await request(app).delete(`/api/projects/${project.id}`).expect(409);
    await request(app).post('/api/projects').send({ name: ' 社区 cms ' }).expect(409);
  });

  it('returns only public project Web authentication settings', async () => {
    const app = createApp({ runner: {}, store: createMemoryStore() });
    const project = (await request(app).post('/api/projects').send({
      name: '无极灯塔', webAuth: { provider: 'lighthouse', host: 'dt.chenmoyuan.tech' }
    }).expect(201)).body;

    expect(project).toMatchObject({ webAuth: { provider: 'lighthouse', host: 'dt.chenmoyuan.tech' } });
    expect(JSON.stringify(project)).not.toMatch(/password|secret|email/i);
  });

  it('rejects a batch that mixes projects before execution', async () => {
    const app = createApp({ runner: { execute: async () => ({}) }, store: createMemoryStore() });
    const firstProject = (await request(app).post('/api/projects').send({ name: '项目一' }).expect(201)).body;
    const secondProject = (await request(app).post('/api/projects').send({ name: '项目二' }).expect(201)).body;
    const first = (await request(app).post('/api/cases').send({ ...webCase, projectId: firstProject.id }).expect(201)).body;
    const second = (await request(app).post('/api/cases').send({ ...webCase, name: '详情验证', projectId: secondProject.id }).expect(201)).body;

    await request(app).post('/api/batches').send({ caseIds: [first.id, second.id] }).expect(409).expect(({ body }) => {
      expect(body.error).toBe('批量执行只能选择同一项目的用例');
    });
  });

  it('creates a web case, starts a run and returns its report', async () => {
    const app = createApp({
      runner: { execute: async () => ({ screenshot: 'evidence/s1.png' }) },
      store: createMemoryStore()
    });

    const created = await request(app).post('/api/cases').send(webCase).expect(201);
    const run = await request(app).post(`/api/cases/${created.body.id}/runs`).expect(202);

    expect(run.body).toMatchObject({ status: 'queued', startedAt: null, finishedAt: null });

    await expect(waitForTerminal(app, `/api/runs/${run.body.id}`)).resolves.toMatchObject({ status: 'passed' });
    await request(app)
      .get(`/api/runs/${run.body.id}/report`)
      .expect(200)
      .expect('content-type', /html/)
      .expect((response) => expect(response.text).toContain('首页验证'));
  });

  it('records explicit mutation authorization for single and batch API runs', async () => {
    const app = createApp({ runner: { api: { execute: async () => ({}) } }, store: createMemoryStore(), executionSchedule: () => {} });
    const mutatingCase = {
      ...apiCase,
      name: '通过帖子审核',
      steps: [{ id: 'approve', kind: 'apiRequest', instruction: '通过帖子', request: { action: 'pass_post', method: 'POST', payload: { id: [1] }, expectedStatus: 1, safety: 'mutating' } }]
    };
    const created = (await request(app).post('/api/cases').send(mutatingCase).expect(201)).body;

    await request(app).post(`/api/cases/${created.id}/runs`).send({ allowMutations: true }).expect(202)
      .expect(({ body }) => expect(body).toMatchObject({ allowMutations: true }));
    await request(app).post('/api/batches').send({ caseIds: [created.id] }).expect(202)
      .expect(({ body }) => expect(body).toMatchObject({ allowMutations: false }));
  });

  it('rejects a malformed web case before creating a run', async () => {
    const app = createApp({ runner: {}, store: createMemoryStore() });

    await request(app).post('/api/cases').send({ target: 'web' }).expect(400);
  });

  it('lists saved test cases for the console', async () => {
    const app = createApp({ runner: {}, store: createMemoryStore() });
    await request(app).post('/api/cases').send(webCase).expect(201);

    await request(app)
      .get('/api/cases')
      .expect(200)
      .expect((response) => {
        expect(response.body).toHaveLength(1);
        expect(response.body[0]).toMatchObject({ name: '首页验证', target: 'web' });
      });
  });

  it('updates, searches, and deletes a test case', async () => {
    const app = createApp({ runner: {}, store: createMemoryStore() });
    const created = (await request(app).post('/api/cases').send(webCase).expect(201)).body;

    await request(app).put(`/api/cases/${created.id}`).send({ ...webCase, name: '首页验证 v2' }).expect(200);
    await request(app).get('/api/cases?q=v2').expect(200).expect((response) => {
      expect(response.body).toMatchObject([{ id: created.id, name: '首页验证 v2' }]);
    });
    await request(app).delete(`/api/cases/${created.id}`).expect(204);
    await request(app).get(`/api/cases/${created.id}`).expect(404);
    await request(app).post(`/api/cases/${created.id}/runs`).expect(404);
  });

  it('keeps a report accessible after its case definition is deleted', async () => {
    const app = createApp({ runner: { execute: async () => ({}) }, store: createMemoryStore() });
    const created = (await request(app).post('/api/cases').send(webCase).expect(201)).body;
    const run = await request(app).post(`/api/cases/${created.id}/runs`).expect(202);

    await waitForTerminal(app, `/api/runs/${run.body.id}`);
    await request(app).delete(`/api/cases/${created.id}`).expect(204);
    await request(app).get(`/api/runs/${run.body.id}/report`).expect(200).expect((response) => {
      expect(response.text).toContain('首页验证');
    });
  });

  it('creates, lists, and retrieves a serial batch with linked runs', async () => {
    const app = createApp({
      runner: { execute: async () => ({ screenshot: 'evidence/step.png' }) },
      store: createMemoryStore()
    });
    const first = (await request(app).post('/api/cases').send(webCase).expect(201)).body;
    const second = (await request(app).post('/api/cases').send({ ...webCase, name: '详情验证' }).expect(201)).body;

    const batch = await request(app)
      .post('/api/batches')
      .send({ name: '冒烟回归', caseIds: [first.id, second.id] })
      .expect(202);

    expect(batch.body).toMatchObject({ name: '冒烟回归', caseIds: [first.id, second.id], status: 'queued', runIds: [] });
    const completed = await waitForTerminal(app, `/api/batches/${batch.body.id}`);
    expect(completed.runIds).toHaveLength(2);

    await request(app)
      .get('/api/batches')
      .expect(200)
      .expect((response) => expect(response.body[0].id).toBe(batch.body.id));

    await request(app)
      .get(`/api/batches/${batch.body.id}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.id).toBe(batch.body.id);
        expect(response.body.runs).toHaveLength(2);
      });
  });

  it('serves one summary report for every run in a batch', async () => {
    const app = createApp({ runner: { execute: async () => ({}) }, store: createMemoryStore() });
    const first = (await request(app).post('/api/cases').send(webCase).expect(201)).body;
    const second = (await request(app).post('/api/cases').send({ ...webCase, name: '详情验证' }).expect(201)).body;
    const batch = (await request(app).post('/api/batches').send({ name: '项目回归', caseIds: [first.id, second.id] }).expect(202)).body;

    await waitForTerminal(app, `/api/batches/${batch.id}`);

    await request(app)
      .get(`/api/batches/${batch.id}/report`)
      .expect(200)
      .expect('content-type', /html/)
      .expect((response) => {
        expect(response.text).toContain('项目回归');
        expect(response.text).toContain('首页验证');
        expect(response.text).toContain('详情验证');
      });
    await request(app).get('/api/batches/missing/report').expect(404);
  });

  it('downloads the same HTML as a single-run report with a safe filename', async () => {
    const store = createMemoryStore();
    store.saveRun({
      id: 'download-run', caseId: 'deleted-case', caseName: '登录/回归', projectId: 'default-project', target: 'web',
      status: 'passed', startedAt: null, finishedAt: null, variables: {}, steps: []
    });
    const app = createApp({ runner: {}, store });

    const preview = await request(app).get('/api/runs/download-run/report').expect(200);
    await request(app).get('/api/runs/download-run/report/download').expect(200)
      .expect('content-type', /html/)
      .expect('content-disposition', /attachment/)
      .expect('content-disposition', /filename\*=UTF-8''/)
      .expect((response) => {
        expect(response.headers['content-disposition']).toContain(encodeURIComponent('登录_回归-测试报告.html'));
        expect(response.text).toBe(preview.text);
      });
    await request(app).get('/api/runs/missing/report/download').expect(404);
  });

  it('downloads the same HTML as a batch report', async () => {
    const store = createMemoryStore();
    store.saveRun({ id: 'batch-run', caseId: 'case-1', caseName: '查询', projectId: 'default-project', target: 'api', status: 'passed', startedAt: null, finishedAt: null, variables: {}, steps: [] });
    store.saveBatch({ id: 'download-batch', name: '批量/回归', status: 'passed', runIds: ['batch-run'] });
    const app = createApp({ runner: {}, store });

    const preview = await request(app).get('/api/batches/download-batch/report').expect(200);
    await request(app).get('/api/batches/download-batch/report/download').expect(200)
      .expect('content-disposition', /attachment/)
      .expect((response) => expect(response.text).toBe(preview.text));
    await request(app).get('/api/batches/missing/report/download').expect(404);
  });

  it('filters batch history by its persisted project ID', async () => {
    const app = createApp({ runner: { execute: async () => ({}) }, store: createMemoryStore() });
    const firstProject = (await request(app).post('/api/projects').send({ name: '项目一' }).expect(201)).body;
    const secondProject = (await request(app).post('/api/projects').send({ name: '项目二' }).expect(201)).body;
    const firstCase = (await request(app).post('/api/cases').send({ ...webCase, projectId: firstProject.id }).expect(201)).body;
    const secondCase = (await request(app).post('/api/cases').send({ ...webCase, name: '项目二用例', projectId: secondProject.id }).expect(201)).body;
    const firstBatch = (await request(app).post('/api/batches').send({ caseIds: [firstCase.id] }).expect(202)).body;
    await request(app).post('/api/batches').send({ caseIds: [secondCase.id] }).expect(202);

    await request(app).get('/api/batches').expect(200).expect(({ body }) => expect(body).toHaveLength(2));
    await request(app).get(`/api/batches?projectId=${firstProject.id}`).expect(200).expect(({ body }) => {
      expect(body).toMatchObject([{ id: firstBatch.id, projectId: firstProject.id }]);
      expect(body).toHaveLength(1);
    });
  });

  it('lists persisted execution, dashboard, and report summaries', async () => {
    const store = createMemoryStore();
    store.saveCase(webCase);
    const startedAt = new Date(Date.now() - 20_000).toISOString();
    const finishedAt = new Date(Date.now() - 10_000).toISOString();
    store.saveRun({
      id: 'failed-run', caseId: webCase.id, caseName: webCase.name, projectId: 'default-project', target: 'web', status: 'failed',
      startedAt, finishedAt, variables: {},
      steps: [{ id: 's1', status: 'failed', attempts: 2, error: '页面未就绪', logs: [] }]
    });
    const app = createApp({ runner: {}, store });

    await request(app).get('/api/executions?projectId=default-project&target=web').expect(200).expect(({ body }) => {
      expect(body).toMatchObject([{ id: 'failed-run', kind: 'run', completedSteps: 1, totalSteps: 1 }]);
    });
    await request(app).get('/api/dashboard?range=30d').expect(200).expect(({ body }) => {
      expect(body).toMatchObject({ completedRuns: 1, failedRuns: 1, automatedCaseCount: 1 });
    });
    await request(app).get('/api/reports?projectId=default-project&status=failed&range=30d').expect(200).expect(({ body }) => {
      expect(body).toMatchObject([{ id: 'failed-run', reportUrl: '/api/runs/failed-run/report' }]);
    });
  });

  it('returns selected execution runs and ordered step snapshots', async () => {
    const store = createMemoryStore();
    store.saveCase(webCase);
    store.saveRun({ id: 'run-1', caseId: webCase.id, caseName: webCase.name, projectId: 'default-project', target: 'web', status: 'failed', startedAt: '2026-07-19T10:00:00.000Z', finishedAt: '2026-07-19T10:00:10.000Z', variables: {}, steps: [{ id: 's1', status: 'failed', attempts: 2, error: '页面未就绪', logs: [] }] });
    store.saveBatch({ id: 'batch-1', projectId: 'default-project', target: 'web', name: '回归任务', caseIds: [webCase.id], status: 'failed', runIds: ['run-1'], startedAt: '2026-07-19T10:00:00.000Z', finishedAt: '2026-07-19T10:00:10.000Z' });
    const app = createApp({ runner: {}, store });

    await request(app).get('/api/executions/batch-1').expect(200).expect(({ body }) => {
      expect(body).toMatchObject({ kind: 'batch', task: { id: 'batch-1', status: 'failed' }, runs: [{ id: 'run-1', steps: [{ id: 's1', status: 'failed', error: '页面未就绪' }] }] });
    });
    await request(app).get('/api/executions/missing').expect(404);
  });

  it('rejects empty, duplicate, and unknown batch selections', async () => {
    const app = createApp({ runner: {}, store: createMemoryStore() });
    const created = await request(app).post('/api/cases').send(webCase).expect(201);

    await request(app).post('/api/batches').send({ caseIds: [] }).expect(400);
    await request(app).post('/api/batches').send({ caseIds: [created.body.id, created.body.id] }).expect(400);
    await request(app).post('/api/batches').send({ caseIds: ['unknown-case'] }).expect(400);
  });

  it('rejects a batch that mixes Web UI and API test cases', async () => {
    const app = createApp({ runner: { web: { execute: async () => ({}) }, api: { execute: async () => ({}) } }, store: createMemoryStore() });
    const web = (await request(app).post('/api/cases').send(webCase).expect(201)).body;
    const api = (await request(app).post('/api/cases').send(apiCase).expect(201)).body;

    await request(app).post('/api/batches').send({ caseIds: [web.id, api.id] }).expect(400).expect((response) => {
      expect(response.body.error).toBe('batch cases must share one target');
    });
  });

  it('rejects a batch that mixes CMS and Editorial API protocols', async () => {
    const app = createApp({ runner: { api: { execute: async () => ({}) } }, store: createMemoryStore(), executionSchedule: () => {} });
    const cms = (await request(app).post('/api/cases').send(apiCase).expect(201)).body;
    const editorial = (await request(app).post('/api/cases').send({
      ...apiCase,
      name: 'AI 评论概览',
      baseUrl: 'https://editorial.example.test',
      steps: [{ id: 'summary', kind: 'apiRequest', instruction: '查询概览', request: {
        protocol: 'editorial', action: 'ai-comment/summary', method: 'GET', payload: {}, expectedStatus: 200, safety: 'readonly'
      } }]
    }).expect(201)).body;

    await request(app).post('/api/batches').send({ caseIds: [cms.id, editorial.id] }).expect(409)
      .expect({ error: '批量执行只能选择同一接口协议的用例' });
  });

  it('reports whether the Web UI runner is configured', async () => {
    const app = createApp({
      runner: {},
      store: createMemoryStore(),
      runnerStatus: { ready: false, message: 'missing MIDSCENE_MODEL_API_KEY' }
    });

    await request(app)
      .get('/api/health')
      .expect(200)
      .expect({ webRunner: { ready: false, message: 'missing MIDSCENE_MODEL_API_KEY' }, cmsRunner: { ready: false, message: 'CMS API runner is not configured' } });
  });

  it('reports the sanitized CMS runner configuration state', async () => {
    const app = createApp({
      runner: {},
      store: createMemoryStore(),
      runnerStatus: { ready: true, message: 'ready' },
      cmsRunnerStatus: { ready: false, message: 'missing CMS_AES_KEY' }
    });

    await request(app)
      .get('/api/health')
      .expect(200)
      .expect({ webRunner: { ready: true, message: 'ready' }, cmsRunner: { ready: false, message: 'missing CMS_AES_KEY' } });
  });

  it('exposes only redacted model configuration details', async () => {
    const app = createApp({
      runner: {},
      store: createMemoryStore(),
      modelConfig: {
        source: 'WUJI',
        baseUrl: 'https://model.example/api',
        modelName: 'vision-model',
        modelFamily: 'gemini',
        apiKey: 'provider-secret-key'
      }
    });

    await request(app).get('/api/model-config').expect(200).expect(({ body }) => {
      expect(body).toEqual({
        source: 'WUJI',
        baseUrl: 'https://model.example/api',
        modelName: 'vision-model',
        modelFamily: 'gemini',
        apiKey: 'pro****************',
        hasApiKey: true
      });
      expect(JSON.stringify(body)).not.toContain('provider-secret-key');
    });
  });

  it('requires an authenticated session to update model configuration', async () => {
    const saved = [];
    const app = createApp({
      runner: {},
      store: createMemoryStore(),
      authRequired: true,
      modelConfigManager: {
        getPublicConfig: () => ({ source: 'PLATFORM', baseUrl: 'https://model.example', modelName: 'vision', modelFamily: '', apiKey: 'mod****************', hasApiKey: true }),
        async update(input) { saved.push(input); return this.getPublicConfig(); }
      }
    });

    await request(app).put('/api/model-config').send({ baseUrl: 'https://model.example', modelName: 'vision' }).expect(401);
    const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' }).expect(200);
    await request(app).put('/api/model-config').set('Cookie', login.headers['set-cookie']).send({ baseUrl: 'https://model.example', modelName: 'vision' }).expect(200).expect(({ body }) => expect(body.hasApiKey).toBe(true));
    expect(saved).toEqual([{ baseUrl: 'https://model.example', modelName: 'vision' }]);
  });

  it('seeds read-only CMS cases idempotently without running them', () => {
    const store = createMemoryStore();
    const cases = cmsWhitebagCases({ baseUrl: 'https://example.test/api.php' });

    createApp({ runner: {}, store, cmsSeedCases: cases });
    createApp({ runner: {}, store, cmsSeedCases: cases });

    expect(store.listCases().map((testCase) => testCase.id)).toEqual(cases.map((testCase) => testCase.id));
    expect(store.listCases().every((testCase) => testCase.target === 'api' && testCase.steps.every((step) => step.request.safety === 'readonly'))).toBe(true);
  });

  it('serves the test console from the same origin as the API', async () => {
    const app = createApp({ runner: {}, store: createMemoryStore() });

    await request(app).get('/').expect(200).expect('content-type', /html/).expect((response) => {
      expect(response.text).toContain('先锋营自动化测试平台');
    });
  });

  it('serves only evidence registered to a run', async () => {
    const evidenceDir = await mkdtemp(join(tmpdir(), 'novatest-evidence-'));
    try {
      await mkdir(join(evidenceDir, 'run-1'));
      await writeFile(join(evidenceDir, 'run-1', 's1-attempt-1.png'), 'png');
      const store = createMemoryStore();
      store.saveRun({
        id: 'run-1', caseId: 'case-1', caseName: '首页验证', status: 'passed', startedAt: '2026-07-17T00:00:00.000Z', variables: {},
        steps: [{ id: 's1', status: 'passed', attempts: 1, screenshot: 'run-1/s1-attempt-1.png', screenshots: [{ path: 'run-1/s1-attempt-1.png', attempt: 1, phase: 'passed' }], logs: [] }]
      });
      const app = createApp({ runner: {}, store, evidenceDir });

      await request(app).get('/api/runs/run-1/evidence/s1-attempt-1.png').expect(200);
      await request(app).get('/api/runs/run-1/evidence/other.png').expect(404);
      await request(app).get('/api/runs/run-1/evidence/..%2Fpackage.json').expect(404);
    } finally {
      await rm(evidenceDir, { recursive: true, force: true });
    }
  });

  it('renders escaped instructions with screenshot thumbnail links', () => {
    const report = renderReport({
      id: 'run-1', status: 'passed', startedAt: '2026-07-17T00:00:00.000Z', variables: {},
      steps: [{ id: 's1', instruction: '<script>', status: 'passed', attempts: 1, screenshots: [{ path: 'run-1/s1-attempt-1.png', attempt: 1, phase: 'passed' }] }]
    }, '首页验证');

    expect(report).toContain('&lt;script&gt;');
    expect(report).toContain('/api/runs/run-1/evidence/s1-attempt-1.png');
    expect(report).toContain('<img');
  });

  it('renders paired reference and execution images for visual checks', () => {
    const report = renderReport({
      id: 'run-visual-1', status: 'failed', startedAt: '2026-07-26T00:00:00.000Z', finishedAt: '2026-07-26T00:00:01.000Z', variables: {},
      steps: [{
        id: 's1', instruction: '验证新任务', status: 'failed', attempts: 1, error: '未找到新任务标题', screenshots: [],
        visualChecks: [{ id: 'v1', status: 'failed', reason: '列表中没有目标标题', baselinePath: 'case-1/baseline.png', screenshot: 'run-visual-1/s1-attempt-1.png' }]
      }]
    }, '任务创建验证');

    expect(report).toContain('/api/cases/case-1/assets/baseline.png?runId=run-visual-1');
    expect(report).toContain('/api/runs/run-visual-1/evidence/s1-attempt-1.png');
    expect(report).toContain('视觉校验失败');
    expect(report).toContain('列表中没有目标标题');
  });

  it('does not render a protected login value from run variables', () => {
    const report = renderReport({
      id: 'run-1', status: 'passed', startedAt: '2026-07-17T00:00:00.000Z',
      variables: { runId: 'run-1', lighthousePassword: 'private-value' }, steps: []
    }, '首页验证');

    expect(report).not.toContain('private-value');
    expect(report).toContain('********');
  });

  it('renders redacted API request and response evidence in a report', () => {
    const report = renderReport({
      id: 'api-run-1', status: 'passed', startedAt: '2026-07-17T00:00:00.000Z', variables: {},
      steps: [{ id: 'api-1', status: 'passed', attempts: 1, api: {
        action: 'list_post', httpStatus: 200, businessStatus: 1, durationMs: 120,
        request: { token: 'secret-token' },
        response: { data: { config: { featureEnabled: true } }, token: 'secret-token' }
      } }]
    }, '帖子列表');

    expect(report).toContain('list_post');
    expect(report).toContain('HTTP 200');
    expect(report).toContain('响应内容');
    expect(report).toContain('********');
    expect(report).toContain('&quot;config&quot;');
    expect(report).toContain('&quot;featureEnabled&quot;');
    expect(report).not.toContain('secret-token');
    expect(report).not.toContain('响应摘要');
    expect(report).not.toContain('解密后响应');
  });

  it('renders redacted request and response evidence for a failed API step', () => {
    const report = renderReport({
      id: 'api-run-failed', status: 'failed', startedAt: '2026-07-17T00:00:00.000Z', variables: {},
      steps: [{ id: 'api-1', status: 'failed', attempts: 2, error: 'API assertion failed: list_post', api: {
        action: 'list_post', httpStatus: 200, businessStatus: 0, durationMs: 120,
        request: { token: 'synthetic-token', password: 'synthetic-password', secret: '123456' },
        response: { status: 0, token: 'synthetic-token', secret: '123456' }
      } }]
    }, '帖子列表');

    expect(report).toContain('请求摘要');
    expect(report).toContain('响应内容');
    expect(report).toContain('********');
    expect(report).not.toContain('synthetic-token');
    expect(report).not.toContain('synthetic-password');
    expect(report).not.toContain('123456');
  });

  it('renders BY business-code evidence with redacted contact data', () => {
    const report = renderReport({
      id: 'by-run', status: 'failed', startedAt: null, variables: {}, steps: [{
        id: 'report', status: 'failed', attempts: 1, error: 'BY business assertion failed', api: {
          action: '/c-api/v1/reports', method: 'POST', httpStatus: 200, businessStatus: 40000, durationMs: 15,
          request: { contact: 'private' }, response: { code: 40000, data: { contact: 'private' } }
        }
      }]
    }, 'BY 举报校验');

    expect(report).toContain('业务状态 40000');
    expect(report).toContain('********');
    expect(report).not.toContain('private');
  });

  it('renders a single report download link and jumps from status chips to matching steps', () => {
    const report = renderReport({
      id: 'run-export', status: 'failed', startedAt: '2026-08-04T00:00:00.000Z',
      finishedAt: '2026-08-04T00:00:01.000Z', variables: {},
      steps: [
        { id: 'passed-step', status: 'passed', attempts: 1, logs: [] },
        { id: 'failed-step', status: 'failed', attempts: 1, logs: [] }
      ]
    }, '导出用例');

    expect(report).toContain('href="/api/runs/run-export/report/download"');
    expect(report).toContain('href="#step-passed-step"');
    expect(report).toContain('href="#step-failed-step"');
    expect(report).toContain('status-chip skipped disabled');
    expect(report).toContain('id="step-failed-step"');
  });

  it('renders batch status chips that link to matching result sections', () => {
    const report = renderBatchReport(
      { id: 'batch-export', name: '导出批量', status: 'failed', startedAt: null, finishedAt: null },
      [
        { id: 'run-passed', caseName: '通过用例', status: 'passed', startedAt: null, finishedAt: null, steps: [] },
        { id: 'run-failed', caseName: '失败用例', status: 'failed', startedAt: null, finishedAt: null, steps: [] }
      ]
    );

    expect(report).toContain('href="/api/batches/batch-export/report/download"');
    expect(report).toContain('href="#batch-status-passed"');
    expect(report).toContain('href="#batch-status-failed"');
    expect(report).toContain('status-chip skipped disabled');
    expect(report).toContain('id="run-run-failed"');
  });

  it('groups batch report runs by final status while retaining order within each group', () => {
    const report = renderBatchReport({ id: 'batch-grouped', name: '状态归类', status: 'failed' }, [
      { id: 'pass-first', caseName: '通过一', status: 'passed', steps: [] },
      { id: 'fail-first', caseName: '失败一', status: 'failed', steps: [] },
      { id: 'skip-first', caseName: '跳过一', status: 'skipped', steps: [] },
      { id: 'pass-second', caseName: '通过二', status: 'passed', steps: [] }
    ]);

    expect(report).toContain('id="batch-status-failed"');
    expect(report).toContain('id="batch-status-skipped"');
    expect(report).toContain('id="batch-status-passed"');
    expect(report.indexOf('失败用例（1）')).toBeLessThan(report.indexOf('跳过用例（1）'));
    expect(report.indexOf('跳过用例（1）')).toBeLessThan(report.indexOf('通过用例（2）'));
    expect(report.indexOf('通过一')).toBeLessThan(report.indexOf('通过二'));
    expect(report).toContain('href="#batch-status-failed"');
  });

  it('renders a batch report with Shanghai local time and ordered run details', () => {
    const report = renderBatchReport(
      { id: 'batch-1', name: '查询回归', status: 'failed', startedAt: '2026-07-18T05:40:00.000Z', finishedAt: '2026-07-18T05:41:02.000Z', caseIds: ['case-1', 'case-2'] },
      [
        { id: 'run-1', caseId: 'case-1', caseName: '帖子列表查询', status: 'passed', startedAt: '2026-07-18T05:40:00.000Z', finishedAt: '2026-07-18T05:40:10.000Z', variables: {}, steps: [{ id: 'list_post', instruction: '帖子列表查询', status: 'passed', attempts: 1, api: { action: 'list_post', httpStatus: 200, businessStatus: 1, durationMs: 100, request: { token: 'synthetic-session-value' }, response: { status: 1 } } }] },
        { id: 'run-2', caseId: 'case-2', caseName: '评论列表查询', status: 'failed', startedAt: '2026-07-18T05:40:10.000Z', finishedAt: '2026-07-18T05:41:02.000Z', variables: {}, steps: [{ id: 'list_post_comments', instruction: '评论列表查询', status: 'failed', attempts: 2, error: 'API assertion failed', api: { action: 'list_post_comments', httpStatus: 200, businessStatus: 0, durationMs: 80, request: { token: 'synthetic-session-value' }, response: { status: 0 } } }] }
      ]
    );

    expect(report).toContain('查询回归');
    expect(report).toContain('class="status-chip passed" href="#batch-status-passed"><strong>1</strong> 通过');
    expect(report).toContain('class="status-chip skipped disabled" aria-disabled="true"><strong>0</strong> 跳过');
    expect(report).toContain('class="status-chip failed" href="#batch-status-failed"><strong>1</strong> 失败');
    expect(report).toContain('2026-07-18 13:40:00');
    expect(report).toContain('帖子列表查询');
    expect(report).toContain('评论列表查询');
    expect(report).toContain('********');
    expect(report).not.toContain('synthetic-session-value');
  });

  it('renders skipped prerequisite evidence separately from API failures', () => {
    const report = renderBatchReport(
      { id: 'batch-1', name: '审核回归', status: 'passed', startedAt: '2026-07-18T05:40:00.000Z', finishedAt: '2026-07-18T05:41:02.000Z', caseIds: ['case-1', 'case-2', 'case-3'] },
      [
        { id: 'run-1', caseName: '帖子审核', status: 'passed', startedAt: '2026-07-18T05:40:00.000Z', finishedAt: '2026-07-18T05:40:10.000Z', steps: [] },
        { id: 'run-2', caseName: '用户资料审核', status: 'skipped', startedAt: '2026-07-18T05:40:10.000Z', finishedAt: '2026-07-18T05:40:20.000Z', steps: [{ id: 'select', status: 'skipped', attempts: 1, error: '前置数据不足：没有待处理记录', api: { action: 'list_member_update_log', httpStatus: 200, businessStatus: 1, durationMs: 80, request: { token: 'sensitive-token' }, response: { data: { list: [] }, token: 'sensitive-token' } } }] },
        { id: 'run-3', caseName: '评论审核', status: 'failed', startedAt: '2026-07-18T05:40:20.000Z', finishedAt: '2026-07-18T05:41:02.000Z', steps: [] }
      ]
    );

    expect(report).toContain('前置数据不足');
    expect(report).toContain('<strong>1</strong> 跳过');
    expect(report).toContain('<strong>1</strong> 失败');
    expect(report).not.toContain('sensitive-token');
  });

  it('lists skipped single-run reports for prerequisite outcomes', async () => {
    const store = createMemoryStore();
    store.saveRun({ id: 'skipped-run', caseId: 'case-1', caseName: '用户资料审核', projectId: 'default-project', target: 'api', status: 'skipped', startedAt: '2026-07-20T00:00:00.000Z', finishedAt: '2026-07-20T00:00:01.000Z', variables: {}, steps: [] });
    const app = createApp({ runner: {}, store });

    await request(app).get('/api/reports?range=30d').expect(200).expect(({ body }) => {
      expect(body).toMatchObject([{ id: 'skipped-run', status: 'skipped', skippedCases: 1 }]);
    });
  });

  it('uploads a PNG visual baseline for an existing case', async () => {
    const app = createApp({ runner: {}, store: createMemoryStore() });
    const created = (await request(app).post('/api/cases').send(webCase).expect(201)).body;

    await request(app)
      .post(`/api/cases/${created.id}/assets`)
      .attach('file', Buffer.from([137, 80, 78, 71]), { filename: 'baseline.png', contentType: 'image/png' })
      .expect(201)
      .expect((response) => expect(response.body).toMatchObject({ source: 'upload', assetPath: expect.stringMatching(new RegExp(`^${created.id}/`)) }));
  });

  it('serves only case-scoped visual assets and retains report baselines by run ID', async () => {
    const caseAssetsDir = await mkdtemp(join(tmpdir(), 'novatest-case-assets-'));
    const store = createMemoryStore();
    const app = createApp({ runner: {}, store, caseAssetsDir });
    try {
      const created = (await request(app).post('/api/cases').send(webCase).expect(201)).body;
      const visualCheck = { id: 'baseline-1', assetPath: `${created.id}/baseline-1.png`, source: 'upload', description: '任务列表显示创建成功状态' };
      await request(app).put(`/api/cases/${created.id}`).send({ ...created, steps: [{ ...created.steps[0], visualChecks: [visualCheck] }] }).expect(200);
      await mkdir(join(caseAssetsDir, created.id), { recursive: true });
      await writeFile(join(caseAssetsDir, created.id, 'baseline-1.png'), Buffer.from([137, 80, 78, 71]));

      await request(app).get(`/api/cases/${created.id}/assets/baseline-1.png`).expect(200).expect('content-type', /image\/png/);
      await request(app).get(`/api/cases/${created.id}/assets/..%2Fbaseline-1.png`).expect(404);
      await request(app).get(`/api/cases/${created.id}/assets/other.png`).expect(404);

      store.saveRun({
        id: 'run-visual-1', caseId: created.id, caseName: created.name, projectId: created.projectId, target: 'web', status: 'passed',
        startedAt: '2026-07-26T00:00:00.000Z', finishedAt: '2026-07-26T00:00:01.000Z', variables: {},
        steps: [{ id: 's1', status: 'passed', attempts: 1, logs: [], visualChecks: [{ ...visualCheck, status: 'passed', reason: '页面状态一致', baselinePath: visualCheck.assetPath, screenshot: 'run-visual-1/s1-attempt-1.png' }] }]
      });
      await request(app).delete(`/api/cases/${created.id}`).expect(204);
      await request(app).get(`/api/cases/${created.id}/assets/baseline-1.png?runId=run-visual-1`).expect(200).expect('content-type', /image\/png/);
    } finally {
      await rm(caseAssetsDir, { recursive: true, force: true });
    }
  });
});
