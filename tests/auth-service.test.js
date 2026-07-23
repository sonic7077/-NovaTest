import { describe, expect, it } from 'vitest';
import { hashPassword, publicUser, validatePasswordChange, validateProfile, verifyPassword } from '../server/services/auth-service.js';

describe('local account authentication', () => {
  it('hashes a password with a salt and accepts only its matching password', async () => {
    const record = await hashPassword('admin123');

    expect(record.hash).not.toContain('admin123');
    expect(record.salt).not.toBe('');
    await expect(verifyPassword('admin123', record)).resolves.toBe(true);
    await expect(verifyPassword('not-admin123', record)).resolves.toBe(false);
  });

  it('exposes safe user fields and validates profile and password input', () => {
    expect(publicUser({ id: 'u1', username: 'admin', displayName: '管理员', jobTitle: '测试负责人', email: '', passwordHash: 'secret', passwordSalt: 'salt' })).toEqual({ id: 'u1', username: 'admin', displayName: '管理员', jobTitle: '测试负责人', email: '' });
    expect(validateProfile({ displayName: ' 管理员 ', jobTitle: ' 测试负责人 ', email: ' admin@example.test ' })).toEqual({ displayName: '管理员', jobTitle: '测试负责人', email: 'admin@example.test' });
    expect(() => validateProfile({ displayName: '', jobTitle: '测试负责人' })).toThrow('display name is required');
    expect(() => validatePasswordChange({ currentPassword: 'old-password', newPassword: 'short' })).toThrow('password must be at least 8 characters');
  });
});
