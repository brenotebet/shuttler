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

    // K-12 phone org with two parents, each with a child profile.
    await setDoc(doc(db, 'orgs/k12Org'), { authMethod: 'phone', orgType: 'k12', subscriptionStatus: 'active' });
    await member('k12Org', 'parentA', 'parent');
    await member('k12Org', 'parentB', 'parent');
    await member('k12Org', 'k12Driver', 'driver');
    await member('k12Org', 'k12Student', 'student');
    await setDoc(doc(db, 'orgs/k12Org/users/parentA/children/kidA'), { name: 'Ana', grade: '3' });
    await setDoc(doc(db, 'orgs/k12Org/stopRequests/reqA'), {
      ...stopRequest('parentA', 'k12Org'), childName: 'Ana', childGrade: '3',
    });
    // New K-12 members wait for an admin; declined ones stay locked out.
    await setDoc(doc(db, 'orgs/k12Org/users/pendingParent'), {
      uid: 'pendingParent', orgId: 'k12Org', role: 'parent', approvalStatus: 'pending', phone: '+15555550100',
    });
    await setDoc(doc(db, 'orgs/k12Org/users/declinedParent'), {
      uid: 'declinedParent', orgId: 'k12Org', role: 'parent', approvalStatus: 'declined',
    });
    await member('k12Org', 'k12Admin', 'admin');
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

  it('a member cannot move their membership to another org or rewrite their uid', async () => {
    const ref = doc(as('student'), 'orgs/emailOrg/users/student');
    await assertFails(updateDoc(ref, { orgId: 'ssoOrg' }));
    await assertFails(updateDoc(ref, { uid: 'admin' }));
  });

  it("a member cannot edit someone else's membership; an admin may only set defaultRouteId", async () => {
    await assertFails(updateDoc(doc(as('student'), 'orgs/emailOrg/users/driver'), { displayName: 'x' }));
    await assertFails(updateDoc(doc(as('admin'), 'orgs/emailOrg/users/student'), { role: 'admin' }));
    await assertSucceeds(updateDoc(doc(as('admin'), 'orgs/emailOrg/users/student'), { defaultRouteId: 'r1' }));
  });
});

