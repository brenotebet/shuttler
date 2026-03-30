// src/utils/pushNotifications.ts
// Client-side helpers that call backend endpoints to send push notifications.
// All functions are fire-and-forget; errors are swallowed so callers never need
// to handle notification failures.
import { SHUTTLER_API_URL } from '../../config';

async function post(path: string, body: object): Promise<void> {
  await fetch(`${SHUTTLER_API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
): Promise<void> {
  try {
    await post('/notifications/stop-arrived', { orgId, studentUid, stopName });
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
