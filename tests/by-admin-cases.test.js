import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../server/app.js';
import { byAdminCases, seedByAdminCases } from '../server/seed/by-admin-cases.js';
import { byCases } from '../server/seed/by-cases.js';

describe('BY admin API cases', () => {
  it('generates a full public and admin matrix with stable unique identifiers', () => {
    const publicCases = byCases({ projectId: 'by-project', baseUrl: 'https://by.example.test' });
    const adminCases = byAdminCases({ projectId: 'by-project', baseUrl: 'https://by.example.test' });
    const all = [...publicCases, ...adminCases];

    expect(publicCases.length).toBeGreaterThanOrEqual(130);
    expect(adminCases.length).toBeGreaterThanOrEqual(100);
    expect(all.length).toBeGreaterThanOrEqual(220);
    expect(new Set(all.map((testCase) => testCase.id)).size).toBe(all.length);
    expect(adminCases.every((testCase) => testCase.steps.every((step) => step.request.protocol === 'byAdmin'))).toBe(true);
    expect(adminCases.filter((testCase) => testCase.steps.some((step) => step.request.skipReason)).length).toBeGreaterThanOrEqual(20);
  });

  it('seeds admin cases idempotently under the selected project', () => {
    const store = createMemoryStore();
    const project = store.saveProject({ name: 'BY项目' });

    expect(seedByAdminCases(store, { projectId: project.id, baseUrl: 'https://by.example.test' })).toBeGreaterThanOrEqual(100);
    expect(seedByAdminCases(store, { projectId: project.id, baseUrl: 'https://changed.example.test' })).toBe(store.listCases('', project.id).length);
    expect(store.listCases('', project.id).every((testCase) => testCase.baseUrl === 'https://changed.example.test')).toBe(true);
  });
});
