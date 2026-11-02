# TripOS

A shared workspace for group trips: itinerary, expenses, tasks, packing, documents, chat and memories in one place, updated live for everyone on the trip.

| Part | Stack | Runs on |
|---|---|---|
| `frontend/` | Vite, React 19, TypeScript, Tailwind, shadcn/ui | http://localhost:3000 |
| `server/` | NestJS 12, Prisma 7, Socket.IO | http://localhost:4000 |
| Database | PostgreSQL 17 in Docker | localhost:5434 |
| `tests/` | Playwright browser tests | |

Vite forwards `/api` and live updates to the backend, so the frontend only ever calls relative paths.

## Setup

You need Node 24, pnpm 11, Yarn 1 and Docker.

```bash
cd server
cp .env.example .env
pnpm install
pnpm run db:up
pnpm exec prisma migrate deploy
pnpm run dev
```

In a second terminal:

```bash
cd frontend
yarn install
yarn dev
```

Open http://localhost:3000 and create an account. Verification and invite emails arrive in the local inbox at http://localhost:8025.

## Viewing the database

Open a browser view of every table at http://localhost:5555:

```bash
cd server
pnpm exec prisma studio
```

Check which migrations have been applied:

```bash
cd server
pnpm exec prisma migrate status
```

## Tests

With the database and both servers running:

```bash
cd server
pnpm test
```

```bash
cd tests
yarn install
npx playwright install chromium
npx playwright test --project=desktop
```

CI runs all of this on every push to `main` and on every pull request.

## Deployment

| Part | Where | Address |
|---|---|---|
| Frontend | Vercel, project `tripos`, deploys from `main` | https://tripos-travel.vercel.app |
| Backend | Render, service `tripos-api`, deploys from `main` | https://tripos-api-z0ux.onrender.com |
| Database | Neon project `TripOS Singapore`, database `tripos` | Set in Render's `DATABASE_URL`, without connection pooling |

How they connect:

- **API calls:** `frontend/vercel.json` forwards `/api` to Render, so the login cookie stays first-party on the frontend's domain.
- **Live updates:** Vercel can't carry a socket, so the browser connects straight to Render (`VITE_SOCKET_URL`) and proves who it is with a short-lived ticket from `/api/auth/realtime-ticket`.
- **Render settings:** `DATABASE_URL`, `APP_URL`, `CORS_ORIGINS`, `NODE_ENV=production`, `NODE_VERSION`.
- **Email:** add `BREVO_API_KEY` and `MAIL_FROM` (a sender verified in Brevo) to turn it on. It uses Brevo's HTTPS API because Render's free plan blocks SMTP ports. Brevo blocks API calls from unknown IP addresses by default, so turn that off or authorize Render's outbound addresses in Brevo's security settings.

Render build command:

```bash
cd server && NODE_ENV=development npx --yes pnpm@11.17.0 install --frozen-lockfile && ./node_modules/.bin/prisma generate && ./node_modules/.bin/nest build
```

Render start command, which also applies migrations:

```bash
cd server && ./node_modules/.bin/prisma migrate deploy && node dist/main.js
```

## Maps

Maps need no keys or accounts: [MapLibre](https://maplibre.org) draws them, [OpenFreeMap](https://openfreemap.org) serves the tiles, and the backend searches places through [Photon](https://photon.komoot.io).

## Installable app and offline access

The service worker only runs in a built app, so to try it or test it:

```bash
cd frontend
yarn build
yarn preview --port 3001
```

```bash
cd tests
PREVIEW_URL=http://localhost:3001 npx playwright test --project=desktop e2e/installable-app.spec.ts
```

## Documentation

- [Data model and API](docs/data-model-and-api.md): schema, routes, permissions and live updates
- [Next-phase plan](docs/next-phase-plan.md): the roadmap to a private beta
- [Product requirements](prd.md) and [app spec](memory/SPEC.md)
