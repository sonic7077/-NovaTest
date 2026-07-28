const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function clipboardImageFile(clipboardData) {
  for (const item of clipboardData?.items || []) {
    if (!imageTypes.has(item.type)) continue;
    const file = item.getAsFile?.();
    if (file) return file;
  }
  return undefined;
}

export function canDeleteWebStep(stepCount) {
  return Number.isInteger(stepCount) && stepCount > 1;
}
