import express, { Request, Response } from 'express';
import cors from 'cors';
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
  orgRejectedTemplate,
  subscriptionConfirmedTemplate,
} from './mailer';
import {
  handleAdminChat,
  checkAndIncrementAiUsage,
  generateOrgInsight,
  runWeeklyDigest,
  runMonthlyDigest,
  startWeeklyDigestCron,
  startMonthlyDigestCron,
} from './ai';

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

const STRIPE_PRICE_DATA_ADDON = process.env.STRIPE_PRICE_DATA || '';

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

// ---------- Rate limiters ----------

function createRateLimiter(windowMs: number, max: number) {
  const map = new Map<string, { count: number; windowStart: number }>();
  return function check(ip: string): boolean {
    const now = Date.now();
    const entry = map.get(ip);
    if (!entry || now - entry.windowStart > windowMs) {
      map.set(ip, { count: 1, windowStart: now });
      return false;
    }
    entry.count += 1;
    return entry.count > max;
  };
}

const exchangeLimit = createRateLimiter(60_000, 10);
const aiChatLimit = createRateLimiter(60_000, 20);
const registerLimit = createRateLimiter(60_000, 5);
const passwordResetLimit = createRateLimiter(60_000, 5);
const orgCreateLimit = createRateLimiter(60_000, 3);
const waitlistLimit = createRateLimiter(60_000, 3);
const announcementLimit = createRateLimiter(60_000, 5);

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
    const superAdminEmails = (process.env.SUPER_ADMIN_EMAILS ?? '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    const isSuperAdmin = decoded.superAdmin === true || superAdminEmails.includes(decoded.email ?? '');
    if (!isSuperAdmin) {
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

// ---------- Entitlements ----------

// Derives the entitlements object from plan + addons. Single source of truth —
// called whenever subscription state changes so the org doc stays in sync.
function computeEntitlements(plan: string, dataAddonActive: boolean) {
  // Enterprise always includes data access; other plans need the add-on
  const dataUnlocked = dataAddonActive || plan === 'enterprise';
  return {
    aiAssistant: true,        // available on all plans including Starter
    basicExport: true,        // always included — orgs always own their data
    dataApi: dataUnlocked,
    extendedRetention: dataUnlocked,
    scheduledExports: dataUnlocked,
  };
}


// ---------- Express app ----------

const app = express();

Sentry.setupExpressErrorHandler(app);

// CORS — allow the admin web dashboard and (in dev only) local dev servers
const isProduction = process.env.NODE_ENV === 'production';
const configuredOrigins = (process.env.ADMIN_ORIGIN ?? '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

if (isProduction && configuredOrigins.length === 0) {
  console.warn('[cors] WARNING: ADMIN_ORIGIN is not set. Browser CORS for the admin dashboard will be blocked in production.');
}

const ALLOWED_ORIGINS = isProduction
  ? configuredOrigins
  : [...configuredOrigins, 'http://localhost:5173', 'http://localhost:4173'];

app.use(cors({
  origin: (origin, cb) => {
    // Allow server-to-server (no origin) and whitelisted browsers
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Stripe webhook needs raw body — register before express.json()
app.use('/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---- Waitlist ----

app.post('/api/waitlist', async (req: Request, res: Response) => {
  if (waitlistLimit(req.ip ?? 'unknown')) {
    return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  }

  const email = String(req.body?.email ?? '').toLowerCase().trim();
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!email || !isValidEmail) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }

  try {
    const db = admin.firestore();
    const existing = await db.collection('waitlist').where('email', '==', email).limit(1).get();
    if (!existing.empty) {
      return res.status(409).json({ error: 'already_registered' });
    }

    await db.collection('waitlist').add({
      email,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: req.body?.source ?? 'website',
      ip: req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? null,
    });

    // Notify Breno — fire and forget
    sendEmail({
      to: 'brenotebet@live.com',
      subject: `New waitlist signup — ${email}`,
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <h2 style="font-size:22px;font-weight:400;margin-bottom:8px;">New waitlist signup</h2>
        <p style="color:#666;margin-bottom:24px;">Someone just joined the Shuttler waitlist.</p>
        <div style="background:#f5f5f8;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
          <p style="margin:0;font-size:13px;color:#888;font-family:monospace;margin-bottom:4px;">EMAIL</p>
          <p style="margin:0;font-size:18px;font-weight:500;">${email}</p>
        </div>
        <p style="color:#888;font-size:13px;">View all leads in your Firebase console under <code>waitlist/</code>.</p>
      </div>`,
    }).catch((err: Error) => console.error('[waitlist] notification email failed:', err));

    // Confirm to user — fire and forget
    sendEmail({
      to: email,
      subject: `You're on the Shuttler waitlist`,
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 32px;background:#08080f;color:#f0f0f8;border-radius:16px;">
        <h1 style="font-size:28px;font-weight:300;letter-spacing:-0.02em;margin-bottom:16px;color:#f0f0f8;">You're on the list.</h1>
        <p style="color:#8888a8;font-size:16px;line-height:1.7;margin-bottom:28px;">
          Thanks for your interest in Shuttler. I'll reach out personally when we're ready to onboard your institution.
        </p>
        <div style="background:#0e0e1a;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:20px 24px;margin-bottom:28px;">
          <p style="margin:0;font-size:13px;color:#555570;font-family:monospace;text-transform:uppercase;margin-bottom:8px;">What happens next</p>
          <p style="margin:0 0 8px;font-size:14px;color:#8888a8;">→ I review your submission and reach out directly.</p>
          <p style="margin:0 0 8px;font-size:14px;color:#8888a8;">→ We schedule a short call to understand your operation.</p>
          <p style="margin:0;font-size:14px;color:#8888a8;">→ You get early access + locked-in founder pricing.</p>
        </div>
        <p style="color:#555570;font-size:13px;">— Breno, Founder of Shuttler</p>
        <div style="margin-top:32px;padding-top:24px;border-top:1px solid rgba(255,255,255,0.06);">
          <a href="https://shuttler.net" style="color:#7B5CF0;font-size:13px;text-decoration:none;">shuttler.net</a>
        </div>
      </div>`,
    }).catch((err: Error) => console.error('[waitlist] confirmation email failed:', err));

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[waitlist] Error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---- Health ----

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'shuttler-backend', apiBaseUrl: API_BASE_URL });
});

// ---- Public org listing ----

app.get('/orgs', async (_req: Request, res: Response) => {
  try {
    const snap = await admin.firestore().collection('orgSlugs').get();
    if (snap.empty) return res.json([]);

    // Batch-fetch org docs to include logoUrl + primaryColor for the selector
    const orgRefs = snap.docs
      .map((d) => d.data().orgId as string | undefined)
      .filter((id): id is string => Boolean(id))
      .map((id) => admin.firestore().collection('orgs').doc(id));

    const orgDocs = orgRefs.length > 0 ? await admin.firestore().getAll(...orgRefs) : [];
    const orgById: Record<string, admin.firestore.DocumentData> = {};
    orgDocs.forEach((d) => { if (d.exists) orgById[d.id] = d.data()!; });

    const orgs = snap.docs.map((d) => {
      const slugData = d.data();
      const orgId = slugData.orgId as string | undefined;
      const extra = orgId ? orgById[orgId] : null;
      return {
        slug: d.id,
        ...slugData,
        logoUrl: extra?.logoUrl ?? null,
        primaryColor: extra?.primaryColor ?? null,
      };
    });
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
  if (exchangeLimit(clientIp)) {
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
  if (orgCreateLimit(req.ip ?? 'unknown')) {
    return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  }

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
    agreedToTerms,
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
      // allowedEmailDomains not set = open self-registration (any email can sign up).
      // Admin can later restrict by setting specific domains or [] to disable.
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
      agreedToTermsAt: agreedToTerms ? admin.firestore.FieldValue.serverTimestamp() : null,
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
      stops: [],
      mapCenter: { latitude: 0, longitude: 0 },
      subscriptionStatus: 'trialing' as const,
      subscriptionPlan: 'starter',
      approved: false,
      reviewStatus: 'pending',
    });
  } catch (e) {
    console.error('[orgs/create] error:', e);
    return res.status(500).json({ error: 'Failed to create organization' });
  }
});

// ---- Email/password registration ----

app.post('/auth/email/register', async (req: Request, res: Response) => {
  if (registerLimit(req.ip ?? 'unknown')) {
    return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  }

  const { orgSlug, email, password, displayName, phone, agreedToTerms } = req.body;
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

    // Phone-auth orgs (K-12) use SMS OTP for parents — email registration is
    // not available. Admins sign in with existing email accounts, not new ones.
    if (org.authMethod === 'phone') {
      return res.status(403).json({
        error: 'This organization uses phone sign-in. Please use the phone sign-in option to access the app.',
      });
    }

    // Enforce allowed email domains if the org has configured them.
    const allowedDomains: string[] = org.allowedEmailDomains ?? [];
    if (allowedDomains.length > 0) {
      const emailDomain = (email as string).split('@')[1]?.toLowerCase() ?? '';
      if (!allowedDomains.includes(emailDomain)) {
        return res.status(403).json({
          error: `Registration is restricted to ${allowedDomains.join(', ')} email addresses.`,
        });
      }
    }

    // Check if a Firebase Auth user already exists for this email.
    // This happens when Firestore data is wiped but Auth users are not — the email
    // would otherwise be permanently blocked from re-registering.
    let authUser: admin.auth.UserRecord;
    let isRecovery = false;
    try {
      authUser = await admin.auth().getUserByEmail(email as string);
      // Auth user exists — check if they already have a profile in this org
      const existingProfile = await admin.firestore()
        .collection('orgs').doc(orgId)
        .collection('users').doc(authUser.uid)
        .get();
      if (existingProfile.exists) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }
      // Orphaned auth user (no org profile) — update password, reset emailVerified so the
      // new signup must re-confirm ownership of the address.
      await admin.auth().updateUser(authUser.uid, {
        password: password as string,
        displayName: displayName as string | undefined,
        emailVerified: false,
      });
      isRecovery = true;
      console.log(`[register] Recovering orphaned auth user uid=${authUser.uid} for orgId=${orgId}`);
    } catch (lookupErr: any) {
      if (lookupErr?.code !== 'auth/user-not-found') throw lookupErr;
      // Normal path — create a fresh auth user
      authUser = await admin.auth().createUser({
        email: email as string,
        password: password as string,
        displayName: displayName as string | undefined,
      });
    }

    await admin.auth().setCustomUserClaims(authUser.uid, { orgId });

    try {
      console.log(`[register] Writing user doc → orgs/${orgId}/users/${authUser.uid}`);
      const isFounder =
        typeof org.founderEmail === 'string' &&
        org.founderEmail.toLowerCase() === (email as string).toLowerCase().trim();
      const role = isFounder ? 'admin' : 'student';

      await admin.firestore()
        .collection('orgs').doc(orgId)
        .collection('users').doc(authUser.uid)
        .set({
          uid: authUser.uid,
          orgId,
          email,
          displayName: displayName ?? null,
          phone: phone ?? null,
          role,
          agreedToTermsAt: agreedToTerms ? admin.firestore.FieldValue.serverTimestamp() : null,
          lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      if (isFounder) {
        await admin.firestore().collection('orgs').doc(orgId).update({
          adminUids: admin.firestore.FieldValue.arrayUnion(authUser.uid),
          ownerUid: authUser.uid, // locked — never reassigned
          founderEmail: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      console.log(`[register] User doc written successfully for uid=${authUser.uid} (recovery=${isRecovery})`);

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
      console.error(`[register] Firestore write FAILED for uid=${authUser.uid} orgId=${orgId}:`, firestoreErr);
      if (!isRecovery) {
        await admin.auth().deleteUser(authUser.uid).catch((delErr) =>
          console.error('[register] Cleanup deleteUser also failed:', delErr),
        );
      }
      return res.status(500).json({ error: 'Registration failed: could not save user profile.' });
    }

    return res.json({ uid: authUser.uid });
  } catch (e: any) {
    console.error('[register] error:', e);
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
      // Prevent changing the caller's own role (must ask another admin).
      const callerUid = (req as any).uid as string;
      if (uid === callerUid) {
        return res.status(403).json({ error: 'You cannot change your own role. Ask another admin.' });
      }

      const orgDoc = await admin.firestore().collection('orgs').doc(orgId).get();
      const ownerUid: string | undefined = orgDoc.data()?.ownerUid;

      // The org owner's role is permanent — no admin can demote them.
      if (ownerUid && uid === ownerUid) {
        return res.status(403).json({ error: 'The org owner\'s role cannot be changed.' });
      }

      const userRef = admin.firestore()
        .collection('orgs').doc(orgId)
        .collection('users').doc(uid);

      const snap = await userRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'User not found in this org' });

      // Prevent demoting the last admin (would lock everyone out).
      if (role !== 'admin' && snap.data()?.role === 'admin') {
        const adminSnap = await admin.firestore()
          .collection('orgs').doc(orgId).collection('users')
          .where('role', '==', 'admin')
          .get();
        if (adminSnap.size <= 1) {
          return res.status(403).json({ error: 'Cannot demote the last admin. Promote someone else first.' });
        }
      }

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
      const callerUid = (req as any).uid as string;
      if (uid === callerUid) {
        return res.status(403).json({ error: 'You cannot remove yourself. Ask another admin.' });
      }

      const orgDoc = await admin.firestore().collection('orgs').doc(orgId).get();
      const ownerUid: string | undefined = orgDoc.data()?.ownerUid;
      if (ownerUid && uid === ownerUid) {
        return res.status(403).json({ error: 'The org owner cannot be removed.' });
      }

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

// ---- Self-service account deletion (Apple App Store 5.1.1(v) requirement) ----
// A user deletes their own account: removes their Firestore membership, public
// profile, and Firebase Auth identity. The org OWNER is blocked — they must
// wind down the organization (cancel subscription, delete org) first so the
// subscription and other members aren't orphaned.
app.delete('/account', requireAuth, async (req: Request, res: Response) => {
  const uid = (req as any).uid as string;
  const { orgId } = req.body as { orgId?: string };

  try {
    if (orgId) {
      const orgRef = admin.firestore().collection('orgs').doc(orgId);
      const orgSnap = await orgRef.get();

      if (orgSnap.exists && orgSnap.data()?.ownerUid === uid) {
        return res.status(409).json({
          error:
            'As the organization owner, please cancel your subscription and delete your organization before deleting your account. Contact support@shuttler.net for help.',
        });
      }

      // Scrub PII from the user's stop requests. Anonymize rather than delete so
      // the org keeps aggregate ridership history (status/stop/timestamps remain).
      const reqSnap = await orgRef
        .collection('stopRequests')
        .where('studentUid', '==', uid)
        .get();
      const reqDocs = reqSnap.docs;
      for (let i = 0; i < reqDocs.length; i += 450) {
        const scrubBatch = admin.firestore().batch();
        for (const d of reqDocs.slice(i, i + 450)) {
          scrubBatch.update(d.ref, {
            studentUid: admin.firestore.FieldValue.delete(),
            studentEmail: admin.firestore.FieldValue.delete(),
            childName: admin.firestore.FieldValue.delete(),
            childGrade: admin.firestore.FieldValue.delete(),
          });
        }
        await scrubBatch.commit();
      }

      const batch = admin.firestore().batch();
      batch.delete(orgRef.collection('users').doc(uid));
      const pubRef = orgRef.collection('publicUsers').doc(uid);
      const pubSnap = await pubRef.get();
      if (pubSnap.exists) batch.delete(pubRef);
      await batch.commit();
    }

    // Remove the auth identity last so a Firestore failure above doesn't strand
    // the user without a login. Best-effort: a missing auth user is still success.
    await admin.auth().deleteUser(uid).catch((e) => {
      console.error('[delete account] auth deleteUser failed:', e);
    });

    return res.json({ deleted: true });
  } catch (e) {
    console.error('Delete account error:', e);
    return res.status(500).json({ error: 'Failed to delete account' });
  }
});

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
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    // Only overwrite allowedEmailDomains when the admin explicitly sends it.
    // Omitting it preserves whatever was previously configured.
    if (allowedEmailDomains !== undefined) {
      update.allowedEmailDomains = allowedEmailDomains;
    }

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

// ---- Org Settings (general) ----

app.patch(
  '/orgs/:orgId',
  requireAuth,
  requireOrgAdmin,
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId as string;
    const { breakSettings } = req.body as { breakSettings?: Record<string, any> };

    const update: Record<string, any> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (breakSettings !== undefined) {
      const enabled = typeof breakSettings.enabled === 'boolean' ? breakSettings.enabled : false;
      const maxMinutes = typeof breakSettings.maxMinutes === 'number' && breakSettings.maxMinutes > 0 ? breakSettings.maxMinutes : 15;
      const breaksPerShift = typeof breakSettings.breaksPerShift === 'number' && breakSettings.breaksPerShift > 0 ? breakSettings.breaksPerShift : 1;
      update.breakSettings = { enabled, maxMinutes, breaksPerShift };
    }

    await admin.firestore().collection('orgs').doc(orgId).update(update);
    return res.json({ ok: true });
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
    if (!priceId) {
      console.error(`[billing] Missing price ID for plan "${plan}". Set STRIPE_PRICE_${plan.toUpperCase()} in Railway env vars.`);
      return res.status(400).json({ error: `Plan "${plan}" is not configured. Please contact support.` });
    }

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
  } catch (e: any) {
    console.error('Checkout session error:', e);
    // Surface actionable Stripe errors so misconfiguration is easy to spot
    const type: string = e?.type ?? '';
    if (type === 'StripeAuthenticationError' || e?.message?.includes('API key')) {
      return res.status(500).json({ error: 'Payment service is misconfigured. Please contact support.' });
    }
    if (type === 'StripeInvalidRequestError') {
      return res.status(500).json({ error: 'Payment configuration error. Please contact support.' });
    }
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

app.post('/billing/create-addon-checkout-session', requireAuth, async (req: Request, res: Response) => {
  const { orgId, returnUrl } = req.body;
  const uid = (req as any).uid as string;

  try {
    const orgDoc = await admin.firestore().collection('orgs').doc(orgId).get();
    if (!orgDoc.exists) return res.status(404).json({ error: 'Org not found' });
    const org = orgDoc.data()!;

    const userDoc = await admin.firestore().collection('orgs').doc(orgId).collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data()!.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (!STRIPE_PRICE_DATA_ADDON) {
      console.error('[billing] Missing price ID for data add-on. Set STRIPE_PRICE_DATA in env vars.');
      return res.status(500).json({ error: 'Data add-on is not available. Please contact support.' });
    }

    let customerId: string = org.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ name: org.name, metadata: { orgId } });
      customerId = customer.id;
      await admin.firestore().collection('orgs').doc(orgId).update({ stripeCustomerId: customerId });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: STRIPE_PRICE_DATA_ADDON, quantity: 1 }],
      success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: returnUrl,
      metadata: { orgId, type: 'data_addon' },
      subscription_data: { metadata: { orgId, type: 'data_addon' } },
    });

    return res.json({ url: session.url });
  } catch (e: any) {
    console.error('[billing/create-addon-checkout-session] error:', e);
    return res.status(500).json({ error: 'Failed to create checkout session' });
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
  const handledTypes = [
    ...subscriptionEventTypes,
    'checkout.session.completed',
    'invoice.payment_failed',
  ];

  if (!handledTypes.includes(event.type)) {
    return res.json({ received: true });
  }

  // Idempotency: skip events already processed (Stripe retries on non-2xx)
  const eventDocRef = admin.firestore().collection('processedWebhookEvents').doc(event.id);
  try {
    const alreadyProcessed = await eventDocRef.get();
    if (alreadyProcessed.exists) {
      console.log(`[webhook] Duplicate event ${event.id} (${event.type}) — skipping`);
      return res.json({ received: true });
    }
    await eventDocRef.set({
      type: event.type,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (idempErr) {
    console.warn('[webhook] Could not check idempotency record — proceeding:', idempErr);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.orgId;
      const eventType: string = session.metadata?.type ?? '';
      if (!orgId) {
        console.warn('[webhook] checkout.session.completed missing orgId in metadata');
        return res.json({ received: true });
      }

      // Data add-on purchase
      if (eventType === 'data_addon') {
        const orgSnap = await admin.firestore().collection('orgs').doc(orgId).get();
        const currentPlan = orgSnap.data()?.subscriptionPlan ?? 'starter';
        await admin.firestore().collection('orgs').doc(orgId).update({
          dataAddonActive: true,
          entitlements: computeEntitlements(currentPlan, true),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[webhook] data_addon activated for org ${orgId}`);
        return res.json({ received: true });
      }

      const plan: string = session.metadata?.plan ?? 'starter';

      // Retrieve the subscription so we get the real status
      const subId = typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription as any)?.id;

      if (subId) {
        const sub = await stripe.subscriptions.retrieve(subId);
        const orgSnap = await admin.firestore().collection('orgs').doc(orgId).get();
        const dataAddonActive = orgSnap.data()?.dataAddonActive ?? false;
        await admin.firestore().collection('orgs').doc(orgId).update({
          subscriptionStatus: sub.status,
          stripeSubscriptionId: sub.id,
          subscriptionPlan: plan,
          entitlements: computeEntitlements(plan, dataAddonActive),
          currentPeriodEnd: (sub as any).current_period_end
            ? new Date((sub as any).current_period_end * 1000)
            : null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Confirmation email — fire and forget
      const orgDoc = await admin.firestore().collection('orgs').doc(orgId).get();
      const orgData = orgDoc.exists ? orgDoc.data()! : {};
      const founderEmail: string | null = session.customer_details?.email ?? orgData.founderEmail ?? null;
      const orgName: string = orgData.name ?? orgId;
      const PLAN_LABELS: Record<string, string> = { starter: 'Starter', campus: 'Campus', enterprise: 'Enterprise' };
      const PLAN_AMOUNTS: Record<string, string> = { starter: '$149', campus: '$299', enterprise: 'From $499' };
      if (founderEmail) {
        sendEmail({
          to: founderEmail,
          subject: `Your Shuttler ${PLAN_LABELS[plan] ?? plan} subscription is active`,
          html: subscriptionConfirmedTemplate({
            contactName: session.customer_details?.name ?? founderEmail,
            orgName,
            planLabel: PLAN_LABELS[plan] ?? plan,
            amount: PLAN_AMOUNTS[plan] ?? '—',
          }),
        }).catch((err) => console.error('[webhook] confirmation email failed:', err));
      }

    } else if (subscriptionEventTypes.includes(event.type)) {
      const subscription = event.data.object as Stripe.Subscription;
      const orgId = subscription.metadata?.orgId;
      const subType: string = subscription.metadata?.type ?? '';
      if (!orgId) {
        console.warn(`[webhook] ${event.type} missing orgId in subscription metadata (sub: ${subscription.id})`);
        return res.json({ received: true });
      }

      if (event.type === 'customer.subscription.deleted') {
        if (subType === 'data_addon') {
          const orgSnap = await admin.firestore().collection('orgs').doc(orgId).get();
          const currentPlan = orgSnap.data()?.subscriptionPlan ?? 'starter';
          await admin.firestore().collection('orgs').doc(orgId).update({
            dataAddonActive: false,
            entitlements: computeEntitlements(currentPlan, false),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`[webhook] data_addon deactivated for org ${orgId}`);
        } else {
          await admin.firestore().collection('orgs').doc(orgId).update({
            subscriptionStatus: 'canceled',
            entitlements: computeEntitlements('starter', false),
            limitOverrides: admin.firestore.FieldValue.delete(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      } else if (subType !== 'data_addon') {
        const updatedPlan = subscription.metadata?.plan ?? 'starter';
        // Negotiated vehicle cap for Enterprise deals — set maxVehicles on the
        // subscription's metadata in the Stripe dashboard. Absent/invalid metadata
        // clears the override so the plan-tier default applies.
        const maxVehicles = parseInt(subscription.metadata?.maxVehicles ?? '', 10);
        const limitOverrides = Number.isInteger(maxVehicles) && maxVehicles > 0
          ? { maxVehicles }
          : admin.firestore.FieldValue.delete();
        const orgSnap = await admin.firestore().collection('orgs').doc(orgId).get();
        const dataAddonActive = orgSnap.data()?.dataAddonActive ?? false;
        await admin.firestore().collection('orgs').doc(orgId).update({
          subscriptionStatus: subscription.status,
          stripeSubscriptionId: subscription.id,
          subscriptionPlan: updatedPlan,
          limitOverrides,
          entitlements: computeEntitlements(updatedPlan, dataAddonActive),
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
    console.error('[webhook] handler error:', e);
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

// ---- Super-admin: list rider feedback ----

app.get('/super-admin/feedback', requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const snap = await admin.firestore()
      .collectionGroup('feedback')
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();

    const entries = snap.docs.map((d) => {
      const data = d.data();
      const pathParts = d.ref.path.split('/');
      const orgId = pathParts[1] ?? null;
      return {
        id: d.id,
        orgId,
        studentUid: data.studentUid ?? null,
        requestId: data.requestId ?? null,
        questionKey: data.questionKey ?? null,
        question: data.question ?? null,
        rating: data.rating ?? null,
        answer: data.answer ?? null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    return res.json({ entries });
  } catch (e) {
    console.error('[super-admin/feedback] error:', e);
    return res.status(500).json({ error: 'Failed to load feedback' });
  }
});

// ---- Super-admin: list pending org applications ----

app.get('/super-admin/org-applications', requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const snap = await admin.firestore()
      .collection('orgApplications')
      .where('reviewStatus', '==', 'pending')
      .get();

    const applications = snap.docs
      .sort((a, b) => {
        const ta = a.data().submittedAt?.toMillis?.() ?? 0;
        const tb = b.data().submittedAt?.toMillis?.() ?? 0;
        return tb - ta;
      })
      .map((d) => {
      const data = d.data();
      return {
        orgId: d.id,
        name: data.orgName ?? data.name ?? null,
        slug: data.slug ?? null,
        founderEmail: data.contactEmail ?? data.founderEmail ?? null,
        contactFirstName: data.contactFirstName ?? null,
        contactLastName: data.contactLastName ?? null,
        contactPhone: data.contactPhone ?? null,
        orgType: data.orgType ?? null,
        website: data.website ?? null,
        estimatedRiders: data.estimatedRiders ?? null,
        heardAboutUs: data.heardAboutUs ?? null,
        description: data.description ?? null,
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
    // Fetch application doc for email + name before writing
    const appSnap = await admin.firestore().collection('orgApplications').doc(orgId).get();
    const appData = appSnap.exists ? appSnap.data()! : {};
    const founderEmail: string | null = appData.contactEmail ?? appData.founderEmail ?? null;
    const firstName: string = appData.contactFirstName ?? 'there';
    const orgName: string = appData.orgName ?? appData.name ?? orgId;

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

    // Notify the founder — fire and forget
    if (founderEmail) {
      sendEmail({
        to: founderEmail,
        subject: `${orgName} has been approved on Shuttler 🎉`,
        html: orgApprovedTemplate({ contactName: firstName, orgName }),
      }).catch((err) => console.error('[super-admin] approve email failed:', err));
    }

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
    const appSnap = await admin.firestore().collection('orgApplications').doc(orgId).get();
    const appData = appSnap.exists ? appSnap.data()! : {};
    const founderEmail: string | null = appData.contactEmail ?? appData.founderEmail ?? null;
    const firstName: string = appData.contactFirstName ?? 'there';
    const orgName: string = appData.orgName ?? appData.name ?? orgId;

    const batch = admin.firestore().batch();
    batch.update(admin.firestore().collection('orgs').doc(orgId), {
      approved: false,
      reviewStatus: 'rejected',
      rejectionReason: reason ?? null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.update(admin.firestore().collection('orgApplications').doc(orgId), {
      reviewStatus: 'rejected',
      rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
      rejectionReason: reason ?? null,
    });
    await batch.commit();
    console.log(`[super-admin] Rejected org ${orgId}`);

    if (founderEmail) {
      sendEmail({
        to: founderEmail,
        subject: `Update on your Shuttler application for ${orgName}`,
        html: orgRejectedTemplate({ contactName: firstName, orgName, reason }),
      }).catch((err) => console.error('[super-admin] reject email failed:', err));
    }

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
      ...(allowedEmailDomains != null ? { allowedEmailDomains } : {}),
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
  data?: Record<string, string>,
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
      ...(data ? { data } : {}),
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
  const orgId: string | undefined = (req as any).claims?.orgId;
  if (!orgId) return res.status(403).json({ error: 'orgId missing from token' });

  try {
    const usersSnap = await admin.firestore()
      .collection('orgs').doc(orgId).collection('users')
      .get();

    const tokens: string[] = [];
    usersSnap.forEach((d) => {
      const data = d.data();
      const newRequestEnabled = data?.notificationPrefs?.newRequest !== false;
      if ((data.role === 'driver' || data.role === 'admin') && data.expoPushToken && newRequestEnabled) {
        tokens.push(data.expoPushToken as string);
      }
    });

    await sendExpoPushNotifications(
      tokens,
      'New Stop Request',
      'A student is requesting a pickup.',
      { type: 'new_request', orgId },
    );
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
  const orgId: string | undefined = (req as any).claims?.orgId;
  const { studentUid, stopName, stopId } = req.body as { studentUid?: string; stopName?: string; stopId?: string };
  if (!orgId) return res.status(403).json({ error: 'orgId missing from token' });
  if (!studentUid) return res.status(400).json({ error: 'studentUid required' });

  try {
    const userDoc = await admin.firestore()
      .collection('orgs').doc(orgId).collection('users').doc(studentUid)
      .get();
    const userData = userDoc.data();
    const token = userData?.expoPushToken as string | undefined;
    const busArrivingEnabled = userData?.notificationPrefs?.busArriving !== false;

    if (token && busArrivingEnabled) {
      await sendExpoPushNotifications(
        [token],
        'Bus Arriving!',
        `Your bus is arriving at ${stopName ?? 'your stop'}.`,
        {
          type: 'bus_arriving',
          orgId,
          ...(stopId ? { stopId } : {}),
          ...(stopName ? { stopName } : {}),
        },
      );
    }

    return res.json({ sent: token && busArrivingEnabled ? 1 : 0 });
  } catch (e) {
    console.error('[notifications] stop-arrived error:', e);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
});

/** POST /notifications/bus-approaching
 *  Called when the driver's bus crosses the approach radius for a requested stop
 *  (a few minutes out). Gives the rider a heads-up to start walking.
 */
app.post('/notifications/bus-approaching', requireAuth, async (req: Request, res: Response) => {
  const orgId: string | undefined = (req as any).claims?.orgId;
  const { studentUid, stopName, stopId, etaMinutes } = req.body as {
    studentUid?: string;
    stopName?: string;
    stopId?: string;
    etaMinutes?: number;
  };
  if (!orgId) return res.status(403).json({ error: 'orgId missing from token' });
  if (!studentUid) return res.status(400).json({ error: 'studentUid required' });

  try {
    const userDoc = await admin.firestore()
      .collection('orgs').doc(orgId).collection('users').doc(studentUid)
      .get();
    const userData = userDoc.data();
    const token = userData?.expoPushToken as string | undefined;
    const busArrivingEnabled = userData?.notificationPrefs?.busArriving !== false;

    if (token && busArrivingEnabled) {
      const minutes = Number(etaMinutes);
      const etaText = Number.isFinite(minutes) && minutes >= 1 && minutes <= 15
        ? `about ${Math.round(minutes)} min`
        : 'a few minutes';
      await sendExpoPushNotifications(
        [token],
        'Bus On The Way!',
        `Your bus is ${etaText} from ${stopName ?? 'your stop'} — time to head over.`,
        {
          type: 'bus_approaching',
          orgId,
          ...(stopId ? { stopId } : {}),
          ...(stopName ? { stopName } : {}),
        },
      );
    }

    return res.json({ sent: token && busArrivingEnabled ? 1 : 0 });
  } catch (e) {
    console.error('[notifications] bus-approaching error:', e);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
});

/** POST /notifications/stop-request-cancelled
 *  Called when a student's stop request is cancelled (e.g. driver went offline).
 *  Sends a push notification to the student who made the request.
 */
app.post('/notifications/stop-request-cancelled', requireAuth, async (req: Request, res: Response) => {
  const orgId: string | undefined = (req as any).claims?.orgId;
  const { studentUid, reason } = req.body as { studentUid?: string; reason?: string };
  if (!orgId) return res.status(403).json({ error: 'orgId missing from token' });
  if (!studentUid) return res.status(400).json({ error: 'studentUid required' });

  try {
    const userDoc = await admin.firestore()
      .collection('orgs').doc(orgId).collection('users').doc(studentUid)
      .get();
    const userData = userDoc.data();
    const token = userData?.expoPushToken as string | undefined;
    const cancelledEnabled = userData?.notificationPrefs?.requestCancelled !== false;

    if (token && cancelledEnabled) {
      const body = reason === 'no_buses_online'
        ? 'There are no buses currently online. Your request was cancelled.'
        : reason === 'driver_skipped'
        ? "The driver couldn't reach your stop. Please request again when the next bus comes around."
        : 'The driver has gone offline. Your request was cancelled.';
      await sendExpoPushNotifications([token], 'Request Cancelled', body, { type: 'request_cancelled', orgId });
    }

    return res.json({ sent: token && cancelledEnabled ? 1 : 0 });
  } catch (e) {
    console.error('[notifications] stop-request-cancelled error:', e);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
});

/** POST /notifications/stop-completed
 *  Called when a stop request is marked completed.
 *  Sends a push notification to the student who made the request.
 */
app.post('/notifications/stop-completed', requireAuth, async (req: Request, res: Response) => {
  const orgId: string | undefined = (req as any).claims?.orgId;
  const { studentUid, stopName } = req.body as { studentUid?: string; stopName?: string };
  if (!orgId) return res.status(403).json({ error: 'orgId missing from token' });
  if (!studentUid) return res.status(400).json({ error: 'studentUid required' });

  try {
    const userDoc = await admin.firestore()
      .collection('orgs').doc(orgId).collection('users').doc(studentUid)
      .get();
    const userData = userDoc.data();
    const token = userData?.expoPushToken as string | undefined;
    const completedEnabled = userData?.notificationPrefs?.requestCompleted !== false;

    if (token && completedEnabled) {
      await sendExpoPushNotifications(
        [token],
        'Bus Has Arrived!',
        `The bus has completed your pickup at ${stopName ?? 'your stop'}.`,
        { type: 'request_completed', orgId },
      );
    }

    return res.json({ sent: token && completedEnabled ? 1 : 0 });
  } catch (e) {
    console.error('[notifications] stop-completed error:', e);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
});

// ---------- Service alerts ----------

const ANNOUNCEMENT_SEVERITIES = ['info', 'warning', 'alert'] as const;

/** POST /announcements
 *  Admin or driver broadcasts a service alert (delay, detour, notice) to their org.
 *  Writes the announcement doc and fans out a push to members who haven't
 *  disabled the serviceAlerts notification pref. Riders see it as a live map banner.
 */
app.post('/announcements', requireAuth, async (req: Request, res: Response) => {
  if (announcementLimit(req.ip ?? 'unknown')) {
    return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  }

  const uid = (req as any).uid as string;
  // orgId comes from the verified token claim — never from the request body
  const orgId: string | undefined = (req as any).claims?.orgId;
  if (!orgId) return res.status(403).json({ error: 'No org associated with this account' });

  const { title, body, severity, durationMinutes } = req.body as {
    title?: string;
    body?: string;
    severity?: string;
    durationMinutes?: number;
  };

  const cleanTitle = String(title ?? '').trim().slice(0, 80);
  const cleanBody = String(body ?? '').trim().slice(0, 300);
  if (!cleanTitle) return res.status(400).json({ error: 'title is required' });
  if (!ANNOUNCEMENT_SEVERITIES.includes(severity as any)) {
    return res.status(400).json({ error: 'severity must be info, warning, or alert' });
  }
  const duration = Number(durationMinutes);
  const hasDuration = Number.isFinite(duration) && duration >= 5 && duration <= 1440;

  try {
    // Verify membership and resolve role from Firestore (not from client)
    const memberDoc = await admin.firestore()
      .collection('orgs').doc(orgId).collection('users').doc(uid).get();
    const memberRole = memberDoc.data()?.role;
    if (!memberDoc.exists || (memberRole !== 'admin' && memberRole !== 'driver')) {
      return res.status(403).json({ error: 'Driver or admin access required' });
    }

    const expiresAt = hasDuration
      ? admin.firestore.Timestamp.fromMillis(Date.now() + duration * 60_000)
      : null;

    const docRef = await admin.firestore()
      .collection('orgs').doc(orgId).collection('announcements')
      .add({
        title: cleanTitle,
        body: cleanBody,
        severity,
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: uid,
        createdByName: memberDoc.data()?.displayName ?? memberDoc.data()?.email ?? null,
        expiresAt,
      });

    // Fan out to all org members (except the author) who haven't opted out.
    const usersSnap = await admin.firestore()
      .collection('orgs').doc(orgId).collection('users').get();
    const tokens: string[] = [];
    usersSnap.forEach((d) => {
      if (d.id === uid) return;
      const data = d.data();
      const serviceAlertsEnabled = data?.notificationPrefs?.serviceAlerts !== false;
      if (data.expoPushToken && serviceAlertsEnabled) {
        tokens.push(data.expoPushToken as string);
      }
    });

    await sendExpoPushNotifications(
      tokens,
      severity === 'alert' ? `⚠️ ${cleanTitle}` : cleanTitle,
      cleanBody || 'Tap to see the latest shuttle service update.',
      { type: 'service_alert', orgId, announcementId: docRef.id },
    );

    return res.json({ id: docRef.id, sent: tokens.length });
  } catch (e) {
    console.error('[announcements] create error:', e);
    return res.status(500).json({ error: 'Failed to post announcement' });
  }
});

/** POST /announcements/:id/deactivate
 *  Admin or driver clears an active service alert (e.g. detour resolved).
 */
app.post('/announcements/:id/deactivate', requireAuth, async (req: Request, res: Response) => {
  const uid = (req as any).uid as string;
  const orgId: string | undefined = (req as any).claims?.orgId;
  if (!orgId) return res.status(403).json({ error: 'No org associated with this account' });

  try {
    const memberDoc = await admin.firestore()
      .collection('orgs').doc(orgId).collection('users').doc(uid).get();
    const memberRole = memberDoc.data()?.role;
    if (!memberDoc.exists || (memberRole !== 'admin' && memberRole !== 'driver')) {
      return res.status(403).json({ error: 'Driver or admin access required' });
    }

    const ref = admin.firestore()
      .collection('orgs').doc(orgId).collection('announcements').doc(String(req.params.id));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Announcement not found' });

    await ref.update({
      active: false,
      deactivatedAt: admin.firestore.FieldValue.serverTimestamp(),
      deactivatedBy: uid,
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[announcements] deactivate error:', e);
    return res.status(500).json({ error: 'Failed to clear announcement' });
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
    let orgName = 'your organization';
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
  if (passwordResetLimit(req.ip ?? 'unknown')) {
    return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  }

  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }

  try {
    let orgName = 'your organization';
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

// ---- Social sign-in (Google / Apple) completion ----
// Called after Firebase signInWithCredential on the client. Sets the orgId
// custom claim so AuthProvider can resolve the user's org on next token refresh.

app.post('/auth/social/complete', requireAuth, async (req: Request, res: Response) => {
  const { orgId } = req.body as { orgId?: string };
  const uid = (req as any).uid as string;

  if (!orgId) return res.status(400).json({ error: 'orgId is required' });

  try {
    const [authUser, orgDoc] = await Promise.all([
      admin.auth().getUser(uid),
      admin.firestore().collection('orgs').doc(orgId).get(),
    ]);

    if (!orgDoc.exists) {
      return res.status(404).json({ error: 'Organization not found.' });
    }

    const email = authUser.email ?? null;
    const displayName = authUser.displayName ?? null;
    const orgData = orgDoc.data()!;

    // Domain restriction check — must happen before user doc creation.
    const allowedDomains: string[] = orgData.allowedEmailDomains ?? [];
    if (allowedDomains.length > 0 && email) {
      const domain = email.split('@')[1]?.toLowerCase() ?? '';
      if (!allowedDomains.includes(domain)) {
        return res.status(403).json({
          error: `Registration is restricted to ${allowedDomains.join(', ')} email addresses.`,
        });
      }
    }

    // Detect Google + Apple same-email duplicate accounts.
    if (email) {
      const emailSnap = await admin.firestore()
        .collection('orgs').doc(orgId)
        .collection('users')
        .where('email', '==', email)
        .limit(2)
        .get();
      const conflict = emailSnap.docs.find((d) => d.id !== uid);
      if (conflict) {
        return res.status(409).json({
          error:
            'An account with this email is already registered in this organization. ' +
            'Please sign in with the same method you used originally (Google or Apple).',
        });
      }
    }

    const userRef = admin.firestore().collection('orgs').doc(orgId).collection('users').doc(uid);
    const memberDoc = await userRef.get();
    let isNew = false;

    if (memberDoc.exists) {
      // Existing member: just refresh lastLoginAt.
      await userRef.update({ lastLoginAt: admin.firestore.FieldValue.serverTimestamp() });
    } else {
      // New member: create the user doc via Admin SDK (bypasses Firestore security
      // rules, which would otherwise block new users from creating their own doc
      // because orgIsActive() requires existing membership to read the org doc).
      // Callers may request 'parent' role (phone auth); anything else defaults to 'student'.
      // 'admin' is never accepted from the client.
      const { role: requestedRole } = req.body as { role?: string };
      const role = requestedRole === 'parent' ? 'parent' : 'student';
      isNew = true;
      await userRef.set({
        uid,
        orgId,
        email,
        displayName,
        role,
        agreedToTermsAt: admin.firestore.FieldValue.serverTimestamp(),
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Spread existing claims so we never clobber superAdmin or other flags.
    const existing = (authUser.customClaims ?? {}) as Record<string, unknown>;
    await admin.auth().setCustomUserClaims(uid, { ...existing, orgId });
    return res.json({ ok: true, isNew });
  } catch (e) {
    console.error('[auth/social/complete]', e);
    return res.status(500).json({ error: 'Failed to complete sign-in.' });
  }
});

// ---------- Export ----------

// Basic export (last 90 days) — included on every plan.
// Extended export (>90 days) — requires dataApi entitlement.
app.get('/export/csv', requireAuth, async (req: Request, res: Response) => {
  const uid = (req as any).uid as string;
  const orgId: string | undefined = (req as any).claims?.orgId;
  if (!orgId) return res.status(403).json({ error: 'No org associated with this account' });

  const type = (req.query.type as string) || 'boardings'; // boardings | requests
  const requestedDays = Math.max(1, parseInt((req.query.days as string) || '90', 10));
  const BASIC_LIMIT = 90;

  // Extended retention requires the dataApi entitlement
  if (requestedDays > BASIC_LIMIT) {
    const orgDoc = await admin.firestore().collection('orgs').doc(orgId).get();
    if (!orgDoc.exists || !orgDoc.data()?.entitlements?.dataApi) {
      return res.status(402).json({
        error: 'upgrade_required',
        feature: 'extendedRetention',
        message: `Exports beyond ${BASIC_LIMIT} days require the Data Export & API add-on. Visit the Billing tab or contact support@shuttler.net.`,
      });
    }
  }

  const days = Math.min(requestedDays, 365); // hard cap even for paid tier
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Verify membership
  const memberDoc = await admin.firestore()
    .collection('orgs').doc(orgId).collection('users').doc(uid).get();
  if (!memberDoc.exists) return res.status(403).json({ error: 'Not a member of this org' });

  try {
    const db = admin.firestore();
    const sinceTs = admin.firestore.Timestamp.fromDate(since);

    let rows: string[] = [];

    if (type === 'boardings') {
      const snap = await db.collection('orgs').doc(orgId).collection('boardingCounts')
        .where('createdAt', '>=', sinceTs)
        .orderBy('createdAt', 'desc')
        .get();
      rows = ['date,stop_name,count,driver_uid'];
      snap.docs.forEach((d) => {
        const data = d.data();
        const date = data.createdAt?.toDate?.()?.toISOString().slice(0, 10) ?? '';
        const stop = (data.stopName ?? data.stop?.name ?? '').replace(/,/g, ' ');
        const count = data.count ?? 0;
        const driver = data.driverUid ?? '';
        rows.push(`${date},${stop},${count},${driver}`);
      });
    } else if (type === 'requests') {
      const snap = await db.collection('orgs').doc(orgId).collection('stopRequests')
        .where('createdAt', '>=', sinceTs)
        .orderBy('createdAt', 'desc')
        .get();
      rows = ['date,time,status,stop_name,wait_minutes,cancelled_reason,student_uid'];
      snap.docs.forEach((d) => {
        const data = d.data();
        const created = data.createdAt?.toDate?.();
        const arrived = data.arrivedAt?.toDate?.();
        const date = created?.toISOString().slice(0, 10) ?? '';
        const time = created?.toISOString().slice(11, 16) ?? '';
        const status = data.status ?? '';
        const stop = (data.stop?.name ?? '').replace(/,/g, ' ');
        const wait = created && arrived
          ? Math.max(0, Math.round((arrived.getTime() - created.getTime()) / 60_000))
          : '';
        const reason = data.cancelledReason ?? '';
        // Use uid only — no student names in export
        const uid = data.studentUid ?? '';
        rows.push(`${date},${time},${status},${stop},${wait},${reason},${uid}`);
      });
    } else {
      return res.status(400).json({ error: 'type must be boardings or requests' });
    }

    const filename = `shuttler_${orgId}_${type}_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(rows.join('\n'));
  } catch (e: any) {
    console.error('[export/csv]', e?.message ?? e);
    return res.status(500).json({ error: 'Export failed' });
  }
});

/** GET /analytics/feedback-summary?days=30
 *  Aggregated rider-feedback stats. Clients can never read the feedback
 *  collection directly (rules deny it), so this endpoint returns aggregates
 *  and anonymized comments only — individual rider identities never leave
 *  the backend.
 *
 *  Riders volunteer this feedback, so the headline (avg rating + counts) is
 *  available to every org. Per-question breakdowns and comments are part of
 *  the Data Analytics add-on (`limited: true` marks the free payload).
 */
app.get('/analytics/feedback-summary', requireAuth, async (req: Request, res: Response) => {
  const uid = (req as any).uid as string;
  const orgId: string | undefined = (req as any).claims?.orgId;
  if (!orgId) return res.status(403).json({ error: 'No org associated with this account' });

  const days = Math.min(Math.max(1, parseInt((req.query.days as string) || '30', 10) || 30), 365);

  try {
    const db = admin.firestore();

    const memberDoc = await db.collection('orgs').doc(orgId).collection('users').doc(uid).get();
    if (!memberDoc.exists || memberDoc.data()?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const orgDoc = await db.collection('orgs').doc(orgId).get();
    const orgData = orgDoc.data() ?? {};
    const entitled = !!(orgData.entitlements?.dataApi || orgData.dataAddonActive);

    const since = new Date();
    since.setDate(since.getDate() - days);
    const snap = await db.collection('orgs').doc(orgId).collection('feedback')
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(since))
      .orderBy('createdAt', 'desc')
      .get();

    let ratingSum = 0;
    let ratingCount = 0;
    const byQuestion = new Map<string, { question: string; sum: number; n: number }>();
    const recentComments: { question: string; answer: string; date: string }[] = [];

    snap.docs.forEach((d) => {
      const data = d.data();
      const rating = typeof data.rating === 'number' ? data.rating : null;
      const question: string = data.question ?? data.questionKey ?? 'Feedback';

      if (rating !== null) {
        ratingSum += rating;
        ratingCount += 1;
        const q = byQuestion.get(question) ?? { question, sum: 0, n: 0 };
        q.sum += rating;
        q.n += 1;
        byQuestion.set(question, q);
      }

      const answer = typeof data.answer === 'string' ? data.answer.trim() : '';
      if (answer && recentComments.length < 5) {
        recentComments.push({
          question,
          answer: answer.slice(0, 280),
          date: data.createdAt?.toDate?.()?.toISOString().slice(0, 10) ?? '',
        });
      }
    });

    return res.json({
      days,
      responseCount: snap.size,
      avgRating: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
      ratingCount,
      limited: !entitled,
      byQuestion: entitled
        ? [...byQuestion.values()]
            .map((q) => ({ question: q.question, avgRating: Math.round((q.sum / q.n) * 10) / 10, count: q.n }))
            .sort((a, b) => b.count - a.count)
        : [],
      recentComments: entitled ? recentComments : [],
    });
  } catch (e: any) {
    console.error('[analytics/feedback-summary]', e?.message ?? e);
    return res.status(500).json({ error: 'Failed to load feedback summary' });
  }
});

// ---------- AI ----------

app.post('/ai/admin-chat', requireAuth, async (req: Request, res: Response) => {
  if (aiChatLimit(req.ip ?? 'unknown')) {
    return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  }

  const uid = (req as any).uid as string;
  // orgId comes from the verified token claim — never from the request body
  const orgId: string | undefined = (req as any).claims?.orgId;

  if (!orgId) {
    return res.status(403).json({ error: 'No org associated with this account' });
  }

  try {
    const { messages } = req.body as {
      messages?: { role: 'user' | 'assistant'; content: string }[];
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Verify membership and resolve role from Firestore (not from client)
    const memberDoc = await admin.firestore()
      .collection('orgs').doc(orgId)
      .collection('users').doc(uid)
      .get();

    if (!memberDoc.exists) {
      return res.status(403).json({ error: 'Not a member of this org' });
    }

    const memberRole: string = memberDoc.data()?.role ?? 'student';

    // Per-user daily cap by role
    const { allowed, count, cap } = await checkAndIncrementAiUsage(uid, memberRole);
    if (!allowed) {
      return res.status(429).json({
        error: 'daily_limit_reached',
        message: `You've reached your daily assistant limit (${cap} messages). It resets at midnight.`,
        count,
        cap,
      });
    }

    const sanitized: { role: 'user' | 'assistant'; content: string }[] = messages.map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: String(m.content).slice(0, 4000),
    }));

    const { reply, inputTokens, outputTokens } = await handleAdminChat(orgId, uid, memberRole, sanitized);

    // Fire-and-forget usage log — metadata only, no message bodies
    admin.firestore().collection('aiUsageLogs').add({
      uid,
      orgId,
      role: memberRole,
      inputTokens,
      outputTokens,
      dailyCount: count,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch((err) => console.error('[ai/admin-chat] log write failed:', err));

    return res.json({ reply });
  } catch (e: any) {
    console.error('[ai/admin-chat]', e?.message ?? e);
    return res.status(500).json({ error: 'AI request failed' });
  }
});

app.post('/ai/weekly-digest', requireInternal, async (_req: Request, res: Response) => {
  try {
    await runWeeklyDigest();
    return res.json({ ok: true });
  } catch (e: any) {
    console.error('[ai/weekly-digest]', e?.message ?? e);
    return res.status(500).json({ error: 'Digest failed' });
  }
});

app.post('/ai/monthly-digest', requireInternal, async (_req: Request, res: Response) => {
  try {
    await runMonthlyDigest();
    return res.json({ ok: true });
  } catch (e: any) {
    console.error('[ai/monthly-digest]', e?.message ?? e);
    return res.status(500).json({ error: 'Digest failed' });
  }
});

app.post('/ai/generate-insights', requireAuth, async (req: Request, res: Response) => {
  // orgId from token claim — never from request body (prevents cross-org access).
  const orgId: string | undefined = (req as any).claims?.orgId;
  const { period } = req.body as { period?: 'weekly' | 'monthly' };
  if (!orgId) return res.status(403).json({ error: 'No org associated with this account' });
  if (!['weekly', 'monthly'].includes(period ?? '')) {
    return res.status(400).json({ error: 'period (weekly|monthly) is required' });
  }
  const uid = (req as any).uid as string;
  try {
    const memberDoc = await admin.firestore()
      .collection('orgs').doc(orgId).collection('users').doc(uid).get();
    if (!memberDoc.exists || memberDoc.data()?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const generated = await generateOrgInsight(orgId, period as 'weekly' | 'monthly');
    return res.json({ ok: true, generated });
  } catch (e: any) {
    console.error('[ai/generate-insights]', e?.message ?? e);
    return res.status(500).json({ error: 'Failed to generate insight' });
  }
});

// ---------- Start ----------

startWeeklyDigestCron();
startMonthlyDigestCron();

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
