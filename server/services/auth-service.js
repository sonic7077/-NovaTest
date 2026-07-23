import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
const maximumFieldLength = 80;

function requiredText(value, name) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${name} is required`);
  if (text.length > maximumFieldLength) throw new Error(`${name} is too long`);
  return text;
}

export function hashPasswordSync(password) {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(password, salt, 64).toString('base64url');
  return { hash, salt };
}

export async function hashPassword(password) { return hashPasswordSync(password); }

export async function verifyPassword(password, { hash, salt }) {
  const candidate = scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'base64url');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

export function publicUser({ id, username, displayName, jobTitle, email }) {
  return { id, username, displayName, jobTitle, email };
}

export function validateProfile({ displayName, jobTitle, email = '' } = {}) {
  const normalizedEmail = String(email).trim();
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('email is invalid');
  if (normalizedEmail.length > maximumFieldLength) throw new Error('email is too long');
  return { displayName: requiredText(displayName, 'display name'), jobTitle: requiredText(jobTitle, 'job title'), email: normalizedEmail };
}

export function validatePasswordChange({ currentPassword, newPassword } = {}) {
  if (!String(currentPassword || '')) throw new Error('current password is required');
  if (String(newPassword || '').length < 8) throw new Error('password must be at least 8 characters');
  return { currentPassword: String(currentPassword), newPassword: String(newPassword) };
}
