# PRD v0.2 implementation plan: traveller social network

Source: `prd_v2.md`. Goal: add profiles, friends, public trips, the new Explore, posts, dated memories and actionable chat locations without changing how today's private trips work.

Status: proposed. Nothing here is built yet.

## What the code analysis found

These facts shape the plan, and some of them change the PRD's order.

| Finding | Where | What it means |
|---|---|---|
| Uploaded files are stored inside the database | `files.controller.ts`, `FileBlob` | Photo posts would fill the free database quickly. Storage has to move first. |
| Uploads keep their GPS data | `files.controller.ts` | Harmless among friends, but a public post could reveal where someone is staying. Must be fixed before anything is public. |
| `profilePublic` is already `true` for everyone, but has never done anything | `auth.service.ts:23` | Honouring it would suddenly expose existing users. It can't be reused. |
| Inviting by email creates a placeholder account | `findOrCreateUser` in `trips.controller.ts` | Placeholders must never appear in search or discovery, or invited addresses and names leak. |
| There are 4 separate places that add someone to a trip | `trips.controller.ts:129`, `:277`, `:374`, `state.controller.ts:127` | The limit must live in one shared rule, or a path will bypass it. Link joining also reads outside its transaction, so two people could take the last place. |
| The invite link joins immediately and the preview lists all members | `trips.controller.ts:346-390` | Fine for private links. Public pages need their own response and must never contain `joinCode`. |
| The main trip response holds everything: expenses, chat, documents | `trip.serializer.ts` | Public pages must use a new, allowlisted response, never a filtered copy of this one. |
| Deleting a memory also deletes its file | `sharing.controller.ts`, `removePhoto` | Share as Post must copy the file, or deleting the memory would break the post. |
| Non-public files with no trip are readable only by the uploader | `files.controller.ts` | File access needs a new rule for posts: public, friends or only me. |
| Memories already group by day | `MemoriesTab.tsx`, `Photo.day` | Dated memories are mostly a UI change. Photos keep working with no data migration. |
| Chat location cards exist, but have a fake map and no link, and depend on the saved place still existing | `ChatTab.tsx:108` | A small fix, with the Google Maps link already built in `MapTab.tsx:154`. |
| Each user already has a realtime room | `realtime.gateway.ts` | Social notifications can use it without new infrastructure. |
| Old Explore is referenced in 4 other places | `Dashboard.tsx:51,198`, `Auth.tsx:385`, `all-screens.spec.ts:180` | All must change together, and saved destinations must keep their data. |

## Rules that protect existing behaviour

1. **Database changes only add.** New tables, and new columns that are nullable or have a default. Nothing is renamed or dropped during this phase.
2. **Existing data starts private.** Every existing trip is private with no limit, and every existing profile is private.
3. **`/state` doesn't grow.** Social data loads separately, so the core app and its offline copy keep today's speed and contents.
4. **Existing endpoints only gain fields.** Their current fields and meanings stay the same.
5. **New screens ship behind a switch.** A `SOCIAL_ENABLED` setting keeps unfinished work out of sight until its phase passes on the live site.
6. **Existing tests stay untouched.** The 63 browser and 143 server tests must pass unchanged. The one planned exception is the old Explore step, replaced in phase 4.
7. **Every phase follows the usual routine.** Test locally with Playwright, push only if everything passes, then test the deployed version.
8. **Rehearse migrations.** Run each one on a Neon branch first, and take a snapshot before production.

## Phases

Size: S is small, M is medium, L is large. The PRD's priorities are reordered where a dependency or a safety risk requires it.

### Phase 0: Safe foundations (L). Needed before anything public

- Move new uploads to object storage, keeping `/api/files/:id` so existing links still work. Then move existing files across and confirm each one before removing its database copy.
- Shrink photos in the browser, then remove location data and check the real file type on the server. Add a per-person storage limit.
- Add account deletion, a privacy policy, terms and an 18+ confirmation, because this phase introduces meeting strangers. Replace `support@tripos.app` with a working contact.

