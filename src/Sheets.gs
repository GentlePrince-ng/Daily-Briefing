/* ================================
 * SHEETS, ROWS AND GENERAL UTILITIES
 * ================================ */

/**
 * Pure: the one place a Messages row is assembled, so every source (Slack,
 * demo, anything added later) writes identical columns in identical order.
 */
function buildMessageRow_(m) {
  const row = new Array(BASE_HEADERS.Messages.length).fill('');
  // A leading apostrophe stores the value as text. Without it Sheets turns a
  // Slack ts like 1729150000.123456 into a rounded number (breaking
  // de-duplication) and "07:02:00" into a 1899 date.
  row[MSG_COL['Message ID']] = `'${m.id}`;
  row[MSG_COL['Message Date']] = m.date;
  row[MSG_COL['Message Time']] = m.time ? `'${m.time}` : '';
  row[MSG_COL['ISO Datetime']] = m.iso || '';
  row[MSG_COL['Channel ID']] = m.channelId || '';
  row[MSG_COL['Sender ID']] = m.senderId || '';
  row[MSG_COL['Sender Name']] = m.senderName || '';
  row[MSG_COL['Sender Type']] = m.senderType || '';
  row[MSG_COL['Message Text']] = m.text || '';
  row[MSG_COL['Message URL']] = m.url || '';
  row[MSG_COL['Thread TS']] = m.threadTs || '';
  row[MSG_COL['Is Thread Reply']] = Boolean(m.threadTs);
  row[MSG_COL['Reply Count']] = Number(m.replyCount || 0);
  row[MSG_COL['Reaction Count']] = Number(m.reactionCount || 0);
  row[MSG_COL['Attachment/File Links']] = (m.links || []).join('\n');
  row[MSG_COL['Raw JSON']] = JSON.stringify(m.raw || {}).substring(0, 49000);
  row[MSG_COL['AI Classified']] = false;
  row[MSG_COL['Ingested At']] = new Date();
  row[MSG_COL['AI Batch ID']] = '';
  row[MSG_COL['Source']] = m.source || '';
  return row;
}

/**
 * Pure: one Topics row per classification. Profile dimensions land in the
 * columns buildTopicHeaders_ created for them, in the same order.
 */
function buildTopicRow_(c, date, profile, batchId, now) {
  return [String(c.message_id), date, c.primary_theme || '', (c.secondary_themes || []).join('; ')]
    .concat((profile.dimensions || []).map(d => c[d.key] || ''))
    .concat([c.sentiment || '', c.risk_level || '', c.newsworthiness || '',
      Number(c.confidence || 0), c.rationale || '', batchId, now, profile.id]);
}

function writeClassifications_(spreadsheetId, messageRows, classifications, batchId, profile) {
  const dateById = new Map(messageRows.map(r =>
    [String(r[MSG_COL['Message ID']]), r[MSG_COL['Message Date']]]));
  const now = new Date();
  const topicRows = [];
  const entityRows = [];
  let unknownIds = 0;

  classifications.forEach(c => {
    const id = String(c.message_id);
    if (!dateById.has(id)) {
      unknownIds++; // the model returned an id it was never given — drop it
      return;
    }
    const date = dateById.get(id);
    topicRows.push(buildTopicRow_(c, date, profile, batchId, now));
    (c.entities || []).forEach(e => {
      entityRows.push([id, date, e.name || '', e.type || '', e.location || '', batchId, now]);
    });
  });

  ensureSheet_(SpreadsheetApp.openById(spreadsheetId), CONFIG.TOPIC_SHEET, buildTopicHeaders_(profile));
  if (topicRows.length) appendRows_(spreadsheetId, CONFIG.TOPIC_SHEET, topicRows);
  if (entityRows.length) appendRows_(spreadsheetId, CONFIG.ENTITY_SHEET, entityRows);
  if (unknownIds) log_('writeClassifications', 'WARN', `Dropped ${unknownIds} classification(s) with unknown message ids.`);
  return { written: topicRows.length, unknownIds: unknownIds };
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    const current = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    if (current.join('|') !== headers.join('|') && name === CONFIG.TOPIC_SHEET) {
      // A profile switch changes the Topics columns. Refuse to mix layouts in
      // one sheet: rename the old one and start fresh.
      sheet.setName(`${name} (${current.length} cols, archived ${new Date().toISOString().substring(0, 10)})`);
      return ensureSheet_(ss, name, headers);
    }
  }
  return sheet;
}

