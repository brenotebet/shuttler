// __tests__/utils.pushNotifications.test.ts
// Tests for push notification client utility.

import {
  notifyDriversNewRequest,
  notifyStudentArrived,
  notifyStudentCompleted,
} from '../src/utils/pushNotifications';

// SHUTTLER_API_URL is mapped to 'http://localhost:3000' via __mocks__/config.ts

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('notifyDriversNewRequest', () => {
  it('POSTs to /notifications/stop-request-created with the orgId', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ sent: 2 }) });

    await notifyDriversNewRequest('org-123');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/notifications/stop-request-created',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ orgId: 'org-123' }),
      }),
    );
  });

  it('swallows network errors silently', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    await expect(notifyDriversNewRequest('org-abc')).resolves.toBeUndefined();
  });
});

describe('notifyStudentArrived', () => {
  it('POSTs to /notifications/stop-arrived with correct payload', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ sent: 1 }) });

    await notifyStudentArrived('org-123', 'uid-student-1', 'Library Stop');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/notifications/stop-arrived',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ orgId: 'org-123', studentUid: 'uid-student-1', stopName: 'Library Stop' }),
      }),
    );
  });

  it('swallows network errors silently', async () => {
    mockFetch.mockRejectedValueOnce(new Error('timeout'));
    await expect(notifyStudentArrived('org', 'uid', 'stop')).resolves.toBeUndefined();
  });
});

describe('notifyStudentCompleted', () => {
  it('POSTs to /notifications/stop-completed with correct payload', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ sent: 1 }) });

    await notifyStudentCompleted('org-abc', 'uid-456', 'Main Quad');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/notifications/stop-completed',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ orgId: 'org-abc', studentUid: 'uid-456', stopName: 'Main Quad' }),
      }),
    );
  });

  it('swallows fetch errors silently', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));
    await expect(notifyStudentCompleted('o', 'u', 's')).resolves.toBeUndefined();
  });
});
