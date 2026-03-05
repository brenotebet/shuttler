import express, { Request, Response } from 'express';
import * as saml from 'samlify';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DOMParser } from '@xmldom/xmldom';
import xpath from 'xpath';
import 'dotenv/config';

/**
 * SAML ACS + one-time token exchange for Firebase custom token.
 *
 * Endpoints:
 *   GET  /health
 *   GET  /saml/login        <-- ADDED (SP-initiated login)
 *   POST /saml/acs
 *   POST /saml/exchange
 *   GET  /saml/metadata
 */

// ---------- ENV (match your .env names) ----------

// Restrict SAML-authenticated users to this email domain (e.g. 'mckendree.edu').
// Set ALLOWED_EMAIL_DOMAIN in .env. Leave empty only for local testing.
const ALLOWED_EMAIL_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || 'mckendree.edu').trim().toLowerCase();

// URL schemes/prefixes allowed in RelayState — prevents open redirects via forged SAML responses.
const ALLOWED_RELAY_PREFIXES = ['bogeybus://'];

const SAML_SP_ENTITY_ID = (
  process.env.EXPO_PUBLIC_SAML_SP_ENTITY_ID ||
  process.env.SAML_SP_ENTITY_ID ||
  'com.example.bogeybus'
).trim();

const SAML_SP_ACS_URL = (
  process.env.EXPO_PUBLIC_SAML_SP_ACS_URL ||
  process.env.SAML_SP_ACS_URL ||
  'https://YOUR-BACKEND/saml/acs'
).trim();

const IDP_ENTITY_ID = (process.env.EXPO_PUBLIC_SAML_IDP_ENTITY_ID || '').trim();
const IDP_SSO_URL = (process.env.EXPO_PUBLIC_SAML_IDP_SSO_URL || '').trim();

// NOTE: Despite the name, your value is a cert body (base64), not a fingerprint.
const IDP_SIGNING_CERT = formatCert(process.env.EXPO_PUBLIC_SAML_IDP_CERT_FINGERPRINT || '');

const PORT = parseInt(process.env.PORT || '3000', 10);

// Optional: where to send users after ACS when using browser-based testing.
// If provided, ACS will redirect to `${RETURN_TO_DEFAULT}?samlToken=...` when no RelayState present.
const RETURN_TO_DEFAULT = (process.env.SAML_RETURN_TO_DEFAULT || '').trim();

// ---------- SAML schema validation (lightweight) ----------
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
        dom
      );
      const audienceNode = xpath.select1(
        "//*[local-name()='AudienceRestriction']/*[local-name()='Audience']",
        dom
      );

      if (!assertionNode || !issuerNode || !subjectConfirmationNode || !audienceNode) {
        throw new Error('ERR_SAML_SCHEMA_MISSING_ASSERTION_CONTENTS');
      }
    }

    return Promise.resolve('ok');
  },
});

// ---------- IdP + SP ----------
const idp = saml.IdentityProvider({
  entityID: IDP_ENTITY_ID,
  // IMPORTANT:
  // For SP-initiated login, samlify commonly creates AuthnRequests using REDIRECT binding.
  // Many IdPs accept both redirect and post at the same SSO URL, so we list both.
  singleSignOnService: [
    {
      Binding: saml.Constants.namespace.binding.redirect,
      Location: IDP_SSO_URL,
    },
    {
      Binding: saml.Constants.namespace.binding.post,
      Location: IDP_SSO_URL,
    },
  ],
  signingCert: IDP_SIGNING_CERT ? [IDP_SIGNING_CERT] : undefined,
});

const sp = saml.ServiceProvider({
  entityID: SAML_SP_ENTITY_ID,
  assertionConsumerService: [
    {
      Binding: saml.Constants.namespace.binding.post,
      Location: SAML_SP_ACS_URL,
    },
  ],
  wantAssertionsSigned: true,
});

// ---------- Firebase Admin init (optional but recommended) ----------
const serviceAccountPath =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(__dirname, 'serviceAccount.json');
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (admin.apps.length === 0) {
  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
    });
  } else if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
    });
  } else {
    // Will NOT be able to createCustomToken without credentials.
    admin.initializeApp();
  }
}

// ---------- One-time handoff token store ----------
type HandoffTokenPayload = {
  uid: string;
  attributes: Record<string, unknown>;
  expiresAt: number;
};

const HANDOFF_TOKEN_TTL_MS = 5 * 60 * 1000;
const handoffTokens = new Map<string, HandoffTokenPayload>();