**Done when:** a downloaded photo has no GPS data, old photos and documents still open, and files survive a redeploy.

### Phase 1: Quick wins for current users (M). PRD priorities 5 and 6, without sharing

**Chat locations**
- Add a shared Google Maps link helper using coordinates, falling back to name and address for older places without them.
- Show a proper location card with **Open in Google Maps**, and allow searching for a place from chat.
- Save the place's name, address and position on the message, so history survives if the place is later deleted. Older messages fall back to the saved place.

**Dated memories**
- List every trip date, labelled from that day's itinerary, including dates with no photos yet.
- Open a date, upload several photos to that date, and caption them. Today, photos go to today's date with the file name as caption.
- Add optional location and activity links, and optional highlights.
- Keep albums, Trip Replay and existing photos working. Photos on days outside new dates, after a date change, stay visible in an "Other photos" group.

**Done when:** a coordinate-specific Maps link opens from chat, and uploads land on the chosen date for every member.

### Phase 2: Identity, friends and safety (L). PRD priority 1 and part of 7

- **Profiles:** username, cover photo, location, interests, places visited and favourite destinations. Existing saved destinations carry over. Public and private settings use a new field, starting private.
- **Usernames:** suggested for existing accounts, and changeable. Email is never shown or searchable.
- **Friends:** send, accept, decline, cancel, remove, plus who can send requests. One active relationship per pair, enforced by the database, so duplicate requests are impossible.
- **Safety, moved up from priority 7:** block and report arrive with profiles rather than last. A block hides both people from each other everywhere, ends the friendship and cancels pending requests. Blocked people get a "not found" response, so they can't detect it.
- **Moderation:** reports are saved and emailed to you, with a small page restricted to admin accounts.
- **Eligibility:** only people with confirmed email can send requests. Placeholder accounts never appear.
- **Notifications:** new types for friend requests and acceptance, with a settings switch. Friendship grants no access to trips, posts or documents by itself.

**Done when:** PRD journey 1 works between two real browsers, and private profile data is unavailable through the API as well as the screen.

### Phase 3: Trip visibility and limits (M). PRD priority 3 and part of 2

- Add `visibility` (default private), `maxParticipants` (default none), category, travel style and which details to show publicly. Copied trips start private with no limit.
- Add one `addParticipant` rule that locks the trip row, checks the limit and adds the person. All 4 existing paths and the new approval path use it. Tests run simultaneous joins for the last place.
- Only active members count, including the host. Invitations and join requests don't hold a place.
- When full: show **Trip Full**, refuse invitation sending, links and acceptances with a clear message, and keep the invitation so it works if a place opens. Limits can't go below the current count and never remove anyone.
- Add create and edit screens, with an explanation before changing visibility. Hide the public option until phase 4 launches.

**Done when:** no joining path can exceed the limit, and trips without a limit behave exactly as today.

### Phase 4: Public trips and the new Explore (L). PRD priority 2 and section 8

- **Public responses:** a separate module with an allowlist for each public field. The plan shows only day, title and type, never addresses, notes, attachments, costs or chat. Budget shows only if the host opts in. Only the host and participant count show by default.
- **Join requests:** new table with request, cancel, accept and reject. Accepting goes through `addParticipant`, and tells the host if the trip is full. Removed or blocked people can't request.
- **Host warning:** before a trip goes public, explain that accepted people see everything shared on the trip, including shared documents.
- **Explore:** remove the old page and its destination recommendations. Rebuild around **Discover Trips** and **Host a Trip**, with all the PRD's filters and a useful empty state, because there will be few public trips at launch. Finished, archived and private trips never appear.
- **Traveller discovery:** a secondary section based on shared styles, destinations and mutual friends, with no popularity ranking.
- **Connected changes:** Dashboard links, onboarding text and the Explore test step. Private links keep working as they do today.

**Done when:** PRD journeys 2, 3 and 4 work, and an automated test finds no private details in any public response.

