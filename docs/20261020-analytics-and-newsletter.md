# Analytics and newsletter signup

Status: built 2026-10-20 (Phase 1, workstream W5b). Read with the [Phase 1 design](20261019-erc-phase-1-design.md).

## Analytics: the shared Umami at analytics.gilla.fun

Umami 3.4.0 (MIT, cookieless) runs on boxy as its own compose project, `~/analytics`, shared by every gilla.fun site. ERC is one website in it. The stack's source is `homebox/stacks/analytics`; it has its own Postgres (`analytics-postgres`, picked up by the nightly `pg_dumpall`) and its own Cloudflare Tunnel.

```
 browser ──> erc.gilla.fun ──────── erc tunnel ─────────> erc-web:3000 ──> erc-postgres
 browser ──> analytics.gilla.fun ── analytics tunnel ───> analytics-umami:3000 ──> analytics-postgres
             (script.js, /api/send, dashboard)
```

Until 2026-11-05 Umami ran inside this project as `erc-umami`, with a `umami` database in `erc-postgres`, at `erc-stats.gilla.fun`. It moved out so other sites can share it without depending on ERC's stack. The move copied the database with `pg_dump`, so ERC's website id, history, and the dashboard login did not change. The old `umami` database and role are still in `erc-postgres` as a rollback until they are dropped.

The tracker loads from Umami's own hostname, which also serves the dashboard. A same-origin proxy route in `erc-web` was rejected for these reasons:

- The dashboard needs a hostname anyway. Umami's `BASE_PATH` is fixed when its image is built **[I]**, so the dashboard cannot live under a path of the site without building our own image.
- Page-view beacons never touch `erc-web`, which is capped at one CPU and 768 MB.
- There is no proxy code to maintain, and Umami answers the cross-origin beacons itself.

The cost is that some content blockers may block a cross-site analytics host **[G]**.

### What the tracker sends

`erc-web` renders the tag per request, so an image built without analytics settings starts counting as soon as they are set and the container restarts. With `UMAMI_URL` or `UMAMI_WEBSITE_ID` unset, no tag is rendered. A partial or malformed pair stops the server at start-up.

The tag sets these attributes, verified against the 3.4.0 tracker source:

| Attribute | Effect |
|---|---|
| `data-do-not-track="true"` | A browser that sends Do Not Track is not counted. |
| `data-exclude-search="true"` | Query strings are dropped from the page URL and the referrer. Newsletter links carry tokens in the query string, so this keeps them out of analytics. Race filter values are not recorded either. |
| `data-exclude-hash="true"` | Fragments are dropped. |
| `data-domains` | Only the hostname of `ERC_SITE_URL` is counted, so a local or staging copy never counts. |

Umami stores no cookies and no IP addresses **[I]**. Do not turn on Umami's session replay or heatmaps; the site never loads `recorder.js`.

### Connect ERC to Umami

1. In the dashboard at https://analytics.gilla.fun, add a website with the site's domain. Copy its website id.
2. Set `UMAMI_URL=https://analytics.gilla.fun` and `UMAMI_WEBSITE_ID=<id>` in `~/erc/.env`, then run `docker compose up -d erc-web` and `docker restart erc-cloudflared`. No rebuild is needed.

## Newsletter signup

Signup only, with double opt-in. Sending issues comes later with listmonk.

```
 footer form ──POST──> receiveSignup ──> subscribers (pending, sha256 of token, expiry)
                                     └─> after the response: email with confirm and unsubscribe links
 /newsletter/confirm?token=…      GET shows a button; POST confirms once, within 48 hours
 /newsletter/unsubscribe?token=…  GET shows a button; POST unsubscribes (signed link, never expires)
```

- The form is in the footer of every page and works without JavaScript. It reuses the contact form's honeypot, signed time token, and per-sender limit (five signups an hour), from `src/content/form-guard.ts`. Confirmation emails are also capped at 15 an hour site-wide; past that every signup is asked to try again later. Requests count and store one at a time under a Postgres advisory lock, so a burst of parallel signups cannot pass the cap (see the Phase 1 design).
- The form appears only when SMTP is configured, decided per request. A signup that can never be confirmed collects addresses we may not use and leaves the visitor waiting for an email that never comes.
- Every accepted signup gets the same reply, and the email goes out after the response. The form never reveals whether an address is listed. `planSignup` in `@erc/domain` decides what a signup does: a confirmed address is left alone, a pending one gets at most one email per 15 minutes, and an unsubscribed one must confirm again. No address gets more than two confirmation emails in any 24 hours, so the form cannot be used to mail one person over and over; the hourly cap counts both stored send times. Plus-addressed and dotted Gmail variants count as different addresses, so someone could still send a person a few extra emails; the per-sender and hourly caps bound it. The per-sender limit counts every address asked for, listed or not, so it cannot be used to probe the list.
- The server deletes expired rows as it starts and every hour after (`schedulePurge`, started from `instrumentation.ts`, so no cron is needed). An address left unconfirmed for 30 days is deleted, so an address someone else typed in does not stay on file. An unsubscribed address is deleted once its last confirmation email is a day old, when the two-a-day limit no longer needs it; unsubscribing stops all email at once. Confirmed subscribers stay until they unsubscribe or staff delete them.
- Confirming and unsubscribing happen on a button press, not on opening the link. Mail scanners open links before people do, and would otherwise use up the single-use link or unsubscribe the reader.
- Nobody can create or edit a subscriber through the admin or REST API, so every subscriber went through double opt-in. Staff can delete a subscriber to erase them.
- Admins download confirmed subscribers as CSV from the Subscribers list in the admin, or from `GET /api/subscribers/export.csv` while signed in. Editors, authors and anonymous requests get 403, and only admins see the button.

## Privacy notice

`/privacy` is the club's notice under section 5 of the Digital Personal Data Protection Act, 2023: what the site collects, why, how long it is kept, who processes it, and how to ask for access, correction, or erasure through `/contact`. The footer, the newsletter form, the contact form, and the confirmation email link to it, and the sitemap lists it. Its retention periods are read from the same constants the code uses. When the notice's text changes, change `PRIVACY_NOTICE.updated` in `site-nav.ts`.

Check the whole flow, and both forms' hourly email caps, against a running site whose SMTP points at a local Mailpit and which shares `ENQUIRY_NOTIFY_TO` with the check:

```sh
ERC_CHECK_URL=http://localhost:3986 MAILPIT_URL=http://localhost:18025 pnpm --filter @erc/web payload run src/scripts/check-newsletter.ts
```
