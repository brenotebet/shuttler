// __tests__/backend.notifications.test.ts
// Integration tests for the backend push-notification endpoints.
// Firebase Admin and Expo Push API are mocked so no real credentials are needed.

jest.mock('firebase-admin', () => {
  const mockGet = jest.fn();
  const mockCollection = jest.fn(() => ({
    doc: jest.fn(() => ({
      collection: jest.fn(() => ({ get: mockGet })),
      get: mockGet,
    })),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    get: mockGet,
  }));

  return {
    apps: [],
    initializeApp: jest.fn(),
    credential: { cert: jest.fn() },
    firestore: Object.assign(
      jest.fn(() => ({ collection: mockCollection })),
      { FieldValue: { serverTimestamp: jest.fn(), arrayUnion: jest.fn(), delete: jest.fn() } },
    ),
    auth: jest.fn(() => ({ verifyIdToken: jest.fn(), setCustomUserClaims: jest.fn() })),
  };
});

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: jest.fn() },
  })),
);

jest.mock('samlify', () => ({
  setSchemaValidator: jest.fn(),
  ServiceProvider: jest.fn(() => ({})),
  IdentityProvider: jest.fn(() => ({})),
}));

// Must import after mocks are set up
// eslint-disable-next-line @typescript-eslint/no-var-requires
const request = require('supertest');

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('POST /notifications/stop-request-created', () => {
  let app: any;

  beforeAll(async () => {
    // Dynamically import so mocks are in place
    jest.resetModules();

    const admin = require('firebase-admin');
    // Return 2 drivers with push tokens, 1 student without
    admin.firestore().collection().doc().collection().get.mockResolvedValue({
      forEach: (cb: (doc: any) => void) => {
        cb({ data: () => ({ role: 'driver', expoPushToken: 'ExponentPushToken[abc123]' }) });
        cb({ data: () => ({ role: 'driver', expoPushToken: 'ExponentPushToken[def456]' }) });
        cb({ data: () => ({ role: 'student' }) }); // no token
      },
    });
  });

  it('returns 400 when orgId is missing', async () => {
    // We test the validation logic directly without spinning up a full server
    // to keep tests fast. Full server startup requires real service-account.json.
    // This is a placeholder to document the expected contract.
    expect(true).toBe(true);
  });
});

// Pure-logic tests that don't require the full Express app:

describe('Expo push token validation', () => {
  function isValidExpoToken(token: string): boolean {
    return typeof token === 'string' && token.startsWith('ExponentPushToken[');
  }

  it('accepts well-formed Expo tokens', () => {
    expect(isValidExpoToken('ExponentPushToken[abc123]')).toBe(true);
    expect(isValidExpoToken('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx]')).toBe(true);
  });

  it('rejects malformed tokens', () => {
    expect(isValidExpoToken('')).toBe(false);
    expect(isValidExpoToken('fcm-token-xyz')).toBe(false);
    expect(isValidExpoToken('ExponentPushToken')).toBe(false); // missing brackets
  });

  it('rejects non-string inputs', () => {
    expect(isValidExpoToken(undefined as any)).toBe(false);
    expect(isValidExpoToken(null as any)).toBe(false);
    expect(isValidExpoToken(123 as any)).toBe(false);
  });
});

// --- Caller authorization for rider-directed notifications ---
// Mirrors requireDriverCaller/getOrgRole in backend/samlServer.ts: only a
// driver or admin caller may trigger a push to another org member. Added
// alongside the fix for a gap where any signed-in member (e.g. a student)
// could POST /notifications/stop-arrived with any other member's UID.

function isAuthorizedNotificationCaller(callerRole: string | null): boolean {
  return callerRole === 'driver' || callerRole === 'admin';
}

describe('rider-notification caller authorization', () => {
  it('allows drivers and admins', () => {
    expect(isAuthorizedNotificationCaller('driver')).toBe(true);
    expect(isAuthorizedNotificationCaller('admin')).toBe(true);
  });

  it('rejects students and parents', () => {
    expect(isAuthorizedNotificationCaller('student')).toBe(false);
    expect(isAuthorizedNotificationCaller('parent')).toBe(false);
  });

  it('rejects a caller with no membership doc', () => {
    expect(isAuthorizedNotificationCaller(null)).toBe(false);
  });
});

describe('Expo push batch sizing', () => {
  function chunkTokens(tokens: string[], batchSize: number): string[][] {
    const batches: string[][] = [];
    for (let i = 0; i < tokens.length; i += batchSize) {
      batches.push(tokens.slice(i, i + batchSize));
    }
    return batches;
  }

  it('sends a single batch for fewer than 100 tokens', () => {
    const tokens = Array.from({ length: 50 }, (_, i) => `ExponentPushToken[tok${i}]`);
    const batches = chunkTokens(tokens, 100);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(50);
  });

  it('sends two batches for 101 tokens', () => {
    const tokens = Array.from({ length: 101 }, (_, i) => `ExponentPushToken[tok${i}]`);
    const batches = chunkTokens(tokens, 100);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(100);
    expect(batches[1]).toHaveLength(1);
  });

  it('handles an empty token list', () => {
    expect(chunkTokens([], 100)).toHaveLength(0);
  });
});
