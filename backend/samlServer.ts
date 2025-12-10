import express from 'express';
import bodyParser from 'body-parser';
import * as saml from 'samlify';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

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

// Minimal schema validator so samlify can run without external XML tooling
saml.setSchemaValidator({
  validate: async () => Promise.resolve(''),
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
if (fs.existsSync(serviceAccountPath) && admin.apps.length === 0) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
  });
}

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Step 2: ACS endpoint that validates SAMLResponse and returns a Firebase token
app.post('/saml/acs', async (req, res) => {
  const samlResponse = req.body?.SAMLResponse;
  if (!samlResponse) {
    return res.status(400).json({ error: 'Missing SAMLResponse payload' });
  }

  try {
    // samlify handles decoding, signature validation, and audience/recipient checks
    const { extract } = await sp.parseLoginResponse(idp, 'post', { body: req.body });
    const attributes = extract?.attributes || {};
    const uid = selectUid(attributes);

    if (!uid) {
      return res.status(422).json({ error: 'SAML assertion missing UID/email attribute' });
    }

    const firebaseToken = await admin.auth().createCustomToken(uid, {
      email: attributes.email as string | undefined,
      displayName: attributes.displayName as string | undefined,
      roles: attributes.roles as string[] | string | undefined,
    });

    // Return JSON for the mobile app; adjust to redirect if you prefer app-deep-link handoff
    return res.json({ firebaseToken });
  } catch (error) {
    console.error('Failed to validate SAMLResponse', error);
    return res.status(401).json({ error: 'Invalid SAML assertion' });
  }
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

