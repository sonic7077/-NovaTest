import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../server/app.js';
import { BatchService } from '../server/services/batch-service.js';
import { decryptPayload, encryptPayload } from '../server/services/cms-crypto.js';
import { CmsApiRunner } from '../server/runners/cms-api-runner.js';
import { DaygfApiRunner } from '../server/runners/daygf-api-runner.js';

const firstCase = {
  id: 'case-1',
  projectId: 'default-project',
  name: '失败用例',
  target: 'web',
  baseUrl: 'https://example.test',
  viewport: 'desktop',
  steps: [{ id: 's1', kind: 'action', instruction: '点击不存在的按钮' }]
};

const secondCase = {
  ...firstCase,
  id: 'case-2',
  name: '后续用例',
  steps: [{ id: 's2', kind: 'assert', instruction: '页面显示标题' }]
};

describe('BatchService', () => {
  it('runs cases in order and continues after a failed run', async () => {
    const executedCases = [];
    const store = createMemoryStore();
    const runner = {
      execute: async (_step, context) => {
        executedCases.push(context.testCase.id);
        if (context.testCase.id === firstCase.id) throw new Error('element missing');
        return {};
      }
    };

    const batch = await new BatchService({ runner, store }).start({
      name: '冒烟回归',
      projectId: 'default-project',
      caseIds: [firstCase.id, secondCase.id],
      cases: [firstCase, secondCase]
    });

    expect(executedCases).toEqual(['case-1', 'case-1', 'case-2']);
    expect(batch).toMatchObject({
      name: '冒烟回归',
      projectId: 'default-project',
      caseIds: ['case-1', 'case-2'],
      status: 'failed'
    });
    expect(batch.startedAt).toEqual(expect.any(String));
    expect(batch.finishedAt).toEqual(expect.any(String));
    expect(batch.runIds).toHaveLength(2);
    expect(store.getRun(batch.runIds[0])).toMatchObject({ caseId: firstCase.id, status: 'failed' });
    expect(store.getRun(batch.runIds[1])).toMatchObject({ caseId: secondCase.id, status: 'passed' });
  });

  it('marks a batch passed only when every case run passes', async () => {
    const store = createMemoryStore();
    const batch = await new BatchService({ runner: { execute: async () => ({}) }, store }).start({
      name: '全量通过',
      projectId: 'default-project',
      caseIds: [secondCase.id],
      cases: [secondCase]
    });

    expect(batch.status).toBe('passed');
    expect(batch.runIds).toHaveLength(1);
  });

  it('shares one CMS login session across all API cases in a batch', async () => {
    const cryptoConfig = { key: '1234567890abcdef', iv: 'abcdef1234567890', appKey: 'app-key' };
    const googleSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const actions = [];
    const api = new CmsApiRunner({
      config: { ...cryptoConfig, googleSecret, username: 'admin', password: 'password', oauthId: 'qa', oauthType: 'web', version: '1.0.0' },
      fetchImpl: async (url, options) => {
        const payload = JSON.parse(decryptPayload(new URLSearchParams(options.body).get('data'), cryptoConfig));
        const action = new URL(url).pathname.split('/').at(-1);
        actions.push(action);
        const data = action === 'loginByPassword' ? 'batch-token' : { ok: true };
        return { ok: true, status: 200, json: async () => ({ status: 1, crypt: true, data: encryptPayload(JSON.stringify(data), cryptoConfig) }) };
      }
    });
    const cases = ['config', 'list_post'].map((action, index) => ({
      id: `api-${index + 1}`, projectId: 'default-project', name: action, target: 'api', baseUrl: 'https://example.test/api.php', viewport: 'desktop',
      steps: [{ id: action, kind: 'apiRequest', instruction: action, request: { action, method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } }]
    }));
    const store = createMemoryStore();

    const batch = await new BatchService({ runner: { api }, store }).start({ name: 'CMS 批量冒烟', projectId: 'default-project', caseIds: cases.map((testCase) => testCase.id), cases });

    expect(actions).toEqual(['loginByPassword', 'config', 'list_post']);
    expect(batch.status).toBe('passed');
    expect(batch.projectId).toBe('default-project');
    expect(batch.runIds).toHaveLength(2);
    expect(batch.runIds.map((id) => store.getRun(id).variables)).toEqual(batch.runIds.map((id) => ({
      runId: id,
      random6: expect.stringMatching(/^\d{6}$/)
    })));
  });

  it('shares mutation authorization and ID reservations across API runs', async () => {
    const store = createMemoryStore();
    const contexts = [];
    const apiCases = [
      { ...firstCase, id: 'api-1', target: 'api', steps: [{ id: 's1', kind: 'apiRequest', instruction: '查询', request: { action: 'list_member_update_log', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } }] },
      { ...firstCase, id: 'api-2', target: 'api', steps: [{ id: 's2', kind: 'apiRequest', instruction: '审核', request: { action: 'pass_member_update_log', method: 'POST', payload: {}, expectedStatus: 1, safety: 'mutating' } }] }
    ];
    const api = { createSession: () => ({}), execute: async (_step, context) => { contexts.push(context); return {}; } };

    const batch = await new BatchService({ runner: { api }, store }).start({
      name: '用户审核', projectId: 'default-project', caseIds: apiCases.map(({ id }) => id), cases: apiCases, allowMutations: true
    });

    expect(batch).toMatchObject({ status: 'passed', allowMutations: true });
    expect(contexts.every((context) => context.allowMutations)).toBe(true);
    expect(new Set(contexts.map((context) => context.selectedApiIds))).toHaveLength(1);
  });

  it('shares one Daygf login session and persists redacted API evidence across API runs', async () => {
    const calls = [];
    const runner = new DaygfApiRunner({
      config: { baseUrl: 'https://daygf.example.test', username: 'daygf-user', password: 'daygf-password' },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/api/login')) return { ok: true, status: 200, json: async () => ({ ok: true, token: 'private-jwt', refresh_token: 'private-refresh' }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, items: [] }) };
      }
    });
    const cases = ['/api/me', '/api/profile/data'].map((action, index) => ({
      id: `daygf-${index + 1}`, projectId: 'default-project', name: action, target: 'api', baseUrl: 'https://daygf.example.test', viewport: 'desktop',
      steps: [{ id: `step-${index + 1}`, kind: 'apiRequest', instruction: action, request: { protocol: 'daygf', action, method: 'GET', payload: {}, expectedStatus: 200, safety: 'readonly' } }]
    }));
    const store = createMemoryStore();

    const batch = await new BatchService({ runner: { api: runner }, store }).start({
      name: 'Daygf 只读冒烟', projectId: 'default-project', caseIds: cases.map((testCase) => testCase.id), cases
    });

    expect(calls.map(({ url }) => new URL(url).pathname)).toEqual(['/api/login', '/api/me', '/api/profile/data']);
    expect(batch.status).toBe('passed');
    const saved = batch.runIds.flatMap((id) => store.getRun(id).steps.map((step) => step.api));
    const evidence = JSON.stringify(saved);
    expect(evidence).not.toContain('daygf-password');
    expect(evidence).not.toContain('private-jwt');
    expect(evidence).not.toContain('private-refresh');
  });

  it('resolves each Web UI case project for a batch run', async () => {
    const store = createMemoryStore();
    store.saveProject({ id: 'default-project', name: '默认项目', webAuth: { provider: 'lighthouse', host: 'dt.chenmoyuan.tech' } });
    const contexts = [];
    const runner = { web: { execute: async (_step, context) => { contexts.push(context); return {}; }, finish: async () => {} } };
    const batch = { id: 'batch-1', projectId: 'default-project', target: 'web', caseIds: ['case-1'], runIds: [], allowMutations: false };

    await new BatchService({ runner, store }).execute({ batch, cases: [firstCase] });

    expect(contexts).toHaveLength(1);
    expect(contexts[0].project.webAuth).toEqual({ provider: 'lighthouse', host: 'dt.chenmoyuan.tech' });
  });

  it('runs Web cases in isolated account workers and persists a worker summary', async () => {
    const store = createMemoryStore();
    const workers = [];
    const runner = {
      web: {
        createWorker: async () => {
          const worker = { execute: async (_step, context) => ({ variables: { account: context.worker.account.username } }), finish: async () => {} };
          workers.push(worker);
          return { ...worker, close: async () => {} };
        }
      }
    };
    const batch = { id: 'batch-workers', projectId: 'default-project', target: 'web', caseIds: [firstCase.id], runIds: [], allowMutations: false };

    await new BatchService({ runner, store }).execute({
      batch,
      cases: [firstCase],
      webWorkers: {
        accounts: [{ username: 'nt01', password: 'Aa01' }, { username: 'nt02', password: 'Aa02' }],
        maxConcurrency: 2,
        workerTimeoutMs: 1000,
        messageCount: 1,
        image: { status: 'passed' }
      }
    });

    expect(workers).toHaveLength(2);
    expect(batch.runIds).toHaveLength(2);
    expect(batch.workerSummary).toMatchObject({ total: 2, passed: 2, failed: 0, messageCount: 2, imagePassed: 2 });
    expect(batch.runIds.map((id) => store.getRun(id).workerId)).toEqual(['worker-1', 'worker-2']);
  });
});
