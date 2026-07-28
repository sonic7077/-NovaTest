const LIGHTHOUSE_PROVIDER = 'lighthouse';

export function normalizeProjectWebAuth(input) {
  if (!input || input.provider !== LIGHTHOUSE_PROVIDER || typeof input.host !== 'string') return undefined;
  const host = input.host.trim().toLowerCase();
  return /^[a-z0-9.-]+$/.test(host) ? { provider: LIGHTHOUSE_PROVIDER, host } : undefined;
}

export function shouldUseLighthouseLogin(project, testCase) {
  const auth = normalizeProjectWebAuth(project?.webAuth);
  if (!auth || testCase?.target !== 'web') return false;
  try {
    return new URL(testCase.baseUrl).host === auth.host;
  } catch {
    return false;
  }
}
