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

## Signing in

Sessions last 60 days from when they were last used, and the cookie is renewed with them. The free backend sleeps when idle, so the app waits for it to answer at startup. Only an actual 401 sends someone to the login page.

**One address, one account, whichever way it was created.**

| Signing in with Google when... | What happens |
|---|---|
| This Google account has signed in before | Signs in, matched by Google's permanent id |
| The address has a confirmed account | Links to it. All its data stays, and the password keeps working |
| The address has an account that never confirmed it | The real owner takes it back: all its data stays, and that password and its sessions stop working, as anyone could have typed this address |
| The address was invited by email | Becomes that person, and the invites appear |
| The address is new | Creates a confirmed account |
| Google hasn't confirmed the address | Refused |

Signing up with a password on an address that already has an account is refused, including a Google-only one. Someone who only uses Google can add a password through Forgot password.

**New accounts prove their address.** Signup turns away reserved domains, throwaway email services and domains that can't receive mail, checked against public DNS. If DNS itself fails, the address is let through. The account then can't reach anything but `/state`, `/me` and `/auth/*` until the emailed link is clicked. Accounts from before this have `mustConfirmEmail` false and just see a reminder. If no email service is configured, nobody is asked to confirm.

## Files

Uploads are checked by their real contents, not what the browser claims. JPG, PNG and WebP images are rewritten without hidden details such as GPS, and photos are shrunk in the browser first. Videos and other files keep whatever details they contain. Each person can store 500 MB.

With `OBJECT_STORAGE_*` set, contents go to object storage. Otherwise they go in the database, as they always did, and `/api/files/:id` works the same either way. A timer on the server, and `POST /jobs/storage`, clean older photos and move older files across, comparing each copy with the original before removing it. A database trigger records the storage key of every deleted file row, including through a deleted trip, so the contents are removed too.

## Travellers and friends

Profile, post, trip and document visibility are separate. Making a profile public changes nothing else, and being friends gives no access to any trip.

| Looking at a profile | Sees |
|---|---|
| Stranger, private profile | Name, username, photo |
| Stranger, public profile | Everything on the profile |
| Friend | Everything on the profile |
| Blocked, either way | "Not found", the same as someone who doesn't exist |

Email addresses are never in any of these responses. Nobody can be found until they've confirmed their email and finished onboarding, so invited placeholders stay out of search.

Every account gets a unique username at signup, which it can change once every 30 days. Usernames are stored lowercase, which makes them case-insensitive, and use letters, numbers, underscores and periods (3 to 30, no period at the start or end, none doubled). The database enforces all of it: a unique index, a CHECK constraint, and the `users_username_cooldown` trigger, which refuses a second change within 30 days and records `usernameChangedAt`. Everything else refers to people by id, so a new username breaks nothing. A deleted account's username becomes `former.<id>`, which frees the old one.

Two people have one `friendships` row, ordered so it's the same row whoever asked, so duplicates can't exist. A declined request looks finished to the sender, who can't ask again for 30 days, and stays in the decliner's list in case they change their mind. Friend notifications are in-app only, to protect the daily email allowance.

## Public trips and limits

Trips are private unless the host chooses otherwise, and that includes every trip made before this existed and every copied trip. Public means findable. Nobody is added without the host or an admin accepting them, and the public response is a separate allowlist, so nothing else on a trip can reach it: no join link, members, addresses, notes, expenses, documents or chat. The plan shows day, title and type only, and only if the host chooses. Finished and archived trips, and trips whose host is suspended, deleted or blocked, don't appear.

`maxParticipants` counts everyone who has joined, including the host. Invitations and requests don't hold a place. Every way of joining goes through `assertRoom` in `participants.ts`, which locks the trip's row so two people can't take the last place. A limit can't go below how many have joined, and never removes anyone.

## Posts

Posts belong to a profile, separate from trip memories. Each has its own audience: public, friends or only me, decided by `PostsService.visibleWhere`, which every read of a post, its photos, comments and likes uses. Blocked people, and suspended or deleted authors, are left out. Post photos are uploaded with visibility "post": only the uploader can open one until it's posted, then the post's audience decides. A linked trip is named only for people who can already see that trip. Sharing a post into a trip chat doesn't widen its audience: each reader still has to be allowed.

Sharing a memory as a post copies the photo into a new file owned by the post, so deleting either one leaves the other, and the trip's permissions don't change. Only the person who added a photo can share it.

## Leaving a trip

