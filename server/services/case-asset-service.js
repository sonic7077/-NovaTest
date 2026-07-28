import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

function isReferenced(steps, assetPath) {
  return (steps || []).some((step) => (step.visualChecks || []).some((visualCheck) => visualCheck.assetPath === assetPath));
}

export function createCaseAssetService({ caseAssetsDir, store }) {
  const root = resolve(caseAssetsDir);

  function absolutePath(assetPath) {
    if (typeof assetPath !== 'string') return undefined;
    const parts = assetPath.split('/');
    if (parts.length !== 2 || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) return undefined;
    const fullPath = resolve(root, ...parts);
    return fullPath.startsWith(`${root}/`) ? fullPath : undefined;
  }

  function resolveAsset({ caseId, fileName, runId }) {
    if (!caseId || !fileName || fileName.includes('/') || fileName.includes('\\')) return undefined;
    const assetPath = `${caseId}/${fileName}`;
    const currentCase = store.getCase(caseId);
    const referencedByCase = isReferenced(currentCase?.steps, assetPath);
    const referencedByRun = !referencedByCase && runId && isReferenced(store.getRun(runId)?.steps, assetPath);
    if (!referencedByCase && !referencedByRun) return undefined;
    const filePath = absolutePath(assetPath);
    return filePath && existsSync(filePath) ? filePath : undefined;
  }

  return { absolutePath, resolve: resolveAsset, uploadPath: (caseId, fileName) => join(root, caseId, fileName) };
}
