# TripOS next phase: private beta

**Goal:** real groups can plan a real trip on TripOS, on the internet, with their data safe.

## Status

| Milestone | Status |
|---|---|
| 1. Version control and CI | **Done.** Code is at `Lokesh-1015/TripOS`, and CI runs every test on each push. |
| 2. Real email and verified accounts | **Built and tested locally.** Off in production until an email provider is connected. |
| 3. Production file storage | **Interim.** Files live in Postgres and survive restarts, but R2 is still needed. |
| 4. Deployment | **Live on free plans:** https://tripos-travel.vercel.app. Needs paid plans and a custom domain before real groups rely on it. |
| 5. Reliability and monitoring | Not started |
| 6. Trust and legal | Not started |
| 7. Measure the beta | Not started |
| 8. Product gaps | **Done**, including the currency fix. |

## Next phase, in order

### A. Production file storage (M), launch blocker
Files are in Postgres for now, which uses up the small free database quickly.
- Move file storage to Cloudflare R2 behind the existing `FileStorage` class, with short-lived signed links.
- Strip location data from uploaded photos, because holiday photos reveal where people are staying.
- Check file types by content rather than trusting the browser, and set storage limits per trip.

**Done when:** files survive a redeploy, and an uploaded photo no longer carries GPS data.

### B. Production-grade hosting (M), launch blocker
The app is deployed on free plans. Before real groups rely on it:
- Move the database to a paid plan with automatic backups, and test a restore once. **The free database expires on 1 December 2026.**
- Move the backend to a paid plan, so it doesn't sleep after 15 idle minutes.
- Connect a custom domain.
- Connect the production email provider, with SPF and DKIM set up so mail doesn't land in spam.
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
- Send emails through a background queue with retries (BullMQ). A failed send is currently only logged, though people can ask for verification and reset emails again.
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
Mapbox with real coordinates (this also makes Trip Replay's route real), optional live location with auto-expiry, installable PWA and offline access. Passports and IDs stay out of offline storage. Order these by beta feedback.

Receipt scanning waits for PRD Phase 5 (AI features). The old Python version is in the baseline commit.

## Known limits of what's built
- **Exchange rates are typed in by people.** Automatic rates can follow if beta groups ask for them.
- **Cross-trip totals only add up INR trips**, in the Expenses hub.
- **Default email sender:** set `MAIL_FROM` to a real address on your domain before going live.
- **Dark mode** covers the signed-in app. A few fixed colours, such as note and priority badges, stay the same in both themes.

## Decisions needed

| Decision | Recommendation | Needed for |
|---|---|---|
| Should the repository stay public? | Make it private until launch: the PRD and all code are readable by anyone | Now |
| Domain name | Yours to choose | B |
| Email provider | Resend, using its SMTP settings in `SMTP_URL` | B |
| File storage account | Cloudflare R2, as the PRD says | A |
| Paid hosting | Render's starter plans for the backend and database | B, before 1 December 2026 |