A member, editor or viewer asks to leave, and an owner or admin approves or rejects it. An admin leaves straight away when another admin remains. The only admin chooses someone on the trip to take over, who gets their role, owner included, in the same transaction as the departure, with the trip row locked so two admins can't both leave it adminless. Someone alone on a trip can't leave it; they can delete it, or invite someone and hand it over. Leaving keeps the member row as `removed` with `leftAt`, so expenses, messages, memories and other contributions stay, and access ends at once. Their shared location and pending invite notifications go. Admins are told about requests and departures, and the person who asked is told the answer.

## Deleting an account

The `users` row stays as a nameless "Former member", because other people's expenses and chat refer to it. Name, email, photo, profile, username, sessions, notifications, friendships, blocks, shared locations and private documents go. Trips with nobody else on them are deleted, and owned trips pass to an admin, or else the longest-standing member.

## Reminders and email

A scheduled GitHub workflow (`.github/workflows/daily-reminders.yml`) calls `/jobs/daily` every morning, because the free backend sleeps and can't time anything itself.

| Email | When | Who gets it |
|---|---|---|
| Trip starts in 3 days, task due today or tomorrow | Daily | Everyone, unless `notify.reminders` is off |
| Money you owe | Mondays | Everyone, unless `notify.reminders` is off |
| Digest of unread updates | Mondays | Only if `notify.email` is on |
| Updates as they happen, except chat | Right away | Only if `notify.emailAlerts` is on |

- Each person gets one reminder email a day, and `reminders_sent` stops the same reminder going out twice.
- Only verified addresses are emailed. Reminders still appear in the app for everyone else.
- Reminders and updates stop at 250 emails a day, so verification and reset emails always fit in Brevo's free 300. A reminder that doesn't fit is sent the next day. The count resets if the backend restarts.

## Live location

| Rule | Why |
|---|---|
| Off until someone chooses to share, per trip, for 1, 4 or 8 hours | It's opt-in and always ends by itself |
| One row per person per trip, holding only the latest position | There's no history to leak |
| Deleted on stop, expiry, sign-out, leaving the trip, or turning off the privacy setting | Nothing is left behind. Expired rows go on the next request, as a background job would keep the free database awake |
| Visible to active members only, fetched through the membership check | Sockets only announce that something changed |
| Left out of the trip data and the offline copy on the device | A position never lands somewhere it can outlive sharing |

## Email and verified accounts

Production mail goes through Brevo's HTTPS API (`BREVO_API_KEY`), because Render's free plan blocks SMTP ports. Failed sends are retried up to three times while the server is running. Without that key, mail goes over `SMTP_URL`; locally, Mailpit catches everything at http://localhost:8025.

| Rule | Why |
|---|---|
| Signing up doesn't verify an address; clicking the emailed link or resetting the password does | Both prove the person can read that inbox |
| An unverified account can't see, accept, decline or send email invites | Otherwise anyone signing up with an invited address could get in, and accounts could send spam |
| Changing email makes the account unverified again | A new address has to prove itself too |
| A password reset ends every session | If someone else signed up with your address first, this is how you take the account back |
| Verification and reset requests send at most one email a minute | So these routes can't flood an inbox |
| Joining through an invite link doesn't need verification | The link is deliberately "anyone with the link" |

## Currency

Every balance is in the trip's currency.

- **An expense in another currency** is entered with the rate paid, and counts at the converted amount.
- **Changing a trip's currency** converts everything in one transaction at a rate an admin enters: expenses, shares, payments, budgets and costs. Shares still add up exactly.
- **Rounding** is corrected with small adjustment entries, so people who were settled stay exactly settled. The UI doesn't count these as payments.
- A trip with no amounts yet can change currency freely. Otherwise `PATCH /trips/:tripId` refuses a currency change with a 409.

## Tables

| Table | UI type | Notes |
|---|---|---|
| `users` | `Person`, `Settings` | A null `passwordHash` is a placeholder from an email invite, claimed at signup. |
| `sessions`, `password_reset_tokens`, `email_verification_tokens` | | Hashed tokens only. |
| `trips` | `Trip` | `joinCode` backs the invite link. Upcoming, ongoing and completed are derived from dates in the UI. |
| `trip_members` | `Member` | `status` is `invited`, `active` or `removed`. Removed rows stay so balances survive. `leftAt` marks someone who left, who can rejoin by link, unlike someone removed. |
| `trip_leave_requests` | | A member's request to leave, `pending` until an admin approves or rejects it, or they cancel. |
| `activities`, `activity_comments`, `activity_attachments` | `Activity`, `Comment`, `Attachment` | `position` holds the order within a day. |
| `expenses`, `expense_shares`, `settlements` | `Expense`, `ExpenseShare`, `Settlement` | Amounts are in the trip's currency. An expense paid in another currency also keeps what was paid and the rate. |
| `ledger_entries` | | Append-only audit of every balance change; edits write reversals. |
| `tasks`, `packing_items`, `places` | `Task`, `PackingItem`, `Place` | |
| `polls`, `poll_options`, `votes` | `Poll`, `PollOption` | One vote per member per poll is a primary key. |
| `messages`, `photos`, `documents`, `files` | `Message`, `Photo`, `TripDoc` | `files` holds metadata; bytes are behind `FileStorage`. |
| `trip_events`, `notifications` | `TripEvent`, `AppNotification` | |

