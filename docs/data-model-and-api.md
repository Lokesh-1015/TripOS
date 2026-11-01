# TripOS data model and API

**Status:** built and tested. The current UI is the source of truth: `server/prisma/schema.prisma` and the API mirror `frontend/src/lib/types.ts`. When the earlier `C:\dev\tripos` project disagrees, the UI wins.

## How the UI connects

Screens read through `useApp` and write through `actions` in `frontend/src/lib/store.ts`:

1. `GET /api/state` loads the `AppState`, including every trip the user belongs to.
2. A write updates the screen immediately, then goes to the server. Each trip's writes are sent in order.
3. If the server refuses, the user sees its message and the screen reloads from the server.
4. After every commit, Socket.IO tells the trip's other members, whose clients refetch what they may see.

## Rules

| Rule | Detail |
|---|---|
| Money | Integer minor units in the database; numbers in major units in the API, as the UI expects. Shares must equal the total exactly. |
| IDs | The client generates them (`uid()`), so a retried create is the same record. A record can't be reached through another trip's URL. |
| Concurrent edits | Editable records carry `version`. A stale save returns 409 instead of overwriting. |
| Racing actions | Votes, comments and reordering are separate atomic routes, never whole-object saves. |
| Feed and notifications | Written by the server in the same transaction as the change, so they can't be forged. |
| Privacy | Personal packing lists and private documents are filtered on the server; events carry no content. |
| Permissions | One guard reads membership from the database per request and fails closed. Rules are pure functions in `authz/trip-policies.ts`. |
| Sessions | Random token in an httpOnly cookie; only its hash is stored. Passwords use scrypt. |

## Roles

| Action | viewer | member | admin | owner |
|---|---|---|---|---|
| Read the trip | Yes | Yes | Yes | Yes |
| Add or edit content, vote, chat | | Yes | Yes | Yes |
| Change or delete someone else's expense, poll, photo or document | | | Yes | Yes |
| Edit or archive the trip; invite; see the invite link | | | Yes | Yes |
| Change roles or remove members | | | Lower roles only | Yes |
| Delete the trip | | | | Yes |

Nobody but the uploader can see a private document, including admins.

## Tables

| Table | UI type | Notes |
|---|---|---|
| `users` | `Person`, `Settings` | A null `passwordHash` is a placeholder from an email invite, claimed at signup. |
| `sessions`, `password_reset_tokens` | | Hashed tokens only. |
| `trips` | `Trip` | `joinCode` backs the invite link. Upcoming, ongoing and completed are derived from dates in the UI. |
| `trip_members` | `Member` | `status` is `invited`, `active` or `removed`. Removed rows stay so balances survive. |
| `activities`, `activity_comments` | `Activity`, `Comment` | `position` holds the order within a day. |
| `expenses`, `expense_shares`, `settlements` | `Expense`, `ExpenseShare`, `Settlement` | |
| `ledger_entries` | | Append-only audit of every balance change; edits write reversals. |
| `tasks`, `packing_items`, `places` | `Task`, `PackingItem`, `Place` | |
| `polls`, `poll_options`, `votes` | `Poll`, `PollOption` | One vote per member per poll is a primary key. |
| `messages`, `photos`, `documents`, `files` | `Message`, `Photo`, `TripDoc` | `files` holds metadata; bytes are behind `FileStorage`. |
| `trip_events`, `notifications` | `TripEvent`, `AppNotification` | |

## Routes

All sit under `/api`. Every route needs a session unless marked public.

```
GET    /health                                  public
POST   /auth/signup | login | logout | forgot-password | reset-password   public
POST   /auth/change-password

GET    /state                                   the UI's AppState
PATCH  /me                                      profile and settings
PUT    /me/saved                                saved Explore destinations
GET    /notifications
POST   /notifications/read
POST   /notifications/:id/accept                accept an invite
DELETE /notifications/:id                       dismissing an invite declines it

POST   /trips
GET    /trips/:tripId
PATCH  /trips/:tripId
DELETE /trips/:tripId
POST   /trips/:tripId/members                   invite by email
PATCH  /trips/:tripId/members/:userId           change role
DELETE /trips/:tripId/members/:userId
GET    /invites/:code                           public preview for the join page
POST   /invites/:code/accept

PUT    /trips/:tripId/activities/:id            create or update
DELETE /trips/:tripId/activities/:id
POST   /trips/:tripId/activities/reorder
POST   /trips/:tripId/activities/:id/comments
POST   /trips/:tripId/activities/:id/attachments

PUT    /trips/:tripId/expenses/:id
DELETE /trips/:tripId/expenses/:id
PUT    /trips/:tripId/settlements/:id
GET    /trips/:tripId/balances

PUT    /trips/:tripId/tasks/:id
DELETE /trips/:tripId/tasks/:id
PUT    /trips/:tripId/packing/:id
DELETE /trips/:tripId/packing/:id
PUT    /trips/:tripId/places/:id
DELETE /trips/:tripId/places/:id

PUT    /trips/:tripId/polls/:id
DELETE /trips/:tripId/polls/:id
POST   /trips/:tripId/polls/:id/vote

PUT    /trips/:tripId/documents/:id
DELETE /trips/:tripId/documents/:id
PUT    /trips/:tripId/messages/:id
PUT    /trips/:tripId/photos/:id
DELETE /trips/:tripId/photos/:id

POST   /files                                   multipart upload, up to 25 MB
GET    /files/:id                               access checked per file
```

Errors look like `{ "message": "Shown to the user", "code": "VERSION_CONFLICT" }`: 401 no session, 403 not allowed, 404 not found, 409 conflict, 422 invalid.

## Live updates

Socket.IO at `/api/socket.io`, authenticated by the session cookie, with one room per trip and one per user.

| Event | Client does |
|---|---|
| `trip:changed { tripId }` | Refetches that trip |
| `trips:changed` | Reloads state (added, removed, or trip deleted) |
| `notifications:changed` | Refetches notifications |

Clients also reload everything after reconnecting. Every screen works from a normal fetch if the socket is down.

## Tests

```bash
cd server && pnpm test
```

```bash
cd tests && npx playwright test --project=desktop
```

Both need the database and backend running, and the browser tests also need the frontend.
