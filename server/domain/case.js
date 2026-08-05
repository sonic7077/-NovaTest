const stepKinds = new Set(['action', 'assert', 'query', 'apiRequest']);
const viewports = new Set(['desktop', 'mobile']);
const apiProtocols = new Set(['cms', 'editorial', 'flywheel']);
const jsonPathPattern = /^\$(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/;

function validJsonPath(value) {
  return typeof value === 'string' && jsonPathPattern.test(value);
}

function validExpectedJson(expectedJson) {
  return expectedJson === undefined || (Array.isArray(expectedJson) && expectedJson.every((expectation) => {
    if (!expectation || typeof expectation !== 'object' || !validJsonPath(expectation.path)) return false;
    return !Object.hasOwn(expectation, 'equalsVariable') || (typeof expectation.equalsVariable === 'string' && expectation.equalsVariable.trim());
  }));
}

function validExtract(extract) {
  return extract === undefined || (extract && typeof extract === 'object' && !Array.isArray(extract)
    && Object.entries(extract).every(([name, path]) => name.trim() && validJsonPath(path)));
}

function validSelection(select) {
  return select === undefined || (select && typeof select === 'object'
    && typeof select.variable === 'string' && select.variable.trim()
    && validJsonPath(select.listPath) && validJsonPath(select.idPath));
}

function validExpectedStatus(value) {
  const statuses = Array.isArray(value) ? value : [value];
  return statuses.length > 0 && statuses.every((status) => Number.isInteger(status));
}

export function validateWebCase(input) {
  if (!input || typeof input !== 'object') throw new Error('invalid web case');
  if (!input.projectId?.trim()) throw new Error('project required');
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
      const protocol = request?.protocol || 'cms';
      const validMethod = protocol === 'cms'
        ? request?.method === 'POST'
        : protocol === 'flywheel'
          ? ['GET', 'POST', 'PUT', 'DELETE'].includes(request?.method)
          : ['GET', 'POST'].includes(request?.method);
      const validAuth = request?.auth === undefined || request.auth === 'session' || request.auth === 'none'
        || (protocol === 'flywheel' && request.auth === 'invalid');
      if (step.kind !== 'apiRequest' || !request?.action?.trim() || !apiProtocols.has(protocol) || !validMethod || !validExpectedStatus(request.expectedStatus) || !['readonly', 'mutating'].includes(request.safety) || !validAuth || !validExpectedJson(request.expectedJson) || !validExtract(request.extract) || !validSelection(request.select)) throw new Error('invalid API request');
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
