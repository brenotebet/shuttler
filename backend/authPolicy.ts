// backend/authPolicy.ts
// Which sign-in providers each org authMethod accepts. Kept free of Firebase
// imports so it can be unit-tested directly.
//
//   email / google / email+google → email/password, Google, Apple
//   phone                         → SMS (parents) + email/password admin escape hatch
//   saml                          → IdP via /saml/exchange only (admins included)
//
// The phone-org email/password escape hatch is enforced on the client (only
// admins may use it) — Firebase password sign-in never touches this server.

import { createHash } from 'crypto';

const SOCIAL_PROVIDERS = ['google.com', 'apple.com'];
const SOCIAL_AUTH_METHODS = ['email', 'google', 'email+google'];

/**
 * Returns an error message when `provider` (the ID token's
 * firebase.sign_in_provider claim) may not be used to sign in to an org with
 * `authMethod`, or null when it's allowed. Used by POST /auth/social/complete.
 */
export function socialSignInRejection(
  authMethod: string | null | undefined,
  provider: string | null | undefined,
): string | null {
  const method = authMethod ?? 'email';

  if (method === 'saml') {
    return "This organization signs in through its SSO provider. Use \"Continue with SSO\" instead.";
  }
  if (provider === 'phone') {
    return method === 'phone'
      ? null
      : "This organization doesn't use phone sign-in.";
  }
  if (provider && SOCIAL_PROVIDERS.includes(provider)) {
    if (SOCIAL_AUTH_METHODS.includes(method)) return null;
    return method === 'phone'
      ? 'This organization uses phone sign-in. Please use the phone sign-in option.'
      : "This sign-in method isn't available for this organization.";
  }
  return "This sign-in method isn't available for this organization.";
}

/**
 * Returns an error message when a new email/password account may not be
 * registered in an org with `authMethod`, or null when it's allowed. SAML orgs
 * are SSO-only — everyone, admins included, must come through the IdP.
 * Used by POST /auth/email/register.
 */
export function emailRegistrationRejection(
  authMethod: string | null | undefined,
): string | null {
  if (authMethod === 'phone') {
    return 'This organization uses phone sign-in. Please use the phone sign-in option to access the app.';
  }
  if (authMethod === 'saml') {
    return "This organization signs in through its SSO provider. Use \"Continue with SSO\" instead.";
  }
  return null;
}

/**
 * The role a first-time SSO identity inherits from the org's pre-SSO accounts
 * with the same email (e.g. the founder's email/password admin login), or
 * null when none of them held an elevated role. SAML orgs are SSO-only, so
 * without this an admin would lose their access the moment SSO went live.
 * Used by POST /saml/exchange.
 */
export function inheritedSsoRole(previousRoles: unknown[]): 'admin' | 'driver' | null {
  if (previousRoles.includes('admin')) return 'admin';
  if (previousRoles.includes('driver')) return 'driver';
  return null;
}

/**
 * The Firebase uid for an SSO identity: a hash of the org and the IdP's
 * subject (uid/email/NameID attribute). Namespacing by org means one org's
 * IdP can never assert a uid that belongs to another org — or to any
 * non-SSO account — which a raw subject used as the uid allowed.
 */
export function ssoUid(orgId: string, idpSubject: string): string {
  return `saml_${createHash('sha256').update(`${orgId}\n${idpSubject}`).digest('hex')}`;
}

// Profile fields an SSO identity keeps from the account(s) it takes over.
// Role and ownership are handled separately (inheritedSsoRole).
const CARRIED_OVER_FIELDS = [
  'displayName', 'phone', 'phoneVerified', 'notificationPrefs',
  'defaultRouteId', 'agreedToTermsAt', 'createdAt',
];

/**
 * Merges the profile of the account(s) an SSO identity takes over: for each
 * carried-over field, the first account (in the order given) that has it wins.
 */
export function carriedOverProfile(previousProfiles: Record<string, unknown>[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const field of CARRIED_OVER_FIELDS) {
    const source = previousProfiles.find((p) => p[field] !== undefined && p[field] !== null);
    if (source) merged[field] = source[field];
  }
  return merged;
}
