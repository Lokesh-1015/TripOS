# TripOS — App Spec

Collaborative group-travel workspace. One frontend (`frontend/`, Vite + React 19) and one backend (`server/`, NestJS 12 + Prisma 7 + PostgreSQL). The API contract, schema and permission rules are in `docs/data-model-and-api.md`.

## Running

```bash
cd server && pnpm install && pnpm run db:up && pnpm exec prisma migrate deploy && pnpm run dev
```

```bash
cd frontend && npx yarn@1 dev
```

The app is at http://localhost:3000. Vite proxies `/api` and the socket to the backend on port 4000. Postgres runs in Docker on port 5434; copy `server/.env.example` to `server/.env` first.

## Accounts
- Real email and password login with an httpOnly session cookie. New accounts start empty and pass through onboarding.
- `/app/*` redirects to `/login` when signed out; `sessionStorage tripos:next` returns people to a join link after logging in.
- Signup sends a verification email; unverified accounts can't see, accept or send email invites. Email goes over SMTP, caught locally by Mailpit at http://localhost:8025.

## Routes
`/` landing · `/login` · `/signup` · `/forgot-password` · `/reset-password/:token` · `/verify-email/:token` · `/onboarding` · `/join/:code` · `/app` dashboard · `/app/trips` · `/app/trips/new` · `/app/trips/:id/:tab?` (overview, itinerary, expenses, tasks, packing, documents, map, chat, memories) · `/app/trips/:id/replay` · `/app/explore` · `/app/expenses` · `/app/tasks` · `/app/memories` · `/app/documents` · `/app/settings`.

## Business logic
- Balances = paid − share, + settlements sent, − settlements received. The UI derives them in `lib/format.ts`; the server's ledger must always agree.
- Suggested transfers are greedy, largest debtor to largest creditor.
- Custom splits must add up exactly to the amount, which the server enforces.
- Trip status is derived from dates unless archived.

## Receipt scanning
Removed from the UI until the AI phase (PRD Phase 5). The old Python version is in the baseline commit.