function cleanupExpiredHandoffTokens() {
  const now = Date.now();
  for (const [token, payload] of handoffTokens.entries()) {
    if (payload.expiresAt <= now) handoffTokens.delete(token);
  }
}

function issueHandoffToken(uid: string, attributes: Record<string, unknown>) {
  cleanupExpiredHandoffTokens();
  const token = crypto.randomBytes(32).toString('hex');
  handoffTokens.set(token, {
    uid,
    attributes,
    expiresAt: Date.now() + HANDOFF_TOKEN_TTL_MS,
  });
  return token;
}

function consumeHandoffToken(token: string): HandoffTokenPayload | null {
  cleanupExpiredHandoffTokens();
  const payload = handoffTokens.get(token);
  if (!payload) return null;
  if (payload.expiresAt <= Date.now()) {
    handoffTokens.delete(token);
    return null;
  }
  handoffTokens.delete(token);
  return payload;
}

// ---------- Simple rate limiter for /saml/exchange ----------
// Allows at most MAX_EXCHANGE_REQUESTS per IP in EXCHANGE_WINDOW_MS.
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

// ---------- Express app ----------
const app = express();

// Replace body-parser with built-in Express parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Health check for IT
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    spEntityId: SAML_SP_ENTITY_ID,
    acsUrl: SAML_SP_ACS_URL,
    idpEntityId: IDP_ENTITY_ID,
  });
});

/**
 * SP-initiated SAML login endpoint
 * Visit:
 *   https://sso.mckendree.edu/saml/login
 *
 * Optional:
 *   /saml/login?returnTo=bogeybus://sso
 *   /saml/login?relayState=bogeybus://sso
 *
 * relayState is carried by the IdP and returned with the POST to ACS.
 */
app.get('/saml/login', async (req: Request, res: Response) => {
  try {
    const returnTo =
      (req.query.relayState as string) ||
      (req.query.returnTo as string) ||
      '';

    const { context } = sp.createLoginRequest(idp, 'redirect');

    // If you want RelayState, append it to the redirect URL manually
    if (returnTo) {
      const joiner = context.includes('?') ? '&' : '?';
      return res.redirect(`${context}${joiner}RelayState=${encodeURIComponent(returnTo)}`);
    }

    return res.redirect(context);
  } catch (e: any) {
    console.error('Failed to create SAML login request:', e?.message ?? e);
    return res.status(500).send('Failed to start SAML login');
  }
});


