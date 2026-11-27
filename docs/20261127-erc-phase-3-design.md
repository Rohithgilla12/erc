# ERC Phase 3: intake, reviews, nearest races, and news

Status: design of record, 2026-11-27. It builds on [Phase 1](20261019-erc-phase-1-design.md) and [Phase 2](20261021-erc-phase-2-design.md) and uses their evidence labels. **[V]** means verified, **[I]** means inferred, and **[G]** means a guess.

## What the founder asked for, and what this phase builds

A recent founder meeting asked for a human-coaching-led platform with content, reviews, onboarding, and a coaching loop. This phase builds the parts that fit the zero-cost, volunteer-run constraint.

| Asked for | This phase | Later, or not at all |
|---|---|---|
| Runner intake questionnaire | Built. Private to the runner and, by their choice, their linked coach. | |
| Shoe and event reviews | Built. Moderated, one review per member per shoe or race. | |
| Q&A on event pages | Built. Members ask, staff and coaches answer, staff moderate. | |
| Nearest events for the athlete's location | Built. City picked by the runner, distance from a fixed city table. | IP geolocation. |
| News, auto-retrieved by an agent | Staff-curated news items. | The fetching agent. It costs model tokens and its output still needs a human check. |
| AI prompts on shoe pages | Not built. | Needs a paid model and a subscription tier, both undecided. |
| Coach registration fee, paid promotions | Not built. | Needs a payment provider; conflicts with zero running cost until the club decides. |
| Posture analysis, recorded coach calls | Not built. | Research item. |
| Cross-qualification queries | Not built. | Needs qualifying standards per race, which nobody holds yet. |

## Step 1. Intake: one private record per member

```
member ──fills /me/intake──> intakes (one row per member, overwritten on re-take)
                                │
                                ├── read by: the member, always
                                └── read by: their active coach, only if share_with_coach = true
```

The questions live in one typed table, `INTAKE_QUESTIONS`, in `@erc/domain`. Each entry names its key, label, kind (choice, number, time, text), and whether it is sensitive. The form, the parser, and the coach view all walk that table, so adding a question is one entry, not four edits.

**Storage.** A plain SQL table `intakes`, keyed by `member_id`, answers in a `jsonb` column parsed by the domain on every read, plus `share_with_coach`, `consented_at`, and `updated_at`. Like `check_ins`, it is not a Payload collection, so no admin screen or REST reply can ever show it.

| Question | Chosen | Alternative | Why |
|---|---|---|---|
| Columns or `jsonb`? | `jsonb`, parsed by the domain | One column per question | Questions will change with the coaches' feedback. A parser at the boundary keeps the type safety a column would give. |
| Keep history? | No. A re-take overwrites. | Versioned rows | It is an assessment snapshot, not a log. Fewer health records held means less to lose. |
| Staff can read it? | No. Only an admin can reassign a coach's member account, and doing so ends that coach's links and turns off sharing, so no one can take over a coach to read its athletes' intakes. | Staff read for support | Health data. Staff never need it, and DPDP asks for the narrowest purpose **[I]**. |

**Consent and wording.** The form asks for explicit consent to store health answers and says it is for assessment, not advice. Deleting the member deletes the row by cascade. The member can also clear it from `/me/intake`.

## Step 2. Reviews and questions: member words, moderated once

```
member ──writes──> reviews (subject: shoe | race) ──staff approve in /admin──> public on the subject page
member ──asks────> questions (race)               ──staff approve──────────> public, with staff/coach answer
```

Both are `defineRecord` collections with `visibility: 'moderated'`, so they reuse Phase 1's `decide()` and approval queue. Shoes are a new staff-curated `defineRecord` with `visibility: 'public'`: brand, model, category, a short description, an image.

| Question | Chosen | Alternative | Why |
|---|---|---|---|
| One review collection or two? | One, with `subject` as Payload's polymorphic relationship to `shoes` or `races` | `shoeReviews` and `raceReviews` | One moderation queue, one form, one renderer. The polymorphic relation enforces exactly one subject. |
| Author shown as | The member's approved athlete name, else "ERC member" | Free-text name | No new public name the club has not reviewed. |
| Edits after approval | A member edit sends the review back to pending | Edits go live | Same rule as Phase 2 profiles: new public words get one review. |
| Limits | One review per member per subject (unique index); 10 reviews and 10 questions an hour per member | None | Stops floods without a CAPTCHA. |
| Who answers questions | Staff in `/admin`, and coaches from `/me/coach/questions` | Any member | Answers about eligibility and readiness should come from someone accountable. |

## Step 3. Nearest races from a city table

```
runner picks a city (saved on member, or ?near=pune for anyone) ──> CITY_COORDINATES[city]
races already store location.city ─────────────────────────────────> CITY_COORDINATES[race city]
                                                     haversine ───> "Near you" list, sorted by km then date
```

`@erc/domain` gains `CITIES`, a table of about 80 Indian cities with latitude and longitude, and a pure `distanceKm`. A race whose city is not in the table falls back to its state's capital, so it still sorts, after exact matches at the same distance.

| Question | Chosen | Alternative | Why |
|---|---|---|---|
| Where the location comes from | The runner picks a city; members save it | Browser geolocation; IP lookup | Works without JavaScript, asks for no device permission, and costs nothing. |
| How races get coordinates | Lookup by city name | Geocode each race on save | No external geocoder, no API key, no outage path. |
| How far it scales | Sort in TypeScript over upcoming races | PostGIS | Upcoming races are a few hundred rows **[I]**; PostGIS would be a new extension for no measured gain. |

## Step 4. News is editorial content

News items are a new `defineEditorial` collection, `news`, so they inherit the Phase 1 workflow (draft, review, publish) and revalidation. Each item has a headline, a summary, a source URL, an optional related race, and a published date. `/news` lists them; the home page shows the latest three beside the nearest races.

## Content in this phase

- **Real races.** The synthetic calendar is replaced by real Indian races, each with an official URL and a `lastVerifiedOn` date. A seed script upserts them by slug and removes the synthetic rows.
- **Articles.** Six Learn posts written for Indian club runners go in as revisions in review, so staff read and publish them.

## Slices

| Slice | Owns | Depends on |
|---|---|---|
| Intake | `intakes` table, domain questions, `/me/intake`, coach view section | none |
| Reviews and Q&A | `shoes`, `reviews`, `questions`, `/shoes`, race page sections | none |
| Nearest and news | `CITIES`, member home city, `/races?near=`, `news`, `/news`, home page | none |
| Races content | real race fixture and seed script | none |
| Articles content | six posts and a seed script | none |

Each code slice writes its own hand-named migration. They merge one at a time, and `payload-types.ts` is regenerated after each merge.

## Trade-offs accepted

- **No auto-fetching news.** Staff add items by hand until the club decides to pay for an agent's tokens.
- **City-level location only.** "Near you" is as precise as the city the runner picks, which is enough to rank races hours apart.
- **Health data the club holds.** The intake stores sensitive answers. In exchange, coaches start from a real picture of the runner. It stays out of Payload, staff cannot read it, and deletion is immediate.

## Open questions

1. Should the intake be required before a member can request a coach, or stay optional?
2. Which shoes should staff seed first? This phase seeds none; reviews appear once staff add shoes.
3. Who in the club answers race questions, and how fast?
