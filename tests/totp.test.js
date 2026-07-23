import { describe, expect, it } from 'vitest';
import { generateTotp } from '../server/services/totp.js';

describe('TOTP', () => {
  it('returns the RFC 6238 SHA-1 code for a fixed time', () => {
    expect(generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { now: 59_000 })).toBe('287082');
  });

  it('rejects malformed Base32 without exposing its value', () => {
    expect(() => generateTotp('invalid!')).toThrow('invalid Google Authenticator secret');
  });
});
