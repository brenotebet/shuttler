# SAML + Firebase migration troubleshooting checklist

Use this when switching the mobile app + backend from one Firebase project to another.

## 1) Confirm mobile app points to the new Firebase project
- Verify `firebase/firebaseconfig.ts` values (`projectId`, `appId`, `apiKey`, etc.) are from the university project.
- Rebuild/restart Expo after env or config edits so stale bundles are not reused.

## 2) Confirm mobile app points to the correct exchange endpoint
- Verify `EXPO_PUBLIC_SAML_TOKEN_EXCHANGE_URL` points to the university backend environment.
- Value must be HTTPS and loaded at runtime from `config.ts`.

## 3) Validate deep-link handoff token is fresh
- The backend handoff token is one-time and time-limited.
- Replaying an old `samlToken` will fail with `Invalid or expired SAML handoff token`.
- Clear app storage/reinstall app if testing repeatedly to avoid stale cached token reuse.

## 4) Confirm backend Firebase Admin credentials match the new Firebase project
- The backend `/saml/exchange` endpoint mints Firebase custom tokens using Admin SDK.
- Service account JSON must be from the same Firebase project the mobile app uses.
- If mismatched, token minting commonly fails with 500-level errors.

## 5) Re-check SAML IdP/SP settings after tenant switch
- Confirm IdP cert/fingerprint, SSO URL, audience/entity ID, and ACS URL all match the new university setup.
- If validation fails at ACS step, exchange will never receive a valid handoff token.

## 6) Test `/saml/exchange` directly
- Use a fresh handoff token and send:
  ```json
  { "samlToken": "..." }
  ```
- Expected error signatures:
  - `400 Missing SAML handoff token`
  - `401 Invalid or expired SAML handoff token`
  - `500 Failed to mint Firebase token. Check Firebase Admin credentials on server.`

## 7) Observe improved client-side error detail
The app now includes status code and backend error message in the thrown exchange error (instead of a single generic message). This helps pinpoint whether failure is from token expiry, backend credentials, or endpoint mismatch.
