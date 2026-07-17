const stepKinds = new Set(['action', 'assert', 'query']);
const viewports = new Set(['desktop', 'mobile']);

export function validateWebCase(input) {
  if (!input || typeof input !== 'object') throw new Error('invalid web case');
  if (!input.name?.trim() || input.target !== 'web') throw new Error('invalid web case');
  if (!/^https?:\/\//.test(input.baseUrl || '')) throw new Error('invalid base URL');
  if (!viewports.has(input.viewport)) throw new Error('invalid viewport');
  if (!Array.isArray(input.steps) || input.steps.length === 0) throw new Error('steps required');

  input.steps.forEach((step) => {
    if (!step?.id || !stepKinds.has(step.kind) || !step.instruction?.trim()) {
      throw new Error('invalid step');
    }
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
