import express, { Request, Response } from 'express';
import * as saml from 'samlify';
import admin from 'firebase-admin';
import Stripe from 'stripe';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DOMParser } from '@xmldom/xmldom';
import xpath from 'xpath';
import 'dotenv/config';
import * as Sentry from '@sentry/node';
import {
  sendEmail,
  emailVerificationTemplate,
  passwordResetTemplate,
  welcomeTemplate,
  orgApplicationReceivedTemplate,
  orgApprovedTemplate,
} from './mailer';

/**
 * Shuttler multi-tenant backend
 *
 * Endpoints:
 *   GET  /health
 *   GET  /orgs                          ← public: list active orgs
 *   GET  /orgs/:slug                    ← public: single org by slug
 *   GET  /orgs/by-id/:orgId             ← public: single org by ID
 *   GET  /saml/:orgSlug/login           ← SP-initiated SAML login (per org)
 *   POST /saml/:orgSlug/acs             ← SAML ACS callback (per org)
 *   POST /saml/exchange                 ← Exchange handoff token for Firebase token
 *   GET  /saml/:orgSlug/metadata        ← SP metadata (per org)
 *   POST /auth/email/register           ← Email/password signup with domain enforcement
 *   POST /admin/orgs/:orgId/auth-config ← Save SAML/email config (org admin only)
 *   POST /billing/create-checkout-session
 *   POST /billing/create-portal-session
 *   POST /stripe/webhook
 *   POST /internal/orgs                 ← Create new org (super-admin only)
 */

// ---------- Sentry ----------

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? '',
  enabled: process.env.NODE_ENV === 'production',
  tracesSampleRate: 0.2,
});

// ---------- ENV ----------

const PORT = parseInt(process.env.PORT || '3000', 10);
const API_BASE_URL = (process.env.API_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || '';

// URL schemes allowed in SAML RelayState (prevents open redirect via forged responses)
const ALLOWED_RELAY_PREFIXES = (process.env.SAML_ALLOWED_RELAY_PREFIXES || 'shuttler://')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean) as string[];

// ---------- SAML schema validator ----------

saml.setSchemaValidator({
  validate: async (xml: string) => {
    const dom = new DOMParser({
      errorHandler: { warning: undefined, error: undefined },
    }).parseFromString(xml);

    const rootName = dom.documentElement?.localName;
    if (!rootName) throw new Error('ERR_SAML_SCHEMA_MISSING_ROOT');

    const isResponse = rootName === 'Response';
    const isLogout = rootName === 'LogoutResponse' || rootName === 'LogoutRequest';
    const isAuthnRequest = rootName === 'AuthnRequest';
    if (!isResponse && !isLogout && !isAuthnRequest) {
      throw new Error(`ERR_SAML_SCHEMA_UNEXPECTED_ROOT_${rootName}`);
    }

    if (isResponse) {
      const assertionNode = xpath.select1("//*[local-name()='Assertion']", dom);
      const issuerNode = xpath.select1("//*[local-name()='Issuer']", dom);
      const subjectConfirmationNode = xpath.select1(
        "//*[local-name()='SubjectConfirmationData']",
        dom,
      );
      const audienceNode = xpath.select1(
        "//*[local-name()='AudienceRestriction']/*[local-name()='Audience']",
        dom,
      );
      if (!assertionNode || !issuerNode || !subjectConfirmationNode || !audienceNode) {
        throw new Error('ERR_SAML_SCHEMA_MISSING_ASSERTION_CONTENTS');
      }
    }

    return Promise.resolve('ok');
  },
});

// ---------- Firebase Admin ----------

const serviceAccountPath =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(__dirname, 'serviceAccount.json');
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (admin.apps.length === 0) {
  if (serviceAccountJson) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccountJson) as admin.ServiceAccount),
    });
  } else if (fs.existsSync(serviceAccountPath)) {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8')) as admin.ServiceAccount,
      ),
    });
  } else {
    admin.initializeApp();
  }
}

// ---------- Stripe ----------

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-02-24.acacia' });

const PLAN_PRICE_IDS: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER || '',
  campus: process.env.STRIPE_PRICE_CAMPUS || '',
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE || '',
};

// ---------- Handoff token store (Firestore-backed) ----------
// Using Firestore instead of an in-memory Map so tokens survive server restarts.

type HandoffTokenPayload = {
  uid: string;
  orgId: string;
  attributes: Record<string, unknown>;
  expiresAt: number;
};

const HANDOFF_TOKEN_TTL_MS = 5 * 60 * 1000;
const HANDOFF_TOKENS_COLLECTION = 'samlHandoffTokens';

async function issueHandoffToken(
  uid: string,
  orgId: string,
  attributes: Record<string, unknown>,
): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await admin.firestore().collection(HANDOFF_TOKENS_COLLECTION).doc(token).set({
    uid,
    orgId,
    attributes,
    expiresAt: Date.now() + HANDOFF_TOKEN_TTL_MS,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return token;
}

async function consumeHandoffToken(token: string): Promise<HandoffTokenPayload | null> {
  const ref = admin.firestore().collection(HANDOFF_TOKENS_COLLECTION).doc(token);
  try {
    return await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const data = snap.data() as any;
      if (!data || data.expiresAt <= Date.now()) {
        tx.delete(ref);
        return null;
      }
      tx.delete(ref);
      return {
        uid: data.uid as string,
        orgId: data.orgId as string,
        attributes: (data.attributes ?? {}) as Record<string, unknown>,
        expiresAt: data.expiresAt as number,
      };
    });
  } catch (err) {
    console.error('[consumeHandoffToken] transaction error:', err);
    return null;
  }
}

