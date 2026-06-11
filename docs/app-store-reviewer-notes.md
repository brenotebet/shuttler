# App Store Reviewer Notes — Shuttler

Paste the contents of the "Notes for Reviewer" section below into App Store Connect → App Review Information. Keep this file in sync with `scripts/create-demo-org.js`.

---

## Notes for Reviewer

Shuttler is a **B2B shuttle tracking platform** for universities, airports, and school districts. Organizations are onboarded under contract, so there is **no public self-signup by design** — users join through their organization (email invite, SSO, or phone verification).

### Demo account

A fully seeded demo organization is provisioned for review:

- **Organization:** Demo University (org code: `demo-appstore`)
- **Admin:** demo-admin@shuttler.net / ShuttlerDemo2026!
- **Driver:** demo-driver@shuttler.net / ShuttlerDemo2026!
- **Rider (student):** demo-student@shuttler.net / ShuttlerDemo2026!
- **Parent:** demo-parent@shuttler.net / ShuttlerDemo2026!

Sign in with the email option, select "Demo University" in the org selector. The demo org is pre-seeded with shuttle routes, stops, announcements, and boarding history.

### Live GPS

Real-time bus positions come from drivers' phones during active shifts in physical deployments. To see live movement during review, log in as the **driver** account and start a shift — the bus position will appear on the rider's map. (We can also run a GPS simulator on request; the seeded data includes historical positions.)

### Navigating roles

- **Rider view:** map with live shuttles, stop request flow, announcements.
- **Driver view:** shift start/stop, boarding counts, route stops.
- **Admin view:** org setup (profile, auth, stops/routes, members, billing, operations), analytics, AI assistant.

### AI Assistant

Available from the admin/rider menu. It answers questions about the org's shuttle data and how to use the app, powered by a large language model (Anthropic Claude) via our backend. The screen displays a disclaimer that responses are AI-generated and may be inaccurate.

### Billing

Subscriptions are **B2B invoicing for organizations** handled via Stripe (permitted under Guideline 3.1.3(e) / 3.1.5 — services purchased by organizations, not consumer digital content). **Stripe is in test mode for the demo org** — no real charges are possible. There are no consumer-facing in-app purchases.

### Account & organization deletion (Guideline 5.1.1)

- Any user: Profile → Danger Zone → **Delete Account** (permanently deletes auth account, profile, and ride history).
- Org owners: Org Setup → Profile tab → Danger Zone → **Delete Organization** (cancels the Stripe subscription and purges all org data and member accounts; requires typing the org name to confirm).

### Background location

Background location (`UIBackgroundModes: location`) is used **only by drivers during an active shift** to broadcast the shuttle's position to riders. Sharing stops automatically when the shift ends or the driver's role changes. Riders use foreground location only.

### Privacy

- Privacy policy: https://shuttler.net/privacy
- Terms: https://shuttler.net/terms
- Support: hello@shuttler.net

---

## Pre-submission reminders (internal, do not paste)

1. Run `node scripts/create-demo-org.js --execute` before submitting; verify all four logins work on a device.
2. Confirm Stripe test mode is active for the demo org.
3. Confirm https://shuttler.net/privacy mentions: Firebase, Stripe, Anthropic, Sentry, location data, push tokens.
4. App Store Connect → App Privacy answers must match `ios/Shuttler/PrivacyInfo.xcprivacy` (location, email, name, phone, payment info, device ID, product interaction, crash data — all "linked to user" except crash data, none used for tracking).
5. Screenshots: 6.9" iPhone (1320×2868) required; capture from the demo org.
6. After review approval, optionally rotate the demo password.
