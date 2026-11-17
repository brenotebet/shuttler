// backend/joinCode.ts
// Join codes let riders find an organization that isn't in the public list
// (an unlisted K-12 school, airport or company shuttle). A code is only for
// *finding* the org — signing in still needs an account, an allowed email
// domain or admin approval, same as picking a listed org.
//
// Codes are random (not derived from the org name, unlike slugs), so an
// unlisted org can't be found by guessing. Lookups are rate limited.

/** No 0/O, 1/I/L — codes are read aloud and typed from flyers. */
export const JOIN_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const JOIN_CODE_LENGTH = 6;

/**
 * A new random code. `randomBytes` is injected (crypto.randomBytes in the
 * server) so this stays testable. Rejection sampling keeps every character
 * equally likely.
 */
export function generateJoinCode(randomBytes: (n: number) => Uint8Array): string {
  const max = Math.floor(256 / JOIN_CODE_ALPHABET.length) * JOIN_CODE_ALPHABET.length;
  let code = '';
  while (code.length < JOIN_CODE_LENGTH) {
    for (const b of randomBytes(JOIN_CODE_LENGTH * 2)) {
      if (b < max) code += JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length];
      if (code.length === JOIN_CODE_LENGTH) break;
    }
  }
  return code;
}

/**
 * Normalizes what a rider typed: case, spaces and dashes don't matter.
 * Returns null if it can't be a code (wrong length, or a character codes
 * never use, like O or 1).
 */
export function normalizeJoinCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '');
  if (cleaned.length !== JOIN_CODE_LENGTH) return null;
  for (const ch of cleaned) {
    if (!JOIN_CODE_ALPHABET.includes(ch)) return null;
  }
  return cleaned;
}

/** Orgs are listed publicly unless an admin turned it off. */
export function isOrgListed(org: { listed?: unknown } | null | undefined): boolean {
  return org?.listed !== false;
}
