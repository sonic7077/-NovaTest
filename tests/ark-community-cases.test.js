import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../server/app.js';
import { arkCommunityCases, seedArkCommunityCases } from '../server/seed/ark-community-cases.js';

describe('Ark community API cases', () => {
  it('defines readonly query and permission-probe actions', () => {
    const cases = arkCommunityCases({ projectId: 'ark-project', baseUrl: 'https://example.test/api.php' });

    expect(cases).toHaveLength(4);
    expect(cases.every((testCase) => testCase.projectId === 'ark-project' && testCase.target === 'api')).toBe(true);
    expect(cases.flatMap((testCase) => testCase.steps).every((step) => step.request.method === 'POST' && step.request.safety === 'readonly')).toBe(true);
    expect(cases.find((testCase) => testCase.name === '帖子状态筛选查询').steps.map((step) => step.request.payload.status)).toEqual([10, 0, 1, 2, 3]);
    expect(cases.filter((testCase) => testCase.name !== '无效登录态拦截').flatMap((testCase) => testCase.steps).every((step) => step.request.expectedJson?.map((assertion) => assertion.path).join(',') === '$.data.list,$.data.total')).toBe(true);
    expect(cases.find((testCase) => testCase.name === '无效登录态拦截').steps[0].request).toMatchObject({
      action: 'list_post', expectedStatus: 0, auth: 'none', payload: { token: 'invalid-token' }
    });
  });

  it('writes cases into the named project without duplicates and refreshes the base URL', () => {
    const store = createMemoryStore();
    const project = store.saveProject({ name: '方舟社区发帖' });

    expect(seedArkCommunityCases(store, { baseUrl: 'https://first.test/api.php' })).toBe(4);
    expect(seedArkCommunityCases(store, { baseUrl: 'https://second.test/api.php' })).toBe(4);

    const cases = store.listCases('', project.id);
    expect(cases).toHaveLength(4);
    expect(cases.every((testCase) => testCase.baseUrl === 'https://second.test/api.php')).toBe(true);
  });

  it('does not create a project when the named project is absent', () => {
    const store = createMemoryStore();

    expect(seedArkCommunityCases(store, { baseUrl: 'https://example.test/api.php' })).toBe(0);
    expect(store.listProjects().map((project) => project.name)).toEqual(['默认项目']);
  });
});
