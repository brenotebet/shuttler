// __tests__/backend.authPolicy.test.ts
// Tests for which sign-in providers each org authMethod accepts
// (POST /auth/social/complete and POST /auth/email/register).

import { emailRegistrationRejection, inheritedSsoRole, socialSignInRejection } from '../backend/authPolicy';

describe('socialSignInRejection', () => {
  it('rejects Google, Apple and phone for SAML orgs', () => {
    expect(socialSignInRejection('saml', 'google.com')).not.toBeNull();
    expect(socialSignInRejection('saml', 'apple.com')).not.toBeNull();
    expect(socialSignInRejection('saml', 'phone')).not.toBeNull();
  });

  it('allows Google and Apple for email-style orgs', () => {
    for (const method of ['email', 'google', 'email+google']) {
      expect(socialSignInRejection(method, 'google.com')).toBeNull();
      expect(socialSignInRejection(method, 'apple.com')).toBeNull();
    }
  });

  it('treats a missing authMethod as email', () => {
    expect(socialSignInRejection(undefined, 'google.com')).toBeNull();
    expect(socialSignInRejection(null, 'apple.com')).toBeNull();
  });

  it('only allows phone sign-in for phone orgs', () => {
    expect(socialSignInRejection('phone', 'phone')).toBeNull();
    expect(socialSignInRejection('email', 'phone')).not.toBeNull();
  });

  it('rejects Google and Apple for phone orgs', () => {
    expect(socialSignInRejection('phone', 'google.com')).not.toBeNull();
    expect(socialSignInRejection('phone', 'apple.com')).not.toBeNull();
  });

  it('rejects unknown or missing providers', () => {
    expect(socialSignInRejection('email', 'password')).not.toBeNull();
    expect(socialSignInRejection('email', 'custom')).not.toBeNull();
    expect(socialSignInRejection('email', undefined)).not.toBeNull();
  });
});

describe('emailRegistrationRejection', () => {
  it('allows registration for email orgs', () => {
    expect(emailRegistrationRejection('email')).toBeNull();
    expect(emailRegistrationRejection(undefined)).toBeNull();
  });

  it('blocks registration for phone orgs', () => {
    expect(emailRegistrationRejection('phone')).not.toBeNull();
  });

  it('blocks all registration in SAML orgs, admins included', () => {
    expect(emailRegistrationRejection('saml')).not.toBeNull();
  });
});

describe('inheritedSsoRole', () => {
  it('carries admin over, preferring it to driver', () => {
    expect(inheritedSsoRole(['admin'])).toBe('admin');
    expect(inheritedSsoRole(['driver', 'admin'])).toBe('admin');
  });

  it('carries driver over', () => {
    expect(inheritedSsoRole(['student', 'driver'])).toBe('driver');
  });

  it('carries nothing over from students, parents or no previous account', () => {
    expect(inheritedSsoRole(['student'])).toBeNull();
    expect(inheritedSsoRole(['parent'])).toBeNull();
    expect(inheritedSsoRole([undefined])).toBeNull();
    expect(inheritedSsoRole([])).toBeNull();
  });
});
