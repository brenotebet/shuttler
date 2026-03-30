# Shuttler — Claude Code Context File

> Place this file at the root of your Shuttler repo. Claude Code reads it automatically at the start of every session.

---

## Project Overview

**Shuttler** (shuttler.net) is a subscription-based SaaS shuttle tracking and stop-request platform targeting universities, airports, and K-12 transportation.

- **First live deployment:** McKendree University (full campus launch planned April 2026)
- **Business entity:** Tebet LLC (Wyoming)
- **Billing:** Stripe

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (web) |
| Mobile | React Native |
| Backend | Node.js / Express |
| Tracking | GPS / real-time location |
| Payments | Stripe |
| Auth | (update with your auth provider, e.g. Firebase Auth, JWT) |
| Hosting | (update with your hosting, e.g. AWS, Vercel, Railway) |
| Database | (update with your DB, e.g. Firebase Firestore, PostgreSQL) |

---

## Repository Structure

```
shuttler/
├── frontend/          # React web app
├── mobile/            # React Native app
├── backend/           # Node.js / Express API
├── shared/            # Shared types, constants, utilities
└── CLAUDE.md          # This file
```

> Update these paths to match your actual folder structure.

---

## Key Workflows & Conventions

### General
- Prefer **clear, readable code** over clever one-liners
- All new features should have corresponding tests before merging
- Use descriptive commit messages (imperative tense: "Add stop-request endpoint", not "added stop request")

### Frontend (React)
- Component files use **PascalCase** (e.g. `ShuttleMap.jsx`)
- Hooks use **camelCase** prefixed with `use` (e.g. `useShuttlePosition`)
- iOS Safari compatibility is a known constraint — always test nav behavior on Safari
  - Known fix: dynamic JS padding applied to nav to prevent overlap (already implemented)

### Backend (Node/Express)
- Route files organized by resource (e.g. `routes/shuttles.js`, `routes/stops.js`)
- Middleware applied globally in `app.js`
- Environment variables loaded via `.env` — never hardcode secrets

### Stripe
- All billing logic lives in the backend — never expose Stripe secret key to client
- Webhook handling should verify signatures before processing events

### GPS / Real-time Tracking
- (Add your WebSocket or polling approach here)
- (Add any known latency constraints or driver app details)

---

## Known Issues & Gotchas

- **iOS Safari nav overlap** — Fixed via JS dynamic padding. Do not revert to CSS-only solution.
- (Add other known bugs or quirks here as they come up)

---

## Testing

- (Update with your test runner, e.g. Jest, Vitest, Mocha)
- Run tests: `npm test` (update if different)
- Before committing, always run the test suite and fix failures

---

## Environment Setup

```bash
# Install dependencies
npm install

# Start backend
cd backend && npm run dev

# Start frontend
cd frontend && npm start

# Start mobile (React Native)
cd mobile && npx expo start   # update if not using Expo
```

---

## Deployment

- **Web:** (update with your deployment process, e.g. `vercel deploy`, AWS Amplify)
- **Backend:** (update with your deploy target)
- **Mobile:** (update with App Store / TestFlight / Expo EAS build process)

---

## Claude Code Preferences

- **Environment:** VS Code extension — use inline diffs and keep suggestions scoped to the highlighted file/block unless the task explicitly spans multiple files
- When making changes across multiple files, **show a plan first** before editing
- Prefer **minimal diffs** — change only what's necessary, never refactor unrelated code in the same pass
- When in doubt about a design decision, **ask before implementing**
- For Stripe or GPS logic, always flag security/privacy implications before proceeding

### Debugging
- When given an error or unexpected behavior, trace it through all layers (React → Express → DB) before suggesting a fix
- Always explain the **root cause**, not just the symptom fix
- Check for regressions in related components when fixing bugs

### Performance
- Flag any N+1 queries, unnecessary re-renders, or blocking operations
- For GPS/real-time features, prefer event-driven patterns over polling where possible
- For React: watch for unnecessary `useEffect` dependencies and missing memoization (`useMemo`, `useCallback`) in high-frequency update components (e.g. live map)

### Code Consistency
- Match the naming conventions, file structure, and patterns already in the codebase — don't introduce new patterns without flagging it
- Prefer explicit over implicit — clear variable names, typed props, documented functions
- If you notice inconsistency in existing code, call it out but don't fix it unless asked

---

## Context: McKendree Deployment

- McKendree University is the first live customer
- Full campus launch is planned for **April 2026**
- Treat McKendree-specific configs as production — no breaking changes without a migration path

---

## Owner

**Breno** — Full-stack developer, bilingual (English/Portuguese)
Contact: (add your preferred contact or leave blank)
