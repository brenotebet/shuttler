// src/hooks/useAnnouncements.ts
import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebaseconfig';

export type AnnouncementSeverity = 'info' | 'warning' | 'alert';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  createdAt: Date | null;
  expiresAt: Date | null;
  createdByName: string | null;
}

function toDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null;
}

/**
 * Live list of active (non-expired) service alerts for the org,
 * newest first. Expired alerts drop off without a server write —
 * a minute-interval tick re-filters against expiresAt locally.
 */
export function useAnnouncements(orgId: string | null | undefined): Announcement[] {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!orgId) {
      setAnnouncements([]);
      return;
    }

    // Equality-only filter avoids a composite index; sorting happens client-side
    // (an org rarely has more than a handful of active alerts).
    const q = query(
      collection(db, 'orgs', orgId, 'announcements'),
      where('active', '==', true),
    );

    const unsub = onSnapshot(q, (snap) => {
      const items: Announcement[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          title: data.title ?? '',
          body: data.body ?? '',
          severity: (['info', 'warning', 'alert'].includes(data.severity) ? data.severity : 'info') as AnnouncementSeverity,
          createdAt: toDate(data.createdAt),
          expiresAt: toDate(data.expiresAt),
          createdByName: data.createdByName ?? null,
        };
      });
      items.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      setAnnouncements(items);
    }, () => setAnnouncements([]));

    return () => unsub();
  }, [orgId]);

  return announcements.filter((a) => !a.expiresAt || a.expiresAt.getTime() > now);
}
