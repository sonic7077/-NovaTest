const targetLabels = Object.freeze({ web: 'Web UI', api: '接口测试' });
const targetOrder = Object.freeze(['web', 'api']);

function labelForTarget(target) {
  return targetLabels[target] || target || '未知类型';
}

export function getBatchSelectionState(testCases = []) {
  const targets = [...new Set(testCases.map((testCase) => testCase.target).filter(Boolean))]
    .sort((left, right) => (targetOrder.indexOf(left) - targetOrder.indexOf(right)) || left.localeCompare(right));
  const count = testCases.length;
  const canExecute = count > 0 && targets.length === 1;
  const message = targets.length > 1 ? '批量执行需选择同一类型的用例，请先按类型筛选。' : '';
  const summary = targets.length > 1
    ? `已选择 ${count} 个用例 · 包含 ${targets.map(labelForTarget).join('、')}`
    : `已选择 ${count} 个${targets.length === 1 ? `${labelForTarget(targets[0])}用例` : '用例'}`;
  return { count, targets, canExecute, summary, message };
}
