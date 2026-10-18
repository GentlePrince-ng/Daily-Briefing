/* ================================
 * DAILY AI INTELLIGENCE BRIEF
 * ================================ */

/** Trigger entry point: brief for the previous day (see SUMMARY_DAY_OFFSET). */
function generateDailyIntelligenceBrief() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw new Error('Another automation is currently running and holding the script lock.');
  }
  try {
    generateBriefForDate_(dateWithOffset_(CONFIG.SUMMARY_DAY_OFFSET));
  } finally {
    lock.releaseLock();
  }
}

/**
 * Generates, writes and records one day's brief. Shared by the nightly
 * trigger and by Backfill.gs, so a backfilled day is produced by exactly the
 * same path as a live one. Returns a short status string.
 */
function generateBriefForDate_(summaryDate) {
  const started = Date.now();
  const batchId = Utilities.getUuid();
  const profile = getActiveProfile_();
  const props = getRequiredProperties_(['SPREADSHEET_ID', 'DOCUMENT_ID', 'DOC_SUMMARY_TAB_ID', 'GEMINI_API_KEY']);

  try {
    const rows = getMessagesForDate_(props.SPREADSHEET_ID, summaryDate);
    if (!rows.length) {
      appendSummaryMetadata_(props.SPREADSHEET_ID, [
        summaryDate, 0, 0, false, batchId, 0, (Date.now() - started) / 1000,
        props.DOC_SUMMARY_TAB_ID, new Date(), 'No messages found', profile.id, false
      ]);
      log_('generateBrief', 'SUCCESS', `No messages for ${summaryDate}.`);
      return 'no messages';
    }

    const input = buildAiInput_(rowsToRecords_(rows), CONFIG.MAX_AI_INPUT_CHARS);
    const prompt = buildBriefPrompt_(profile, summaryDate, input.json, input.truncated);
    const result = callGemini_(prompt, buildResponseSchema_(profile), props.GEMINI_API_KEY);

    writeDailyBriefToDoc_(props.DOCUMENT_ID, props.DOC_SUMMARY_TAB_ID, summaryDate,
      result.brief, rows.length, profile, input.truncated);
    const written = writeClassifications_(props.SPREADSHEET_ID, rows, result.classifications || [], batchId, profile).written;
    const coverage = classificationCoverage_(written, input.included);
    if (coverage < 0.9) {
      log_('generateBrief', 'WARN', `Only ${written} of ${input.included} messages classified (${Math.round(coverage * 100)}%).`);
    }
    markRowsClassified_(props.SPREADSHEET_ID, rows.map(r => r[MSG_COL['Message ID']]), batchId);

    const wordCount = String(result.brief || '').trim().split(/\s+/).filter(Boolean).length;
    appendSummaryMetadata_(props.SPREADSHEET_ID, [
      summaryDate, rows.length, Number(result.unique_story_count || 0), true, batchId,
      wordCount, (Date.now() - started) / 1000, props.DOC_SUMMARY_TAB_ID, new Date(), '',
      profile.id, input.truncated
    ]);
    log_('generateBrief', 'SUCCESS',
      `Generated ${summaryDate} brief from ${rows.length} messages (${profile.id}).`);
    return `ok — ${rows.length} messages, ${Number(result.unique_story_count || 0)} stories`;
  } catch (err) {
    try {
      appendSummaryMetadata_(props.SPREADSHEET_ID, [
        summaryDate, 0, 0, false, batchId, 0, (Date.now() - started) / 1000,
        '', new Date(), err.message, profile.id, false
      ]);
    } catch (_) {}
    log_('generateBrief', 'ERROR', err.stack || err.message);
    throw err;
  }
}

/** Pure: share of messages sent to the model that came back classified. */
function classificationCoverage_(written, sent) {
  return sent ? Math.min(written / sent, 1) : 1;
}

/** Pure: Messages-sheet rows → the compact records the model sees. */
function rowsToRecords_(rows) {
  return rows.map(row => ({
    message_id: String(row[MSG_COL['Message ID']]),
    date: row[MSG_COL['Message Date']],
    time: row[MSG_COL['Message Time']],
    sender: row[MSG_COL['Sender Name']],
    sender_type: row[MSG_COL['Sender Type']],
    text: row[MSG_COL['Message Text']],
    url: row[MSG_COL['Message URL']],
    links: row[MSG_COL['Attachment/File Links']],
  }));
}

/**
 * Pure: serialises records, dropping whole records (never cutting one in
 * half) once the character budget is reached, and reports truncation so the
 * brief can say coverage was partial instead of silently ignoring the tail.
 */
function buildAiInput_(records, maxChars) {
  const kept = [];
  let size = 2; // the surrounding []
  for (const r of records) {
    const piece = JSON.stringify(r);
    if (size + piece.length + 1 > maxChars) break;
    kept.push(r);
    size += piece.length + 1;
  }
  return { json: JSON.stringify(kept), included: kept.length, truncated: kept.length < records.length };
}

