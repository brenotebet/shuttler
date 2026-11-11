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
 * The lowercased domain of an email address, or '' when there's no "@". Taken
 * from after the LAST "@": split('@')[1] reads "school.edu" out of
 * "x@school.edu@evil.example", whose mail actually goes to evil.example —
 * which would pass an allowed-domains check it shouldn't.
 */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).toLowerCase();
}

/**
 * Whether a legacy SSO account (keyed by the raw IdP subject, from before uids
 * were namespaced per org) belongs to the person in this assertion. IdPs can
 * reassign subjects (recycled usernames), so the stored email must match —
 * with no email on either side there's no proof, so no takeover.
 */
export function legacySsoAccountMatches(storedEmail: unknown, assertionEmail: string | null | undefined): boolean {
  return typeof storedEmail === 'string'
    && !!assertionEmail
    && storedEmail.trim().toLowerCase() === assertionEmail.trim().toLowerCase();
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

// authMethods an org can be switched to directly. 'saml' isn't one: it goes
// live only through the draft → test → activate flow.
const DIRECT_AUTH_METHODS = ['email', 'google', 'email+google', 'phone'];

/**
 * Error message when `authMethod` isn't a method POST /admin/orgs/:orgId/auth-config
 * may switch an org to without a SAML config, or null when it's allowed.
 */
export function directAuthMethodRejection(authMethod: unknown): string | null {
  return typeof authMethod === 'string' && DIRECT_AUTH_METHODS.includes(authMethod)
    ? null
    : `authMethod must be one of ${DIRECT_AUTH_METHODS.join(', ')} (or saml with a samlConfig).`;
}

/**
 * Cleans an admin-supplied allowed-domains list: lowercased, trimmed, a
 * leading "@" dropped, blanks and duplicates removed — so "@McKendree.edu "
 * matches emailDomain()'s output. Returns null when the input isn't a list of
 * strings, or an entry isn't a plausible bare domain.
 */
export function normalizeAllowedEmailDomains(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const domains: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') return null;
    const d = raw.trim().toLowerCase().replace(/^@/, '');
    if (!d) continue;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return null;
    if (!domains.includes(d)) domains.push(d);
  }
  return domains;
}

