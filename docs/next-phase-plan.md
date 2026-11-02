# TripOS next phase: private beta

**Goal:** real groups can plan a real trip on TripOS, on the internet, with their data safe.

## Status

| Milestone | Status |
|---|---|
| 1. Version control and CI | **Done.** Code is at `Lokesh-1015/TripOS`, and CI runs every test on each push. |
| 2. Real email and verified accounts | **Built and tested locally, with Brevo sending ready.** Uses a Gmail sender, so mail may land in spam until a domain is connected. |
| 3. Production file storage | **Interim.** Files live in Postgres and survive restarts, but use up the database's 1 GB limit. |
| 4. Deployment | **Live on free plans:** https://tripos-travel.vercel.app, with the database on Neon. |
| 5. Reliability and monitoring | Not started |
| 6. Trust and legal | Not started |
| 7. Measure the beta | Not started |
| 8. Product gaps | **Done**, including the currency fix. |

## Next phase, in order

### A. Production file storage (M), launch blocker
Files are in Postgres for now, which uses up the small free database quickly.
- Move file storage to Neon Object Storage (5 GB free, S3-compatible), with short-lived signed links.
- Strip location data from uploaded photos, because holiday photos reveal where people are staying.
- Check file types by content rather than trusting the browser, and set storage limits per trip.

**Done when:** files survive a redeploy, and an uploaded photo no longer carries GPS data.

### B. Production-grade hosting (M), launch blocker
The app is deployed on free plans. Before real groups rely on it:
- Automate backups, because Neon's free plan keeps only 6 hours of history and one manual snapshot, and test a restore once.
- Decide whether the backend's sleep after 15 idle minutes is acceptable. Don't keep it awake by pinging `/api/health`, because that also keeps the database awake and uses up its 100 free compute hours a month.
- Connect a custom domain.
- Authenticate a domain in Brevo, with SPF, DKIM and DMARC set up so mail doesn't land in spam, and change `MAIL_FROM` on Render to use it.
- Review Vercel's plan: Hobby is for non-commercial use.

**Done when:** two people on different networks sign up from a real email, and plan a trip together on the live site.

### C. Trust and legal (M), launch blocker
Passports and financial records need this before real data arrives.
- Publish a privacy policy and terms, and state an 18+ age requirement.
- Add account deletion and personal data export for India's DPDP Act. Deletion anonymises the person and keeps group balances intact.
- Replace the invented testimonials and statistics on the landing and login pages.
- Get a legal review before opening to the public.

**Done when:** a user can export or delete their data, and no invented claims remain.

### D. Reliability and monitoring (M)
- Add Sentry, structured logs with request IDs, and uptime alerts.
- Add security headers, and rate limits per account on uploads, invites and chat. Today's limits are per IP address and cover login and invites only.
- Send emails through a durable background queue (BullMQ). Failed sends are retried three times in memory and then only logged, and a restart loses retries in progress, though people can ask for verification and reset emails again.
- Add older-message loading: only the latest 300 messages load today, and all trip data loads at startup.
- Load test against a target of 200 concurrent users. Add the Redis adapter if this needs more than one server.

**Done when:** an error reaches the team within minutes, and the load test passes.

### E. Measure the beta (S)
- Add PostHog, with consent where required.
- Track what the product depends on: invite acceptance rate, share of trips reaching 3 active members, and expenses logged per trip.

**Done when:** the funnel from trip created to third member joined is visible.

## Beta exit criteria
Move to PRD Phase 4 when all of these are true:
- 10 real groups have used TripOS to plan a trip.
- At least half of invited people join.
- There have been no data-loss or privacy incidents, and no incorrect balances.

## After the beta: PRD Phase 4
Mapbox with real coordinates (this also makes Trip Replay's route real) and optional live location with auto-expiry. Order these by beta feedback.

Receipt scanning waits for PRD Phase 5 (AI features). The old Python version is in the baseline commit.

## Known limits of what's built
- **Exchange rates are daily market rates**, from Exchange Rate API's free service, and they're suggestions. An expense keeps the rate saved with it, so a new day's rates never change a balance. Today's rate is suggested even for an expense dated earlier.
- **Offline access is for reading, plus changes while the app stays open.** The app and trips open with no signal, but photos and files need a connection, documents are never stored on the device, and a change made offline is lost if the app is closed before reconnecting.
- **Default email sender:** set `MAIL_FROM` to a real address on your domain before going live.
- **Dark mode** covers the signed-in app. A few fixed colours, such as note and priority badges, stay the same in both themes.

## Decisions needed

| Decision | Recommendation | Needed for |
|---|---|---|
| Should the repository stay public? | Make it private until launch: the PRD and all code are readable by anyone | Now |
| Domain name | Yours to choose | B |
| Email domain | Authenticate a domain in Brevo. Sending from Gmail works without one, but Brevo replaces the sender address and more mail may land in spam | B |
| File storage | Neon Object Storage, to stay on free plans | A |
| Paid hosting | Stay on free plans for now, and watch Neon's compute and storage use | B |
