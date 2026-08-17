const defaultStages = [
  { vus: 20, durationSeconds: 180 },
  { vus: 50, durationSeconds: 300 },
  { vus: 100, durationSeconds: 300 },
  { vus: 20, durationSeconds: 120 }
];

export const DEFAULT_DAYGF_SCENARIO = {
  stages: defaultStages,
  thresholds: {
    loginSuccessRate: 0.995,
    readSuccessRate: 0.995,
    writeSuccessRate: 0.99,
    readP95Ms: 1500,
    writeP95Ms: 2000,
    serverErrorRate: 0.001
  }
};

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sameStages(stages) {
  return Array.isArray(stages)
    && stages.length === defaultStages.length
    && stages.every((stage, index) => stage?.vus === defaultStages[index].vus && stage?.durationSeconds === defaultStages[index].durationSeconds);
}

function validThresholds(value) {
  return value && typeof value === 'object'
    && ['loginSuccessRate', 'readSuccessRate', 'writeSuccessRate', 'serverErrorRate'].every((key) => Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1)
    && ['readP95Ms', 'writeP95Ms'].every((key) => Number.isInteger(value[key]) && value[key] > 0);
}

export function validateAccountPool(input) {
  const validAccounts = Array.isArray(input?.accounts) && input.accounts.length > 0 && input.accounts.length <= 500
    && input.accounts.every((account) => isText(account?.username) && isText(account?.password));
  if (!isText(input?.projectId) || !isText(input?.name) || !validAccounts) throw new Error('invalid performance account pool');
  return structuredClone(input);
}

export function publicAccountPool(pool) {
  return {
    id: pool.id,
    projectId: pool.projectId,
    name: pool.name,
    accountCount: pool.accounts.length,
    createdAt: pool.createdAt,
    updatedAt: pool.updatedAt
  };
}

export function validatePerformanceAsset(input) {
  const probe = input?.securityProbe;
  const valid = isText(input?.projectId) && isText(input?.name) && input.protocol === 'daygf'
    && /^https?:\/\//.test(input.baseUrl || '') && isText(input.accountPoolId)
    && Array.isArray(input.dataset?.postIds) && input.dataset.postIds.length > 0
    && input.dataset.postIds.every((id) => Number.isInteger(id) && id > 0)
    && Array.isArray(input.dataset?.historyContentIds) && input.dataset.historyContentIds.length > 0
    && input.dataset.historyContentIds.every((id) => Number.isInteger(id) && id > 0)
    && sameStages(input.stages) && validThresholds(input.thresholds)
    && typeof probe?.enabled === 'boolean' && Number.isInteger(probe.postId) && probe.postId > 0
    && !Object.hasOwn(input.traffic || {}, 'anonymousLike');
  if (!valid) throw new Error('invalid performance asset');
  return structuredClone(input);
}
