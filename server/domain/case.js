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

function validPoll(poll) {
  return poll === undefined || (poll && typeof poll === 'object' && !Array.isArray(poll)
    && validJsonPath(poll.path) && Array.isArray(poll.values) && poll.values.length > 0 && poll.values.length <= 10
    && poll.values.every((value) => typeof value === 'string' && value.trim())
    && Number.isInteger(poll.intervalMs) && poll.intervalMs >= 0 && poll.intervalMs <= 5_000
    && Number.isInteger(poll.maxAttempts) && poll.maxAttempts >= 1 && poll.maxAttempts <= 20);
}

function validRandomSelection(selection) {
  if (selection === undefined) return true;
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) return false;
  const { variable, values, minCount, maxCount } = selection;
  return typeof variable === 'string' && variable.trim()
    && Array.isArray(values) && values.length >= 1 && values.length <= 500
    && values.every((value) => typeof value === 'string' && value.trim())
    && new Set(values).size === values.length
    && Number.isInteger(minCount) && minCount >= 1 && minCount <= 3
    && Number.isInteger(maxCount) && maxCount >= minCount && maxCount <= 3 && values.length >= maxCount;
}

function validRecommendationPolicy(policy) {
  if (policy === undefined) return true;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return false;
  const ratio = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  return typeof policy.selectedTagsVariable === 'string' && policy.selectedTagsVariable.trim()
    && Number.isInteger(policy.requestedSize) && policy.requestedSize >= 1 && policy.requestedSize <= 50
    && (policy.minItems === undefined || (Number.isInteger(policy.minItems) && policy.minItems >= 1 && policy.minItems <= 50))
    && Number.isInteger(policy.maxItems) && policy.maxItems >= 1 && policy.maxItems <= 50
    && (policy.minItems === undefined || policy.minItems <= policy.maxItems)
    && Number.isInteger(policy.headGuard) && policy.headGuard >= 0 && policy.headGuard <= policy.maxItems
    && ratio(policy.minHitRatio) && ratio(policy.maxHitRatio) && policy.minHitRatio <= policy.maxHitRatio
    && typeof policy.requireUniqueContentIds === 'boolean'
    && (policy.exploreRatio === undefined || ratio(policy.exploreRatio));
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
      const validRequestPoll = protocol === 'flywheel' ? validPoll(request.poll) : request.poll === undefined;
      if (step.kind !== 'apiRequest' || !request?.action?.trim() || !apiProtocols.has(protocol) || !validMethod || !validExpectedStatus(request.expectedStatus) || !['readonly', 'mutating'].includes(request.safety) || !validAuth || !validExpectedJson(request.expectedJson) || !validExtract(request.extract) || !validSelection(request.select) || !validRequestPoll || !validRandomSelection(request.randomSelection) || (protocol !== 'flywheel' && request.recommendationPolicy !== undefined) || !validRecommendationPolicy(request.recommendationPolicy)) throw new Error('invalid API request');
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
    const fullMatch = value.match(/^{{\s*([\w.-]+)\s*}}$/);
    if (fullMatch) {
      const name = fullMatch[1];
      if (!(name in variables)) throw new Error(`missing variable: ${name}`);
      return variables[name];
    }
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