function appendRows_(spreadsheetId, sheetName, rows) {
  if (!rows.length) return;
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function markRowsClassified_(spreadsheetId, ids, batchId) {
  const wanted = new Set(ids.map(String));
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(CONFIG.MESSAGE_SHEET);
  if (sheet.getLastRow() < 2) return;
  const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, BASE_HEADERS.Messages.length);
  const values = range.getValues();
  let changed = false;
  values.forEach(row => {
    if (wanted.has(String(row[MSG_COL['Message ID']]))) {
      row[MSG_COL['AI Classified']] = true;
      row[MSG_COL['AI Batch ID']] = batchId;
      changed = true;
    }
  });
  if (changed) range.setValues(values);
}

function appendSummaryMetadata_(spreadsheetId, row) {
  appendRows_(spreadsheetId, CONFIG.SUMMARY_SHEET, [row]);
}

function getExistingMessageIds_(spreadsheetId) {
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(CONFIG.MESSAGE_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return new Set();
  return new Set(sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().flat().map(String));
}

function getMessagesForDate_(spreadsheetId, targetDate) {
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(CONFIG.MESSAGE_SHEET);
  if (!sheet) throw new Error(`Sheet "${CONFIG.MESSAGE_SHEET}" was not found. Run setupSystem().`);
  if (sheet.getLastRow() < 2) return [];
  const tz = getTimezone_();
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, BASE_HEADERS.Messages.length).getValues()
    .filter(row => normaliseSheetDate_(row[MSG_COL['Message Date']], tz) === targetDate);
}

function getLatestSuccessfulSummaryMetadata_(spreadsheetId, summaryDate) {
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(CONFIG.SUMMARY_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const tz = getTimezone_();
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (normaliseSheetDate_(values[i][0], tz) === summaryDate && values[i][3] === true) {
      return { rowNumber: i + 2, messages: Number(values[i][1] || 0), uniqueStories: Number(values[i][2] || 0) };
    }
  }
  return null;
}

function markSummaryEmailed_(spreadsheetId, summaryDate, recipients) {
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(CONFIG.SUMMARY_SHEET);
  ensureAdditionalHeaders_(sheet, ['Email Sent', 'Email Sent At', 'Email Recipients']);
  const meta = getLatestSuccessfulSummaryMetadata_(spreadsheetId, summaryDate);
  if (!meta) return;
  const headerMap = getHeaderMap_(sheet);
  sheet.getRange(meta.rowNumber, headerMap['Email Sent']).setValue(true);
  sheet.getRange(meta.rowNumber, headerMap['Email Sent At']).setValue(new Date());
  sheet.getRange(meta.rowNumber, headerMap['Email Recipients']).setValue(recipients);
}

function ensureAdditionalHeaders_(sheet, headers) {
  const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(String);
  headers.forEach(h => {
    if (!existing.includes(h)) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(h);
      existing.push(h);
    }
  });
}

function getHeaderMap_(sheet) {
  const map = {};
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .forEach((h, i) => { map[String(h)] = i + 1; });
  return map;
}

/** Sheets turns '2026-10-17' into a Date; bring both forms back to yyyy-MM-dd. */
function normaliseSheetDate_(value, tz) {
  if (value instanceof Date) return Utilities.formatDate(value, tz || getTimezone_(), 'yyyy-MM-dd');
  return String(value || '').trim().substring(0, 10);
}

function getRequiredProperties_(names) {
  const props = PropertiesService.getScriptProperties().getProperties();
  const missing = names.filter(n => !props[n]);
  if (missing.length) throw new Error(`Missing Script Properties: ${missing.join(', ')}`);
  return props;
}

function dateWithOffset_(offsetDays) {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  return Utilities.formatDate(now, getTimezone_(), 'yyyy-MM-dd');
}

function formatHumanDate_(yyyyMmDd) {
  return Utilities.formatDate(new Date(`${yyyyMmDd}T12:00:00Z`), 'UTC', 'd MMMM yyyy');
}

/** Pure */
function escapeHtml_(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function log_(fn, status, details) {
  console.log(`[${status}] ${fn}: ${details}`);
  try {
    const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (id) appendRows_(id, CONFIG.LOG_SHEET, [[new Date(), fn, status, String(details).slice(0, 50000)]]);
  } catch (_) {}
}
