import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, createMemoryStore } from '../server/app.js';

const webCase = {
  name: '首页验证',
  target: 'web',
  baseUrl: 'https://example.test',
  viewport: 'desktop',
  steps: [{ id: 's1', kind: 'assert', instruction: '页面显示标题' }]
};

describe('execution API', () => {
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

  it('rejects empty, duplicate, and unknown batch selections', async () => {
    const app = createApp({ runner: {}, store: createMemoryStore() });
    const created = await request(app).post('/api/cases').send(webCase).expect(201);

    await request(app).post('/api/batches').send({ caseIds: [] }).expect(400);
    await request(app).post('/api/batches').send({ caseIds: [created.body.id, created.body.id] }).expect(400);
    await request(app).post('/api/batches').send({ caseIds: ['unknown-case'] }).expect(400);
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
      .expect({ webRunner: { ready: false, message: 'missing MIDSCENE_MODEL_API_KEY' } });
  });

  it('serves the test console from the same origin as the API', async () => {
    const app = createApp({ runner: {}, store: createMemoryStore() });

    await request(app).get('/').expect(200).expect('content-type', /html/).expect((response) => {
      expect(response.text).toContain('NovaTest');
    });
  });
});
