# Daily Briefing

**Turn a noisy stream of mentions into one decision-ready brief every morning.**

An automated monitoring channel (media alerts, social mentions, review
sites, support tickets, a regulator's feed) produces hundreds of
duplicated, syndicated and half-relevant messages a day. Someone usually
reads them all and hand-writes a summary. This pipeline does that job:

```
 firehose channel ──► Google Sheet ──► Gemini (structured output) ──► Google Doc brief ──► PDF by email
   (Slack / demo)     single source       taxonomy from the             one section            that day
                      of truth            active PROFILE                per day                only
```

Each night it deduplicates the day's messages into stories, classifies
every message against a taxonomy you choose, writes a formatted **Daily
Intelligence Brief** into a Google Doc, records per-message
classifications and entities in Sheets for trend analysis, and emails a
one-day PDF the next morning.

It runs entirely on Google Apps Script plus a Gemini API key: no server,
no database, no hosting bill.

> **Origin.** I first built this for a health-sector communications team
> whose daily media-monitoring summary was being written by hand. This
> repository is a generalised rewrite. The organisation's branding,
> prompts, taxonomy and data have been removed, and the domain logic now
> lives in swappable profiles.

---

## The engine is the pattern, not the topic

Only `src/Profiles.gs` knows what the brief is about. Five profiles ship
with the repo:

| Profile | Reads | Decides |
|---|---|---|
| `brand-reputation` *(default)* | news, social, review sites | what to respond to today |
| `policy-regulatory` | gazettes, regulator notices, legislative news | which rules need a position or submission |
| `competitor-intel` | launches, pricing, funding and hiring news | where to respond in the market |
| `customer-feedback` | support tickets, app reviews, community posts | what to fix, escalate or answer first |
| `public-health` | health news, surveillance and policy signals | what to verify, cover or raise with officials |

Other fits for the same engine: newsroom wire and tip-line digests,
donor and funding-opportunity scans for NGOs, internal Slack or Teams
digests for leadership, and ESG or supply-chain risk monitoring.

A profile is about 30 lines. It sets the analyst's role, the audience,
what to prioritise, a closed list of themes, extra classification fields
(each becomes a column), entity types and the brief's sections. See
[Adding a profile](#adding-a-profile).

---

## Sample output

**[examples/sample-brief.pdf](examples/sample-brief.pdf)** is a real,
unedited run of the default `brand-reputation` profile over the synthetic
demo feed, using Gemini 3.1 Flash-Lite. It is three pages: 32 messages
deduplicated into stories, the unverified "battery fire" rumour kept as
unverified with a verification step, the competitor's sales figure labelled
self-reported, and follow-ups tied to the dates in the feed. Every message
was also classified into the Topics and Entities sheets.

The feed is fictional, so the brief is too. It shows the format and the
reasoning discipline, not real-world findings.

---

## Try it in 10 minutes (demo mode, no Slack needed)

The repo includes a **synthetic one-day feed**: 32 messages about a
fictional scooter company in a fictional city. It contains syndicated
duplicates, an unverified rumour, a competitor launch, a regulator signal
and plenty of noise. Every name and link is invented, and the links use
the reserved `example.com` and `example.org` domains.

1. Create a **Google Sheet** and a **Google Doc**. In the Doc, add a tab
   named exactly `Daily Intelligence Brief`.
2. Open the Sheet → *Extensions → Apps Script*. Copy every file from
   `src/` into the project, and replace `appsscript.json` with `src/appsscript.json` from
   this repo (*Project Settings → Show manifest*). Or use
   [clasp](https://github.com/google/clasp): `clasp create`, then `clasp push`.
3. *Project Settings → Script Properties*, add:
   - `SPREADSHEET_ID`: the ID from the Sheet's URL
   - `DOCUMENT_ID`: the ID from the Doc's URL
   - `GEMINI_API_KEY`: from [Google AI Studio](https://aistudio.google.com/)
   - `TIMEZONE`: e.g. `Africa/Lagos` or `Europe/London` (optional)
4. Run `setupSystem()` once and approve the permissions.
5. Run `runDemo()`. The brief appears in the Doc tab, and the Topics and
   Entities sheets fill with classifications.

To switch domain, set `PROFILE` to another profile id and run
`setupSystem()` again. The old Topics sheet is archived rather than mixed
with the new columns.

---

## Going live with Slack

Add a Slack app with the bot scopes `channels:history`, `users:read` and
`bots:read`, invite it to the monitoring channel, then set:

| Property | Purpose |
|---|---|
| `SLACK_BOT_TOKEN` | Bot token (`xoxb-…`) |
| `SLACK_CHANNEL_ID` | Channel to poll |
| `SLACK_WORKSPACE_URL` | e.g. `https://yourteam.slack.com`, used for permalinks in Source Notes |
| `EMAIL_RECIPIENTS` | Comma-separated To: list. The email trigger is installed only when this is set |

Re-run `setupSystem()`. It installs three triggers: Slack sync (every
minute by default), brief generation at 00:10, and email at 07:00 (local
time).

**Optional:** `PROFILE`, `GEMINI_MODEL`, `SOURCE` (`slack` / `demo`),
`SLACK_SYNC_MINUTES` (`1`, `5`, `10`, `15` or `30`; default `1`),
`EMAIL_CC`, `EMAIL_BCC`, `EMAIL_REPLY_TO`, `EMAIL_SUBJECT_PREFIX`,
`EMAIL_SENDER_NAME`, and the letterhead settings `BRAND_PRIMARY`,
`BRAND_DARK`, `BRAND_ACCENT`, `BRAND_LOGO_URL` and `BRAND_FOOTER`.

**No secrets live in source.** Every token, key, ID and email address is
read from Script Properties at runtime, and `.gitignore` blocks the usual
credential files as a backstop.

---

## Design decisions worth knowing

**Built around Slack's 2025–26 rate limit, not against it.** Since 29 May
2025 Slack has capped `conversations.history` at 15 messages per request
and one request per minute for any app that isn't an internal custom app
or an approved Marketplace app. The grace period for existing installs
ended on 3 March 2026. The sync pages through Slack's cursor until it
catches up, hits a page ceiling or gets a 429. It saves its cursor and
resumes on the next one-minute trigger. On the restricted tier it usually
stops after one page; that is expected, not a failure.

**A backlog can't silently drop messages.** The "already synced"
watermark only moves once a whole catch-up sequence has finished. A
large backlog that takes several minutes to drain is therefore never
skipped.

**The model gets a schema, not a wish.** The structured-output schema is
generated from the profile. Themes, entity types and enumerated fields are
closed lists, and every profile field is required. A classification
carrying a message id the model was never given is dropped and logged,
not written.

**Truncation is visible.** If a day's input exceeds the character budget,
whole messages are dropped (never cut in half). The brief and its
metadata table then say that coverage was partial.

**One day per PDF, located by structure.** Each day's section starts with
a "Reporting Date" table, and the PDF export uses those tables as anchors
to copy exactly one day. If the day can't be found, it attaches the most
recent day and logs an error. It never emails the whole cumulative
document.

**Missed nights can be refilled.** The brief runs on yesterday's data, so
a failed night would leave a permanent gap. `Backfill.gs` regenerates
chosen dates through the same code path as the live run. It also has a
dry run that writes to a throwaway Doc and touches nothing real.

**Profiles are validated before they reach the model.** A malformed
profile fails with a clear message when you run `setupSystem()`, rather
than as a confusing API error at midnight.

---

## Adding a profile

Add an entry to `PROFILES` in `src/Profiles.gs`:

```js
'energy-regulatory': {
  label: 'Energy regulation watch',
  analystRole: 'the energy policy analyst',
  audience: 'the regulatory affairs team, who decide which consultations to answer',
  focus: ['tariff decisions', 'licensing rounds', 'grid and metering rules'],
  themes: ['Tariffs', 'Licensing', 'Grid & Metering', 'Subsidy', 'Enforcement', 'Other'],
  dimensions: [
    { key: 'regulator', header: 'Regulator', description: 'Issuing body' },
    { key: 'stage', header: 'Stage', description: 'Lifecycle stage',
      enum: ['Proposed', 'Consultation', 'Final', 'In Force'] },
  ],
  entityTypes: ['Regulator', 'Utility', 'Government', 'Company', 'Person', 'Other'],
  sections: ['Tariff and Pricing Decisions', 'Consultations Closing Soon', 'Positions to Consider'],
},
```

Run `npm test`. It validates every profile and checks that its Topics
columns line up.

---

## Repository layout

```
src/
  Config.gs        constants, neutral house style, Messages column map
  Profiles.gs      the taxonomies and brief shapes, plus validation
  Setup.gs         setupSystem(), triggers, source selection
  SourceSlack.gs   rate-limit-aware Slack ingestion
  SourceDemo.gs    synthetic feed and runDemo()
  Brief.gs         prompt, schema, Gemini call, nightly generation
  DocRender.gs     Markdown → styled Google Doc (banner, callout, links)
  Email.gs         one-day PDF export and distribution
  Backfill.gs      regenerate missed days, plus a dry run
  Sheets.gs        row builders, sheet I/O, utilities
tests/             Node tests for the pure logic (no Google services needed)
examples/          sample brief from a real demo run
  appsscript.json  manifest with explicit OAuth scopes
```

## Tests

```
npm test
```

The tests load every `.gs` file into one sandbox, the way Apps Script
shares a single global scope, and cover the logic that doesn't need
Google services:
- profile validation, the generated schema and prompt structure;
- input budgeting and Gemini response handling;
- Slack message parsing;
- Markdown rendering decisions;
- PDF day-location;
- backfill date handling;
- the demo feed (fictional URLs only, rows matching the sheet layout).

Code that touches Sheets, Docs, Gmail or `UrlFetchApp` is checked by
running the demo end to end in a real project.

## Limits and responsible use

- **The brief is AI-generated.** The prompt forbids invented facts,
  requires uncertainty to be stated and asks for source links. It still
  needs a human editor before it informs a public statement or decision.
  The email footer says so.
- **Data leaves Google Workspace for the Gemini API.** Check that this
  fits your data-handling rules before pointing it at private channels or
  customer data, and prefer a paid tier where prompts are not used for
  training.
- **Apps Script quotas apply.** A one-minute sync is about 1,440 trigger
  runs a day. That is fine on Google Workspace, but on a free consumer
  account it can approach the 90-minute daily trigger-runtime quota. Set
  `SLACK_SYNC_MINUTES` to `5` or more there. Daily email-recipient limits
  apply too.
- **Sentiment and risk labels are model judgements**, not measurements.
  Sample them and spot-check them before reporting trends.

## How this was built

I designed the architecture, the profile model, the failure handling and
the tests. I used AI coding assistants for parts of the implementation,
and I reviewed and tested what they produced.

## License

MIT. See [LICENSE](LICENSE).
