// src/utils/pushNotifications.ts
// Client-side helpers that call backend endpoints to send push notifications.
// All functions are fire-and-forget; errors are swallowed so callers never need
// to handle notification failures.
import { SHUTTLER_API_URL } from '../../config';
import { auth } from '../../firebase/firebaseconfig';

async function post(path: string, body: object): Promise<void> {
  const token = await auth.currentUser?.getIdToken();
  await fetch(`${SHUTTLER_API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Called when a student creates a stop request — notifies all active drivers in the org. */
export async function notifyDriversNewRequest(orgId: string): Promise<void> {
  try {
    await post('/notifications/stop-request-created', { orgId });
  } catch {
    // Non-critical
  }
}

/** Called when the driver's GPS first enters a stop's arrival radius — notifies the student. */
export async function notifyStudentArrived(
  orgId: string,
  studentUid: string,
  stopName: string,
  stopId?: string,
): Promise<void> {
  try {
    await post('/notifications/stop-arrived', { orgId, studentUid, stopName, stopId });
  } catch {
    // Non-critical
  }
}

/** Called when the driver's GPS first crosses a stop's approach radius (a few
 *  minutes out) — gives the student a "head to your stop now" heads-up. */
export async function notifyStudentApproaching(
  orgId: string,
  studentUid: string,
  stopName: string,
  stopId?: string,
  etaMinutes?: number,
): Promise<void> {
  try {
    await post('/notifications/bus-approaching', { orgId, studentUid, stopName, stopId, etaMinutes });
  } catch {
    // Non-critical
  }
}

/** Called when a student's request is cancelled — notifies the student. */
export async function notifyStudentRequestCancelled(
  orgId: string,
  studentUid: string,
  reason: 'driver_offline' | 'no_buses_online' | 'driver_skipped',
): Promise<void> {
  try {
    await post('/notifications/stop-request-cancelled', { orgId, studentUid, reason });
  } catch {
    // Non-critical
  }
}

/** Called when a stop request is marked completed — notifies the student. */
export async function notifyStudentCompleted(
  orgId: string,
  studentUid: string,
  stopName: string,
): Promise<void> {
  try {
    await post('/notifications/stop-completed', { orgId, studentUid, stopName });
  } catch {
    // Non-critical
  }
}
