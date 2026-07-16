import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../server/app.js';
import { BatchService } from '../server/services/batch-service.js';

const firstCase = {
  id: 'case-1',
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
      caseIds: [firstCase.id, secondCase.id],
      cases: [firstCase, secondCase]
    });

    expect(executedCases).toEqual(['case-1', 'case-1', 'case-2']);
    expect(batch).toMatchObject({
      name: '冒烟回归',
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
      caseIds: [secondCase.id],
      cases: [secondCase]
    });

    expect(batch.status).toBe('passed');
    expect(batch.runIds).toHaveLength(1);
  });
});
