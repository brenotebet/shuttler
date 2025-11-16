# School App SAML Handoff Requirements

Use this checklist to collect everything needed to enable the "use school-app
session or fall back to QuickLaunch" flow.

## Identity Provider (IdP)
- IdP Entity ID and SSO (Login) URL.
- IdP signing certificate (x509 public cert) and fingerprint for signature
  validation.
- SLO (Logout) URL if you want to support remote logout.
- Test IdP metadata for non-production along with at least one student account.

## Service Provider (Your Backend / Shuttle App)
- SP Entity ID (we default to `com.example.bogeybus` in `config.ts`).
- Assertion Consumer Service (ACS) URL that the IdP will POST the SAML response
  to (e.g., `https://YOUR-BACKEND/saml/acs`).
- Backend endpoint to exchange a validated assertion or handoff token for a
  Firebase custom token (configure in `config.ts` as `SAML_TOKEN_EXCHANGE_URL`).
- Attribute mappings that provide:
  - Immutable student identifier to use as the Firebase UID claim.
  - Student email, display name, and optional role/group flags for authorization.
- Session lifetime/timeout expectations and whether long-lived cookies are set
  by the IdP.

## App-to-App Handoff
- Deep-link scheme/host to register (e.g., `bogeybus://sso`) and confirmation
  that the school app will launch the shuttle app with one of these query
  parameters carrying a one-time token: `samlToken`, `saml_token`, or
  `samlHandoff`.
- Bundle identifier/package name to whitelist for the deep link (Android and
  iOS).
- Clarify whether the handoff token is a full SAML Response, an artifact, or a
  short-lived reference that your backend can redeem at `SAML_TOKEN_EXCHANGE_URL`.

## Security and Ops
- Certificate pinning or managed-app-config requirements (if any) for the
  shuttle app.
- Rotation policy for IdP signing certificates and notice period before
  metadata changes.
- Contacts for IdP admins to coordinate testing windows and validate
  production cutover.
