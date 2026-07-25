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
