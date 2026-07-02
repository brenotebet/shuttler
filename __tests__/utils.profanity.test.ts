// __tests__/utils.profanity.test.ts
// Tests for user-generated-content moderation (org names, display names,
// stop/route names, announcements).

import { containsProfanity, validateUserText } from '../src/utils/profanity';

describe('containsProfanity', () => {
  it('returns false for clean text', () => {
    expect(containsProfanity('Main Entrance')).toBe(false);
    expect(containsProfanity('McKendree University')).toBe(false);
    expect(containsProfanity('Morning Loop')).toBe(false);
    expect(containsProfanity('Library Stop')).toBe(false);
    expect(containsProfanity('')).toBe(false);
    expect(containsProfanity(null)).toBe(false);
    expect(containsProfanity(undefined)).toBe(false);
  });

  it('flags blatant profanity', () => {
    expect(containsProfanity('fuck')).toBe(true);
    expect(containsProfanity('this is shit')).toBe(true);
    expect(containsProfanity('Bitch Stop')).toBe(true);
  });

  it('catches leetspeak obfuscation', () => {
    expect(containsProfanity('sh1t')).toBe(true);
    expect(containsProfanity('@sshole')).toBe(true);
    expect(containsProfanity('f4ggot')).toBe(true);
  });

  it('catches separator obfuscation', () => {
    expect(containsProfanity('f u c k')).toBe(true);
    expect(containsProfanity('s.h.i.t')).toBe(true);
    expect(containsProfanity('f-u-c-k off')).toBe(true);
  });

  it('does NOT flag innocent words containing bad substrings (Scunthorpe problem)', () => {
    expect(containsProfanity('class schedule')).toBe(false);
    expect(containsProfanity('AI assistant')).toBe(false);
    expect(containsProfanity('Scunthorpe')).toBe(false);
    expect(containsProfanity('Cockburn Street')).toBe(false);
    expect(containsProfanity('grass')).toBe(false);
    expect(containsProfanity('analysis')).toBe(false);
    expect(containsProfanity('Shitake')).toBe(false); // not exactly "shit" on a boundary
  });
});

describe('validateUserText', () => {
  it('returns null for valid input', () => {
    expect(validateUserText('Main Gate', 'Stop name')).toBeNull();
  });

  it('rejects empty input with the field label', () => {
    expect(validateUserText('   ', 'Stop name')).toBe('Stop name cannot be empty.');
  });

  it('rejects profane input with the field label', () => {
    expect(validateUserText('fuck', 'Org name')).toBe(
      'Org name contains inappropriate language. Please choose something else.',
    );
  });
});
