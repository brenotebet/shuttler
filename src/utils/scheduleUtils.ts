import { WeekSchedule, DaySchedule, Route } from '../org/OrgContext';

const DAY_KEYS: (keyof WeekSchedule)[] = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

// Returns the current time expressed in a specific IANA timezone.
// Falls back to device-local time when timezone is undefined or invalid.
function getTimeInZone(date: Date, timezone: string): { day: keyof WeekSchedule; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(date);

    const weekday = (parts.find((p) => p.type === 'weekday')?.value ?? '').toLowerCase() as keyof WeekSchedule;
    let hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
    if (hour === 24) hour = 0; // midnight edge case in some Intl implementations
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);

    return { day: weekday, minutes: hour * 60 + minute };
  } catch {
    // Invalid timezone string — fall back to device local time
    return {
      day: DAY_KEYS[date.getDay()],
      minutes: date.getHours() * 60 + date.getMinutes(),
    };
  }
}

function getDayAndMinutes(now: Date, timezone?: string): { key: keyof WeekSchedule; cur: number } {
  if (timezone) {
    const { day, minutes } = getTimeInZone(now, timezone);
    return { key: day, cur: minutes };
  }
  return {
    key: DAY_KEYS[now.getDay()],
    cur: now.getHours() * 60 + now.getMinutes(),
  };
}

// Today's weekday key resolved in the org's timezone (falls back to device time).
export function getTodayKey(now: Date = new Date(), timezone?: string): keyof WeekSchedule {
  return getDayAndMinutes(now, timezone).key;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function isRouteActive(
  route: Route | null | undefined,
  now: Date = new Date(),
  timezone?: string,
): boolean {
  if (!route?.schedule) return true; // no schedule = always active
  const { key, cur } = getDayAndMinutes(now, timezone);
  const day: DaySchedule = route.schedule[key];
  if (!day.isOpen) return false;
  return cur >= toMinutes(day.open) && cur < toMinutes(day.close);
}

export function formatTime12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr;
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

export function getNextOpenText(
  route: Route | null | undefined,
  now: Date = new Date(),
  timezone?: string,
): string {
  if (!route?.schedule) return '';

  const { key: todayKey, cur } = getDayAndMinutes(now, timezone);
  const todayIdx = DAY_KEYS.indexOf(todayKey);

  for (let offset = 0; offset < 8; offset++) {
    const dayIdx = (todayIdx + offset) % 7;
    const key = DAY_KEYS[dayIdx];
    const day = route.schedule[key];
    if (!day.isOpen) continue;
    if (offset === 0) {
      if (cur < toMinutes(day.open)) {
        return `Opens today at ${formatTime12h(day.open)}`;
      }
      // past close for today — continue to next day
      continue;
    }
    const dayName = key.charAt(0).toUpperCase() + key.slice(1);
    return `Opens ${offset === 1 ? 'tomorrow' : dayName} at ${formatTime12h(day.open)}`;
  }
  return 'No upcoming hours found';
}

export function getTodayScheduleText(
  route: Route | null | undefined,
  now: Date = new Date(),
  timezone?: string,
): string {
  if (!route?.schedule) return '';
  const { key } = getDayAndMinutes(now, timezone);
  const day = route.schedule[key];
  if (!day.isOpen) return 'Closed today';
  return `Today: ${formatTime12h(day.open)} – ${formatTime12h(day.close)}`;
}
