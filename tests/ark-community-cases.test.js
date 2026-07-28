import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../server/app.js';
import { arkCommunityCases, seedArkCommunityCases } from '../server/seed/ark-community-cases.js';

describe('Ark community API cases', () => {
  it('defines query probes and non-delete community business chains', () => {
    const cases = arkCommunityCases({ projectId: 'ark-project', baseUrl: 'https://example.test/api.php' });

    expect(cases).toHaveLength(11);
    expect(cases.every((testCase) => testCase.projectId === 'ark-project' && testCase.target === 'api')).toBe(true);
    expect(cases.flatMap((testCase) => testCase.steps).every((step) => step.request.method === 'POST')).toBe(true);
    expect(cases.flatMap((testCase) => testCase.steps.map((step) => step.request.action))).not.toEqual(expect.arrayContaining(['del_post', 'del_post_comments', 'del_member_update_log']));
    expect(cases.find((testCase) => testCase.name === '帖子状态筛选查询').steps.map((step) => step.request.payload.status)).toEqual([10, 0, 1, 2, 3]);
    expect(cases.filter((testCase) => testCase.id.endsWith('status-filters')).flatMap((testCase) => testCase.steps).every((step) => step.request.expectedJson?.map((assertion) => assertion.path).join(',') === '$.data.list,$.data.total')).toBe(true);
    expect(cases.find((testCase) => testCase.name === '无效登录态拦截').steps[0].request).toMatchObject({
      action: 'list_post', expectedStatus: 0, auth: 'none', payload: { token: 'invalid-token' }
    });
    expect(cases.find((testCase) => testCase.id === 'ark-community-member-approve').steps[0].request.select).toEqual({ listPath: '$.data.list', variable: 'memberLogId', idPath: '$.id' });
    expect(cases.find((testCase) => testCase.id === 'ark-community-post-approve').steps.some((step) => step.request.action === 'pass_post' && step.request.safety === 'mutating')).toBe(true);
    expect(cases.find((testCase) => testCase.id === 'ark-community-comment-reply').steps.some((step) => step.request.action === 'reply_post_comments' && step.request.safety === 'mutating')).toBe(true);
  });

  it('writes cases into the named project without duplicates and refreshes the base URL', () => {
    const store = createMemoryStore();
    const project = store.saveProject({ name: '方舟社区发帖' });

    expect(seedArkCommunityCases(store, { baseUrl: 'https://first.test/api.php' })).toBe(11);
    expect(seedArkCommunityCases(store, { baseUrl: 'https://second.test/api.php' })).toBe(11);

    const cases = store.listCases('', project.id);
    expect(cases).toHaveLength(11);
    expect(cases.every((testCase) => testCase.baseUrl === 'https://second.test/api.php')).toBe(true);
  });

  it('does not create a project when the named project is absent', () => {
    const store = createMemoryStore();

    expect(seedArkCommunityCases(store, { baseUrl: 'https://example.test/api.php' })).toBe(0);
    expect(store.listProjects().map((project) => project.name)).toEqual(['默认项目']);
  });
});
