# Analytics and newsletter signup

Status: built 2026-10-20 (Phase 1, workstream W5b). Read with the [Phase 1 design](20261019-erc-phase-1-design.md).

## Analytics: Umami on its own hostname

Umami 3.4.0 (MIT, cookieless) runs as `erc-umami` in the `erc` compose project. Its data lives in a `umami` database owned by a `umami` role inside `erc-postgres`, so the host's nightly `pg_dumpall` already backs it up. The `umami` role cannot connect to the `erc` database.

```
 browser ──> erc.<domain>        ─┐                          ┌─> erc-web:3000
                                   ├─ Cloudflare Tunnel ──────┤
 browser ──> erc-stats.<domain>  ─┘  (script.js, /api/send,   └─> erc-umami:3000 ──> erc-postgres (db umami)
             staff ──> dashboard      dashboard)
```

The tracker loads from Umami's own hostname, which also serves the dashboard. A same-origin proxy route in `erc-web` was rejected for these reasons:

- The dashboard needs a hostname anyway. Umami's `BASE_PATH` is fixed when its image is built **[I]**, so the dashboard cannot live under a path of the site without building our own image.
- Page-view beacons never touch `erc-web`, which is capped at one CPU and 768 MB.
- There is no proxy code to maintain, and Umami answers the cross-origin beacons itself.

The cost is one more tunnel route and DNS record, and some content blockers may block a cross-site analytics host **[G]**. Use a one-level name such as `erc-stats.gilla.fun`, so Cloudflare's free certificate covers it.

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

### Set up Umami on the server

1. Add `UMAMI_DB_PASSWORD` (`openssl rand -hex 24`) and `UMAMI_APP_SECRET` (`openssl rand -hex 32`) to `~/erc/.env`. Every deploy now fails until both are set.
2. Deploy. `deploy.sh` creates the `umami` role and database if missing and starts `erc-umami`.
3. Umami starts with the login `admin` / `umami`, so change it before the dashboard is public. On the host, get the container's address with `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' erc-umami`. From the workstation, run `ssh -L 3001:<address>:3000 <host>`, open `http://localhost:3001`, sign in, and change the password.
4. Add the tunnel route `erc-stats.<domain>` to `http://erc-umami:3000` in the host's `cloudflared.yml`, add its DNS record, and restart `erc-cloudflared`. Consider a Cloudflare Access policy on that hostname, with bypass rules for `/script.js` and `/api/send`, which every visitor's browser must reach **[I]**.
5. In the dashboard, add a website with the site's domain. Copy its website id.
6. Set `UMAMI_URL=https://erc-stats.<domain>` and `UMAMI_WEBSITE_ID=<id>` in `~/erc/.env`, then run `docker compose up -d erc-web`. No rebuild is needed.

## Newsletter signup

Signup only, with double opt-in. Sending issues comes later with listmonk.

```
 footer form ──POST──> receiveSignup ──> subscribers (pending, sha256 of token, expiry)
                                     └─> after the response: email with confirm and unsubscribe links
 /newsletter/confirm?token=…      GET shows a button; POST confirms once, within 48 hours
 /newsletter/unsubscribe?token=…  GET shows a button; POST unsubscribes (signed link, never expires)
```

- The form is in the footer of every page and works without JavaScript. It reuses the contact form's honeypot, signed time token, and per-sender limit (five signups an hour), from `src/content/form-guard.ts`. Confirmation emails are also capped at 15 an hour site-wide; past that every signup is asked to try again later (see the Phase 1 design).
- The form appears only when SMTP is configured, decided per request. A signup that can never be confirmed collects addresses we may not use and leaves the visitor waiting for an email that never comes.
- Every accepted signup gets the same reply, and the email goes out after the response. The form never reveals whether an address is listed. `planSignup` in `@erc/domain` decides what a signup does: a confirmed address is left alone, a pending one gets at most one email per 15 minutes, and an unsubscribed one must confirm again. The per-sender limit counts every address asked for, listed or not, so it cannot be used to probe the list.
- An address left unconfirmed for 30 days is deleted at the next signup, so an address someone else typed in does not stay on file.
- Confirming and unsubscribing happen on a button press, not on opening the link. Mail scanners open links before people do, and would otherwise use up the single-use link or unsubscribe the reader.
- Nobody can create or edit a subscriber through the admin or REST API, so every subscriber went through double opt-in. Staff can delete a subscriber to erase them.
- Admins download confirmed subscribers as CSV from the Subscribers list in the admin, or from `GET /api/subscribers/export.csv` while signed in. Editors, authors and anonymous requests get 403, and only admins see the button.

Check the whole flow, and both forms' hourly email caps, against a running site whose SMTP points at a local Mailpit and which shares `ENQUIRY_NOTIFY_TO` with the check:

```sh
ERC_CHECK_URL=http://localhost:3986 MAILPIT_URL=http://localhost:18025 pnpm --filter @erc/web payload run src/scripts/check-newsletter.ts
```
