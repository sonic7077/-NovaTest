import { describe, expect, it } from 'vitest';
import { getBatchSelectionState } from '../client/batch-selection.js';

describe('batch selection state', () => {
  it('allows a non-empty selection when every case has the same target', () => {
    expect(getBatchSelectionState([
      { id: 'api-1', target: 'api' },
      { id: 'api-2', target: 'api' }
    ])).toEqual({
      count: 2,
      targets: ['api'],
      canExecute: true,
      summary: '已选择 2 个接口测试用例',
      message: ''
    });
  });

  it('blocks a mixed Web UI and API selection before submitting a batch', () => {
    expect(getBatchSelectionState([
      { id: 'web-1', target: 'web' },
      { id: 'api-1', target: 'api' }
    ])).toEqual({
      count: 2,
      targets: ['web', 'api'],
      canExecute: false,
      summary: '已选择 2 个用例 · 包含 Web UI、接口测试',
      message: '批量执行需选择同一类型的用例，请先按类型筛选。'
    });
  });

  it('does not allow an empty selection', () => {
    expect(getBatchSelectionState([])).toEqual({
      count: 0,
      targets: [],
      canExecute: false,
      summary: '已选择 0 个用例',
      message: ''
    });
  });
});
