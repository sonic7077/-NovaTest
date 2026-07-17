const stepKinds = new Set(['action', 'assert', 'query', 'apiRequest']);
const viewports = new Set(['desktop', 'mobile']);

export function validateWebCase(input) {
  if (!input || typeof input !== 'object') throw new Error('invalid web case');
  if (!input.name?.trim() || !['web', 'api'].includes(input.target)) throw new Error('invalid test case');
  if (!/^https?:\/\//.test(input.baseUrl || '')) throw new Error('invalid base URL');
  if (input.target === 'web' && !viewports.has(input.viewport)) throw new Error('invalid viewport');
  if (!Array.isArray(input.steps) || input.steps.length === 0) throw new Error('steps required');

  input.steps.forEach((step) => {
    if (!step?.id || !stepKinds.has(step.kind) || !step.instruction?.trim()) {
      throw new Error('invalid step');
    }
    if (input.target === 'api') {
      const request = step.request;
      if (step.kind !== 'apiRequest' || !request?.action?.trim() || request.method !== 'POST' || !['readonly', 'mutating'].includes(request.safety)) throw new Error('invalid API request');
    }
    if (input.target === 'web' && step.kind === 'apiRequest') throw new Error('invalid step');
    (step.visualChecks || []).forEach((visualCheck) => {
      if (!visualCheck?.id || !['upload', 'run'].includes(visualCheck.source) || !visualCheck.description?.trim() || !visualCheck.assetPath?.startsWith(`${input.id}/`)) {
        throw new Error('invalid visual check');
      }
    });
  });

  return input;
}

export function interpolate(value, variables) {
  if (typeof value === 'string') {
    return value.replace(/{{\s*([\w.-]+)\s*}}/g, (_, name) => {
      if (!(name in variables)) throw new Error(`missing variable: ${name}`);
      return String(variables[name]);
    });
  }

  if (Array.isArray(value)) return value.map((item) => interpolate(item, variables));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, variables)]));
  }

  return value;
}
