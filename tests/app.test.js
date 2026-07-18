import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, createMemoryStore } from '../server/app.js';
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

describe('execution API', () => {
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

    await request(app)
      .get(`/api/runs/${run.body.id}`)
      .expect(200)
      .expect((response) => expect(response.body.status).toBe('passed'));
    await request(app)
      .get(`/api/runs/${run.body.id}/report`)
      .expect(200)
      .expect('content-type', /html/)
      .expect((response) => expect(response.text).toContain('首页验证'));
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

    expect(batch.body).toMatchObject({ name: '冒烟回归', caseIds: [first.id, second.id], status: 'passed' });
    expect(batch.body.runIds).toHaveLength(2);

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
      expect(response.text).toContain('NovaTest');
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

  it('renders a batch report with Shanghai local time and ordered run details', () => {
    const report = renderBatchReport(
      { id: 'batch-1', name: '查询回归', status: 'failed', startedAt: '2026-07-18T05:40:00.000Z', finishedAt: '2026-07-18T05:41:02.000Z', caseIds: ['case-1', 'case-2'] },
      [
        { id: 'run-1', caseId: 'case-1', caseName: '帖子列表查询', status: 'passed', startedAt: '2026-07-18T05:40:00.000Z', finishedAt: '2026-07-18T05:40:10.000Z', variables: {}, steps: [{ id: 'list_post', instruction: '帖子列表查询', status: 'passed', attempts: 1, api: { action: 'list_post', httpStatus: 200, businessStatus: 1, durationMs: 100, request: { token: 'synthetic-session-value' }, response: { status: 1 } } }] },
        { id: 'run-2', caseId: 'case-2', caseName: '评论列表查询', status: 'failed', startedAt: '2026-07-18T05:40:10.000Z', finishedAt: '2026-07-18T05:41:02.000Z', variables: {}, steps: [{ id: 'list_post_comments', instruction: '评论列表查询', status: 'failed', attempts: 2, error: 'API assertion failed', api: { action: 'list_post_comments', httpStatus: 200, businessStatus: 0, durationMs: 80, request: { token: 'synthetic-session-value' }, response: { status: 0 } } }] }
      ]
    );

    expect(report).toContain('查询回归');
    expect(report).toContain('<strong>1</strong> 通过 · <strong>1</strong> 失败');
    expect(report).toContain('2026-07-18 13:40:00');
    expect(report).toContain('帖子列表查询');
    expect(report).toContain('评论列表查询');
    expect(report).toContain('********');
    expect(report).not.toContain('synthetic-session-value');
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
});
