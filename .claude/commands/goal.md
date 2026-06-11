---
description: Audit Shuttler and prepare it for App Store submission. Checks privacy, performance, metadata, account deletion, reviewer demo flow, and React Native build health.
allowed-tools: Read, Grep, Glob, Bash, WebFetch
model: claude-opus-4-7
---

# Shuttler — App Store Deployment Readiness Audit

You are acting as an App Store submission specialist for **Shuttler**, a multi-tenant SaaS shuttle management platform built in React Native (iOS + Android). The app uses Firebase, Stripe, and an AI assistant feature. It serves university campuses, airports, and school districts under a B2B model.

Your task is to perform a comprehensive, end-to-end App Store readiness audit and produce a prioritized fix list. Work through every section below methodically. For each check, either confirm it passes or flag it as a blocking issue, a warning, or a recommendation.

---

## 1. Project Structure Scan

- Locate the React Native project root (`ios/`, `android/`, `package.json`, `app.json` or `app.config.js`)
- Identify all third-party SDKs and native modules in use (check `package.json`, `Podfile`, `build.gradle`)
- List any SDKs known to require a **privacy manifest** (Firebase, Crashlytics, Amplitude, Sentry, etc.)
- Check if `PrivacyInfo.xcprivacy` exists in the `ios/` directory

## 2. Privacy & Data Transparency

- Scan for all uses of location (`CLLocationManager`, `Geolocation`, background modes)
- Confirm `NSLocationAlwaysAndWhenInUseUsageDescription` and `NSLocationWhenInUseUsageDescription` are present in `Info.plist` with **user-facing, non-generic copy**
- Check `UIBackgroundModes` — confirm `location` is declared if background GPS is used
- Identify every type of data collected: location, account info, usage data, payment info, device ID
- Flag any data shared with third parties (Firebase Analytics, Stripe, AI APIs) that isn't disclosed
- Confirm a **Privacy Policy URL** is ready for App Store Connect

## 3. Account & Organization Deletion (Guideline 5.1.1)

**Account deletion:**
- Search for a "Delete Account" flow in the codebase (`deleteAccount`, `delete_account`, "Delete Account" string)
- Confirm it is reachable from **Settings** inside the app — not buried or email-gated
- Confirm it works for **both rider and admin account types**
- Flag if this is missing — it is a near-certain rejection reason

**Organization deletion (Org Admin):**
- Search for an "Delete Organization" or "Delete Workspace" flow (`deleteOrg`, `deleteOrganization`, `delete_org`, "Delete Organization" string)
- Confirm the Org Admin role has a self-serve path to delete their organization and all associated data — not just their personal account
- Confirm the flow includes a **clear warning** about what will be deleted (all riders, routes, stop data, billing) and requires explicit confirmation (e.g. type org name or confirm dialog)
- Confirm that deleting an org cascades correctly: removes all member accounts tied to that org, cancels the Stripe subscription, and purges Firebase data — or clearly communicates what happens to each
- Confirm this flow is accessible from the org/admin settings panel, not just account-level settings
- Flag if org deletion is only possible via contacting support — Apple expects self-serve deletion for any entity the user created within the app

## 4. AI Feature Disclosure

- Locate the AI assistant feature in the codebase
- Confirm there is in-app disclosure that the feature is AI-powered
- Confirm the AI API endpoint and data sent to it are disclosed in the privacy policy
- Flag any AI-generated content that could be mistaken for authoritative real-time data without a disclaimer

## 5. Performance & Stability

- Check for any known crash-prone patterns: unhandled promise rejections, missing null checks on GPS data, navigation errors
- Scan for excessive `console.log` or debug flags left enabled
- Check if Hermes is enabled (recommended for RN performance)
- Look for any `__DEV__` guards that might leave debug behavior active in production builds
- Check battery/CPU usage patterns: are location updates throttled appropriately? Is there a background fetch interval set?

## 6. React Native Build Health

- Confirm the iOS deployment target is **iOS 16.0 or higher** (check `Podfile` and Xcode project)
- Check `react-native` version — flag if it's older than 0.73
- Run a dependency audit: `npm audit` or `yarn audit` — flag high-severity vulnerabilities
- Confirm `pod install` would succeed (check for any version conflicts in `Podfile.lock`)
- Check that the bundle identifier in `Info.plist` matches App Store Connect

## 7. App Store Metadata Readiness

- Confirm app icon exists at all required sizes (1024×1024 for App Store, plus all `@1x/@2x/@3x` sizes)
- Check if screenshots are prepared for:
  - 6.9" iPhone (1320×2868px) — **required**, or
  - 6.5" iPhone (1284×2778px) as fallback
  - iPad 12.9" if iPad is supported
- Confirm the app name, subtitle, and description are ready and don't contain restricted keywords ("best", "free", "#1" without substantiation)
- Confirm the app category is appropriate (Navigation, Travel, or Business)
- Flag any placeholder or lorem ipsum text in metadata

## 8. Reviewer Demo Account

- Confirm there is a **sandbox/demo login** that gives reviewers access to a fully functional session
- The demo should include: pre-seeded shuttle routes, stops, and simulated GPS movement (or a note explaining GPS requires physical deployment)
- Confirm the reviewer notes will explain:
  - This is a **B2B platform** — no public self-signup by design
  - How to navigate between rider and admin views
  - What the AI assistant does and how to trigger it
  - That Stripe is in test mode for review

## 9. Stripe & Paywall Compliance (Guideline 3.1.1)

- Confirm no **hard paywall** blocks the reviewer before they can see core functionality
- Confirm subscription pricing is clearly disclosed before purchase
- If in-app purchases exist for consumer users, confirm they use Apple's IAP — not Stripe (B2B invoicing via Stripe is permitted, direct consumer purchases are not)

## 10. Entitlements & Capabilities

- List all entitlements in `ios/<AppName>.entitlements`
- Confirm push notifications entitlement matches what's configured in App Store Connect
- Flag any entitlements that require a provisioning profile update

---

## Output Format

Produce a structured report with four sections:

### 🔴 Blocking Issues
Must be fixed before submission. List each with: what it is, where in the codebase, and the exact fix required.

### 🟡 Warnings
Won't guarantee rejection but are high-risk. List with recommended fix.

### 🟢 Passing Checks
Brief confirmation of what looks good.

### 📋 Pre-Submission Checklist
A final numbered checklist the developer can work through line by line before hitting Submit in App Store Connect.

---

Be specific — reference actual file paths, line numbers, and variable names wherever possible. Do not give generic advice; every finding should be grounded in what you actually read in the Shuttler codebase.
