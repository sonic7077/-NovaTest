export function executionFocusRoute({ projectId = '', executionId = '' }) {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (executionId) params.set('focus', executionId);
  const query = params.toString();
  return query ? `#/executions?${query}` : '#/executions';
}

export function readExecutionFocus(hash) {
  const query = String(hash || '').split('?')[1] || '';
  const params = new URLSearchParams(query);
  return {
    projectId: params.get('projectId') || '',
    executionId: params.get('focus') || ''
  };
}

export function resolveSelectedExecutionId({ taskIds, selectedExecutionId = '', handledFocusId = '', requestedExecutionId = '' }) {
  if (!requestedExecutionId) {
    return {
      selectedExecutionId: taskIds.includes(selectedExecutionId) ? selectedExecutionId : (taskIds[0] || ''),
      handledFocusId: ''
    };
  }
  if (requestedExecutionId !== handledFocusId && taskIds.includes(requestedExecutionId)) {
    return { selectedExecutionId: requestedExecutionId, handledFocusId: requestedExecutionId };
  }
  return {
    selectedExecutionId: taskIds.includes(selectedExecutionId) ? selectedExecutionId : (taskIds[0] || ''),
    handledFocusId
  };
}
