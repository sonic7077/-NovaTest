const wujiAliases = {
  MIDSCENE_MODEL_BASE_URL: 'WUJI_BASE_URL',
  MIDSCENE_MODEL_NAME: 'WUJI_MODEL',
  MIDSCENE_MODEL_API_KEY: 'WUJI_MODEL_API_KEY'
};

export function withWujiMidsceneConfig(env) {
  const resolved = { ...env };
  for (const [midsceneKey, wujiKey] of Object.entries(wujiAliases)) {
    if (!resolved[midsceneKey] && resolved[wujiKey]) resolved[midsceneKey] = resolved[wujiKey];
  }
  return resolved;
}

function redactApiKey(apiKey) {
  return apiKey ? `${apiKey.slice(0, 3)}****************` : '';
}

export function publicMidsceneConfig(env) {
  return {
    source: env.WUJI_BASE_URL || env.WUJI_MODEL || env.WUJI_MODEL_API_KEY ? 'WUJI' : 'MIDSCENE',
    baseUrl: env.MIDSCENE_MODEL_BASE_URL || '',
    modelName: env.MIDSCENE_MODEL_NAME || '',
    modelFamily: env.MIDSCENE_MODEL_FAMILY || '',
    apiKey: redactApiKey(env.MIDSCENE_MODEL_API_KEY)
  };
}
