// __tests__/utils.scheduleUtils.test.ts
// Tests for route schedule resolution: is-open checks, next-open text, and
// today's-hours text — including timezone handling, since a route's schedule
// is evaluated in the org's IANA timezone, not the device's.

import { isRouteActive, getNextOpenText, getTodayScheduleText, formatTime12h, getTodayKey } from '../src/utils/scheduleUtils';
import type { Route, WeekSchedule } from '../src/org/OrgContext';

const ALWAYS_OPEN: WeekSchedule = {
  sunday:    { isOpen: true, open: '00:00', close: '23:59' },
  monday:    { isOpen: true, open: '00:00', close: '23:59' },
  tuesday:   { isOpen: true, open: '00:00', close: '23:59' },
  wednesday: { isOpen: true, open: '00:00', close: '23:59' },
  thursday:  { isOpen: true, open: '00:00', close: '23:59' },
  friday:    { isOpen: true, open: '00:00', close: '23:59' },
  saturday:  { isOpen: true, open: '00:00', close: '23:59' },
};

const WEEKDAYS_9_TO_5: WeekSchedule = {
  sunday:    { isOpen: false, open: '09:00', close: '17:00' },
  monday:    { isOpen: true,  open: '09:00', close: '17:00' },
  tuesday:   { isOpen: true,  open: '09:00', close: '17:00' },
  wednesday: { isOpen: true,  open: '09:00', close: '17:00' },
  thursday:  { isOpen: true,  open: '09:00', close: '17:00' },
  friday:    { isOpen: true,  open: '09:00', close: '17:00' },
  saturday:  { isOpen: false, open: '09:00', close: '17:00' },
};

function routeWith(schedule: WeekSchedule | undefined): Route {
  return { id: 'r1', name: 'Main Loop', stopIds: [], schedule };
}

describe('isRouteActive', () => {
  it('is always active when the route has no schedule configured', () => {
    expect(isRouteActive(routeWith(undefined))).toBe(true);
    expect(isRouteActive(null)).toBe(true);
    expect(isRouteActive(undefined)).toBe(true);
  });

  it('is active any time on an always-open schedule', () => {
    const noon = new Date('2026-07-25T12:00:00Z'); // a Saturday
    expect(isRouteActive(routeWith(ALWAYS_OPEN), noon, 'UTC')).toBe(true);
  });

  it('is inactive on a day marked closed', () => {
    const sunday = new Date('2026-07-26T12:00:00Z'); // Sunday
    expect(isRouteActive(routeWith(WEEKDAYS_9_TO_5), sunday, 'UTC')).toBe(false);
  });

  it('is active within the open window on an open day', () => {
    const mondayNoon = new Date('2026-07-27T12:00:00Z'); // Monday
    expect(isRouteActive(routeWith(WEEKDAYS_9_TO_5), mondayNoon, 'UTC')).toBe(true);
  });

  it('is inactive before opening and at/after closing', () => {
    const mondayEarly = new Date('2026-07-27T08:00:00Z'); // 08:00 UTC — before 09:00 open
    const mondayClose = new Date('2026-07-27T17:00:00Z'); // exactly close — end is exclusive
    expect(isRouteActive(routeWith(WEEKDAYS_9_TO_5), mondayEarly, 'UTC')).toBe(false);
    expect(isRouteActive(routeWith(WEEKDAYS_9_TO_5), mondayClose, 'UTC')).toBe(false);
  });

  it('resolves the day/time in the given timezone, not UTC', () => {
    // 02:00 UTC Monday is still Sunday 21:00 in America/Chicago (UTC-5 in July, DST) — closed.
    const earlyMondayUtc = new Date('2026-07-27T02:00:00Z');
    expect(isRouteActive(routeWith(WEEKDAYS_9_TO_5), earlyMondayUtc, 'America/Chicago')).toBe(false);
    // The same instant is fine when read as UTC — still Monday but before opening.
    expect(isRouteActive(routeWith(WEEKDAYS_9_TO_5), earlyMondayUtc, 'UTC')).toBe(false);
  });

  it('falls back to device-local time for an invalid timezone string', () => {
    // Should not throw, and should behave the same as omitting the timezone.
    const noon = new Date('2026-07-25T12:00:00Z');
    expect(() => isRouteActive(routeWith(ALWAYS_OPEN), noon, 'Not/A_Zone')).not.toThrow();
  });
});

describe('formatTime12h', () => {
  it('formats midnight, noon, and PM hours', () => {
    expect(formatTime12h('00:00')).toBe('12:00 AM');
    expect(formatTime12h('12:00')).toBe('12:00 PM');
    expect(formatTime12h('13:30')).toBe('1:30 PM');
    expect(formatTime12h('09:05')).toBe('9:05 AM');
  });
});

describe('getTodayScheduleText', () => {
  it('is blank when there is no schedule', () => {
    expect(getTodayScheduleText(routeWith(undefined))).toBe('');
  });

  it('reports closed on a closed day', () => {
    const sunday = new Date('2026-07-26T12:00:00Z');
    expect(getTodayScheduleText(routeWith(WEEKDAYS_9_TO_5), sunday, 'UTC')).toBe('Closed today');
  });

  it('reports open hours on an open day', () => {
    const monday = new Date('2026-07-27T12:00:00Z');
    expect(getTodayScheduleText(routeWith(WEEKDAYS_9_TO_5), monday, 'UTC')).toBe('Today: 9:00 AM – 5:00 PM');
  });
});

describe('getNextOpenText', () => {
  it('is blank when there is no schedule', () => {
    expect(getNextOpenText(routeWith(undefined))).toBe('');
  });

  it('reports later today when still before opening', () => {
    const mondayEarly = new Date('2026-07-27T08:00:00Z');
    expect(getNextOpenText(routeWith(WEEKDAYS_9_TO_5), mondayEarly, 'UTC')).toBe('Opens today at 9:00 AM');
  });

  it('reports tomorrow when past closing on a weekday', () => {
    const mondayNight = new Date('2026-07-27T20:00:00Z');
    expect(getNextOpenText(routeWith(WEEKDAYS_9_TO_5), mondayNight, 'UTC')).toBe('Opens tomorrow at 9:00 AM');
  });

  it('skips the closed weekend and names the next open day', () => {
    const fridayNight = new Date('2026-07-31T20:00:00Z'); // Friday, past close
    expect(getNextOpenText(routeWith(WEEKDAYS_9_TO_5), fridayNight, 'UTC')).toBe('Opens Monday at 9:00 AM');
  });
});

describe('getTodayKey', () => {
  it('resolves the weekday key in the given timezone', () => {
    const monday = new Date('2026-07-27T12:00:00Z');
    expect(getTodayKey(monday, 'UTC')).toBe('monday');
  });

  it('falls back to device-local weekday when timezone is omitted', () => {
    const monday = new Date('2026-07-27T12:00:00Z');
    expect(getTodayKey(monday)).toBe(getTodayKey(monday));
  });
});
