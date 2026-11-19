import { isPresent, presenceAction, presenceDisplayValue } from '../src/utils/presence';

describe('isPresent', () => {
  it('treats null, undefined and false as hidden', () => {
    expect(isPresent(null)).toBe(false);
    expect(isPresent(undefined)).toBe(false);
    expect(isPresent(false)).toBe(false);
  });

  it('treats ids, true and arrays as shown', () => {
    expect(isPresent('bus1')).toBe(true);
    expect(isPresent(true)).toBe(true);
    expect(isPresent(['bus1', 'bus2'])).toBe(true);
  });
});

describe('presenceAction', () => {
  it('enters when a value appears and exits when it clears', () => {
    expect(presenceAction(null, 'bus1')).toBe('enter');
    expect(presenceAction('bus1', null)).toBe('exit');
    expect(presenceAction(true, false)).toBe('exit');
  });

  it('does nothing when nothing is shown or the value is unchanged', () => {
    expect(presenceAction(null, null)).toBe('none');
    expect(presenceAction('bus1', 'bus1', true)).toBe('none');
  });

  it('replays only when asked, on a switch to another value', () => {
    expect(presenceAction('stopA', 'stopB')).toBe('none');
    expect(presenceAction('stopA', 'stopB', true)).toBe('replay');
  });
});

describe('presenceDisplayValue', () => {
  it('shows the live value', () => {
    expect(presenceDisplayValue('bus2', 'bus1', true)).toBe('bus2');
  });

  it('keeps the last value while animating out', () => {
    expect(presenceDisplayValue(null, 'bus1', true)).toBe('bus1');
  });

  it('shows nothing once gone', () => {
    expect(presenceDisplayValue(null, 'bus1', false)).toBeNull();
  });
});