## Routes

All sit under `/api`. Every route needs a session unless marked public.

```
POST   /auth/signup | login | logout | forgot-password | reset-password | verify-email   public
POST   /auth/change-password
POST   /auth/resend-verification

GET    /state                                   the UI's AppState
GET    /health                                  public; also checks the database
GET    /health/live                             public; the process only, for the uptime monitor
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
POST   /trips/:tripId/convert-currency      admin or owner; { currency, rate }
GET    /exchange-rates?date=                signed in; today's rates against USD, cached for 6 hours, or a past date's
GET    /trips/:tripId/messages?before=&beforeId=&limit=   members; chat older than the 300 that load with the trip
POST   /trips/:tripId/copy                  members; new trip from this one { id, name, startDate }
POST   /jobs/daily                          the x-jobs-secret header; sends the day's reminders
POST   /jobs/storage                        the x-jobs-secret header; finishes deletes, cleans older photos, moves older files
POST   /contact                             public, 5 per 10 minutes; emails whoever runs TripOS
POST   /me/accept-terms                     an older account confirming it's 18+ and accepts the terms
POST   /me/delete                           { password } or, with no password, { email }
GET    /me/profile   PATCH /me/profile      your own traveller profile, with when your username can next change
GET    /usernames/check?username=           { username, available, mine, reason }
GET    /profiles/:username                  respects who's looking; blocked and unconfirmed people are "not found"
GET    /people/search?q=                    by name or username, never by email
GET    /friends                             DELETE /friends/:userId
GET    /friends/requests                    POST /friends/requests { username }
POST   /friends/requests/:id/accept | decline   DELETE /friends/requests/:id
GET    /blocks                              POST /blocks { userId }   DELETE /blocks/:userId
POST   /reports                             { targetType: "profile" | "trip", targetId, reason, details }
GET    /public/trips                        Explore, with filters; needs an account
GET    /public/trips/:id                    public, so a trip can be shared by link; only allowlisted fields
POST   /public/trips/:id/join-request       { message }   DELETE to cancel
GET    /trips/:id/join-requests             owner and admins
POST   /trips/:id/join-requests/:rid/accept | reject   owner and admins
GET    /trips/:id/leave                     how this person can leave: request, direct, choose_successor or only_person
POST   /trips/:id/leave                     { successorId? } members ask; admins leave, handing over first if they're the only one
DELETE /trips/:id/leave                     cancel a pending request
POST   /trips/:id/leave-requests/:rid/approve | reject   owner and admins
GET    /people/suggested                    public profiles with something in common
POST   /admin/trips/:id/unpublish           ADMIN_EMAILS only
GET    /feed?before=&beforeId=              your posts, friends' posts and public posts, newest first
GET    /profiles/:username/posts            that person's posts you're allowed to see
POST   /posts                               { id, caption, destination, tripId, visibility, photos, fromPhotoId? }
GET | PATCH | DELETE /posts/:id             PATCH and DELETE are for the author
PUT | DELETE /posts/:id/like
GET | POST /posts/:id/comments              DELETE /posts/:id/comments/:commentId (commenter or post author)
POST   /admin/posts/:id/remove              ADMIN_EMAILS only
GET    /admin/reports                       ADMIN_EMAILS only, otherwise 404; also POST /admin/reports/:id/review
POST   /admin/users/:id/suspend | unsuspend ADMIN_EMAILS only
GET    /auth/config                         public; the Google client id, or null if it's not set up
POST   /auth/google                         public; signs in with a credential from Google { credential }
GET    /trips/:tripId/live-locations        active members; who is sharing and where
PUT    /trips/:tripId/live-locations/me     active members; start sharing { lat, lng, accuracy, hours: 1 | 4 | 8 }
PATCH  /trips/:tripId/live-locations/me     the sharer; new position { lat, lng, accuracy }. Can't extend the end time
DELETE /trips/:tripId/live-locations/me     the sharer; stop and delete the position
GET    /live-locations/mine                 signed in; the trips you're sharing with
DELETE /live-locations/mine                 signed in; stop sharing everywhere, as signing out does

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