describe('K-12 parents', () => {
  const parent = (uid: string) => as(uid, 'phone');

  it("a parent manages only their own children's profiles", async () => {
    await assertSucceeds(getDoc(doc(parent('parentA'), 'orgs/k12Org/users/parentA/children/kidA')));
    await assertSucceeds(addDoc(collection(parent('parentA'), 'orgs/k12Org/users/parentA/children'), { name: 'Ben' }));
    await assertFails(getDoc(doc(parent('parentB'), 'orgs/k12Org/users/parentA/children/kidA')));
    await assertFails(addDoc(collection(parent('parentB'), 'orgs/k12Org/users/parentA/children'), { name: 'Eve' }));
  });

  it('non-parents cannot read or create children profiles, even staff', async () => {
    await assertFails(getDoc(doc(as('k12Driver', 'password'), 'orgs/k12Org/users/parentA/children/kidA')));
    await assertFails(addDoc(collection(as('k12Student', 'phone'), 'orgs/k12Org/users/k12Student/children'), { name: 'X' }));
  });

  it("a parent sees only their own stop requests; drivers see the child's name to pick them up", async () => {
    await assertSucceeds(getDoc(doc(parent('parentA'), 'orgs/k12Org/stopRequests/reqA')));
    await assertFails(getDoc(doc(parent('parentB'), 'orgs/k12Org/stopRequests/reqA')));
    await assertSucceeds(getDoc(doc(as('k12Driver', 'password'), 'orgs/k12Org/stopRequests/reqA')));
  });

  it('a parent cannot request a stop as someone else, or cancel another parent\'s request', async () => {
    await assertFails(addDoc(collection(parent('parentB'), 'orgs/k12Org/stopRequests'), stopRequest('parentA', 'k12Org')));
    await assertFails(updateDoc(doc(parent('parentB'), 'orgs/k12Org/stopRequests/reqA'), { status: 'cancelled' }));
    await assertSucceeds(updateDoc(doc(parent('parentA'), 'orgs/k12Org/stopRequests/reqA'), { status: 'cancelled' }));
  });

  it('a parent cannot promote themselves or read other members', async () => {
    await assertFails(updateDoc(doc(parent('parentA'), 'orgs/k12Org/users/parentA'), { role: 'admin' }));
    await assertFails(updateDoc(doc(parent('parentA'), 'orgs/k12Org/users/parentA'), { role: 'driver' }));
    await assertFails(getDoc(doc(parent('parentA'), 'orgs/k12Org/users/parentB')));
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

describe('org type', () => {
  it('lets an admin set a known org type', async () => {
    await assertSucceeds(updateDoc(doc(as('admin'), 'orgs/emailOrg'), { orgType: 'university' }));
    await assertSucceeds(updateDoc(doc(as('admin'), 'orgs/emailOrg'), { orgType: 'k12' }));
  });

  it('rejects an unknown org type', async () => {
    await assertFails(updateDoc(doc(as('admin'), 'orgs/emailOrg'), { orgType: 'casino' }));
  });

  it('does not let non-admins change the org type', async () => {
    await assertFails(updateDoc(doc(as('driver'), 'orgs/emailOrg'), { orgType: 'k12' }));
    await assertFails(updateDoc(doc(as('student'), 'orgs/emailOrg'), { orgType: 'k12' }));
  });
});

describe('K-12 approval', () => {
  const parent = (uid: string) => as(uid, 'phone');

  it('a pending or declined member sees no buses, org, names or stop requests', async () => {
    for (const uid of ['pendingParent', 'declinedParent']) {
      await assertFails(getDoc(doc(parent(uid), 'orgs/k12Org')));
      await assertFails(getDoc(doc(parent(uid), 'orgs/k12Org/buses/k12Driver')));
      await assertFails(getDoc(doc(parent(uid), 'orgs/k12Org/publicUsers/parentA')));
      await assertFails(addDoc(collection(parent(uid), 'orgs/k12Org/stopRequests'), stopRequest(uid, 'k12Org')));
      await assertFails(addDoc(collection(parent(uid), `orgs/k12Org/users/${uid}/children`), { name: 'Kid' }));
    }
  });

  it('a pending member can read their own doc and save a push token, to hear when approved', async () => {
    const ref = doc(parent('pendingParent'), 'orgs/k12Org/users/pendingParent');
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(updateDoc(ref, { expoPushToken: 'ExponentPushToken[x]' }));
  });

  it('a pending or declined member cannot approve themselves or rewrite their request', async () => {
    const ref = doc(parent('pendingParent'), 'orgs/k12Org/users/pendingParent');
    await assertFails(updateDoc(ref, { approvalStatus: 'approved' }));
    await assertFails(updateDoc(ref, { approvalRequest: { children: [] } }));
    await assertFails(updateDoc(ref, { relationship: 'guardian' }));
    await assertFails(updateDoc(doc(parent('declinedParent'), 'orgs/k12Org/users/declinedParent'), {
      approvalStatus: 'pending',
    }));
  });

  it('an admin cannot approve from the client either — only the backend can', async () => {
    await assertFails(updateDoc(doc(as('k12Admin'), 'orgs/k12Org/users/pendingParent'), { approvalStatus: 'approved' }));
  });

  it("an admin can read a parent's children (incl. ones added after approval); other parents cannot", async () => {
    await assertSucceeds(getDoc(doc(as('k12Admin'), 'orgs/k12Org/users/parentA/children/kidA')));
    await assertFails(getDoc(doc(as('k12Driver'), 'orgs/k12Org/users/parentA/children/kidA')));
  });

  it('members without an approvalStatus (joined before approvals) keep working', async () => {
    await assertSucceeds(getDoc(doc(parent('parentA'), 'orgs/k12Org')));
    await assertSucceeds(getDoc(doc(parent('parentA'), 'orgs/k12Org/buses/k12Driver')));
  });
});
