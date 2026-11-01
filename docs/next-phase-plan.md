# TripOS next phase: private beta

**Goal:** real groups can plan a real trip on TripOS, on the internet, with their data safe.

## Where things stand

| PRD phase | Status |
|---|---|
| 1. Foundation | Accounts, trips, invites and the responsive layout are built. **Project infrastructure isn't:** no git, CI, deployment or email. |
| 2. Planning | Built: voting, itinerary, tasks, packing, documents. |
| 3. Collaboration | Built: expenses, chat, notifications, gallery. |
| 4. Experience | Started: Trip Replay exists. The map is illustrative, and live location and PWA aren't started. |
| 5. Enhancements | Not started. |

Every item in the PRD's MVP definition (§23) works on a developer's machine and is covered by tests. But nothing is online, and invites can't reach anyone by email.

**Recommendation:** do this beta phase before PRD Phase 4. Maps and live location only matter once real groups can use the product, and real usage will show what to build next.

## Milestones

Do these in order. Size is relative: S is small, M is medium, L is large.

### 1. Version control and CI (S)
The code has no history or backup right now, so this comes first.
- Create the git repository and the first commit, and push it to GitHub.
- Run typecheck, API tests and browser tests on every push.
- Replace the template README with real setup steps, and remove the retired `backend/` folder.

**Done when:** a broken change fails CI, and a new developer can run the app from the README.

### 2. Real email and verified accounts (M), launch blocker
- Send invitation and password reset emails through an email provider.
- Require a verified email before an account can accept an email invite. Today, anyone signing up with an invited address can accept that invite.
- Stop writing reset links to the server log, and add rate limits for email sending.

**Done when:** someone with no account gets an invite email, signs up, verifies and lands in the trip.

### 3. Production file storage (M), launch blocker
Files currently sit on one machine's disk and would be lost on redeploy.
- Move file storage to Cloudflare R2 behind the existing `FileStorage` class, with short-lived signed links.
- Strip location data from uploaded photos, because holiday photos reveal where people are staying.
- Check file types by content, and set storage limits per trip.

**Done when:** files survive a redeploy, and an uploaded photo no longer carries GPS data.

### 4. Deployment (M), launch blocker
- Host the frontend on Vercel, and the API and live updates on Railway or Render. Vercel can't hold open the connections live updates need.
- Use `app.` and `api.` subdomains on one domain, so the login cookie works across them. This needs a configurable API address in the frontend.
- Use managed Postgres with automatic backups, and test a restore once.
- Apply database migrations automatically on deploy, with secure cookies and exact allowed origins.

**Done when:** two people on different networks plan a trip together on the live site.

### 5. Reliability and monitoring (M)
- Add Sentry, structured logs with request IDs, and uptime alerts.
- Add security headers, and rate limits on uploads, invites and chat.
- Add older-message loading: today only the latest 300 messages are loaded, and all trip data loads at startup.
- Load test against a target of 200 concurrent users. Add the Redis adapter if this needs more than one server.

**Done when:** an error reaches the team within minutes, and the load test passes.

### 6. Trust and legal (M), launch blocker
Passports and financial records need this before real data arrives.
- Publish a privacy policy and terms, and state an 18+ age requirement.
- Add account deletion and personal data export for India's DPDP Act. Deletion anonymises the person and keeps group balances intact.
- Replace the invented testimonials and statistics on the landing and login pages.
- Add a legal review before opening to the public.

**Done when:** a user can export or delete their data, and no invented claims remain.

### 7. Measure the beta (S)
- Add PostHog, with consent where required.
- Track what the product depends on: invite acceptance rate, share of trips reaching 3 active members, and expenses logged per trip.

**Done when:** the funnel from trip created to third member joined is visible.

### 8. Close the product gaps (M)
Found in the audit and testing, and best done alongside beta feedback:
- Fix the currency switch, which relabels amounts without converting them.
- Add activity types (travel, meal, stay), task status, the trips list view and appearance settings.
- Store itinerary attachments as real files (only names are kept today).
- Add a way to write Trip Replay highlights.
- Decide whether to bring back receipt scanning (currently returns 404, with manual entry still working).

## Beta exit criteria
Move to PRD Phase 4 when all of these are true:
- 10 real groups have used TripOS to plan a trip.
- At least half of invited people join.
- There have been no data-loss or privacy incidents, and no incorrect balances.

## After the beta: PRD Phase 4
Mapbox with real coordinates (this also makes Trip Replay's route real), optional live location with auto-expiry, installable PWA and offline access. Passports and IDs stay out of offline storage. Order these by beta feedback.

## Decisions needed

| Decision | Recommendation | Needed for |
|---|---|---|
| GitHub repository | A new private repo, keeping `Lokesh-1015/tripos` as an archive | Milestone 1 |
| Email provider | Resend, for its simple setup | Milestone 2 |
| Domain name | Yours to choose; required for email and deployment | Milestones 2 and 4 |
| Backend host | Railway, as the PRD suggests | Milestone 4 |
| Should pending invitees be in splits by default? | No: include only people who've joined, and let the payer add others | Milestone 8 |
| Who can record a payment? | Keep it open to any member, and show who recorded it | Milestone 8 |
| Default trip cover | Ask the creator to pick one, as the default Manali photo looks wrong on other trips | Milestone 8 |
