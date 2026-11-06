# PRD v0.2 launch review

The phase 7 review of `prd_v2.md`, checked on 6 November 2026 against what's built and tested. Phases 0 to 6 of `docs/prd-v2-plan.md` are live.

## Success criteria (PRD section 17)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Users can manage public and private profiles | Met | `social.e2e.test.ts`, `people-and-friends.spec.ts` |
| 2 | Users can send and accept friend requests | Met | Same, including the four states and no repeats |
| 3 | Users can discover travellers with shared interests | Met | `/people/suggested` and Explore's Travellers tab, `public-trips.e2e.test.ts` |
| 4 | Hosts can publish public and private trips | Met | `public-trips.e2e.test.ts`, `explore-and-join.spec.ts` |
| 5 | Explore is rebuilt around hosting and discovering trips | Met | Old recommendations removed, `explore-and-join.spec.ts` |
| 6 | Public trips are discoverable through Explore | Met | Filters for every field the PRD lists |
| 7 | Users can request to join public trips | Met | `public-trips.e2e.test.ts` |
| 8 | Hosts retain control over join approvals | Met | Nobody joins without the owner or an admin accepting |
| 9 | Private trips are accessible only through authorized invitations | Met | `privacy-matrix.e2e.test.ts` |
| 10 | Hosts can configure and manage participant limits | Met | `participant-limits.e2e.test.ts`, `participant-limits.spec.ts` |
| 11 | Participant limits are respected across every joining method | Met | One locked rule for links, invitations and requests, tested with simultaneous joins |
| 12 | Users can publish travel-related photo posts | Met | `posts.e2e.test.ts`, `posts-and-feed.spec.ts` |
| 13 | Users can interact with eligible posts | Met | Likes and comments only for people who can see the post |
| 14 | Trip memories remain separate from profile posts | Met | Separate tables and files |
| 15 | Users can upload memories against specific trip dates | Met | `memories-and-locations.spec.ts` |
| 16 | Multiple trip participants can contribute memories | Met | Same, with a second member adding to the same date |
| 17 | Users can explicitly share selected memories as social posts | Met | The post gets its own copy, and deleting either leaves the other |
| 18 | Shared chat locations open the correct Google Maps destination | Met | Coordinates in the link, kept if the place is deleted |
| 19 | Privacy and safety controls work consistently | Met | `privacy-matrix.e2e.test.ts` covers owner, member, friend, stranger, blocked and signed out |

## Privacy review

`privacy-matrix.e2e.test.ts` checks six kinds of person against a private trip, its shared and private files, its memories, a profile, posts with each audience, and search. It also checks that nothing private reaches anything public: search, profiles, suggestions, Explore, the feed, a public trip page and the invite preview. It plants a marked secret in the trip's name, description, chat, documents and memories, and checks for it, email addresses and the join link.

What a public trip shows is a separate allowlist. Its people, chat, documents, expenses, addresses and notes can't reach it, and the plan shows titles only.

## Notifications review

| Notification | Goes to | Opens | Pacing |
|---|---|---|---|
| Friend request | The person asked | Requests tab | One each, taken back if cancelled or blocked |
| Friend request accepted | The person who asked | Their new friend's profile | One each |
| Join request | Owner and admins | The trip, with requests at the top | One unread per trip |
| Join accepted or declined | The person who asked | The trip, or Explore if declined | One each, by email only if they opted in |
| Someone joined | Owner and admins | The trip | One unread per trip. **New in this phase**, as the PRD's "invitation accepted" wasn't covered |
| Trip full | Owner and admins, other than whoever filled it | The trip | One unread per trip |
| Trip visibility changed | Members | The trip | One per change |
| Post liked or commented on | The author | The post | One unread per post and kind |
| Invitation received | The person invited | The trip | One each, as before |

Social notifications are in-app only, apart from join decisions for people who turned on email alerts, to stay inside Brevo's 300 emails a day. They can be turned off in Settings, under Friend requests.

## Speed and storage

| Measure | Before this phase | After |
|---|---|---|
| Script for the landing or login page | 1,511 KB | About 820 KB |
| Main script, compressed | 443 KB | 151 KB |
| Map code | In the main script | Loaded only when a map opens |
| Backend health, when awake | 0.4 s | Unchanged |

Pages other than the landing and sign-in pages now load the first time they're opened. Installed copies still have every page offline, as all of them are cached.

On 6 November the database was 22 MB of Neon's 0.5 GB free, and stored files 29 MB of Neon Object Storage's 5 GB. Each person can store 500 MB.

Render's free plan sleeps after 15 minutes without traffic, and the first request then takes up to about a minute. The app shows "Waking TripOS up" rather than signing anyone out. This can't be fixed on the free plan.

## Gaps and limits

These are known and deliberate, or small enough for later.

- **Public trip participants:** only the count is shown, not names. The PRD allows a list "where permitted", but no setting for that exists yet, so friend requests start from the host or a profile.
- **Memory details:** a photo shows who added it and which day, but not the upload date.
- **Chat location preview:** a styled card with the name and address, not a live map, to save data.
- **Feed order:** newest first. The PRD asks for relevance, which needs more content to tune.
- **Budget filter:** only matches trips in the viewer's own currency.
- **Videos:** they keep any location data, so they can't be posted, only added to trip memories.
- **Moderation:** reports reach an admin page and email, but someone has to read them.
- **Legal:** the privacy policy and terms haven't been reviewed by a lawyer, and there's no data export yet.
