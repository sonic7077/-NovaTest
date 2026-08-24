import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../server/app.js';
import { byCases, seedByCases } from '../server/seed/by-cases.js';

describe('BY public API cases', () => {
  it('creates BY public cases under the supplied project with stable identifiers', () => {
    const cases = byCases({ projectId: 'by-project', baseUrl: 'https://by.example.test' });

    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(cases.every((testCase) => testCase.projectId === 'by-project' && testCase.target === 'api')).toBe(true);
    expect(cases.every((testCase) => testCase.steps.every((step) => step.request.protocol === 'by'))).toBe(true);
    expect(new Set(cases.map((testCase) => testCase.id)).size).toBe(cases.length);
  });

  it('keeps successful reports and write operations opt-in', () => {
    const cases = byCases({ projectId: 'by-project', baseUrl: 'https://by.example.test' });
    const report = cases.find((testCase) => testCase.id === 'by-report-04');

    expect(report.steps.at(-1).request.safety).toBe('mutating');
    expect(cases.some((testCase) => testCase.id === 'by-member-01')).toBe(true);
    expect(cases.some((testCase) => testCase.id === 'by-content-01')).toBe(true);
    expect(cases.some((testCase) => testCase.id === 'by-config-01')).toBe(true);
  });

  it('uses a valid member for the overlong report negative case', () => {
    const cases = byCases({ projectId: 'by-project', baseUrl: 'https://by.example.test' });
    const report = cases.find((testCase) => testCase.id === 'by-report-02');

    expect(report.steps).toHaveLength(2);
    expect(report.steps[0].request.extract).toEqual({ memberPubId: '$.data.list[0].pubId' });
    expect(report.steps[1].request.payload).toMatchObject({ pubId: '{{memberPubId}}' });
    expect(report.steps[1].request.expectedStatus).toBe(200);
    expect(report.steps[1].request.expectedCode).toBe(40000);
  });

  it('keeps documented public business failures on HTTP 200 envelopes', () => {
    const cases = byCases({ projectId: 'by-project', baseUrl: 'https://by.example.test' });
    const byId = Object.fromEntries(cases.map((testCase) => [testCase.id, testCase]));

    expect(byId['by-member-06'].steps[0].request).toMatchObject({ expectedStatus: 200, expectedCode: 40400 });
    expect(byId['by-member-07'].steps[0].request).toMatchObject({ expectedStatus: 200, expectedCode: 40300 });
    expect(byId['by-content-05'].steps[0].request).toMatchObject({ expectedStatus: 200, expectedCode: 40000 });
    expect(byId['by-content-06'].steps[0].request).toMatchObject({ expectedStatus: 200, expectedCode: 40400 });
  });

  it('writes BY cases idempotently', () => {
    const store = createMemoryStore();
    const project = store.saveProject({ name: 'BY项目' });

    expect(seedByCases(store, { projectId: project.id, baseUrl: 'https://by.example.test' })).toBeGreaterThanOrEqual(20);
    expect(seedByCases(store, { projectId: project.id, baseUrl: 'https://changed.example.test' })).toBe(store.listCases('', project.id).length);
    expect(store.listCases('', project.id).every((testCase) => testCase.baseUrl === 'https://changed.example.test')).toBe(true);
  });
});
