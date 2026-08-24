import { describe, expect, it } from 'vitest';
import { DEFAULT_DAYGF_SCENARIO, publicAccountPool, validateAccountPool, validatePerformanceAsset } from '../server/domain/performance.js';

const validAsset = {
  projectId: 'daygf-project',
  name: '登录浏览点赞基线',
  protocol: 'daygf',
  baseUrl: 'https://daygf.example.test',
  accountPoolId: 'pool-1',
  dataset: { postIds: [101], historyContentIds: [201] },
  stages: [
    { vus: 20, durationSeconds: 180 },
    { vus: 50, durationSeconds: 300 },
    { vus: 100, durationSeconds: 300 },
    { vus: 20, durationSeconds: 120 }
  ],
  thresholds: { loginSuccessRate: 0.995, readSuccessRate: 0.995, writeSuccessRate: 0.99, readP95Ms: 1500, writeP95Ms: 2000, serverErrorRate: 0.001 },
  securityProbe: { enabled: true, postId: 999 }
};

describe('performance domain', () => {
  it('accepts the fixed Daygf scenario and rejects anonymous write traffic', () => {
    expect(validatePerformanceAsset(validAsset)).toEqual(validAsset);
    expect(() => validatePerformanceAsset({ ...validAsset, traffic: { anonymousLike: 1 } })).toThrow('invalid performance asset');
    expect(DEFAULT_DAYGF_SCENARIO.stages).toEqual(validAsset.stages);
  });

  it('requires credentials internally but exposes only account counts publicly', () => {
    const pool = validateAccountPool({ id: 'pool-1', projectId: 'daygf-project', name: '100 VU 账号池', accounts: [{ username: 'vu-01', password: 'private-password' }] });
    expect(publicAccountPool({ ...pool, createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z' }))
      .toEqual({ id: 'pool-1', projectId: 'daygf-project', name: '100 VU 账号池', accountCount: 1, createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z' });
  });
});
