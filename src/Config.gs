/**
 * DAILY BRIEFING — firehose channel → taxonomy → daily decision brief
 *
 * A Google Apps Script pipeline that:
 *   1. ingests a stream of short messages (a Slack channel, or the bundled
 *      synthetic demo feed) into a Google Sheet that is the single source of
 *      truth;
 *   2. once a day, sends that day's messages to Gemini with a structured-output
 *      schema built from the active PROFILE (taxonomy + brief sections);
 *   3. writes a formatted Daily Intelligence Brief into a Google Doc tab and the
 *      per-message classifications into Sheets;
 *   4. exports that single day as a PDF and emails it.
 *
 * Everything domain-specific lives in Profiles.gs. Everything secret or
 * deployment-specific lives in Script Properties (see README.md). Nothing in
 * this file identifies an organisation.
 */

const CONFIG = {
  MESSAGE_SHEET: 'Messages',
  TOPIC_SHEET: 'Topics',
  ENTITY_SHEET: 'Entities',
  SUMMARY_SHEET: 'Daily Summary Metadata',
  LOG_SHEET: 'Processing Log',

  DOC_SUMMARY_TAB_TITLE: 'Daily Intelligence Brief',

  SLACK_HISTORY_URL: 'https://slack.com/api/conversations.history',
  SLACK_USERS_URL: 'https://slack.com/api/users.info',
  SLACK_BOTS_URL: 'https://slack.com/api/bots.info',

  GEMINI_API_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models',
  // Low-cost model with structured-output support. Override with the
  // GEMINI_MODEL Script Property without touching code.
  DEFAULT_GEMINI_MODEL: 'gemini-3.1-flash-lite',

  // Since 29 May 2025 Slack caps conversations.history at 15 objects per
  // request and one request per minute for any app that is NOT an internal,
  // single-workspace custom app or an approved Marketplace app; the grace
  // period for existing installs ended 3 March 2026. Raising this above 15
  // will not return more messages on that tier — Slack silently caps `limit`
  // and answers faster calls with HTTP 429. Internal custom apps are exempt
  // and can raise it.
  SLACK_PAGE_SIZE: 15,
  // A sync run keeps paging until it catches up, hits this many pages, or is
  // rate-limited — whichever comes first — then resumes on the next trigger.
  MAX_PAGES_PER_RUN: 20,

  // The brief covers the previous calendar day. Use 0 for "today so far".
  SUMMARY_DAY_OFFSET: -1,
  // Hard ceiling on the JSON sent to the model; the brief records when the
  // day's input was truncated so a reader knows coverage was partial.
  MAX_AI_INPUT_CHARS: 180000,

  EMAIL_SEND_HOUR: 7,
  EMAIL_SEND_MINUTE: 0,
  DEFAULT_SENDER_NAME: 'Daily Briefing',
};

/**
 * Neutral house style. Override the three colours and the letterhead with
 * Script Properties (BRAND_PRIMARY, BRAND_DARK, BRAND_ACCENT, BRAND_LOGO_URL,
 * BRAND_FOOTER) so a deployment can carry its own identity without a code
 * change.
 */
const DEFAULT_BRAND = {
  PRIMARY: '#2F6FED',
  DARK: '#1B2A4A',
  ACCENT: '#6FA8FF',
  NEAR_BLACK: '#111418',
  MUTED: '#5B6576',
  CALLOUT_BG: '#EEF3FD',
  METADATA_LABEL_BG: '#F2F4F7',
  HEADING_SIZES: { 1: 16, 2: 13, 3: 11.5 },
};

const BASE_HEADERS = {
  Messages: [
    'Message ID', 'Message Date', 'Message Time', 'ISO Datetime', 'Channel ID',
    'Sender ID', 'Sender Name', 'Sender Type', 'Message Text', 'Message URL',
    'Thread TS', 'Is Thread Reply', 'Reply Count', 'Reaction Count',
    'Attachment/File Links', 'Raw JSON', 'AI Classified',
    'Ingested At', 'AI Batch ID', 'Source'
  ],
  Entities: [
    'Message ID', 'Message Date', 'Entity Name', 'Entity Type',
    'Location', 'AI Batch ID', 'Extracted At'
  ],
  Summary: [
    'Summary Date', 'Messages Included', 'Unique Stories', 'Generated',
    'AI Batch ID', 'Word Count', 'Generation Time Seconds',
    'Doc Tab ID', 'Generated At', 'Error', 'Profile', 'Input Truncated'
  ],
  Log: ['Timestamp', 'Function', 'Status', 'Details']
};

// Zero-based column positions in the Messages sheet, so no function relies on
// a magic number that silently breaks when a column is added.
const MSG_COL = BASE_HEADERS.Messages.reduce((acc, header, i) => {
  acc[header] = i;
  return acc;
}, {});

/** Script time zone unless a TIMEZONE Script Property overrides it. */
function getTimezone_() {
  const override = PropertiesService.getScriptProperties().getProperty('TIMEZONE');
  return override || Session.getScriptTimeZone();
}

function getBrand_() {
  const p = PropertiesService.getScriptProperties().getProperties();
  return Object.assign({}, DEFAULT_BRAND, {
    PRIMARY: p.BRAND_PRIMARY || DEFAULT_BRAND.PRIMARY,
    DARK: p.BRAND_DARK || DEFAULT_BRAND.DARK,
    ACCENT: p.BRAND_ACCENT || DEFAULT_BRAND.ACCENT,
    LOGO_URL: p.BRAND_LOGO_URL || '',
    FOOTER: p.BRAND_FOOTER || '',
  });
}
