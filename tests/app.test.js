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
});
