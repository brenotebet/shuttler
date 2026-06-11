// __tests__/backend.announcements.test.ts
// Tests for the service-alert (announcements) logic: input validation,
// push recipient filtering, and client-side expiry filtering.
// Follows the repo convention of testing pure logic inlined from
// backend/samlServer.ts and src/hooks/useAnnouncements.ts.

// --- Validation logic (mirrors POST /announcements) ---

const ANNOUNCEMENT_SEVERITIES = ['info', 'warning', 'alert'] as const;

function validateAnnouncement(input: {
  title?: unknown;
  severity?: unknown;
  durationMinutes?: unknown;
}): { ok: boolean; error?: string; expiresInMs?: number | null } {
  const cleanTitle = String(input.title ?? '').trim().slice(0, 80);
  if (!cleanTitle) return { ok: false, error: 'title is required' };
  if (!ANNOUNCEMENT_SEVERITIES.includes(input.severity as any)) {
    return { ok: false, error: 'severity must be info, warning, or alert' };
  }
  const duration = Number(input.durationMinutes);
  const hasDuration = Number.isFinite(duration) && duration >= 5 && duration <= 1440;
  return { ok: true, expiresInMs: hasDuration ? duration * 60_000 : null };
}

describe('announcement validation', () => {
  it('accepts a valid announcement with duration', () => {
    const result = validateAnnouncement({ title: 'Main Loop delayed', severity: 'warning', durationMinutes: 60 });
    expect(result.ok).toBe(true);
    expect(result.expiresInMs).toBe(3_600_000);
  });

  it('accepts a valid announcement without duration (until cleared)', () => {
    const result = validateAnnouncement({ title: 'Detour on Route A', severity: 'info' });
    expect(result.ok).toBe(true);
    expect(result.expiresInMs).toBeNull();
  });

  it('rejects a missing or whitespace-only title', () => {
    expect(validateAnnouncement({ title: '', severity: 'info' }).ok).toBe(false);
    expect(validateAnnouncement({ title: '   ', severity: 'info' }).ok).toBe(false);
    expect(validateAnnouncement({ severity: 'info' }).ok).toBe(false);
  });

  it('rejects unknown severities', () => {
    expect(validateAnnouncement({ title: 'Hi', severity: 'critical' }).ok).toBe(false);
    expect(validateAnnouncement({ title: 'Hi', severity: undefined }).ok).toBe(false);
  });

  it('ignores out-of-range durations (treated as until-cleared)', () => {
    expect(validateAnnouncement({ title: 'Hi', severity: 'info', durationMinutes: 2 }).expiresInMs).toBeNull();
    expect(validateAnnouncement({ title: 'Hi', severity: 'info', durationMinutes: 100000 }).expiresInMs).toBeNull();
    expect(validateAnnouncement({ title: 'Hi', severity: 'info', durationMinutes: 'abc' }).expiresInMs).toBeNull();
  });
});

// --- Push recipient filtering (mirrors the fan-out in POST /announcements) ---

interface OrgUser {
  id: string;
  expoPushToken?: string;
  notificationPrefs?: { serviceAlerts?: boolean };
}

function announcementRecipients(users: OrgUser[], authorUid: string): string[] {
  const tokens: string[] = [];
  users.forEach((u) => {
    if (u.id === authorUid) return;
    const serviceAlertsEnabled = u.notificationPrefs?.serviceAlerts !== false;
    if (u.expoPushToken && serviceAlertsEnabled) tokens.push(u.expoPushToken);
  });
  return tokens;
}

describe('announcement push fan-out', () => {
  const users: OrgUser[] = [
    { id: 'author', expoPushToken: 'ExponentPushToken[author]' },
    { id: 'student1', expoPushToken: 'ExponentPushToken[s1]' },
    { id: 'student2', expoPushToken: 'ExponentPushToken[s2]', notificationPrefs: { serviceAlerts: false } },
    { id: 'student3' }, // no push token
    { id: 'parent1', expoPushToken: 'ExponentPushToken[p1]', notificationPrefs: { serviceAlerts: true } },
  ];

  it('excludes the author, opted-out users, and users without tokens', () => {
    expect(announcementRecipients(users, 'author')).toEqual([
      'ExponentPushToken[s1]',
      'ExponentPushToken[p1]',
    ]);
  });

  it('defaults to sending when no pref is stored', () => {
    expect(announcementRecipients([{ id: 'u1', expoPushToken: 'ExponentPushToken[u1]' }], 'author'))
      .toEqual(['ExponentPushToken[u1]']);
  });

  it('returns empty for an org with only the author', () => {
    expect(announcementRecipients([users[0]], 'author')).toEqual([]);
  });
});

// --- Expiry filtering (mirrors useAnnouncements) ---

interface AnnouncementLike {
  id: string;
  expiresAt: Date | null;
}

function filterActive(announcements: AnnouncementLike[], now: number): AnnouncementLike[] {
  return announcements.filter((a) => !a.expiresAt || a.expiresAt.getTime() > now);
}

describe('announcement expiry filtering', () => {
  const now = Date.now();

  it('keeps announcements with no expiry', () => {
    expect(filterActive([{ id: 'a', expiresAt: null }], now)).toHaveLength(1);
  });

  it('keeps announcements expiring in the future', () => {
    expect(filterActive([{ id: 'a', expiresAt: new Date(now + 60_000) }], now)).toHaveLength(1);
  });

  it('drops announcements that have expired', () => {
    expect(filterActive([{ id: 'a', expiresAt: new Date(now - 1) }], now)).toHaveLength(0);
  });

  it('handles a mixed list', () => {
    const result = filterActive(
      [
        { id: 'live', expiresAt: null },
        { id: 'expired', expiresAt: new Date(now - 60_000) },
        { id: 'future', expiresAt: new Date(now + 60_000) },
      ],
      now,
    );
    expect(result.map((a) => a.id)).toEqual(['live', 'future']);
  });
});
