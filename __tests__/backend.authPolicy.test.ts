// __tests__/backend.authPolicy.test.ts
// Tests for which sign-in providers each org authMethod accepts
// (POST /auth/social/complete and POST /auth/email/register).

import {
  carriedOverProfile,
  emailDomain,
  emailRegistrationRejection,
  inheritedSsoRole,
  legacySsoAccountMatches,
  socialSignInRejection,
  ssoUid,
} from '../backend/authPolicy';

describe('legacySsoAccountMatches', () => {
  it('matches when the stored email equals the assertion email, ignoring case', () => {
    expect(legacySsoAccountMatches('John@School.edu', 'john@school.edu')).toBe(true);
  });

  it('rejects a reassigned subject whose stored email belongs to someone else', () => {
    expect(legacySsoAccountMatches('former.admin@school.edu', 'new.hire@school.edu')).toBe(false);
  });

  it('rejects when either side has no email — no proof it is the same person', () => {
    expect(legacySsoAccountMatches(undefined, 'john@school.edu')).toBe(false);
    expect(legacySsoAccountMatches(null, 'john@school.edu')).toBe(false);
    expect(legacySsoAccountMatches('john@school.edu', null)).toBe(false);
  });
});

describe('emailDomain', () => {
  it('returns the lowercased domain', () => {
    expect(emailDomain('Jane@McKendree.EDU')).toBe('mckendree.edu');
  });

  it('reads the domain after the last "@", where the mail is actually delivered', () => {
    expect(emailDomain('x@school.edu@evil.example')).toBe('evil.example');
  });

  it('returns an empty string when there is no "@"', () => {
    expect(emailDomain('school.edu')).toBe('');
  });
});

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

describe('ssoUid', () => {
  it('is stable for the same org and subject', () => {
    expect(ssoUid('org1', 'jsmith@school.edu')).toBe(ssoUid('org1', 'jsmith@school.edu'));
  });

  it('differs per org, so one IdP cannot assert another org\'s users', () => {
    expect(ssoUid('org1', 'jsmith')).not.toBe(ssoUid('org2', 'jsmith'));
  });

  it('never equals the raw subject and fits Firebase uid limits', () => {
    const uid = ssoUid('org1', 'Xk2abcDEF123victimUid000000');
    expect(uid).not.toBe('Xk2abcDEF123victimUid000000');
    expect(uid).toMatch(/^saml_[0-9a-f]{64}$/);
    expect(uid.length).toBeLessThanOrEqual(128);
  });

  it('cannot be forged by moving characters between org and subject', () => {
    expect(ssoUid('org1', 'x')).not.toBe(ssoUid('org1x', ''));
  });
});

describe('carriedOverProfile', () => {
  it('takes each field from the first account that has it', () => {
    expect(carriedOverProfile([
      { displayName: 'Jane Doe', phone: null },
      { displayName: 'J. Doe', phone: '+15555550100', notificationPrefs: { newRequest: false } },
    ])).toEqual({
      displayName: 'Jane Doe',
      phone: '+15555550100',
      notificationPrefs: { newRequest: false },
    });
  });

  it('never carries over role, email or uid', () => {
    expect(carriedOverProfile([{ role: 'admin', email: 'a@b.edu', uid: 'old', orgId: 'org1' }])).toEqual({});
  });

  it('returns nothing when there are no previous accounts', () => {
    expect(carriedOverProfile([])).toEqual({});
  });
});
