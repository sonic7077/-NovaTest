import { describe, expect, it } from 'vitest';
import { executionFocusRoute, readExecutionFocus, resolveSelectedExecutionId } from '../client/execution-navigation.js';

describe('execution navigation', () => {
  it('creates a batch focus URL with the project filter', () => {
    expect(executionFocusRoute({ projectId: 'project a', executionId: 'batch/1' }))
      .toBe('#/executions?projectId=project+a&focus=batch%2F1');
  });

  it('reads optional project and execution focus values from an execution URL', () => {
    expect(readExecutionFocus('#/executions?projectId=project-a&focus=batch-1'))
      .toEqual({ projectId: 'project-a', executionId: 'batch-1' });
    expect(readExecutionFocus('#/executions')).toEqual({ projectId: '', executionId: '' });
  });

  it('prioritizes a new URL focus over a retained selected task without losing an unresolved focus', () => {
    expect(resolveSelectedExecutionId({
      taskIds: ['batch-old', 'batch-new'],
      selectedExecutionId: 'batch-old',
      handledFocusId: 'batch-old',
      requestedExecutionId: 'batch-new'
    })).toEqual({ selectedExecutionId: 'batch-new', handledFocusId: 'batch-new' });

    expect(resolveSelectedExecutionId({
      taskIds: ['batch-old'],
      selectedExecutionId: 'batch-old',
      handledFocusId: 'batch-old',
      requestedExecutionId: 'batch-new'
    })).toEqual({ selectedExecutionId: 'batch-old', handledFocusId: 'batch-old' });
  });
});
