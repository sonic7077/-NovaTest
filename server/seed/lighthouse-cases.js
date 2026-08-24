const LIGHTHOUSE_TASK_CASE_ID = '76e41c5c-08b2-45c5-b1b6-a4f38e097b1a';
const LIGHTHOUSE_TASK_CASE_NAME = '无极灯塔 - 任务清单识别与新建任务';
const LIGHTHOUSE_READONLY_CASE_ID = '1f2c2396-a44c-42da-88f0-2fd3444e7591';
const LIGHTHOUSE_READONLY_CASE_NAME = '无极灯塔 - 任务清单只读识别';
const readonlyInstruction = '查看“我负责的”任务列表，确认页面已加载且可见任务内容。不得创建、编辑、删除任务，也不得变更任何任务状态；保留页面截图证据。';

const legacyInstructions = [
  '确认“我负责的”任务列表已加载。',
  '借助视觉识别读取“我负责的”任务列表，确认可见任务标题、负责人、状态、截止日期和任务清单字段；记录本次识别结果作为截图证据。',
  '点击“新建任务”，选择任务清单“测试任务”，输入任务标题“衡川测试0725”并创建；断言新任务出现在“我负责的”列表，且优先级字段显示“测试任务”。'
];

const upgradedInstructions = [
  '确认“我负责的”任务列表已加载。',
  '结合参考图片识别“我负责的”任务列表中可见任务的标题、负责人、状态、截止日期和任务清单字段；保存截图证据。',
  '点击“新建任务”，选择任务清单“测试任务”。',
  '在任务标题中输入“衡川测试{{random6}}”并创建。若因本次运行重试已存在相同标题时不重复创建，直接验证该标题出现在“我负责的”列表且任务清单为“测试任务”；保存截图证据。'
];

function isUntouchedLegacyCase(testCase) {
  return testCase?.name === LIGHTHOUSE_TASK_CASE_NAME
    && testCase.target === 'web'
    && testCase.steps?.length === legacyInstructions.length
    && testCase.steps.every((step, index) => step?.instruction === legacyInstructions[index]);
}

export function upgradeLighthouseTaskListCase(store) {
  const existing = store.getCase(LIGHTHOUSE_TASK_CASE_ID);
  if (!isUntouchedLegacyCase(existing)) return false;

  store.saveCase({
    ...existing,
    steps: upgradedInstructions.map((instruction, index) => ({
      id: `step-${index + 1}`,
      kind: 'action',
      instruction
    }))
  });
  return true;
}

export function upgradeLighthouseReadonlyCase(store) {
  const existing = store.getCase(LIGHTHOUSE_READONLY_CASE_ID);
  const step = existing?.steps?.[0];
  if (existing?.name !== LIGHTHOUSE_READONLY_CASE_NAME
    || existing.target !== 'web'
    || existing.steps?.length !== 1
    || step?.id !== 'verify-task-list'
    || step.kind !== 'action'
    || step.instruction !== readonlyInstruction) return false;

  store.saveCase({ ...existing, steps: [{ ...step, kind: 'assert' }] });
  return true;
}
