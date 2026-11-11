// __tests__/backend.authPolicy.test.ts
// Tests for which sign-in providers each org authMethod accepts
// (POST /auth/social/complete and POST /auth/email/register).

import {
  carriedOverProfile,
  cleanDeclineReason,
  directAuthMethodRejection,
  emailDomain,
  emailRegistrationRejection,
  inheritedSsoRole,
  legacySsoAccountMatches,
  MAX_APPLICATION_CHILDREN,
  memberApprovalStatus,
  normalizeAllowedEmailDomains,
  orgSessionRejection,
  parseParentApplication,
  preSsoRestoreTarget,
  requiresMemberApproval,
  socialSignInRejection,
  SSO_TEST_MAX_AGE_MS,
  ssoActivationRejection,
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

describe('directAuthMethodRejection', () => {
  it('allows the methods an org can switch to in one step', () => {
    for (const m of ['email', 'google', 'email+google', 'phone']) {
      expect(directAuthMethodRejection(m)).toBeNull();
    }
  });

  it('rejects saml without a config, missing and unknown methods', () => {
    // 'saml' with no samlConfig used to delete the config and leave the org
    // SSO-only with no IdP — a full lockout.
    expect(directAuthMethodRejection('saml')).not.toBeNull();
    expect(directAuthMethodRejection(undefined)).not.toBeNull();
    expect(directAuthMethodRejection('password')).not.toBeNull();
  });
});

describe('normalizeAllowedEmailDomains', () => {
  it('lowercases, trims, drops a leading @, blanks and duplicates', () => {
    expect(normalizeAllowedEmailDomains([' @McKendree.EDU ', '', 'mckendree.edu', 'alumni.mckendree.edu']))
      .toEqual(['mckendree.edu', 'alumni.mckendree.edu']);
  });

  it('accepts an empty list (open registration)', () => {
    expect(normalizeAllowedEmailDomains([])).toEqual([]);
  });

  it('rejects non-lists, non-strings and things that are not domains', () => {
    expect(normalizeAllowedEmailDomains('mckendree.edu')).toBeNull();
    expect(normalizeAllowedEmailDomains([42])).toBeNull();
    expect(normalizeAllowedEmailDomains(['jane@mckendree.edu'])).toBeNull();
    expect(normalizeAllowedEmailDomains(['mckendree'])).toBeNull();
  });
});

describe('ssoActivationRejection', () => {
  const now = 1_800_000_000_000;
  const base = { callerEmails: ['Founder@School.edu'], isSuperAdmin: false, nowMs: now };

  it('allows activation after a recent test as the activating admin, ignoring case', () => {
    expect(ssoActivationRejection({ ...base, lastTest: { email: 'founder@school.edu', atMs: now - 60_000 } })).toBeNull();
  });

  it('matches either of the caller emails (token or member doc)', () => {
    expect(ssoActivationRejection({
      ...base,
      callerEmails: [undefined, 'founder@school.edu'],
      lastTest: { email: 'founder@school.edu', atMs: now },
    })).toBeNull();
  });

  it('blocks when the test login is someone else — the founder would land as a student', () => {
    expect(ssoActivationRejection({ ...base, lastTest: { email: 'it.person@school.edu', atMs: now } }))
      .toMatch(/doesn't match your Shuttler email/);
  });

  it('blocks when the IdP released no email — no admin role could carry over', () => {
    expect(ssoActivationRejection({ ...base, lastTest: { email: null, atMs: now } })).toMatch(/email attribute/);
  });

  it('blocks with no test, or a stale one', () => {
    expect(ssoActivationRejection({ ...base, lastTest: undefined })).toMatch(/Test connection/);
    expect(ssoActivationRejection({
      ...base,
      lastTest: { email: 'founder@school.edu', atMs: now - SSO_TEST_MAX_AGE_MS - 1 },
    })).toMatch(/Test connection/);
  });

  it('lets a super admin override (support activating for a customer)', () => {
    expect(ssoActivationRejection({ ...base, isSuperAdmin: true, lastTest: undefined })).toBeNull();
  });
});

describe('orgSessionRejection', () => {
  it('requires an SSO (custom token) session for a SAML org', () => {
    expect(orgSessionRejection('saml', 'custom')).toBeNull();
    expect(orgSessionRejection('saml', 'password')).not.toBeNull();
    expect(orgSessionRejection('saml', 'google.com')).not.toBeNull();
    expect(orgSessionRejection('saml', undefined)).not.toBeNull();
  });

  it('places no restriction on non-SAML orgs', () => {
    expect(orgSessionRejection('email', 'password')).toBeNull();
    expect(orgSessionRejection(undefined, 'password')).toBeNull();
    expect(orgSessionRejection('phone', 'phone')).toBeNull();
  });
});

describe('preSsoRestoreTarget', () => {
  it('prefers the earlier login whose email matches the member', () => {
    expect(preSsoRestoreTarget(
      ['legacySubject', 'founderUid'],
      'founder@school.edu',
      { legacySubject: null, founderUid: 'Founder@School.edu' },
    )).toBe('founderUid');
  });

  it('falls back to the first earlier login that still exists', () => {
    expect(preSsoRestoreTarget(['gone', 'a', 'b'], 'x@school.edu', { a: 'a@school.edu', b: null })).toBe('a');
  });

  it('returns null when no earlier login can sign in any more', () => {
    expect(preSsoRestoreTarget(['gone'], 'x@school.edu', {})).toBeNull();
    expect(preSsoRestoreTarget(undefined, 'x@school.edu', { a: null })).toBeNull();
  });
});

describe('requiresMemberApproval', () => {
  it('requires approval in K-12 and phone-sign-in orgs', () => {
    expect(requiresMemberApproval({ orgType: 'k12', authMethod: 'email' })).toBe(true);
    expect(requiresMemberApproval({ orgType: 'k12' })).toBe(true);
    expect(requiresMemberApproval({ orgType: 'other', authMethod: 'phone' })).toBe(true);
  });

  it('leaves universities and other email orgs open (McKendree unchanged)', () => {
    expect(requiresMemberApproval({ orgType: 'university', authMethod: 'email' })).toBe(false);
    expect(requiresMemberApproval({})).toBe(false);
  });

  it('exempts SAML orgs — the IdP already vouches for everyone', () => {
    expect(requiresMemberApproval({ orgType: 'k12', authMethod: 'saml' })).toBe(false);
  });
});

describe('memberApprovalStatus', () => {
  it('treats members from before approvals existed as approved', () => {
    expect(memberApprovalStatus({})).toBe('approved');
    expect(memberApprovalStatus(undefined)).toBe('approved');
  });

  it('reads pending and declined; anything unknown is approved', () => {
    expect(memberApprovalStatus({ approvalStatus: 'pending' })).toBe('pending');
    expect(memberApprovalStatus({ approvalStatus: 'declined' })).toBe('declined');
    expect(memberApprovalStatus({ approvalStatus: 'approved' })).toBe('approved');
  });
});

describe('parseParentApplication', () => {
  const valid = {
    fullName: '  Maria   Silva ',
    relationship: 'Guardian',
    children: [{ name: 'Ana Silva', grade: ' 3 ' }, { name: 'Leo Silva', grade: '' }],
  };

  it('accepts and cleans a complete application', () => {
    expect(parseParentApplication(valid)).toEqual({
      fullName: 'Maria Silva',
      relationship: 'guardian',
      children: [{ name: 'Ana Silva', grade: '3' }, { name: 'Leo Silva', grade: null }],
    });
  });

  it('requires a first and last name', () => {
    expect(parseParentApplication({ ...valid, fullName: 'Maria' })).toHaveProperty('error');
    expect(parseParentApplication({ ...valid, fullName: '' })).toHaveProperty('error');
  });

  it('requires a known relationship', () => {
    expect(parseParentApplication({ ...valid, relationship: 'neighbor' })).toHaveProperty('error');
  });

  it(`requires 1–${MAX_APPLICATION_CHILDREN} named children`, () => {
    expect(parseParentApplication({ ...valid, children: [] })).toHaveProperty('error');
    expect(parseParentApplication({ ...valid, children: [{ name: 'A' }] })).toHaveProperty('error');
    expect(parseParentApplication({
      ...valid,
      children: Array.from({ length: MAX_APPLICATION_CHILDREN + 1 }, (_, i) => ({ name: `Kid ${i}` })),
    })).toHaveProperty('error');
  });

  it('rejects a missing application (old app builds)', () => {
    expect(parseParentApplication(undefined)).toHaveProperty('error');
  });
});

describe('cleanDeclineReason', () => {
  it('trims, caps at 200 characters, and treats blank as no reason', () => {
    expect(cleanDeclineReason('  Not on our contact list  ')).toBe('Not on our contact list');
    expect(cleanDeclineReason('x'.repeat(300))).toHaveLength(200);
    expect(cleanDeclineReason('   ')).toBeNull();
    expect(cleanDeclineReason(undefined)).toBeNull();
  });
});
