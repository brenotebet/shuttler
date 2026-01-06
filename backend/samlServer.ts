import express from 'express';
import bodyParser from 'body-parser';
import * as saml from 'samlify';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DOMParser } from '@xmldom/xmldom';
import xpath from 'xpath';

/**
 * Drop-in example that covers SAML setup steps 1 and 2:
 * 1) Define your Service Provider identifiers (Entity ID + ACS URL)
 * 2) Stand up a real ACS endpoint that parses and validates SAML Responses
 *
 * To run locally:
 *   npm install express body-parser samlify firebase-admin
 *   export SAML_SP_ENTITY_ID="https://YOUR-DOMAIN/sp"
 *   export SAML_SP_ACS_URL="https://YOUR-DOMAIN/saml/acs"
 *   export EXPO_PUBLIC_SAML_IDP_ENTITY_ID="https://idp.example.com/metadata"
 *   export EXPO_PUBLIC_SAML_IDP_SSO_URL="https://idp.example.com/sso"
 *   export EXPO_PUBLIC_SAML_IDP_CERT="<BASE64 PEM WITHOUT BEGIN/END LINES>"
 *   export FIREBASE_SERVICE_ACCOUNT_PATH="./serviceAccount.json"
 *   ts-node backend/samlServer.ts
 */

// Step 1: lock in the SP identifiers your IdP will trust
const SAML_SP_ENTITY_ID =
  process.env.SAML_SP_ENTITY_ID || 'com.example.bogeybus';
const SAML_SP_ACS_URL =
  process.env.SAML_SP_ACS_URL || 'https://YOUR-BACKEND/saml/acs';

// IdP metadata values you already have from IT
const IDP_ENTITY_ID = process.env.EXPO_PUBLIC_SAML_IDP_ENTITY_ID || '';
const IDP_SSO_URL = process.env.EXPO_PUBLIC_SAML_IDP_SSO_URL || '';
const IDP_SIGNING_CERT = formatCert(process.env.EXPO_PUBLIC_SAML_IDP_CERT || '');

// SAML schema validation (per samlify guidance)
saml.setSchemaValidator({
  validate: async (xml: string) => {
    const dom = new DOMParser({
      errorHandler: { warning: null, error: null },
    }).parseFromString(xml);
    const rootName = dom.documentElement?.localName;
    if (!rootName) {
      throw new Error('ERR_SAML_SCHEMA_MISSING_ROOT');
    }

    const isResponse = rootName === 'Response';
    const isLogout = rootName === 'LogoutResponse' || rootName === 'LogoutRequest';
    const isAuthnRequest = rootName === 'AuthnRequest';
    if (!isResponse && !isLogout && !isAuthnRequest) {
      throw new Error(`ERR_SAML_SCHEMA_UNEXPECTED_ROOT_${rootName}`);
    }

    if (isResponse) {
      const assertionNode = xpath.select1(
        "//*[local-name()='Assertion']",
        dom,
      );
      const issuerNode = xpath.select1(
        "//*[local-name()='Issuer']",
        dom,
      );
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

const idp = saml.IdentityProvider({
  entityID: IDP_ENTITY_ID,
  singleSignOnService: [
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

// Boot Firebase Admin so we can mint custom tokens after a valid assertion
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
    admin.initializeApp();
  }
}

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const HANDOFF_TOKEN_TTL_MS = 5 * 60 * 1000;
const handoffTokens = new Map<string, HandoffTokenPayload>();

type HandoffTokenPayload = {
  uid: string;
  attributes: Record<string, unknown>;
  expiresAt: number;
};

function cleanupExpiredHandoffTokens() {
  const now = Date.now();
  for (const [token, payload] of handoffTokens.entries()) {
    if (payload.expiresAt <= now) {
      handoffTokens.delete(token);
    }
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

// Step 2: ACS endpoint that validates SAMLResponse and returns a handoff token
app.post('/saml/acs', async (req, res) => {
  const samlResponse = req.body?.SAMLResponse;
  if (!samlResponse) {
    return res.status(400).json({ error: 'Missing SAMLResponse payload' });
  }

  try {
    // samlify handles decoding and signature validation; we enforce audience/recipient below
    const { extract, samlContent } = await sp.parseLoginResponse(idp, 'post', { body: req.body });
    const assertionDetails = enforceAudienceAndRecipient(extract, samlContent);
    const attributes = extract?.attributes || {};
    const uid = selectUid(attributes);

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

    // Return JSON for the mobile app; adjust to redirect if you prefer app-deep-link handoff
    return res.json({ samlToken });
  } catch (error) {
    if (!isSamlValidationError(error)) {
      logAssertionFailure('validation_error', {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        error,
      });
    }
    return res.status(401).json({ error: 'Invalid SAML assertion' });
  }
});

// Step 3: Exchange a one-time-use SAML handoff token for a Firebase token
app.post('/saml/exchange', async (req, res) => {
  const samlToken = req.body?.samlToken;
  if (!samlToken) {
    return res.status(400).json({ error: 'Missing SAML handoff token' });
  }

  const payload = consumeHandoffToken(samlToken);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired SAML handoff token' });
  }

  const { uid, attributes } = payload;
  const firebaseToken = await admin.auth().createCustomToken(uid, {
    email: attributes.email as string | undefined,
    displayName: attributes.displayName as string | undefined,
    roles: attributes.roles as string[] | string | undefined,
  });

  return res.json({ firebaseToken });
});

app.get('/saml/metadata', (_req, res) => {
  res.type('application/xml');
  res.send(sp.getMetadata());
});

const port = parseInt(process.env.PORT || '3000', 10);
app.listen(port, () => {
  console.log(`SAML ACS listening on http://localhost:${port}`);
  console.log(`SP Entity ID: ${SAML_SP_ENTITY_ID}`);
  console.log(`ACS URL: ${SAML_SP_ACS_URL}`);
});

function selectUid(attributes: Record<string, unknown>): string | undefined {
  const candidateKeys = ['uid', 'userId', 'email', 'nameID'];
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
  const recipientValue = normalizeString(recipientExtract?.recipient);

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
  if (Array.isArray(audience)) {
    return audience.map((value) => String(value));
  }
  return [String(audience)];
}

function normalizeString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value[0] ? String(value[0]) : undefined;
  return String(value);
}

function logAssertionFailure(reason: string, details: Record<string, unknown>) {
  console.error('SAML assertion rejected', {
    reason,
    ...details,
  });
}

function isSamlValidationError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('ERR_SAML_');
}
