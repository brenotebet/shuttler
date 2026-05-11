import { WeekSchedule, DaySchedule, Route } from '../org/OrgContext';

const DAY_KEYS: (keyof WeekSchedule)[] = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

function getTodayKey(now: Date = new Date()): keyof WeekSchedule {
  return DAY_KEYS[now.getDay()];
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function isRouteActive(route: Route | null | undefined, now: Date = new Date()): boolean {
  if (!route?.schedule) return true; // no schedule = always active
  const key = getTodayKey(now);
  const day: DaySchedule = route.schedule[key];
  if (!day.isOpen) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
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

export function getNextOpenText(route: Route | null | undefined, now: Date = new Date()): string {
  if (!route?.schedule) return '';
  const todayIdx = now.getDay(); // 0=Sun
  // Check rest of today first, then next 7 days
  for (let offset = 0; offset < 8; offset++) {
    const dayIdx = (todayIdx + offset) % 7;
    const key = DAY_KEYS[dayIdx];
    const day = route.schedule[key];
    if (!day.isOpen) continue;
    if (offset === 0) {
      // still today — check if open window is ahead
      const cur = now.getHours() * 60 + now.getMinutes();
      if (cur < toMinutes(day.open)) {
        return `Opens today at ${formatTime12h(day.open)}`;
      }
      // already past close — continue to next day
      continue;
    }
    const dayName = key.charAt(0).toUpperCase() + key.slice(1);
    return `Opens ${offset === 1 ? 'tomorrow' : dayName} at ${formatTime12h(day.open)}`;
  }
  return 'No upcoming hours found';
}

export function getTodayScheduleText(route: Route | null | undefined, now: Date = new Date()): string {
  if (!route?.schedule) return '';
  const key = getTodayKey(now);
  const day = route.schedule[key];
  if (!day.isOpen) return 'Closed today';
  return `Today: ${formatTime12h(day.open)} – ${formatTime12h(day.close)}`;
}