/** Pure: the full instruction for one day, built from the profile. */
function buildBriefPrompt_(profile, summaryDate, messagesJson, truncated) {
  const sections = BRIEF_OPENING_SECTIONS.concat(profile.sections, BRIEF_CLOSING_SECTIONS);
  const count = JSON.parse(messagesJson).length;
  const dims = (profile.dimensions || []).map(d =>
    `- ${d.key}: ${d.description}${d.enum ? ` (one of: ${d.enum.join(', ')})` : ''}`).join('\n');

  return `
You are ${profile.analystRole}. The brief is read by ${profile.audience}.

Analyse the monitored messages supplied below for ${summaryDate}. They come from an automated monitoring channel, so many are duplicated, syndicated, weakly relevant, or refer to the same underlying story.

Your tasks:
1. Deduplicate messages into underlying stories and report how many unique stories there are.
2. Prioritise:
${profile.focus.map(f => `   - ${f}`).join('\n')}
3. Distinguish confirmed developments from commentary, claims, rumours and emerging signals.
4. Do not invent facts. State uncertainty explicitly. Every claim in the brief must trace to at least one message.
5. Keep the brief decision-ready rather than merely descriptive.
6. Return exactly one classification for EVERY message_id in the input — ${count} messages, ${count} classifications — using each message_id exactly as given. Classify noise and off-topic messages too, with primary_theme "Other" and newsworthiness "Low".
7. Return only the requested structured JSON.

VERIFICATION AND ATTRIBUTION RULES:
- An unverified claim stays "unverified" until an official or clearly authoritative source confirms or refutes it. An anonymous reply, a single social post or hearsay does NOT settle it either way — say what would verify it.
- Attribute claims to the kind of source that made them: "one blog estimates", "the company says", "a regulator notice states". Never upgrade one source to "analysts", "reports" or "experts".
- Label figures that come only from the party that benefits from them (e.g. a company's own sales figure) as self-reported.

RECOMMENDED FOLLOW-UP must list concrete actions, each with the date or deadline from the messages where one exists, and must include verifying any open claim from the Risks section. Never invent a deadline: if the messages give no date, write "Ongoing".

SOURCE NOTES must list each story with links to the messages it draws on, using each message's url (or a URL from its links) as the target and a short readable label such as the outlet and headline — never a bare message_id.
${truncated ? '\nNOTE: the input was truncated to fit the model budget. Say in the Executive Summary that coverage for this day is partial.\n' : ''}
Classification fields specific to this monitoring profile:
${dims || '- (none)'}

FORMATTING RULES:
- Put every Markdown heading on its own line, with a blank line before and after it.
- Separate paragraphs with a blank line. Never return the brief as one block.
- Put every list item on its own line, starting with "- " or "1. ". Never run several numbered items together in one line.

The Markdown brief must use these headings, in this order:
# Daily Intelligence Brief — ${summaryDate}
${sections.map(s => `## ${s}`).join('\n')}

Under Source Notes, link back to the original messages where URLs are available.
Omit a section with no material signal, or state plainly that none was identified.
Do not repeat the same story in several sections unless analytically necessary.

Messages:
${messagesJson}
`.trim();
}

/** Pure: structured-output schema; profile dimensions become required fields. */
function buildResponseSchema_(profile) {
  const classificationProps = {
    message_id: { type: 'string' },
    primary_theme: { type: 'string', enum: profile.themes },
    secondary_themes: { type: 'array', items: { type: 'string' } },
    sentiment: { type: 'string', enum: ['Positive', 'Neutral', 'Negative', 'Mixed'] },
    risk_level: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] },
    newsworthiness: { type: 'string', enum: ['Low', 'Medium', 'High'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    rationale: { type: 'string' },
    entities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'type', 'location'],
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: profile.entityTypes },
          location: { type: 'string' },
        },
      },
    },
  };
  (profile.dimensions || []).forEach(d => {
    classificationProps[d.key] = d.enum ? { type: 'string', enum: d.enum } : { type: 'string' };
  });

  return {
    type: 'object',
    additionalProperties: false,
    required: ['brief', 'unique_story_count', 'classifications'],
    properties: {
      brief: { type: 'string' },
      unique_story_count: { type: 'integer' },
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: Object.keys(classificationProps),
          properties: classificationProps,
        },
      },
    },
  };
}

function callGemini_(prompt, schema, apiKey) {
  const model = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || CONFIG.DEFAULT_GEMINI_MODEL;
  const response = UrlFetchApp.fetch(
    `${CONFIG.GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': apiKey },
      payload: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 1.0,
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
        },
      }),
      muteHttpExceptions: true,
    });

  const status = response.getResponseCode();
  const raw = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error(`Gemini API error ${status}: ${raw.substring(0, 1500)}`);
  }
  return parseGeminiResponse_(JSON.parse(raw));
}

/** Pure: unwraps a generateContent response, failing with a useful reason. */
function parseGeminiResponse_(data) {
  const candidate = data.candidates && data.candidates[0];
  if (!candidate) {
    const reason = (data.promptFeedback && data.promptFeedback.blockReason) || 'No candidate returned';
    throw new Error(`Gemini returned no response candidate: ${reason}`);
  }
  const finishReason = candidate.finishReason || '';
  if (finishReason && !['STOP', 'MAX_TOKENS'].includes(finishReason)) {
    throw new Error(`Gemini generation stopped with reason: ${finishReason}`);
  }
  const text = ((candidate.content && candidate.content.parts) || [])
    .map(part => part.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned no output text.');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Gemini output was not valid JSON${finishReason === 'MAX_TOKENS' ? ' (hit MAX_TOKENS)' : ''}: ${text.substring(0, 1500)}`);
  }
  if (typeof parsed.brief !== 'string' || !parsed.brief.trim()) {
    throw new Error('Gemini output has no brief text.');
  }
  return parsed;
}
