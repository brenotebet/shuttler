# SAML backend setup primer

Use these steps to define your Service Provider values (Entity ID and ACS URL)
and spin up the backend endpoints you need before sharing metadata with IT.

## 1) Pick (or confirm) your SP identifiers
- **SP Entity ID:** A unique string you control. If you do not have one yet,
  use your production domain namespace (e.g.,
  `https://shuttle.example.com/sp`) or stick with the default placeholder
  `com.example.bogeybus` until you finalize it.
- **ACS URL:** An HTTPS route on your backend that will receive SAML responses.
  Decide the base domain you will host (prod and staging) and choose a stable
  path such as `/saml/acs`. Example: `https://api.example.com/saml/acs`.

Update `config.ts` so the app and metadata template stay aligned:
- `SAML_SP_ENTITY_ID` → your chosen Entity ID.
- `SAML_SP_ACS_URL` → your actual ACS endpoint.

> **Ready-made code:** `backend/samlServer.ts` already wires these values from
> `SAML_SP_ENTITY_ID` and `SAML_SP_ACS_URL` environment variables so you can run
> a working ACS locally while you finalize the identifiers you will hand IT.

## 2) Create the ACS endpoint on your backend
- Implement an HTTPS POST endpoint at the ACS URL you chose.
- Parse the inbound SAML Response (commonly under `SAMLResponse` form field).
- Validate the signature against the IdP signing cert fingerprint your IT team
  provided.
- Extract user attributes you care about (immutable ID for Firebase UID, email,
  name, roles/groups) and enforce audience/recipient checks against your SP
  Entity ID and ACS URL.
- On success, issue a one-time handoff token or immediately mint a Firebase
  custom token that you will return via your exchange endpoint (next step).

> **Ready-made code:** The Express sample in `backend/samlServer.ts` registers
> `/saml/acs` and performs validation with `samlify`, then mints a Firebase
> custom token and returns it as JSON. Run it with
> `npm install express body-parser samlify firebase-admin` and
> `ts-node backend/samlServer.ts` to test your ACS flow end-to-end.

## 3) Expose the SAML token exchange endpoint
- Add an authenticated backend route at `SAML_TOKEN_EXCHANGE_URL` (configured in
`config.ts` as `https://YOUR-BACKEND/saml/exchange`).
- Accept either the validated SAML assertion from your ACS handler or the
handoff token passed from the app-to-app deep link.
- Mint a Firebase custom token from the verified user identity and return
  `{ firebaseToken }` to the mobile app.

**Quick blueprint (drop-in pseudocode for Express/Fastify):**
```ts
// ACS handler
app.post('/saml/acs', async (req, res) => {
  const samlResponse = req.body.SAMLResponse;
  const assertion = await validateAndParse(samlResponse, {
    idpFingerprint: process.env.EXPO_PUBLIC_SAML_IDP_CERT_FINGERPRINT,
    audience: process.env.SAML_SP_ENTITY_ID,
    recipient: process.env.SAML_SP_ACS_URL,
  });

  // Convert assertion into your internal user model
  const user = mapAttributes(assertion);

  // Option A: mint Firebase custom token right here
  const firebaseToken = await admin.auth().createCustomToken(user.uid);
  return res.redirect(
    `bogeybus://sso?samlToken=${encodeURIComponent(firebaseToken)}`
  );
});

// Token exchange handler (used if you issued a short-lived handoff token)
app.post('/saml/exchange', async (req, res) => {
  const handoffToken = req.body.samlToken;
  const user = await lookupUserFromHandoff(handoffToken);
  const firebaseToken = await admin.auth().createCustomToken(user.uid);
  res.json({ firebaseToken });
});
```

## 4) Generate metadata to send to IT
Fill the template from the docs with your values:
- `EntityDescriptor` → `entityID` set to your `SAML_SP_ENTITY_ID`.
- `AssertionConsumerService` → `Location` set to your `SAML_SP_ACS_URL` and
binding `urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST`.
- Include your SP signing cert if you sign AuthnRequests; otherwise omit.

## 5) Hand IT a ready-to-send packet
- Copy the template below into a new file (e.g., `saml_metadata.xml`) and fill
  in the placeholders:

```xml
<EntityDescriptor entityID="YOUR-SP-ENTITY-ID" xmlns="urn:oasis:names:tc:SAML:2.0:metadata">
  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true"
                   protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                              Location="https://YOUR-BACKEND/saml/acs"
                              index="1" isDefault="true" />
  </SPSSODescriptor>
</EntityDescriptor>
```

- Send IT the completed metadata file plus this checklist:
  - **SP Entity ID** and **ACS URL** you set above.
  - **Exchange endpoint:** `https://YOUR-BACKEND/saml/exchange` (matches
    `SAML_TOKEN_EXCHANGE_URL` in `config.ts`).
  - **IdP info you received:** `EXPO_PUBLIC_SAML_IDP_ENTITY_ID`,
    `EXPO_PUBLIC_SAML_IDP_SSO_URL`, and `EXPO_PUBLIC_SAML_IDP_CERT_FINGERPRINT`.
  - **Attributes expected:** immutable user ID, email, display name, and any
    roles/groups.
  - **Deep link handoff format (if used):** the param name (`samlToken`,
    `saml_token`, or `samlHandoff`) and your app scheme/host (e.g.,
    `bogeybus://sso`).

## 6) Share the checklist along with the metadata
- Include the IdP values you received (`EXPO_PUBLIC_SAML_IDP_ENTITY_ID`,
`EXPO_PUBLIC_SAML_IDP_SSO_URL`, and the cert fingerprint) so IT knows what
you expect.
- Provide attribute requirements and deep-link handoff details from
`docs/saml_it_checklist.md` so they can configure mappings and mobile launch
behavior on their side.

Following these steps gives you concrete SP identifiers, a real ACS endpoint,
and the exchange route the app needs, so your IT contact can load the metadata
and complete SSO onboarding without you having to re-derive the pieces each
time.
