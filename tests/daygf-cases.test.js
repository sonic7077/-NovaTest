import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../server/app.js';
import { daygfCases, seedDaygfCases } from '../server/seed/daygf-cases.js';

describe('Daygf API cases', () => {
  it('defines an exact 110-case read-only matrix with safe financial coverage', () => {
    const cases = daygfCases({ projectId: 'daygf-project', baseUrl: 'https://daygf.example.test' });
    const steps = cases.flatMap((testCase) => testCase.steps);

    expect(cases).toHaveLength(110);
    expect(cases.filter((testCase) => testCase.name.startsWith('正例：'))).toHaveLength(57);
    expect(cases.filter((testCase) => testCase.name.startsWith('反例：'))).toHaveLength(53);
    expect(cases.every((testCase) => testCase.projectId === 'daygf-project' && testCase.target === 'api')).toBe(true);
    expect(steps.every((step) => step.request.protocol === 'daygf')).toBe(true);
    expect(steps.some((step) => /shop\/(vip|coin)\/orders|shop\/pay\/callback|\/unlock/.test(step.request.action) && step.request.safety === 'mutating')).toBe(false);
    expect(steps.some((step) => step.request.method === 'DELETE')).toBe(false);
    expect(JSON.stringify(cases)).not.toMatch(/aaaa|111111|private-jwt/i);
  });

  it('covers the approved module totals and representative documented endpoints', () => {
    const cases = daygfCases({ projectId: 'daygf-project', baseUrl: 'https://daygf.example.test' });
    const counts = Object.fromEntries(['auth', 'profile', 'content', 'post', 'streamer', 'search', 'shop', 'public']
      .map((module) => [module, cases.filter((testCase) => testCase.id.startsWith(`daygf-${module}-`)).length]));

    expect(counts).toEqual({ auth: 18, profile: 15, content: 17, post: 16, streamer: 16, search: 15, shop: 8, public: 5 });
    expect(cases.flatMap((testCase) => testCase.steps).map((step) => step.request.action)).toEqual(expect.arrayContaining([
      '/api/me', '/api/content/list', '/api/feed/list', '/api/streamer/list', '/api/search',
      '/api/regions/summary', '/api/shop/config', '/api/home', '/api/track/config'
    ]));
  });

  it('models business rejections and tolerant reads with their actual contracts', () => {
    const byId = Object.fromEntries(daygfCases({ projectId: 'daygf-project', baseUrl: 'https://daygf.example.test' })
      .map((testCase) => [testCase.id, testCase]));

    expect(byId['daygf-content-12'].steps[0].request).toMatchObject({
      auth: 'none', expectedStatus: 200, expectedJson: [{ path: '$.ok', equals: false }]
    });
    expect(byId['daygf-content-10'].steps[0].request).toMatchObject({
      auth: 'none', expectedStatus: 200, expectedJson: [{ path: '$.ok', equals: true }]
    });
    expect(byId['daygf-profile-08'].steps[0].request).toMatchObject({ auth: 'none', expectedStatus: 401 });
    expect(byId['daygf-shop-08'].steps[0].request).toMatchObject({ auth: 'none', expectedStatus: 401 });
  });

  it('upserts the full matrix into the 一日女友 project without duplicating cases', () => {
    const store = createMemoryStore();
    const project = store.saveProject({ name: '一日女友' });

    expect(seedDaygfCases(store, { baseUrl: 'https://first.example.test' })).toBe(110);
    expect(seedDaygfCases(store, { baseUrl: 'https://second.example.test' })).toBe(110);
    const cases = store.listCases('', project.id);
    expect(cases).toHaveLength(110);
    expect(cases.every((testCase) => testCase.baseUrl === 'https://second.example.test')).toBe(true);
  });
});
