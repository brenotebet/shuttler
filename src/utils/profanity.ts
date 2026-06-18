// src/utils/profanity.ts
//
// Lightweight content moderation for user-supplied text (org names, display
// names, stop names, announcements, etc). Catches common profanity and slurs,
// including light obfuscation (leetspeak and separators like "f.u.c.k" or
// "f u c k"), while avoiding the classic "Scunthorpe problem" — substrings
// inside innocent words (e.g. "class", "assistant", "Scunthorpe") are NOT
// flagged because matches require word boundaries.
//
// This is a deterrent for casual abuse, not a guarantee. The backend mirrors
// this list in backend/profanity.ts — keep the two in sync.

// Base blocklist. Lowercase, no separators. Keep entries as the "root" word;
// the matcher handles spacing/leet variants automatically.
const BLOCKLIST: string[] = [
  'anal', 'anus', 'arse', 'arsehole', 'ass', 'asshole', 'bastard', 'bitch',
  'blowjob', 'bollocks', 'boner', 'boob', 'bugger', 'bullshit', 'clit',
  'cock', 'coon', 'crap', 'cum', 'cunt', 'dick', 'dildo', 'dyke', 'fag',
  'faggot', 'fuck', 'fucker', 'fucking', 'goddamn', 'handjob', 'hardon',
  'hoe', 'horny', 'jerkoff', 'jizz', 'kike', 'nigga', 'nigger', 'nutsack',
  'paki', 'penis', 'piss', 'prick', 'pussy', 'queer', 'rape', 'retard',
  'rimjob', 'shit', 'shithead', 'slut', 'spic', 'tit', 'titties', 'twat',
  'vagina', 'wank', 'wanker', 'whore',
];

// Map common leetspeak / homoglyph substitutions back to letters so that
// "fvck", "sh1t", "@ss" normalize before matching.
const LEET_MAP: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't', '(': 'c',
};

function normalizeLeet(input: string): string {
  return input
    .toLowerCase()
    .split('')
    .map((ch) => LEET_MAP[ch] ?? ch)
    .join('');
}

// Build one matcher per word. Letters may be separated by any run of
// non-letters (spaces, dots, dashes), and the whole match must sit on word
// boundaries so it never fires inside a larger alphabetic word.
const MATCHERS: RegExp[] = BLOCKLIST.map((word) => {
  const spaced = word.split('').join('[^a-z]*');
  return new RegExp(`(?:^|[^a-z])${spaced}(?:[^a-z]|$)`, 'i');
});

/**
 * Returns true if the text contains blocklisted profanity or slurs.
 */
export function containsProfanity(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = normalizeLeet(text);
  return MATCHERS.some((re) => re.test(normalized));
}

/**
 * Validates a user-supplied text field. Returns an error message string if the
 * value is not acceptable, or null if it's fine.
 *
 * @param text  The raw user input.
 * @param label Human-readable field name used in the error message (e.g. "Stop name").
 */
export function validateUserText(
  text: string | null | undefined,
  label = 'This field',
): string | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return `${label} cannot be empty.`;
  if (containsProfanity(trimmed)) {
    return `${label} contains inappropriate language. Please choose something else.`;
  }
  return null;
}
