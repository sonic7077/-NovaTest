import { describe, expect, it } from 'vitest';
import { cmsWhitebagCases } from '../server/seed/cms-whitebag-cases.js';

describe('white-bag CMS smoke cases', () => {
  it('contains only readonly documented API actions', () => {
    const cases = cmsWhitebagCases({ baseUrl: 'https://example.test/api.php' });

    expect(cases).toHaveLength(3);
    expect(cases.flatMap((testCase) => testCase.steps).every((step) => step.request.safety === 'readonly' && step.request.method === 'POST')).toBe(true);
    expect(cases.every((testCase) => testCase.steps[0].request.action === 'config')).toBe(true);
    expect(cases.flatMap((testCase) => testCase.steps.map((step) => step.request.action))).toEqual(expect.arrayContaining(['config', 'list_post', 'list_post_comments', 'list_member_update_log']));
    expect(cases.flatMap((testCase) => testCase.steps.map((step) => step.request.action)).includes('loginByPassword')).toBe(false);
  });
});
