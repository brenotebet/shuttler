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
  studentUid: string | null;
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
