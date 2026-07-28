import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../server/app.js';
import { upgradeLighthouseTaskListCase } from '../server/seed/lighthouse-cases.js';

const legacyInstructions = [
  '确认“我负责的”任务列表已加载。',
  '借助视觉识别读取“我负责的”任务列表，确认可见任务标题、负责人、状态、截止日期和任务清单字段；记录本次识别结果作为截图证据。',
  '点击“新建任务”，选择任务清单“测试任务”，输入任务标题“衡川测试0725”并创建；断言新任务出现在“我负责的”列表，且优先级字段显示“测试任务”。'
];

function legacyCase(overrides = {}) {
  return {
    id: '76e41c5c-08b2-45c5-b1b6-a4f38e097b1a',
    projectId: 'default-project',
    name: '无极灯塔 - 任务清单识别与新建任务',
    target: 'web',
    baseUrl: 'https://dt.chenmoyuan.tech/dashboard/tasks/my',
    viewport: 'desktop',
    steps: legacyInstructions.map((instruction, index) => ({ id: `step-${index + 1}`, kind: 'action', instruction })),
    ...overrides
  };
}

describe('Lighthouse task case upgrade', () => {
  it('upgrades only the untouched Lighthouse task-list workflow once', () => {
    const store = createMemoryStore();
    const original = legacyCase();
    store.saveCase(original);

    expect(upgradeLighthouseTaskListCase(store)).toBe(true);
    const upgraded = store.getCase(original.id);
    expect(upgraded.steps).toHaveLength(4);
    expect(upgraded.steps[3]).toMatchObject({
      id: 'step-4',
      kind: 'action',
      instruction: expect.stringContaining('衡川测试{{random6}}')
    });
    expect(upgraded.steps[3].instruction).toContain('不重复创建');
    expect(upgraded.steps[3].instruction).toContain('保存截图证据');
    expect(upgradeLighthouseTaskListCase(store)).toBe(false);
  });

  it('does not replace a renamed or user-modified Lighthouse case', () => {
    const store = createMemoryStore();
    const original = legacyCase({ steps: [{ id: 'step-1', kind: 'action', instruction: '用户自定义步骤' }] });
    store.saveCase(original);

    expect(upgradeLighthouseTaskListCase(store)).toBe(false);
    expect(store.getCase(original.id)).toEqual(original);
  });
});
