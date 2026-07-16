import { describe, expect, it } from 'vitest';
import { interpolate, validateWebCase } from '../server/domain/case.js';

describe('web test case', () => {
  it('accepts a desktop web case with natural language steps', () => {
    const testCase = validateWebCase({
      name: '登录',
      target: 'web',
      baseUrl: 'https://example.test',
      viewport: 'desktop',
      steps: [{ id: 's1', kind: 'action', instruction: '点击登录' }]
    });

    expect(testCase.target).toBe('web');
  });

  it('replaces variables recursively and rejects a missing variable', () => {
    expect(interpolate('订单 {{orderId}}', { orderId: 'A-1' })).toBe('订单 A-1');
    expect(interpolate({ order: '{{orderId}}' }, { orderId: 'A-1' })).toEqual({ order: 'A-1' });
    expect(() => interpolate('{{missing}}', {})).toThrow('missing variable: missing');
  });
});
