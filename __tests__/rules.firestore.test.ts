// __tests__/rules.firestore.test.ts
// Firestore security rules tests — run with `npm run test:rules` (needs the
// Firestore emulator; see jest.rules.config.js).

import { readFileSync } from 'fs';
import path from 'path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { addDoc, collection, doc, getDoc, setDoc, setLogLevel, updateDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;

// A signed-in client whose session came from the given Firebase provider:
// 'custom' is /saml/exchange (SSO), 'password' email/password, etc.
function as(uid: string, provider: 'custom' | 'password' | 'google.com' | 'apple.com' | 'phone' = 'password') {
  return env.authenticatedContext(uid, { firebase: { sign_in_provider: provider } } as any).firestore();
}

function stopRequest(studentUid: string, orgId: string) {
  return { studentUid, orgId, stopId: 'stop1', status: 'pending' };
}

beforeAll(async () => {
  // Every assertFails logs a PERMISSION_DENIED warning — expected noise.
  setLogLevel('error');
  env = await initializeTestEnvironment({
    projectId: 'demo-shuttler',
    firestore: { rules: readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const member = (orgId: string, uid: string, role: string) =>
      setDoc(doc(db, 'orgs', orgId, 'users', uid), { uid, orgId, role, email: `${uid}@school.edu` });

    await setDoc(doc(db, 'orgs/emailOrg'), { authMethod: 'email', subscriptionStatus: 'active' });
    await member('emailOrg', 'student', 'student');
    await member('emailOrg', 'driver', 'driver');
    await member('emailOrg', 'admin', 'admin');

    await setDoc(doc(db, 'orgs/ssoOrg'), { authMethod: 'saml', subscriptionStatus: 'active' });
    await member('ssoOrg', 'ssoStudent', 'student');
    await member('ssoOrg', 'ssoAdmin', 'admin');
    // A pre-SSO email/password admin account that never signed in with SSO.
    await member('ssoOrg', 'legacyAdmin', 'admin');

    await setDoc(doc(db, 'orgs/emailOrg/stopRequests/req1'), stopRequest('student', 'emailOrg'));
  });
});

describe('membership', () => {
  it('a client can never create its own membership, in any org', async () => {
    for (const [orgId, provider] of [['emailOrg', 'google.com'], ['ssoOrg', 'google.com'], ['emailOrg', 'password']] as const) {
      await assertFails(setDoc(doc(as('stranger', provider), 'orgs', orgId, 'users', 'stranger'), {
        uid: 'stranger', orgId, role: 'student',
      }));
    }
  });

  it('a member can update their own profile', async () => {
    await assertSucceeds(updateDoc(doc(as('student'), 'orgs/emailOrg/users/student'), {
      displayName: 'Sam Student', notificationPrefs: { newRequest: false },
    }));
  });

  it('a member cannot change their role, email or SSO link fields', async () => {
    const ref = doc(as('student'), 'orgs/emailOrg/users/student');
    await assertFails(updateDoc(ref, { role: 'admin' }));
    await assertFails(updateDoc(ref, { email: 'admin@school.edu' }));
    await assertFails(updateDoc(ref, { ssoLinkedFrom: ['admin'] }));
  });
});

describe('email org', () => {
  it('members can read the org; non-members cannot', async () => {
    await assertSucceeds(getDoc(doc(as('student'), 'orgs/emailOrg')));
    await assertFails(getDoc(doc(as('stranger'), 'orgs/emailOrg')));
  });

  it('only members can create stop requests', async () => {
    await assertSucceeds(addDoc(collection(as('student'), 'orgs/emailOrg/stopRequests'), stopRequest('student', 'emailOrg')));
    await assertFails(addDoc(collection(as('stranger'), 'orgs/emailOrg/stopRequests'), stopRequest('stranger', 'emailOrg')));
  });

  it('only members can write their public profile', async () => {
    await assertSucceeds(setDoc(doc(as('student'), 'orgs/emailOrg/publicUsers/student'), { displayName: 'Sam' }));
    await assertFails(setDoc(doc(as('stranger'), 'orgs/emailOrg/publicUsers/stranger'), { displayName: 'Mallory' }));
  });

  it('a driver can claim a pending request', async () => {
    await assertSucceeds(updateDoc(doc(as('driver'), 'orgs/emailOrg/stopRequests/req1'), {
      driverUid: 'driver', status: 'accepted',
    }));
  });

  it('admins can read every member; students cannot', async () => {
    await assertSucceeds(getDoc(doc(as('admin'), 'orgs/emailOrg/users/student')));
    await assertFails(getDoc(doc(as('student'), 'orgs/emailOrg/users/admin')));
  });
});

describe('SSO org', () => {
  it('SSO sessions work as usual', async () => {
    const db = as('ssoStudent', 'custom');
    await assertSucceeds(getDoc(doc(db, 'orgs/ssoOrg')));
    await assertSucceeds(getDoc(doc(db, 'orgs/ssoOrg/users/ssoStudent')));
    await assertSucceeds(addDoc(collection(db, 'orgs/ssoOrg/stopRequests'), stopRequest('ssoStudent', 'ssoOrg')));
    await assertSucceeds(getDoc(doc(as('ssoAdmin', 'custom'), 'orgs/ssoOrg/users/ssoStudent')));
  });

  it('a password session gets nothing, not even as an admin', async () => {
    const db = as('legacyAdmin', 'password');
    await assertFails(getDoc(doc(db, 'orgs/ssoOrg')));
    await assertFails(getDoc(doc(db, 'orgs/ssoOrg/users/legacyAdmin')));
    await assertFails(getDoc(doc(db, 'orgs/ssoOrg/users/ssoStudent')));
    await assertFails(updateDoc(doc(db, 'orgs/ssoOrg/users/legacyAdmin'), { displayName: 'x' }));
    await assertFails(updateDoc(doc(db, 'orgs/ssoOrg'), { name: 'Hijacked' }));
  });

  it('Google, Apple and phone sessions get nothing either', async () => {
    for (const provider of ['google.com', 'apple.com', 'phone'] as const) {
      const db = as('ssoStudent', provider);
      await assertFails(getDoc(doc(db, 'orgs/ssoOrg')));
      await assertFails(addDoc(collection(db, 'orgs/ssoOrg/stopRequests'), stopRequest('ssoStudent', 'ssoOrg')));
    }
  });
});

describe('plan limits on stops and routes', () => {
  const stops = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `Stop ${i}`, latitude: 38.6, longitude: -89.8 }));
  const routes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `Route ${i}`, stopIds: [] }));

  async function setOrg(fields: Record<string, unknown>) {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'orgs/emailOrg'), fields, { merge: true }));
  }

  it('caps a trial org at 10 stops and 1 route', async () => {
    await setOrg({ subscriptionPlan: 'starter', subscriptionStatus: 'trialing' });
    const ref = doc(as('admin'), 'orgs/emailOrg');
    await assertSucceeds(updateDoc(ref, { stops: stops(10), routes: routes(1) }));
    await assertFails(updateDoc(ref, { stops: stops(11) }));
    await assertFails(updateDoc(ref, { routes: routes(2) }));
  });

  it('lets a Campus org go past the Starter caps', async () => {
    await setOrg({ subscriptionPlan: 'campus', subscriptionStatus: 'active' });
    await assertSucceeds(updateDoc(doc(as('admin'), 'orgs/emailOrg'), { stops: stops(40), routes: routes(5) }));
  });

  it('applies an Enterprise limit override on a paid plan', async () => {
    await setOrg({ subscriptionPlan: 'enterprise', subscriptionStatus: 'active', limitOverrides: { maxRoutes: 3 } });
    const ref = doc(as('admin'), 'orgs/emailOrg');
    await assertSucceeds(updateDoc(ref, { routes: routes(3) }));
    await assertFails(updateDoc(ref, { routes: routes(4) }));
  });

  it('lets a downgraded org shrink or edit an over-limit list, but not grow it', async () => {
    await setOrg({ subscriptionPlan: 'starter', subscriptionStatus: 'active', stops: stops(12) });
    const ref = doc(as('admin'), 'orgs/emailOrg');
    await assertSucceeds(updateDoc(ref, { stops: stops(11) }));
    await assertFails(updateDoc(ref, { stops: stops(12) }));
    await assertSucceeds(updateDoc(ref, { name: 'Renamed Org' }));
  });
});
