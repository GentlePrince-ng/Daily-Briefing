/* ================================
 * ONE-TIME SETUP AND TRIGGERS
 * ================================ */

/**
 * Creates the sheets, initialises the Doc tab and installs triggers.
 * Safe to re-run. In demo mode (SOURCE = demo, the default when no Slack
 * token is set) no Slack trigger is installed.
 */
function setupSystem() {
  const props = getRequiredProperties_(['SPREADSHEET_ID', 'DOCUMENT_ID', 'GEMINI_API_KEY']);
  const profile = getActiveProfile_();
  const source = getSource_();
  if (source === 'slack') getRequiredProperties_(['SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID']);

  const ss = SpreadsheetApp.openById(props.SPREADSHEET_ID);
  ensureSheet_(ss, CONFIG.MESSAGE_SHEET, BASE_HEADERS.Messages);
  ensureSheet_(ss, CONFIG.TOPIC_SHEET, buildTopicHeaders_(profile));
  ensureSheet_(ss, CONFIG.ENTITY_SHEET, BASE_HEADERS.Entities);
  ensureSheet_(ss, CONFIG.SUMMARY_SHEET, BASE_HEADERS.Summary);
  ensureSheet_(ss, CONFIG.LOG_SHEET, BASE_HEADERS.Log);

  const doc = DocumentApp.openById(props.DOCUMENT_ID);
  const tab = getDocTabByTitle_(doc, CONFIG.DOC_SUMMARY_TAB_TITLE);
  PropertiesService.getScriptProperties().setProperty('DOC_SUMMARY_TAB_ID', tab.getId());
  initialiseDocTab_(tab.asDocumentTab().getBody(), 'Daily Intelligence Brief',
    `Automated daily synthesis — ${profile.label}.`);

  installTriggers();
  log_('setupSystem', 'SUCCESS', `Configured for profile "${profile.id}", source "${source}".`);
}

/** Reinstalls this project's triggers (removing only its own). */
function installTriggers() {
  const handlers = new Set(['syncSlackMessages', 'generateDailyIntelligenceBrief', 'sendDailyBriefEmail']);
  ScriptApp.getProjectTriggers()
    .filter(t => handlers.has(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));

  const tz = getTimezone_();
  if (getSource_() === 'slack') {
    ScriptApp.newTrigger('syncSlackMessages').timeBased().everyMinutes(getSyncMinutes_()).create();
  }
  ScriptApp.newTrigger('generateDailyIntelligenceBrief').timeBased()
    .atHour(0).nearMinute(10).everyDays(1).inTimezone(tz).create();

  if (PropertiesService.getScriptProperties().getProperty('EMAIL_RECIPIENTS')) {
    ScriptApp.newTrigger('sendDailyBriefEmail').timeBased()
      .atHour(CONFIG.EMAIL_SEND_HOUR).nearMinute(CONFIG.EMAIL_SEND_MINUTE)
      .everyDays(1).inTimezone(tz).create();
  }
}

/**
 * Sync interval in minutes. One minute matches Slack's restricted-tier pace
 * but uses ~1,440 trigger runs a day; on a consumer Google account (90 min/day
 * trigger runtime) set SLACK_SYNC_MINUTES to 5 or more.
 */
function getSyncMinutes_() {
  return normaliseSyncMinutes_(PropertiesService.getScriptProperties().getProperty('SLACK_SYNC_MINUTES'));
}

/** Pure: everyMinutes() only accepts 1, 5, 10, 15 or 30. */
function normaliseSyncMinutes_(value) {
  const allowed = [1, 5, 10, 15, 30];
  const n = Number(value || 1);
  if (!allowed.includes(n)) throw new Error(`SLACK_SYNC_MINUTES must be one of ${allowed.join(', ')}; got "${value}".`);
  return n;
}

/** 'slack' when configured, else 'demo'. Override with the SOURCE property. */
function getSource_() {
  const p = PropertiesService.getScriptProperties().getProperties();
  if (p.SOURCE) return String(p.SOURCE).toLowerCase();
  return p.SLACK_BOT_TOKEN ? 'slack' : 'demo';
}

function getDocTabByTitle_(doc, title) {
  const tab = flattenTabs_(doc.getTabs()).find(t => t.getTitle() === title);
  if (!tab) throw new Error(`Google Docs tab "${title}" was not found. Create it, then rerun setupSystem().`);
  return tab;
}

function flattenTabs_(tabs) {
  const out = [];
  tabs.forEach(tab => {
    out.push(tab);
    const children = tab.getChildTabs();
    if (children && children.length) out.push(...flattenTabs_(children));
  });
  return out;
}
