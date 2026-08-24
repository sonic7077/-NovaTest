import { describe, expect, it } from 'vitest';
import { byAdminWebCases } from '../server/seed/by-admin-web-cases.js';

describe('BY backend Web UI cases', () => {
  it('creates non-mutating backend dashboard and member-list cases under the BY project', () => {
    const cases = byAdminWebCases({ projectId: 'by-project', baseUrl: 'https://by.example.test/admin-login#/operation/member' });

    expect(cases).toHaveLength(2);
    expect(cases).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'by-admin-web-dashboard', projectId: 'by-project', target: 'web', steps: [expect.objectContaining({ kind: 'assert' })] }),
      expect.objectContaining({ id: 'by-admin-web-members', projectId: 'by-project', target: 'web', steps: [expect.objectContaining({ kind: 'action' }), expect.objectContaining({ kind: 'assert' })] })
    ]));
  });
});
