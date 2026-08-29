import { auth } from './firebase';

const API = import.meta.env.VITE_API_URL ?? 'https://shuttler-production.up.railway.app';

async function token(): Promise<string> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error('Not authenticated');
  return t;
}

export type Application = {
  orgId: string;
  name: string | null;
  slug: string | null;
  founderEmail: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactPhone: string | null;
  orgType: string | null;
  website: string | null;
  estimatedRiders: string | null;
  heardAboutUs: string | null;
  description: string | null;
  authMethod: string | null;
  submittedAt: string | null;
  reviewStatus: string;
};

export async function listApplications(): Promise<Application[]> {
  const res = await fetch(`${API}/super-admin/org-applications`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.applications ?? [];
}

export async function approveOrg(orgId: string): Promise<void> {
  const res = await fetch(`${API}/super-admin/org-applications/${orgId}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function rejectOrg(orgId: string, reason: string): Promise<void> {
  const res = await fetch(`${API}/super-admin/org-applications/${orgId}/reject`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export type LimitOverrides = {
  maxVehicles?: number;
  maxRoutes?: number;
  maxStops?: number;
};

export type OrgSummary = {
  orgId: string;
  name: string | null;
  slug: string | null;
  approved: boolean;
  reviewStatus: string | null;
  founderEmail: string | null;
  authMethod: string | null;
  allowedEmailDomains: string[];
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  dataAddonActive: boolean;
  limitOverrides: LimitOverrides | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  createdAt: string | null;
  busesOnline: number;
  lastBusSeenAt: string | null;
  requests24h: number;
};

export async function listOrgs(): Promise<OrgSummary[]> {
  const res = await fetch(`${API}/super-admin/orgs`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.orgs ?? [];
}

export async function setOrgLimits(orgId: string, overrides: LimitOverrides): Promise<void> {
  const res = await fetch(`${API}/super-admin/orgs/${orgId}/limits`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(overrides),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function setDataAddon(orgId: string, active: boolean): Promise<void> {
  const res = await fetch(`${API}/super-admin/orgs/${orgId}/data-addon`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ active }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function extendTrial(orgId: string, days: number): Promise<string> {
  const res = await fetch(`${API}/super-admin/orgs/${orgId}/extend-trial`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ days }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.trialEndsAt;
}

export type WaitlistEntry = {
  id: string;
  email: string | null;
  source: string | null;
  submittedAt: string | null;
};

export async function listWaitlist(): Promise<WaitlistEntry[]> {
  const res = await fetch(`${API}/super-admin/waitlist`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.entries ?? [];
}

export type FeedbackEntry = {
  id: string;
  orgId: string | null;
  requestId: string | null;
  questionKey: string | null;
  question: string | null;
  rating: number | null;
  answer: string | null;
  createdAt: string | null;
};

export async function listFeedback(): Promise<FeedbackEntry[]> {
  const res = await fetch(`${API}/super-admin/feedback`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.entries ?? [];
}

// ---- Org profile / subscription / suspend (super-admin) ----

export async function updateOrgProfile(orgId: string, fields: { name?: string; founderEmail?: string }): Promise<void> {
  const res = await fetch(`${API}/super-admin/orgs/${orgId}/profile`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
}

export async function setSubscription(
  orgId: string,
  fields: { subscriptionStatus?: string; subscriptionPlan?: string },
): Promise<void> {
  const res = await fetch(`${API}/super-admin/orgs/${orgId}/subscription`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
}

export async function suspendOrg(orgId: string): Promise<void> {
  const res = await fetch(`${API}/super-admin/orgs/${orgId}/suspend`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function reinstateOrg(orgId: string): Promise<void> {
  const res = await fetch(`${API}/super-admin/orgs/${orgId}/reinstate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// Deleting an org is owner-only at the API layer, except a super-admin caller
// (verified server-side via the same claim used everywhere else in this
// panel) is also allowed through — see requireOrgAdmin/isSuperAdminClaims in
// backend/samlServer.ts.
export async function deleteOrg(orgId: string): Promise<void> {
  const res = await fetch(`${API}/admin/orgs/${orgId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${await token()}` },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
}

// Reverts a stuck/misconfigured org back to email/password sign-in — the
// support fix for an org locked into a broken SAML config. Reuses the same
// auth-config endpoint the org's own admins use.
export async function resetAuthMethod(orgId: string): Promise<void> {
  const res = await fetch(`${API}/admin/orgs/${orgId}/auth-config`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ authMethod: 'email' }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
}

export async function updateAllowedDomains(orgId: string, authMethod: string, allowedEmailDomains: string[]): Promise<void> {
  const res = await fetch(`${API}/admin/orgs/${orgId}/auth-config`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ authMethod, allowedEmailDomains }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
}

// ---- Org users (super-admin, via the org-admin endpoints) ----

export type OrgMember = {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: 'student' | 'driver' | 'admin' | 'parent';
};

export async function getOrgUsers(orgId: string): Promise<OrgMember[]> {
  const res = await fetch(`${API}/admin/orgs/${orgId}/users`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function setUserRole(orgId: string, uid: string, role: 'student' | 'driver' | 'admin'): Promise<void> {
  const res = await fetch(`${API}/admin/orgs/${orgId}/users/${uid}/role`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
}

export async function removeUser(orgId: string, uid: string): Promise<void> {
  const res = await fetch(`${API}/admin/orgs/${orgId}/users/${uid}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${await token()}` },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
}

// ---- Cross-org user search (super-admin) ----

export type UserSearchResult = {
  uid: string;
  orgId: string;
  orgName: string | null;
  email: string | null;
  displayName: string | null;
  role: string | null;
};

export async function searchUsersByEmail(email: string): Promise<UserSearchResult[]> {
  const res = await fetch(`${API}/super-admin/users/search?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.results ?? [];
}
