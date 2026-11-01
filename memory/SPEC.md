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
- Password reset links are logged by the server until an email provider is added.

## Routes
`/` landing · `/login` · `/signup` · `/forgot-password` · `/reset-password/:token` · `/onboarding` · `/join/:code` · `/app` dashboard · `/app/trips` · `/app/trips/new` · `/app/trips/:id/:tab?` (overview, itinerary, expenses, tasks, packing, documents, map, chat, memories) · `/app/trips/:id/replay` · `/app/explore` · `/app/expenses` · `/app/tasks` · `/app/memories` · `/app/documents` · `/app/settings`.

## Business logic
- Balances = paid − share, + settlements sent, − settlements received. The UI derives them in `lib/format.ts`; the server's ledger must always agree.
- Suggested transfers are greedy, largest debtor to largest creditor.
- Custom splits must add up exactly to the amount, which the server enforces.
- Trip status is derived from dates unless archived.

## Receipt scanning
Not ported to the new backend, so the route returns 404 and the UI falls back to manual entry. The PRD lists it as a future feature.
