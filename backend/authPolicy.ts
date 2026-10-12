// backend/authPolicy.ts
// Which sign-in providers each org authMethod accepts. Kept free of Firebase
// imports so it can be unit-tested directly.
//
//   email / google / email+google → email/password, Google, Apple
//   phone                         → SMS (parents) + email/password admin escape hatch
//   saml                          → IdP via /saml/exchange + email/password admin escape hatch
//
// The email/password escape hatch is enforced on the client (only admins may
// use it) — Firebase password sign-in never touches this server.

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
 * only accept the founder's account (their admin escape hatch) — everyone else
 * must come through the IdP. Used by POST /auth/email/register.
 */
export function emailRegistrationRejection(
  authMethod: string | null | undefined,
  isFounder: boolean,
): string | null {
  if (authMethod === 'phone') {
    return 'This organization uses phone sign-in. Please use the phone sign-in option to access the app.';
  }
  if (authMethod === 'saml' && !isFounder) {
    return "This organization signs in through its SSO provider. Use \"Continue with SSO\" instead.";
  }
  return null;
}