### Phase 5: Posts and feed (L). PRD priority 4

- Posts with several photos, caption, destination and optional trip, each public, friends or only me.
- Likes, comments, delete, edit, share within TripOS and reporting. Like and comment counts stay modest in the design.
- One shared visibility check used for reading posts, their photos, comments and likes.
- A paginated travel feed on its own page, separate from Explore, plus a profile gallery.
- Notifications grouped per post, so they don't overwhelm anyone. In-app only, to protect the 300 emails a day.

**Done when:** PRD journey 5 works, and a friends-only photo address fails for non-friends.

### Phase 6: Share a memory as a post (S). PRD priority 5, remainder

- Choose a memory, then **Share as Post**, edit caption, choose visibility, publish. The post gets its own file copy, stripped of location data.
- Only the person who added a photo can share it. Other members' photos stay in the trip.

**Done when:** deleting either one leaves the other intact, and the original memory's permissions are unchanged.

### Phase 7: Final pass and launch (M). PRD priority 7, remainder

- Review all notification types for links and pacing.
- Run the full privacy test across profiles, Explore, trips, posts, chat and memories.
- Check page speed with the free backend asleep and awake, and storage use.
- Add a What's new entry for each phase as it goes live.
- Check against PRD section 17 and record any gaps.

## New data

| Table or field | Purpose |
|---|---|
| `users`: `username`, `coverPhoto`, `location`, `profileVisibility`, `friendRequestsFrom`, `placesVisited`, `interests` | Profile |
| `friendships`, `blocks` | Relationships and blocking |
| `reports` | Reports on profiles, posts and trips |
| `trips`: `visibility`, `maxParticipants`, `category`, `travelStyle`, `showBudget`, `showPlan` | Trip discovery and limits |
| `join_requests` | Request, accept, reject |
| `posts`, `post_photos`, `post_likes`, `post_comments` | Social posts, separate from `photos` |
| `messages`: location name, address and position | Chat history that lasts |
| `photos`: optional `placeId`, `activityId`, `highlight` | Memory details |
| `files`: storage location, optional `postId` | Object storage and post permissions |
| `NotificationKind`: new values | Social notifications |

## Testing

- **Existing suite:** runs unchanged at every phase.
- **Privacy matrix:** a table-driven server test covering stranger, friend, blocked person, member and owner against every profile, post, trip and file visibility.
- **Leak test:** seed a trip with marked secrets, then confirm none appears in any public response.
- **Limits:** simultaneous joins through each path, including the last-place race.
- **Two-browser Playwright:** one test for each of the 8 PRD journeys.
- **Upgrade test:** start from a copy of the current data shape, migrate, and confirm existing trips stay private and fully usable.

## Risks

| Risk | Mitigation |
|---|---|
| Free storage or database runs out | Phase 0 compression and limits, with storage use checked at each release |
| Render's free backend sleeps, making first Explore load slow | Reuse the existing waking screen and show loading placeholders |
| Strangers meeting in person | 18+ confirmation, confirmed email, block and report, and safety guidance on public trips. A moderator still has to read reports |
| Few public trips at launch | A strong empty state, and a prompt to host |
| Mail allowance of 300 a day | Social notifications stay in-app, with email only for join-request decisions and only if opted in |

## Decisions needed

1. **Existing profiles:** start private, which is recommended, or public?
2. **Storage:** Neon Object Storage is recommended, with no second account. Its 5 GB free limit comes from our earlier notes and has to be confirmed, and the Neon connector needs reconnecting.
3. **Signed-out visitors:** recommended that public trip pages are viewable so links can be shared, while profiles, discovery and requesting to join need an account.
4. **Who approves requests:** recommended that the owner and admins can, matching who can invite today.
5. **What accepted people can see:** recommended as a normal member with the warning above. The stricter option is view-only until the host promotes them.
6. **Who reads reports:** recommended that they go to you by email, with the admin page.