// ---------- Rate limiter ----------

const EXCHANGE_WINDOW_MS = 60_000;
const MAX_EXCHANGE_REQUESTS = 10;
const exchangeRateMap = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = exchangeRateMap.get(ip);
  if (!entry || now - entry.windowStart > EXCHANGE_WINDOW_MS) {
    exchangeRateMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_EXCHANGE_REQUESTS;
}

// ---------- Org helpers ----------

type OrgSamlConfig = {
  orgId: string;
  slug: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpSigningCert: string;
  spEntityId: string;
  acsUrl: string;
  allowedEmailDomains?: string[];
  subscriptionStatus: string;
};

async function loadOrgSamlConfig(orgSlug: string): Promise<OrgSamlConfig> {
  const slugDoc = await admin.firestore().collection('orgSlugs').doc(orgSlug).get();
  if (!slugDoc.exists) throw Object.assign(new Error('Org not found'), { status: 404 });

  const { orgId } = slugDoc.data()!;
  const orgDoc = await admin.firestore().collection('orgs').doc(orgId).get();
  if (!orgDoc.exists) throw Object.assign(new Error('Org document missing'), { status: 500 });

  const org = orgDoc.data()!;

  if (!['trialing', 'active'].includes(org.subscriptionStatus)) {
    throw Object.assign(new Error('Org subscription is not active'), { status: 403 });
  }

  if (!org.samlConfig) {
    throw Object.assign(new Error('Org has no SAML configuration'), { status: 400 });
  }

  return {
    orgId,
    slug: orgSlug,
    ...org.samlConfig,
    allowedEmailDomains: org.allowedEmailDomains ?? [],
    subscriptionStatus: org.subscriptionStatus,
  };
}

function buildIdpAndSp(config: OrgSamlConfig) {
  const idp = saml.IdentityProvider({
    entityID: config.idpEntityId,
    singleSignOnService: [
      { Binding: saml.Constants.namespace.binding.redirect, Location: config.idpSsoUrl },
      { Binding: saml.Constants.namespace.binding.post, Location: config.idpSsoUrl },
    ],
    signingCert: config.idpSigningCert ? [formatCert(config.idpSigningCert)] : undefined,
  });

  const sp = saml.ServiceProvider({
    entityID: config.spEntityId,
    assertionConsumerService: [
      { Binding: saml.Constants.namespace.binding.post, Location: config.acsUrl },
    ],
    wantAssertionsSigned: true,
    ...({ clockDrifts: [-300000, 300000] } as any),
  });

  return { idp, sp };
}

// ---------- Auth middleware ----------

