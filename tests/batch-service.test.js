import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../server/app.js';
import { BatchService } from '../server/services/batch-service.js';
import { decryptPayload, encryptPayload } from '../server/services/cms-crypto.js';
import { CmsApiRunner } from '../server/runners/cms-api-runner.js';

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
    const actions = [];
    const api = new CmsApiRunner({
      config: { ...cryptoConfig, username: 'admin', password: 'password', oauthId: 'qa', oauthType: 'web', version: '1.0.0' },
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
    expect(batch.runIds.map((id) => store.getRun(id).variables)).toEqual([{}, {}]);
  });
});
