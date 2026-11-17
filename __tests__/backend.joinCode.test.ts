// __tests__/backend.joinCode.test.ts
import crypto from 'crypto';
import {
  generateJoinCode,
  normalizeJoinCode,
  isOrgListed,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
} from '../backend/joinCode';

describe('generateJoinCode', () => {
  it('makes codes of the right length from the safe alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode((n) => crypto.randomBytes(n));
      expect(code).toHaveLength(JOIN_CODE_LENGTH);
      for (const ch of code) expect(JOIN_CODE_ALPHABET).toContain(ch);
    }
  });

  it('skips bytes that would bias the alphabet', () => {
    // 248 and up are rejected (31 * 8 = 248); then 0 → '2', 1 → '3' …
    const bytes = [255, 250, 248, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    let i = 0;
    const code = generateJoinCode((n) => Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length]));
    expect(code).toBe('234567');
  });

  it('does not repeat in practice', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(generateJoinCode((n) => crypto.randomBytes(n)));
    expect(seen.size).toBe(2000);
  });
});

describe('normalizeJoinCode', () => {
  it('ignores case, spaces and dashes', () => {
    expect(normalizeJoinCode('k7q-4mx')).toBe('K7Q4MX');
    expect(normalizeJoinCode(' K7Q 4MX ')).toBe('K7Q4MX');
  });

  it('rejects wrong lengths, look-alike characters and non-strings', () => {
    expect(normalizeJoinCode('K7Q4M')).toBeNull();
    expect(normalizeJoinCode('K7Q4MXY')).toBeNull();
    expect(normalizeJoinCode('K7Q4M0')).toBeNull(); // zero
    expect(normalizeJoinCode('K7Q4MO')).toBeNull(); // letter O
    expect(normalizeJoinCode('K7Q4M1')).toBeNull();
    expect(normalizeJoinCode(null)).toBeNull();
    expect(normalizeJoinCode(123456)).toBeNull();
  });
});

describe('isOrgListed', () => {
  it('lists orgs unless listed is explicitly false', () => {
    expect(isOrgListed({})).toBe(true);
    expect(isOrgListed({ listed: true })).toBe(true);
    expect(isOrgListed(undefined)).toBe(true);
    expect(isOrgListed({ listed: false })).toBe(false);
  });
});
