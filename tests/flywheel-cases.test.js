import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createMemoryStore } from '../server/app.js';
import { flywheelCases, seedFlywheelCases } from '../server/seed/flywheel-cases.js';

describe('Flywheel API cases', () => {
  it('defines documented positive and negative cases without destructive content operations', () => {
    const cases = flywheelCases({ projectId: 'flywheel-project', baseUrl: 'https://flywheel.example.test', platformId: 'tenant-a' });
    const steps = cases.flatMap((testCase) => testCase.steps);

    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(cases.every((testCase) => testCase.target === 'api' && testCase.projectId === 'flywheel-project')).toBe(true);
    expect(steps.every((step) => step.request.protocol === 'flywheel')).toBe(true);
    expect(cases.some((testCase) => testCase.name === '正例：飞轮内容采集及状态回查')).toBe(true);
    expect(cases.some((testCase) => testCase.name === '反例：飞轮推荐缺少用户标识')).toBe(true);
    expect(cases.some((testCase) => testCase.name === '反例：飞轮搜索超长关键词')).toBe(true);
    expect(JSON.stringify(cases)).toContain('{{platformId}}-novatest-{{runId}}');
    expect(steps.some((step) => /\/api\/v1\/content\/reconcile|DELETE/.test(`${step.request.action}:${step.request.method}`))).toBe(false);
    expect(JSON.stringify(cases)).not.toContain('private-platform-key');
  });

  it('upserts Flywheel cases in the 飞轮引擎 project', () => {
    const store = createMemoryStore();
    const project = store.saveProject({ name: '飞轮引擎' });

    const firstCount = seedFlywheelCases(store, { baseUrl: 'https://first.example.test', platformId: 'tenant-a' });
    const secondCount = seedFlywheelCases(store, { baseUrl: 'https://second.example.test', platformId: 'tenant-a' });
    const cases = store.listCases('', project.id);

    expect(firstCount).toBe(secondCount);
    expect(cases).toHaveLength(firstCount);
    expect(cases.every((testCase) => testCase.baseUrl === 'https://second.example.test')).toBe(true);
  });

  it('offers the Flywheel protocol and documented HTTP methods in the API editor', async () => {
    const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');

    expect(source).toContain('<option value="flywheel">飞轮引擎</option>');
    expect(source).toContain('<option value="PUT">PUT</option>');
    expect(source).toContain('<option value="DELETE">DELETE</option>');
  });
});