// ACS endpoint
app.post('/saml/acs', async (req: Request, res: Response) => {
  const samlResponse = (req.body as any)?.SAMLResponse;
  if (!samlResponse) {
    return res.status(400).json({ error: 'Missing SAMLResponse payload' });
  }

  try {
    const { extract, samlContent } = await sp.parseLoginResponse(idp, 'post', { body: req.body as any });
    const assertionDetails = enforceAudienceAndRecipient(extract, samlContent);

    const attributes = (extract?.attributes || {}) as Record<string, unknown>;
    const uid = selectUid(attributes);

    // log only attribute KEYS to help mapping without leaking values
    console.log('SAML attributes received (keys only):', Object.keys(attributes));

    if (!uid) {
      logAssertionFailure('missing_uid', {
        ...assertionDetails,
        issuer: extract?.issuer,
        requestId: extract?.response?.inResponseTo,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      return res.status(422).json({ error: 'SAML assertion missing UID/email attribute' });
    }

    const samlToken = issueHandoffToken(uid, attributes);

    // If RelayState or returnTo default is provided, redirect instead of JSON.
    // RelayState can be any string; we expect a URL like bogeybus://sso or https://...
    const relayState =
      normalizeString((req.body as any)?.RelayState) ||
      normalizeString((extract as any)?.relayState) ||
      '';

    const returnTo = relayState || RETURN_TO_DEFAULT;

    if (returnTo) {
      // Validate returnTo against the allowlist to prevent open redirects.
      const allowed = ALLOWED_RELAY_PREFIXES.some((prefix) => returnTo.startsWith(prefix));
      if (!allowed) {
        logAssertionFailure('relay_state_rejected', { returnTo, ip: req.ip });
        return res.status(400).json({ error: 'RelayState destination is not permitted' });
      }
      const joiner = returnTo.includes('?') ? '&' : '?';
      return res.redirect(`${returnTo}${joiner}samlToken=${encodeURIComponent(samlToken)}`);
    }

    // Default: JSON response (useful for debugging)
    return res.json({ samlToken });
  } catch (error) {
    if (!isSamlValidationError(error)) {
      logAssertionFailure('validation_error', {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return res.status(401).json({ error: 'Invalid SAML assertion' });
  }
});

// Exchange endpoint
app.get('/saml/exchange', (_req: Request, res: Response) => {
  return res.status(405).json({
    error: 'Method not allowed. Use POST /saml/exchange with JSON body { samlToken }.',
  });
});

app.post('/saml/exchange', async (req: Request, res: Response) => {
  const clientIp = req.ip ?? 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  }

  const samlToken = (req.body as any)?.samlToken;
  if (!samlToken) {
    return res.status(400).json({ error: 'Missing SAML handoff token' });
  }

  const payload = consumeHandoffToken(String(samlToken));
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired SAML handoff token' });
  }

  const { uid, attributes } = payload;

  try {
    // Map attributes coming from QuickLaunch.
    // If IT sends Fname/Lname keys, we can build a display name:
    const email =
      normalizeString((attributes as any).email) ||
      normalizeString((attributes as any).mail) ||
      undefined;

    // Enforce institutional email domain before minting a Firebase token.
    if (ALLOWED_EMAIL_DOMAIN && email) {
      const domain = email.split('@')[1]?.toLowerCase() ?? '';
      if (domain !== ALLOWED_EMAIL_DOMAIN) {
        console.error('SAML exchange rejected: email domain not allowed', { domain, ip: clientIp });
        return res.status(403).json({ error: 'Email domain not permitted' });
      }
    }

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

    const firebaseToken = await admin.auth().createCustomToken(uid, {
      email,
      displayName,
      // keep roles optional; you said roles stay in Firebase/Firestore
      roles: (attributes as any).roles as string[] | string | undefined,
    });

    return res.json({ firebaseToken });
  } catch (e) {
    // This usually means Firebase Admin credentials aren’t configured on the server.
    return res.status(500).json({
      error: 'Failed to mint Firebase token. Check Firebase Admin credentials on server.',
      details: e instanceof Error ? e.message : String(e),
    });
  }
});

// Metadata
app.get('/saml/metadata', (_req: Request, res: Response) => {
  res.type('application/xml');
  res.send(sp.getMetadata());
});

// Start
app.listen(PORT, () => {
  console.log(`SAML service listening on http://localhost:${PORT}`);
  console.log(`SP Entity ID: ${SAML_SP_ENTITY_ID}`);
  console.log(`ACS URL: ${SAML_SP_ACS_URL}`);
  console.log(`Login URL: ${SAML_SP_ENTITY_ID.replace(/\/$/, '')}/saml/login (via IIS host)`);
});

// ---------- helpers ----------
function selectUid(attributes: Record<string, unknown>): string | undefined {
  // Adjust this list to match the IdP attribute mapping
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

function enforceAudienceAndRecipient(extract: any, samlContent: string) {
  const expectedAudience = SAML_SP_ENTITY_ID;
  const expectedRecipient = SAML_SP_ACS_URL;

  const audienceValues = normalizeAudience(extract?.audience);
  const responseDestination = extract?.response?.destination as string | undefined;

  const recipientExtract = saml.Extractor.extract(samlContent, [
    {
      key: 'recipient',
      localPath: ['Assertion', 'Subject', 'SubjectConfirmation', 'SubjectConfirmationData'],
      attributes: ['Recipient'],
    },
  ]);
  const recipientValue = normalizeString((recipientExtract as any)?.recipient);

  if (!audienceValues.includes(expectedAudience)) {
    const error = new Error('ERR_SAML_AUDIENCE_MISMATCH');
    logAssertionFailure('audience_mismatch', {
      audience: audienceValues,
      expectedAudience,
      destination: responseDestination,
      recipient: recipientValue,
    });
    throw error;
  }

  if (responseDestination && responseDestination !== expectedRecipient) {
    const error = new Error('ERR_SAML_DESTINATION_MISMATCH');
    logAssertionFailure('destination_mismatch', {
      audience: audienceValues,
      expectedAudience,
      destination: responseDestination,
      recipient: recipientValue,
    });
    throw error;
  }

  if (!recipientValue || recipientValue !== expectedRecipient) {
    const error = new Error('ERR_SAML_RECIPIENT_MISMATCH');
    logAssertionFailure('recipient_mismatch', {
      audience: audienceValues,
      expectedAudience,
      destination: responseDestination,
      recipient: recipientValue,
    });
    throw error;
  }

  return {
    audience: audienceValues,
    destination: responseDestination,
    recipient: recipientValue,
  };
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

function logAssertionFailure(reason: string, details: Record<string, unknown>) {
  console.error('SAML assertion rejected', { reason, ...details });
}

function isSamlValidationError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('ERR_SAML_');
}