// How long a successful SSO test login stays valid for activation.
export const SSO_TEST_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Error message when an org admin may not activate SAML yet, or null when they
 * may. SAML orgs are SSO-only, and an admin keeps their role only through an
 * SSO account with the same email (see inheritedSsoRole) — so activation
 * requires a recent test login whose email matches the activating admin's.
 * Otherwise the founder can lock themselves out: their SSO login lands as a
 * student and their password login stops working. Super admins may override
 * (support activating on a customer's behalf).
 */
export function ssoActivationRejection(opts: {
  lastTest: { email?: unknown; atMs?: unknown } | null | undefined;
  callerEmails: (string | null | undefined)[];
  isSuperAdmin: boolean;
  nowMs: number;
}): string | null {
  if (opts.isSuperAdmin) return null;
  const { lastTest } = opts;
  if (!lastTest || typeof lastTest.atMs !== 'number' || opts.nowMs - lastTest.atMs > SSO_TEST_MAX_AGE_MS) {
    return 'Run "Test connection" with your own SSO login (within the last hour) before activating.';
  }
  if (typeof lastTest.email !== 'string' || !lastTest.email.trim()) {
    return "Your identity provider didn't send an email address in the test login, so admins wouldn't keep their "
      + 'access after SSO goes live. Ask your IT team to release the email attribute, then test again.';
  }
  const tested = lastTest.email.trim().toLowerCase();
  const mine = opts.callerEmails
    .filter((e): e is string => typeof e === 'string' && !!e.trim())
    .map((e) => e.trim().toLowerCase());
  if (!mine.includes(tested)) {
    return `The test login used ${tested}, which doesn't match your Shuttler email, so you'd lose admin access `
      + 'once SSO is live. Test with your own SSO account, or contact support@shuttler.net.';
  }
  return null;
}

/**
 * Error message when a session may not use an org's admin API, or null when it
 * may. Mirrors sessionAllowedInOrg in firestore.rules: a SAML org accepts only
 * sessions minted by /saml/exchange (sign_in_provider 'custom'), so a leftover
 * password/Google login — e.g. of someone the IdP has offboarded — can't keep
 * administering the org through the backend.
 */
export function orgSessionRejection(
  authMethod: string | null | undefined,
  provider: string | null | undefined,
): string | null {
  if ((authMethod ?? 'email') === 'saml' && provider !== 'custom') {
    return 'This organization signs in through SSO. Sign in with "Continue with SSO" to manage it.';
  }
  return null;
}

/**
 * Which pre-SSO account an SSO member should be restored onto when the org
 * leaves SAML: the first uid in `linkedFrom` that still has a Firebase login,
 * preferring one whose login email matches the member's. Null when none can
 * sign in any more.
 */
export function preSsoRestoreTarget(
  linkedFrom: unknown,
  memberEmail: string | null | undefined,
  loginEmails: Record<string, string | null | undefined>,
): string | null {
  if (!Array.isArray(linkedFrom)) return null;
  const candidates = linkedFrom.filter((u): u is string => typeof u === 'string' && u in loginEmails);
  const email = memberEmail?.trim().toLowerCase();
  const sameEmail = email
    ? candidates.find((u) => loginEmails[u]?.trim().toLowerCase() === email)
    : undefined;
  return sameEmail ?? candidates[0] ?? null;
}

// ---------- Member approval (K-12 / phone-sign-in orgs) ----------
// Anyone who can sign in to a K-12 org sees live bus positions, so every new
// member there waits for an org admin to approve them. SAML orgs are exempt:
// their IdP already vouches for everyone. Members whose doc has no
// approvalStatus (everyone who joined before this existed) count as approved.

export type ApprovalStatus = 'pending' | 'approved' | 'declined';

/** Whether new members of this org must be approved by an org admin. */
export function requiresMemberApproval(org: { orgType?: unknown; authMethod?: unknown }): boolean {
  if (org.authMethod === 'saml') return false;
  return org.orgType === 'k12' || org.authMethod === 'phone';
}

/** A member doc's approval status; a missing field means approved (pre-existing members). */
export function memberApprovalStatus(member: { approvalStatus?: unknown } | null | undefined): ApprovalStatus {
  const s = member?.approvalStatus;
  return s === 'pending' || s === 'declined' ? s : 'approved';
}

export const PARENT_RELATIONSHIPS = ['parent', 'guardian', 'grandparent', 'other'] as const;
export const MAX_APPLICATION_CHILDREN = 8;

export type ParentApplication = {
  fullName: string;
  relationship: (typeof PARENT_RELATIONSHIPS)[number];
  children: { name: string; grade: string | null }[];
};

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Validates what a parent tells the school when they ask to join: their name,
 * relationship to the child, and each child's name and grade. The admin checks
 * this — and the SMS-verified phone number — against the school's records.
 */
export function parseParentApplication(input: unknown): ParentApplication | { error: string } {
  const body = (input ?? {}) as Record<string, unknown>;
  const fullName = cleanText(body.fullName);
  if (fullName.length < 3 || !fullName.includes(' ') || fullName.length > 80) {
    return { error: 'Enter your first and last name.' };
  }
  const relationship = cleanText(body.relationship).toLowerCase();
  if (!(PARENT_RELATIONSHIPS as readonly string[]).includes(relationship)) {
    return { error: 'Choose your relationship to the child.' };
  }
  if (!Array.isArray(body.children) || body.children.length === 0) {
    return { error: 'Add at least one child.' };
  }
  if (body.children.length > MAX_APPLICATION_CHILDREN) {
    return { error: `Add at most ${MAX_APPLICATION_CHILDREN} children.` };
  }
  const children: ParentApplication['children'] = [];
  for (const raw of body.children) {
    const child = (raw ?? {}) as Record<string, unknown>;
    const name = cleanText(child.name);
    if (name.length < 2 || name.length > 60) return { error: "Enter each child's full name." };
    const grade = cleanText(child.grade);
    if (grade.length > 20) return { error: 'Grade is too long.' };
    children.push({ name, grade: grade || null });
  }
  return { fullName, relationship: relationship as ParentApplication['relationship'], children };
}

/** Cleans an admin's optional reason for declining a request (shown to the person). */
export function cleanDeclineReason(input: unknown): string | null {
  const reason = cleanText(input);
  return reason ? reason.slice(0, 200) : null;
}
