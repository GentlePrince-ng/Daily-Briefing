/* ================================
 * BACKFILL — regenerate briefs for missed days
 * ================================
 *
 * The nightly brief runs on yesterday's data, so any night the trigger fails
 * leaves a permanent hole unless something fills it. Messages keep syncing
 * regardless, so the data is already in the sheet; only the brief is missing.
 *
 * Set BACKFILL_DATES (comma-separated yyyy-MM-dd, oldest first), then:
 *   backfillDryRun()  — first date only, into a THROWAWAY Doc, emailed to
 *                       BACKFILL_TEST_EMAIL (or nobody). Touches nothing real.
 *   backfillBriefs()  — every date: write to the real Doc + sheets and email
 *                       one PDF per day. Days that already have a successful
 *                       brief are skipped unless BACKFILL_FORCE = true.
 *
 * Both go through generateBriefForDate_, the same path as the live run.
 */

function backfillBriefs() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Could not obtain the script lock. Try again in a minute.');
  try {
    const props = getRequiredProperties_(['SPREADSHEET_ID', 'BACKFILL_DATES']);
    const force = String(props.BACKFILL_FORCE || '').toLowerCase() === 'true';
    const recipients = props.BACKFILL_TEST_EMAIL || props.EMAIL_RECIPIENTS || '';
    const results = parseBackfillDates_(props.BACKFILL_DATES).map((date, i) => {
      if (i > 0) Utilities.sleep(2000);
      try {
        if (!force && getLatestSuccessfulSummaryMetadata_(props.SPREADSHEET_ID, date)) {
          return `${date}: skipped (already generated; set BACKFILL_FORCE=true to redo)`;
        }
        const outcome = generateBriefForDate_(date);
        if (recipients && outcome.indexOf('ok') === 0) emailBriefForDate_(date, props, recipients);
        return `${date}: ${outcome}${recipients ? `, emailed to ${recipients}` : ''}`;
      } catch (err) {
        log_('backfillBriefs', 'ERROR', `${date}: ${err.stack || err.message}`);
        return `${date}: ERROR — ${err.message}`;
      }
    });
    log_('backfillBriefs', 'SUCCESS', results.join('  |  '));
    console.log(results.join('\n'));
  } finally {
    lock.releaseLock();
  }
}

/** Side-effect-free check of the first backfill date. */
function backfillDryRun() {
  const props = getRequiredProperties_(['SPREADSHEET_ID', 'GEMINI_API_KEY', 'BACKFILL_DATES']);
  const date = parseBackfillDates_(props.BACKFILL_DATES)[0];
  const rows = getMessagesForDate_(props.SPREADSHEET_ID, date);
  if (!rows.length) { console.log(`${date}: no messages in sheet`); return; }

  const profile = getActiveProfile_();
  const input = buildAiInput_(rowsToRecords_(rows), CONFIG.MAX_AI_INPUT_CHARS);
  const result = callGemini_(buildBriefPrompt_(profile, date, input.json, input.truncated),
    buildResponseSchema_(profile), props.GEMINI_API_KEY);

  const temp = DocumentApp.create(`TEST — Daily Intelligence Brief — ${date}`);
  try {
    const body = temp.getBody();
    body.clear();
    initialiseDocTab_(body, 'Daily Intelligence Brief (TEST)', `Dry run — ${profile.label}.`);
    const tabId = temp.getTabs()[0].getId(); // read before closing; a closed Doc can't be queried
    temp.saveAndClose();
    writeDailyBriefToDoc_(temp.getId(), tabId, date, result.brief, rows.length, profile, input.truncated);
    const pdf = DriveApp.getFileById(temp.getId()).getBlob().getAs(MimeType.PDF).setName(`TEST — ${date}.pdf`);
    if (props.BACKFILL_TEST_EMAIL) {
      MailApp.sendEmail({ to: props.BACKFILL_TEST_EMAIL, subject: `[TEST] Daily Intelligence Brief — ${formatHumanDate_(date)}`,
        body: `Dry-run brief for ${date}: ${rows.length} messages, ${result.unique_story_count} stories.`, attachments: [pdf] });
    }
    console.log(`${date}: ${rows.length} messages → ${result.unique_story_count} stories (dry run, nothing committed)`);
  } finally {
    try { DriveApp.getFileById(temp.getId()).setTrashed(true); } catch (_) {}
  }
}

/** Pure: validates and orders the BACKFILL_DATES list. */
function parseBackfillDates_(value) {
  const dates = String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  const bad = dates.filter(d => !/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(`${d}T00:00:00Z`)));
  if (bad.length) throw new Error(`BACKFILL_DATES has invalid entries: ${bad.join(', ')}`);
  if (!dates.length) throw new Error('BACKFILL_DATES is empty.');
  return [...new Set(dates)].sort();
}
