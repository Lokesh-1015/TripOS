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

Open http://localhost:3000 and create an account.

## Viewing the database

```bash
cd server
pnpm exec prisma studio
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

## Documentation

- [Data model and API](docs/data-model-and-api.md): schema, routes, permissions and live updates
- [Next-phase plan](docs/next-phase-plan.md): the roadmap to a private beta
- [Product requirements](prd.md) and [app spec](memory/SPEC.md)