async function requireAuth(req: Request, res: Response, next: Function) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(header.slice(7));
    (req as any).uid = decoded.uid;
    (req as any).claims = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function requireOrgAdmin(req: Request, res: Response, next: Function) {
  const orgId = req.params.orgId as string;
  const uid = (req as any).uid as string;
  try {
    const userDoc = await admin.firestore()
      .collection('orgs').doc(orgId)
      .collection('users').doc(uid)
      .get();
    if (!userDoc.exists || userDoc.data()!.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized as org admin' });
    }
    const orgDoc = await admin.firestore().collection('orgs').doc(orgId).get();
    if (!orgDoc.exists) return res.status(404).json({ error: 'Org not found' });
    (req as any).orgSlug = orgDoc.data()!.slug;
    next();
  } catch {
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

async function requireSuperAdmin(req: Request, res: Response, next: Function) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(header.slice(7));
    if (!decoded.superAdmin) {
      return res.status(403).json({ error: 'Super admin access required' });
    }
    (req as any).uid = decoded.uid;
    (req as any).claims = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireInternal(req: Request, res: Response, next: Function) {
  if (!INTERNAL_SECRET || req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// ---------- Express app ----------

const app = express();

Sentry.setupExpressErrorHandler(app);

// Stripe webhook needs raw body — register before express.json()
app.use('/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---- Health ----

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'shuttler-backend', apiBaseUrl: API_BASE_URL });
});

// ---- Public org listing ----

app.get('/orgs', async (_req: Request, res: Response) => {
  try {
    const snap = await admin.firestore().collection('orgSlugs').get();
    const orgs = snap.docs.map((d) => ({ slug: d.id, ...d.data() }));
    return res.json(orgs);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to list orgs' });
  }
});

app.get('/orgs/by-id/:orgId', async (req: Request, res: Response) => {
  try {
    const orgDoc = await admin.firestore().collection('orgs').doc(req.params.orgId as string).get();
    if (!orgDoc.exists) return res.status(404).json({ error: 'Org not found' });
    const data = orgDoc.data()!;
    // Strip sensitive fields before returning to clients
    const { samlConfig: _saml, stripeCustomerId: _sc, stripeSubscriptionId: _ss, adminUids: _au, ...safe } = data;
    return res.json(safe);
  } catch {
    return res.status(500).json({ error: 'Failed to fetch org' });
  }
});

app.get('/orgs/:slug', async (req: Request, res: Response) => {
  try {
    const slugDoc = await admin.firestore().collection('orgSlugs').doc(req.params.slug as string).get();
    if (!slugDoc.exists) return res.status(404).json({ error: 'Org not found' });
    const { orgId } = slugDoc.data()!;
    const orgDoc = await admin.firestore().collection('orgs').doc(orgId).get();
    if (!orgDoc.exists) return res.status(404).json({ error: 'Org document missing' });
    const data = orgDoc.data()!;
    const { samlConfig: _saml, stripeCustomerId: _sc, stripeSubscriptionId: _ss, adminUids: _au, ...safe } = data;
    return res.json(safe);
  } catch {
    return res.status(500).json({ error: 'Failed to fetch org' });
  }
});

// ---- SAML (per-org) ----

app.get('/saml/:orgSlug/login', async (req: Request, res: Response) => {
  try {
    const config = await loadOrgSamlConfig(req.params.orgSlug as string);
    const { idp, sp } = buildIdpAndSp(config);

    const returnTo =
      (req.query.relayState as string) || (req.query.returnTo as string) || '';
    const { context } = sp.createLoginRequest(idp, 'redirect');

    if (returnTo) {
      const joiner = context.includes('?') ? '&' : '?';
      return res.redirect(`${context}${joiner}RelayState=${encodeURIComponent(returnTo)}`);
    }
    return res.redirect(context);
  } catch (e: any) {
    console.error('SAML login error:', e?.message);
    return res.status(e?.status ?? 500).send(e?.message ?? 'Failed to start SAML login');
  }
});

app.post('/saml/:orgSlug/acs', async (req: Request, res: Response) => {
  try {
    const config = await loadOrgSamlConfig(req.params.orgSlug as string);
    const { idp, sp } = buildIdpAndSp(config);

    const samlResponse = (req.body as any)?.SAMLResponse;
    if (!samlResponse) return res.status(400).json({ error: 'Missing SAMLResponse payload' });

    if (!config.idpSigningCert) {
      return res.status(500).json({ error: 'Server misconfiguration: IDP signing cert not loaded' });
    }

    const { extract, samlContent } = await sp.parseLoginResponse(idp, 'post', { body: req.body as any });
    enforceAudienceAndRecipient(extract, samlContent, config.spEntityId, config.acsUrl);

    const attributes = (extract?.attributes || {}) as Record<string, unknown>;
    const uid = selectUid(attributes);

    if (!uid) {
      console.error('SAML ACS: missing UID in assertion attributes');
      return res.status(422).json({ error: 'SAML assertion missing UID/email attribute' });
    }

    const email = normalizeString((attributes as any).email) || normalizeString((attributes as any).mail);

    // Enforce allowed email domains if configured
    if (config.allowedEmailDomains && config.allowedEmailDomains.length > 0 && email) {
      const domain = email.split('@')[1]?.toLowerCase() ?? '';
      if (!config.allowedEmailDomains.includes(domain)) {
        console.error('SAML ACS: email domain not allowed', { domain, orgId: config.orgId });
        return res.status(403).json({ error: 'Email domain not permitted for this organization' });
      }
    }

    const samlToken = await issueHandoffToken(uid, config.orgId, attributes);

    const relayState =
      normalizeString((req.body as any)?.RelayState) ||
      normalizeString((extract as any)?.relayState) ||
      '';

    if (relayState) {
      const allowed = ALLOWED_RELAY_PREFIXES.some((prefix) => relayState.startsWith(prefix));
      if (!allowed) {
        console.error('SAML ACS: relay state rejected', { relayState });
        return res.status(400).json({ error: 'RelayState destination is not permitted' });
      }
      const joiner = relayState.includes('?') ? '&' : '?';
      return res.redirect(`${relayState}${joiner}samlToken=${encodeURIComponent(samlToken)}`);
    }

    return res.json({ samlToken });
  } catch (e: any) {
    console.error('SAML ACS error:', e?.message);
    return res.status(e?.status ?? 401).json({ error: e?.message ?? 'Invalid SAML assertion' });
  }
});

app.get('/saml/exchange', (_req: Request, res: Response) =>
  res.status(405).json({ error: 'Use POST /saml/exchange' }),
);

app.post('/saml/exchange', async (req: Request, res: Response) => {
  const clientIp = req.ip ?? 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  }

  const samlToken = (req.body as any)?.samlToken;
  if (!samlToken) return res.status(400).json({ error: 'Missing SAML handoff token' });

  const payload = await consumeHandoffToken(String(samlToken));
  if (!payload) return res.status(401).json({ error: 'Invalid or expired SAML handoff token' });

  const { uid, orgId, attributes } = payload;

  try {
    const email =
      normalizeString((attributes as any).email) ||
      normalizeString((attributes as any).mail) ||
      undefined;

    const givenName =
      normalizeString((attributes as any).givenName) ||
      normalizeString((attributes as any).Fname) ||
      undefined;

    const lastName =
      normalizeString((attributes as any).lastName) ||
      normalizeString((attributes as any).Lname) ||
      undefined;

    const displayName =
      normalizeString((attributes as any).displayName) ||
      [givenName, lastName].filter(Boolean).join(' ') ||
      undefined;

    // Embed orgId as a custom claim so AuthProvider can read it on re-launch
    const firebaseToken = await admin.auth().createCustomToken(uid, { orgId, email, displayName });

    // Upsert user doc in org subcollection
    await admin.firestore()
      .collection('orgs').doc(orgId)
      .collection('users').doc(uid)
      .set(
        {
          uid,
          orgId,
          email: email ?? null,
          displayName: displayName ?? null,
          role: 'student', // SAML users start as student; admin can promote
          lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    return res.json({ firebaseToken });
  } catch (e) {
    console.error('SAML exchange failed:', e);
    return res.status(500).json({ error: 'Failed to mint Firebase token.' });
  }
});

app.get('/saml/:orgSlug/metadata', async (req: Request, res: Response) => {
  try {
    const config = await loadOrgSamlConfig(req.params.orgSlug as string);
    const { sp } = buildIdpAndSp(config);
    res.type('application/xml');
    return res.send(sp.getMetadata());
  } catch (e: any) {
    return res.status(e?.status ?? 500).send(e?.message ?? 'Error generating metadata');
  }
});

// ---- Self-serve org creation ----

app.post('/orgs/create', async (req: Request, res: Response) => {
  const {
    contactFirstName,
    contactLastName,
    contactEmail,
    contactPhone,
    orgName,
    orgType,
    website,
    estimatedRiders,
    heardAboutUs,
    description,
  } = req.body;

  if (!contactFirstName || !contactLastName || !contactEmail || !orgName || !orgType) {
    return res.status(400).json({
      error: 'contactFirstName, contactLastName, contactEmail, orgName and orgType are required',
    });
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Auto-generate slug; ensure uniqueness by appending a counter
  const baseSlug = (orgName as string)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);

  let slug = baseSlug;
  let attempt = 0;
  while (true) {
    const existing = await admin.firestore().collection('orgSlugs').doc(slug).get();
    if (!existing.exists) break;
    attempt++;
    slug = `${baseSlug}-${attempt}`;
    if (attempt > 99) return res.status(409).json({ error: 'Could not generate a unique slug' });
  }

  try {
    const orgRef = admin.firestore().collection('orgs').doc();
    const orgId = orgRef.id;

    const orgData: Record<string, any> = {
      orgId,
      name: orgName,
      slug,
      authMethod: 'email',
      allowedEmailDomains: [],
      stops: [],
      routes: [],
      mapCenter: { latitude: 0, longitude: 0 },
      subscriptionStatus: 'trialing',
      subscriptionPlan: 'starter',
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      adminUids: [],
      approved: false,
      reviewStatus: 'pending',
      founderEmail: (contactEmail as string).toLowerCase().trim(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const batch = admin.firestore().batch();
    batch.set(orgRef, orgData);
    batch.set(admin.firestore().collection('orgSlugs').doc(slug), {
      orgId,
      name: orgName,
      authMethod: 'email',
    });
    batch.set(admin.firestore().collection('orgApplications').doc(orgId), {
      orgId,
      contactFirstName,
      contactLastName,
      contactEmail: (contactEmail as string).toLowerCase().trim(),
      contactPhone: contactPhone ?? null,
      orgName,
      orgType,
      website: website ?? null,
      estimatedRiders: estimatedRiders ?? null,
      heardAboutUs: heardAboutUs ?? null,
      description: description ?? null,
      reviewStatus: 'pending',
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();

    console.log(`[orgs/create] New org application: ${orgName} (${orgId}) by ${contactEmail}`);

    // Send application-received email — fire and forget so a mailer hiccup
    // never blocks the HTTP response.
    sendEmail({
      to: (contactEmail as string).toLowerCase().trim(),
      subject: 'Your Shuttler application has been received',
      html: orgApplicationReceivedTemplate({
        contactName: `${contactFirstName} ${contactLastName}`.trim(),
        orgName: orgName as string,
      }),
    }).catch((err) => console.error('[orgs/create] welcome email failed:', err));

    return res.status(201).json({
      orgId,
      name: orgName,
      slug,
      authMethod: 'email' as const,
      allowedEmailDomains: [],
      stops: [],
      mapCenter: { latitude: 0, longitude: 0 },
      subscriptionStatus: 'trialing' as const,
      subscriptionPlan: 'starter',
      approved: false,
      reviewStatus: 'pending',
    });
  } catch (e) {
    console.error('[orgs/create] error:', e);
    return res.status(500).json({ error: 'Failed to create organisation' });
  }
});

// ---- Email/password registration ----

app.post('/auth/email/register', async (req: Request, res: Response) => {
  const { orgSlug, email, password, displayName, phone } = req.body;
  if (!orgSlug || !email || !password) {
    return res.status(400).json({ error: 'orgSlug, email and password are required' });
  }

  try {
    const slugDoc = await admin.firestore().collection('orgSlugs').doc(orgSlug).get();
    if (!slugDoc.exists) return res.status(404).json({ error: 'Org not found' });
    const { orgId } = slugDoc.data()!;

    const orgDoc = await admin.firestore().collection('orgs').doc(orgId).get();
    if (!orgDoc.exists) return res.status(404).json({ error: 'Org document missing' });
    const org = orgDoc.data()!;

    if (!['trialing', 'active'].includes(org.subscriptionStatus)) {
      return res.status(403).json({ error: 'Org subscription is not active' });
    }

    // Enforce allowed email domains
    if (org.allowedEmailDomains?.length > 0) {
      const domain = (email as string).split('@')[1]?.toLowerCase();
      if (!org.allowedEmailDomains.includes(domain)) {
        return res.status(403).json({ error: 'Email domain not permitted for this organization' });
      }
    }

    const user = await admin.auth().createUser({
      email: email as string,
      password: password as string,
      displayName: displayName as string | undefined,
    });

    await admin.auth().setCustomUserClaims(user.uid, { orgId });

    try {
      console.log(`[register] Writing user doc → orgs/${orgId}/users/${user.uid}`);
      // Founder promotion: if the registering email matches the org's founderEmail, make them admin
      const isFounder =
        typeof org.founderEmail === 'string' &&
        org.founderEmail.toLowerCase() === (email as string).toLowerCase().trim();
      const role = isFounder ? 'admin' : 'student';

      await admin.firestore()
        .collection('orgs').doc(orgId)
        .collection('users').doc(user.uid)
        .set({
          uid: user.uid,
          orgId,
          email,
          displayName: displayName ?? null,
          phone: phone ?? null,
          role,
          lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      if (isFounder) {
        await admin.firestore().collection('orgs').doc(orgId).update({
          adminUids: admin.firestore.FieldValue.arrayUnion(user.uid),
          founderEmail: admin.firestore.FieldValue.delete(), // consumed — remove so members can't read it
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      console.log(`[register] User doc written successfully for uid=${user.uid}`);

      // Send welcome email — fire and forget
      sendEmail({
        to: email as string,
        subject: `Welcome to ${org.name} on Shuttler`,
        html: welcomeTemplate({
          name: (displayName as string | undefined) ?? (email as string).split('@')[0],
          orgName: org.name,
          role,
        }),
      }).catch((err) => console.error('[register] welcome email failed:', err));
    } catch (firestoreErr: any) {
      console.error(`[register] Firestore write FAILED for uid=${user.uid} orgId=${orgId}:`, firestoreErr);
      // Auth user was created — clean up so the email isn't permanently orphaned
      await admin.auth().deleteUser(user.uid).catch((delErr) =>
        console.error('[register] Cleanup deleteUser also failed:', delErr),
      );
      return res.status(500).json({ error: 'Registration failed: could not save user profile.' });
    }

    return res.json({ uid: user.uid });
  } catch (e: any) {
    if (e?.code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    console.error('[register] Auth user creation failed:', e);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// ---- Admin: list org members ----

app.get(
  '/admin/orgs/:orgId/users',
  requireAuth,
  requireOrgAdmin,
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId as string;
    try {
      const snap = await admin.firestore()
        .collection('orgs').doc(orgId)
        .collection('users')
        .orderBy('createdAt', 'desc')
        .get();
      const users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      return res.json(users);
    } catch (e) {
      console.error('List users error:', e);
      return res.status(500).json({ error: 'Failed to list users' });
    }
  },
);

// ---- Admin: set member role ----

app.post(
  '/admin/orgs/:orgId/users/:uid/role',
  requireAuth,
  requireOrgAdmin,
  async (req: Request, res: Response) => {
    const { orgId, uid } = req.params as { orgId: string; uid: string };
    const { role } = req.body;

    if (!['student', 'driver', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'role must be student, driver, or admin' });
    }

    try {
      const userRef = admin.firestore()
        .collection('orgs').doc(orgId)
        .collection('users').doc(uid);

      const snap = await userRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'User not found in this org' });

      await userRef.update({ role, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return res.json({ uid, role });
    } catch (e) {
      console.error('Set role error:', e);
      return res.status(500).json({ error: 'Failed to update role' });
    }
  },
);

// ---- Admin: remove member from org ----

app.delete(
  '/admin/orgs/:orgId/users/:uid',
  requireAuth,
  requireOrgAdmin,
  async (req: Request, res: Response) => {
    const { orgId, uid } = req.params as { orgId: string; uid: string };
    try {
      const batch = admin.firestore().batch();
      const userRef = admin.firestore().collection('orgs').doc(orgId).collection('users').doc(uid);
      const pubRef = admin.firestore().collection('orgs').doc(orgId).collection('publicUsers').doc(uid);

      const [userSnap, pubSnap] = await Promise.all([userRef.get(), pubRef.get()]);
      if (!userSnap.exists) return res.status(404).json({ error: 'User not found in this org' });

      batch.delete(userRef);
      if (pubSnap.exists) batch.delete(pubRef);
      await batch.commit();

      return res.json({ uid, removed: true });
    } catch (e) {
      console.error('Remove user error:', e);
      return res.status(500).json({ error: 'Failed to remove user' });
    }
  },
);

// ---- Admin: save auth config ----

app.post(
  '/admin/orgs/:orgId/auth-config',
  requireAuth,
  requireOrgAdmin,
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId as string;
    const orgSlug = (req as any).orgSlug as string;
    const { authMethod, samlConfig, allowedEmailDomains } = req.body;

    const update: Record<string, any> = {
      authMethod,
      allowedEmailDomains: allowedEmailDomains ?? [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    let spEntityId: string | undefined;
    let acsUrl: string | undefined;

    if (authMethod === 'saml' && samlConfig) {
      acsUrl = `${API_BASE_URL}/saml/${orgSlug}/acs`;
      spEntityId = `${API_BASE_URL}/orgs/${orgId}`;
      update.samlConfig = {
        idpEntityId: samlConfig.idpEntityId,
        idpSsoUrl: samlConfig.idpSsoUrl,
        idpSigningCert: samlConfig.idpSigningCert,
        acsUrl,
        spEntityId,
      };
    } else {
      // Clear SAML config if switching away
      update.samlConfig = admin.firestore.FieldValue.delete();
    }

    await admin.firestore().collection('orgs').doc(orgId).update(update);
    await admin.firestore()
      .collection('orgSlugs').doc(orgSlug)
      .update({ authMethod });

    return res.json({ ok: true, spEntityId, acsUrl });
  },
);

// ---- Billing ----

app.post('/billing/create-checkout-session', requireAuth, async (req: Request, res: Response) => {
  const { orgId, plan, returnUrl } = req.body;
  const uid = (req as any).uid as string;

  try {
    const orgDoc = await admin.firestore().collection('orgs').doc(orgId).get();
    if (!orgDoc.exists) return res.status(404).json({ error: 'Org not found' });
    const org = orgDoc.data()!;

    const userDoc = await admin.firestore().collection('orgs').doc(orgId).collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data()!.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    let customerId: string = org.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ name: org.name, metadata: { orgId } });
      customerId = customer.id;
      await admin.firestore().collection('orgs').doc(orgId).update({ stripeCustomerId: customerId });
    }

    const priceId = PLAN_PRICE_IDS[plan];
    if (!priceId) return res.status(400).json({ error: `Unknown plan: ${plan}` });

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: returnUrl,
      metadata: { orgId, plan },
      subscription_data: { metadata: { orgId, plan } },
    });

    return res.json({ url: session.url });
  } catch (e) {
    console.error('Checkout session error:', e);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

app.post('/billing/create-portal-session', requireAuth, async (req: Request, res: Response) => {
  const { orgId, returnUrl } = req.body;
  const uid = (req as any).uid as string;

  try {
    const orgDoc = await admin.firestore().collection('orgs').doc(orgId).get();
    if (!orgDoc.exists) return res.status(404).json({ error: 'Org not found' });
    const org = orgDoc.data()!;

    const userDoc2 = await admin.firestore().collection('orgs').doc(orgId).collection('users').doc(uid).get();
    if (!userDoc2.exists || userDoc2.data()!.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (!org.stripeCustomerId) {
      return res.status(400).json({ error: 'No billing account found. Subscribe first.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: returnUrl,
    });

    return res.json({ url: session.url });
  } catch (e) {
    console.error('Portal session error:', e);
    return res.status(500).json({ error: 'Failed to create portal session' });
  }
});

app.post('/stripe/webhook', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || '',
    );
  } catch (err) {
    console.error('Stripe webhook signature error:', err);
    return res.status(400).send(`Webhook Error: ${err}`);
  }

  const subscriptionEventTypes = [
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
  ];
  const invoiceEventTypes = ['invoice.payment_failed'];
  const handledTypes = [...subscriptionEventTypes, ...invoiceEventTypes];

  if (!handledTypes.includes(event.type)) {
    return res.json({ received: true });
  }

  try {
    if (subscriptionEventTypes.includes(event.type)) {
      const subscription = event.data.object as Stripe.Subscription;
      const orgId = subscription.metadata?.orgId;
      if (!orgId) {
        console.warn(`Stripe webhook: no orgId in subscription metadata (event: ${event.type}, sub: ${subscription.id})`);
        return res.json({ received: true });
      }

      if (event.type === 'customer.subscription.deleted') {
        await admin.firestore().collection('orgs').doc(orgId).update({
          subscriptionStatus: 'canceled',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        await admin.firestore().collection('orgs').doc(orgId).update({
          subscriptionStatus: subscription.status,
          stripeSubscriptionId: subscription.id,
          subscriptionPlan: subscription.metadata?.plan ?? 'starter',
          currentPeriodEnd: (subscription as any).current_period_end
            ? new Date((subscription as any).current_period_end * 1000)
            : null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
      if (!subId) return res.json({ received: true });

      const sub = await stripe.subscriptions.retrieve(subId);
      const orgId = sub.metadata?.orgId;
      if (!orgId) return res.json({ received: true });

      await admin.firestore().collection('orgs').doc(orgId).update({
        subscriptionStatus: 'past_due',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  } catch (e) {
    console.error('Stripe webhook handler error:', e);
  }

  return res.json({ received: true });
});

// ---- Internal: approve org application ----

app.post('/internal/orgs/:orgId/approve', requireInternal, async (req: Request, res: Response) => {
  const { orgId } = req.params as { orgId: string };
  try {
    const batch = admin.firestore().batch();
    batch.update(admin.firestore().collection('orgs').doc(orgId), {
      approved: true,
      reviewStatus: 'approved',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.update(admin.firestore().collection('orgApplications').doc(orgId), {
      reviewStatus: 'approved',
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();
    console.log(`[approve] Org ${orgId} approved`);
    return res.json({ orgId, approved: true });
  } catch (e) {
    console.error('[approve] error:', e);
    return res.status(500).json({ error: 'Failed to approve org' });
  }
});

// ---- Internal: grant super-admin claim to a user ----

app.post('/internal/users/:uid/grant-super-admin', requireInternal, async (req: Request, res: Response) => {
  const { uid } = req.params as { uid: string };
  try {
    await admin.auth().setCustomUserClaims(uid, { superAdmin: true });
    console.log(`[super-admin] Granted superAdmin claim to uid ${uid}`);
    return res.json({ uid, superAdmin: true });
  } catch (e) {
    console.error('[super-admin] grant error:', e);
    return res.status(500).json({ error: 'Failed to grant super-admin claim' });
  }
});

// ---- Super-admin: list pending org applications ----

app.get('/super-admin/org-applications', requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const snap = await admin.firestore()
      .collection('orgApplications')
      .where('reviewStatus', '==', 'pending')
      .orderBy('submittedAt', 'desc')
      .get();

    const applications = snap.docs.map((d) => {
      const data = d.data();
      return {
        orgId: d.id,
        name: data.name ?? null,
        slug: data.slug ?? null,
        founderEmail: data.founderEmail ?? null,
        authMethod: data.authMethod ?? null,
        submittedAt: data.submittedAt?.toDate?.()?.toISOString() ?? null,
        reviewStatus: data.reviewStatus ?? 'pending',
      };
    });

    return res.json({ applications });
  } catch (e) {
    console.error('[super-admin] list applications error:', e);
    return res.status(500).json({ error: 'Failed to list applications' });
  }
});

// ---- Super-admin: approve org application ----

app.post('/super-admin/org-applications/:orgId/approve', requireSuperAdmin, async (req: Request, res: Response) => {
  const { orgId } = req.params as { orgId: string };
  try {
    const batch = admin.firestore().batch();
    batch.update(admin.firestore().collection('orgs').doc(orgId), {
      approved: true,
      reviewStatus: 'approved',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.update(admin.firestore().collection('orgApplications').doc(orgId), {
      reviewStatus: 'approved',
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();
    console.log(`[super-admin] Approved org ${orgId}`);
    return res.json({ orgId, approved: true });
  } catch (e) {
    console.error('[super-admin] approve error:', e);
    return res.status(500).json({ error: 'Failed to approve org' });
  }
});

// ---- Super-admin: reject org application ----

app.post('/super-admin/org-applications/:orgId/reject', requireSuperAdmin, async (req: Request, res: Response) => {
  const { orgId } = req.params as { orgId: string };
  const { reason } = req.body as { reason?: string };
  try {
    const batch = admin.firestore().batch();
    batch.update(admin.firestore().collection('orgs').doc(orgId), {
      approved: false,
      reviewStatus: 'rejected',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.update(admin.firestore().collection('orgApplications').doc(orgId), {
      reviewStatus: 'rejected',
      rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
      rejectionReason: reason ?? null,
    });
    await batch.commit();
    console.log(`[super-admin] Rejected org ${orgId}`);
    return res.json({ orgId, rejected: true });
  } catch (e) {
    console.error('[super-admin] reject error:', e);
    return res.status(500).json({ error: 'Failed to reject org' });
  }
});

// ---- Internal: create new org ----

app.post('/internal/orgs', requireInternal, async (req: Request, res: Response) => {
  const { name, slug, adminEmail, authMethod, allowedEmailDomains } = req.body;
  if (!name || !slug || !adminEmail || !authMethod) {
    return res.status(400).json({ error: 'name, slug, adminEmail and authMethod are required' });
  }

  try {
    // Ensure slug is unique
    const existing = await admin.firestore().collection('orgSlugs').doc(slug).get();
    if (existing.exists) return res.status(409).json({ error: `Slug "${slug}" already taken` });

    const orgRef = admin.firestore().collection('orgs').doc();
    const orgId = orgRef.id;

    await orgRef.set({
      orgId,
      name,
      slug,
      authMethod,
      allowedEmailDomains: allowedEmailDomains ?? [],
      stops: [],
      mapCenter: { latitude: 0, longitude: 0 },
      subscriptionStatus: 'trialing',
      subscriptionPlan: 'starter',
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      adminUids: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await admin.firestore().collection('orgSlugs').doc(slug).set({
      orgId,
      name,
      authMethod,
    });

    const inviteCode = crypto.randomBytes(16).toString('hex');
    await admin.firestore().collection('orgInvites').doc(inviteCode).set({
      orgId,
      email: adminEmail,
      role: 'admin',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    console.log(`New org created: ${name} (${orgId}), invite code: ${inviteCode}`);

    return res.json({ orgId, slug, inviteCode });
  } catch (e) {
    console.error('Create org error:', e);
    return res.status(500).json({ error: 'Failed to create org' });
  }
});

// ---------- Push Notifications ----------

/**
 * Sends push notifications via the Expo Push API.
 * Batches up to 100 messages per request as required by Expo.
 */
async function sendExpoPushNotifications(
  tokens: string[],
  title: string,
  body: string,
): Promise<void> {
  const valid = tokens.filter((t) => t && t.startsWith('ExponentPushToken['));
  if (valid.length === 0) return;

  const BATCH_SIZE = 100;
  for (let i = 0; i < valid.length; i += BATCH_SIZE) {
    const batch = valid.slice(i, i + BATCH_SIZE).map((to) => ({
      to,
      title,
      body,
      sound: 'default',
    }));

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(batch),
    });
  }
}

/** POST /notifications/stop-request-created
 *  Called when a student creates a stop request.
 *  Reads all driver/admin users in the org and sends them a push notification.
 */
app.post('/notifications/stop-request-created', requireAuth, async (req: Request, res: Response) => {
  const { orgId } = req.body as { orgId?: string };
  if (!orgId) return res.status(400).json({ error: 'orgId required' });

  try {
    const usersSnap = await admin.firestore()
      .collection('orgs').doc(orgId).collection('users')
      .get();

    const tokens: string[] = [];
    usersSnap.forEach((d) => {
      const data = d.data();
      if ((data.role === 'driver' || data.role === 'admin') && data.expoPushToken) {
        tokens.push(data.expoPushToken as string);
      }
    });

    await sendExpoPushNotifications(tokens, 'New Stop Request', 'A student is requesting a pickup.');
    return res.json({ sent: tokens.length });
  } catch (e) {
    console.error('[notifications] stop-request-created error:', e);
    return res.status(500).json({ error: 'Failed to send notifications' });
  }
});

/** POST /notifications/stop-arrived
 *  Called when the driver's bus enters a stop's arrival radius.
 *  Sends a push notification to the student who made the request.
 */
app.post('/notifications/stop-arrived', requireAuth, async (req: Request, res: Response) => {
  const { orgId, studentUid, stopName } = req.body as {
    orgId?: string;
    studentUid?: string;
    stopName?: string;
  };
  if (!orgId || !studentUid) return res.status(400).json({ error: 'orgId and studentUid required' });

  try {
    const userDoc = await admin.firestore()
      .collection('orgs').doc(orgId).collection('users').doc(studentUid)
      .get();
    const token = userDoc.data()?.expoPushToken as string | undefined;

    if (token) {
      await sendExpoPushNotifications(
        [token],
        'Bus Arriving!',
        `Your bus is arriving at ${stopName ?? 'your stop'}.`,
      );
    }

    return res.json({ sent: token ? 1 : 0 });
  } catch (e) {
    console.error('[notifications] stop-arrived error:', e);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
});

/** POST /notifications/stop-completed
 *  Called when a stop request is marked completed.
 *  Sends a push notification to the student who made the request.
 */
app.post('/notifications/stop-completed', requireAuth, async (req: Request, res: Response) => {
  const { orgId, studentUid, stopName } = req.body as {
    orgId?: string;
    studentUid?: string;
    stopName?: string;
  };
  if (!orgId || !studentUid) return res.status(400).json({ error: 'orgId and studentUid required' });

  try {
    const userDoc = await admin.firestore()
      .collection('orgs').doc(orgId).collection('users').doc(studentUid)
      .get();
    const token = userDoc.data()?.expoPushToken as string | undefined;

    if (token) {
      await sendExpoPushNotifications(
        [token],
        'Bus Has Arrived!',
        `The bus has completed your pickup at ${stopName ?? 'your stop'}.`,
      );
    }

    return res.json({ sent: token ? 1 : 0 });
  } catch (e) {
    console.error('[notifications] stop-completed error:', e);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
});

// ---------- Email ----------

// Send a branded email-verification email for the currently signed-in user.
// The mobile app calls this instead of Firebase SDK's sendEmailVerification().
app.post('/auth/send-verification', requireAuth, async (req: Request, res: Response) => {
  const uid = (req as any).uid as string;
  try {
    const userRecord = await admin.auth().getUser(uid);
    if (!userRecord.email) return res.status(400).json({ error: 'User has no email address' });

    const orgId = (req as any).claims?.orgId as string | undefined;
    let orgName = 'your organisation';
    if (orgId) {
      const orgDoc = await admin.firestore().collection('orgs').doc(orgId).get();
      orgName = orgDoc.data()?.name ?? orgName;
    }

    const verifyUrl = await admin.auth().generateEmailVerificationLink(userRecord.email);
    const displayName = userRecord.displayName ?? userRecord.email.split('@')[0];

    await sendEmail({
      to: userRecord.email,
      subject: 'Verify your Shuttler email address',
      html: emailVerificationTemplate({ name: displayName, verifyUrl, orgName }),
    });

    console.log(`[send-verification] sent to ${userRecord.email}`);
    return res.json({ sent: true });
  } catch (e: any) {
    console.error('[send-verification] error:', e);
    return res.status(500).json({ error: 'Failed to send verification email' });
  }
});

// Send a branded password-reset email. No auth required — same as Firebase's
// sendPasswordResetEmail(), but uses our template. Always returns 200 so as
// not to reveal whether an account exists for the given email address.
app.post('/auth/send-password-reset', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }

  try {
    let orgName = 'your organisation';
    let displayName = (email as string).split('@')[0];

    try {
      const userRecord = await admin.auth().getUserByEmail(email);
      displayName = userRecord.displayName ?? displayName;
      const claims = userRecord.customClaims ?? {};
      const orgId = (claims as any).orgId;
      if (orgId) {
        const orgDoc = await admin.firestore().collection('orgs').doc(orgId).get();
        orgName = orgDoc.data()?.name ?? orgName;
      }
    } catch {
      // User not found — still attempt to generate the link; Firebase returns
      // an error that we swallow so we don't leak account existence.
    }

    const resetUrl = await admin.auth().generatePasswordResetLink(email);

    await sendEmail({
      to: email,
      subject: 'Reset your Shuttler password',
      html: passwordResetTemplate({ name: displayName, resetUrl, orgName }),
    });

    console.log(`[send-password-reset] sent to ${email}`);
    return res.json({ sent: true });
  } catch (e: any) {
    // Log but still return 200 — never confirm or deny account existence.
    console.error('[send-password-reset] error:', e?.message ?? e);
    return res.json({ sent: false });
  }
});

// ---------- Start ----------

const server = app.listen(PORT, () => {
  console.log(`Shuttler backend listening on http://localhost:${PORT}`);
  console.log(`API base URL: ${API_BASE_URL}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received — shutting down gracefully`);
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ---------- Helpers ----------

function selectUid(attributes: Record<string, unknown>): string | undefined {
  const candidateKeys = ['uid', 'userId', 'email', 'mail', 'nameID', 'NameID'];
  for (const key of candidateKeys) {
    const value = attributes[key];
    if (!value) continue;
    if (Array.isArray(value)) {
      if (value[0]) return String(value[0]);
    } else {
      return String(value);
    }
  }
  return undefined;
}

function formatCert(cert: string): string {
  if (!cert) return '';
  const compact = cert
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\r?\n|\s+/g, '');
  const wrapped = compact.match(/.{1,64}/g)?.join('\n') || compact;
  return `-----BEGIN CERTIFICATE-----\n${wrapped}\n-----END CERTIFICATE-----`;
}

function enforceAudienceAndRecipient(
  extract: any,
  samlContent: string,
  expectedAudience: string,
  expectedRecipient: string,
) {
  const audienceValues = normalizeAudience(extract?.audience);
  const responseDestination = extract?.response?.destination as string | undefined;

  const recipientExtract = saml.Extractor.extract(samlContent, [
    {
      key: 'recipient',
      localPath: ['Response', 'Assertion', 'Subject', 'SubjectConfirmation', 'SubjectConfirmationData'],
      attributes: ['Recipient'],
    },
  ]);
  const recipientValue = normalizeString((recipientExtract as any)?.recipient);

  if (!audienceValues.includes(expectedAudience)) {
    throw Object.assign(new Error('ERR_SAML_AUDIENCE_MISMATCH'), { status: 401 });
  }

  if (responseDestination && responseDestination !== expectedRecipient) {
    throw Object.assign(new Error('ERR_SAML_DESTINATION_MISMATCH'), { status: 401 });
  }

  if (recipientValue && recipientValue !== expectedRecipient) {
    throw Object.assign(new Error('ERR_SAML_RECIPIENT_MISMATCH'), { status: 401 });
  }
}

function normalizeAudience(audience: unknown): string[] {
  if (!audience) return [];
  if (Array.isArray(audience)) return audience.map((v) => String(v));
  return [String(audience)];
}

function normalizeString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value[0] ? String(value[0]) : undefined;
  return String(value);
}
