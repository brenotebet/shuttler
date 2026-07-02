// backend/profanity.ts
//
// Server-side mirror of src/utils/profanity.ts. The backend uses its own
// tsconfig (backend/**/* only) and cannot import from ../src, so the blocklist
// and matcher are duplicated here. Keep the two files in sync.
//
// Server-side enforcement is the authoritative check — the client copy is for
// immediate UX feedback and can be bypassed.

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

const MATCHERS: RegExp[] = BLOCKLIST.map((word) => {
  const spaced = word.split('').join('[^a-z]*');
  return new RegExp(`(?:^|[^a-z])${spaced}(?:[^a-z]|$)`, 'i');
});

export function containsProfanity(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = normalizeLeet(text);
  return MATCHERS.some((re) => re.test(normalized));
}
