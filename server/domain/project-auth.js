const LIGHTHOUSE_PROVIDER = 'lighthouse';
const BY_ADMIN_PROVIDER = 'byAdmin';
const supportedProviders = new Set([LIGHTHOUSE_PROVIDER, BY_ADMIN_PROVIDER]);

export function normalizeProjectWebAuth(input) {
  if (!input || !supportedProviders.has(input.provider) || typeof input.host !== 'string') return undefined;
  const host = input.host.trim().toLowerCase();
  return /^[a-z0-9.-]+$/.test(host) ? { provider: input.provider, host } : undefined;
}

function shouldUseProjectLogin(provider, project, testCase) {
  const auth = normalizeProjectWebAuth(project?.webAuth);
  if (!auth || auth.provider !== provider || testCase?.target !== 'web') return false;
  try {
    return new URL(testCase.baseUrl).host === auth.host;
  } catch {
    return false;
  }
}

export function shouldUseLighthouseLogin(project, testCase) {
  return shouldUseProjectLogin(LIGHTHOUSE_PROVIDER, project, testCase);
}

export function shouldUseByAdminLogin(project, testCase) {
  return shouldUseProjectLogin(BY_ADMIN_PROVIDER, project, testCase);
}
