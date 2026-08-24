import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../server/app.js';
import { arkDedicatedSiteCases, seedArkDedicatedSiteCases } from '../server/seed/ark-dedicated-site-cases.js';

describe('Ark dedicated-site CMS cases', () => {
  it('defines required CMS protocol checks and keeps article writes disabled by default', () => {
    const cases = arkDedicatedSiteCases({ projectId: 'ark-project', baseUrl: 'https://example.test/api.php' });
    const steps = cases.flatMap((testCase) => testCase.steps);

    expect(cases).toHaveLength(7);
    expect(steps.filter((step) => step.request.safety === 'readonly').map((step) => step.request.action))
      .toEqual(expect.arrayContaining(['project_list', 'config']));
    expect(cases.find((testCase) => testCase.id === 'ark-dedicated-config-categories').steps[0].request.expectedJson)
      .toEqual([{ path: '$.data.category_list', exists: true }]);
    expect(cases.find((testCase) => testCase.id === 'ark-dedicated-auth-reuse').steps).toHaveLength(2);
    expect(steps.filter((step) => step.request.safety === 'mutating').every((step) => step.request.skipReason === '专属站点建稿/更新需独立授权')).toBe(true);
  });

  it('writes the cases into the existing Ark community project without duplicates', () => {
    const store = createMemoryStore();
    const project = store.saveProject({ name: '方舟社区发帖' });

    expect(seedArkDedicatedSiteCases(store, { baseUrl: 'https://first.test/api.php' })).toBe(7);
    expect(seedArkDedicatedSiteCases(store, { baseUrl: 'https://second.test/api.php' })).toBe(7);

    const cases = store.listCases('', project.id);
    expect(cases).toHaveLength(7);
    expect(cases.every((testCase) => testCase.baseUrl === 'https://second.test/api.php')).toBe(true);
  });
});
