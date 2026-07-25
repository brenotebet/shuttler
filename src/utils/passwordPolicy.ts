// src/utils/passwordPolicy.ts
// Single source of truth for password requirements — shared by sign-up
// (AuthScreen) and change-password (ProfileScreen) so the two can't drift
// apart (they previously enforced 8-char+complexity vs. 6-char minimum).

export const PASSWORD_RULES = [
  { key: 'length',  label: 'At least 8 characters',       test: (p: string) => p.length >= 8 },
  { key: 'upper',   label: 'One uppercase letter (A–Z)',   test: (p: string) => /[A-Z]/.test(p) },
  { key: 'lower',   label: 'One lowercase letter (a–z)',   test: (p: string) => /[a-z]/.test(p) },
  { key: 'number',  label: 'One number (0–9)',             test: (p: string) => /\d/.test(p) },
  { key: 'special', label: 'One special character (!@#…)', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export function passwordPolicyErrors(password: string): string[] {
  return PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.label.toLowerCase());
}

export function meetsPasswordPolicy(password: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(password));
}
