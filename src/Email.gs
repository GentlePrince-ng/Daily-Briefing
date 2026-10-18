/* ================================
 * ONE-DAY PDF + EMAIL DISTRIBUTION
 * ================================ */

/**
 * Trigger entry point (daily, morning). Emails yesterday's brief as a PDF
 * holding that day only.
 *
 * Required Script Property:  EMAIL_RECIPIENTS (comma-separated)
 * Optional:                  EMAIL_CC, EMAIL_BCC, EMAIL_REPLY_TO,
 *                            EMAIL_SUBJECT_PREFIX, EMAIL_SENDER_NAME
 */
function sendDailyBriefEmail() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const props = getRequiredProperties_(['SPREADSHEET_ID', 'DOCUMENT_ID', 'DOC_SUMMARY_TAB_ID', 'EMAIL_RECIPIENTS']);
    emailBriefForDate_(dateWithOffset_(-1), props, props.EMAIL_RECIPIENTS);
  } catch (err) {
    log_('sendDailyBriefEmail', 'ERROR', err.stack || err.message);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function emailBriefForDate_(summaryDate, props, recipients) {
  const started = Date.now();
  const meta = getLatestSuccessfulSummaryMetadata_(props.SPREADSHEET_ID, summaryDate);
  if (!meta) {
    throw new Error(`No successful brief found for ${summaryDate}. Generate it before emailing.`);
  }

  const pdf = createDayPdf_(props.DOCUMENT_ID, props.DOC_SUMMARY_TAB_ID, summaryDate);
  try {
    const human = formatHumanDate_(summaryDate);
    const prefix = props.EMAIL_SUBJECT_PREFIX ? `${props.EMAIL_SUBJECT_PREFIX} — ` : '';
    const docUrl = `https://docs.google.com/document/d/${encodeURIComponent(props.DOCUMENT_ID)}/edit`;

    const options = {
      to: recipients,
      subject: `${prefix}Daily Intelligence Brief — ${human}`,
      body: [
        `Daily Intelligence Brief — ${human}`, '',
        `${meta.messages} messages captured`,
        `${meta.uniqueStories} unique stories identified`, '',
        'The full brief is attached as a PDF.', '',
        `Live report: ${docUrl}`,
      ].join('\n'),
      htmlBody: `
        <div style="font-family:Arial,sans-serif;line-height:1.55;color:#222;">
          <h2 style="margin-bottom:4px;">Daily Intelligence Brief</h2>
          <p style="margin-top:0;"><strong>${escapeHtml_(human)}</strong></p>
          <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;margin:16px 0;">
            <tr><td style="border:1px solid #ddd;"><strong>Messages captured</strong></td>
                <td style="border:1px solid #ddd;">${meta.messages}</td></tr>
            <tr><td style="border:1px solid #ddd;"><strong>Unique stories</strong></td>
                <td style="border:1px solid #ddd;">${meta.uniqueStories}</td></tr>
          </table>
          <p>The full brief is attached as a PDF.</p>
          <p><a href="${docUrl}">Open the live report</a></p>
          <p style="font-size:12px;color:#666;">Automated monitoring brief. AI-generated from monitored messages; verify before acting on any single claim.</p>
        </div>`.trim(),
      attachments: [pdf.pdfBlob],
      name: props.EMAIL_SENDER_NAME || CONFIG.DEFAULT_SENDER_NAME,
    };
    if (props.EMAIL_CC) options.cc = props.EMAIL_CC;
    if (props.EMAIL_BCC) options.bcc = props.EMAIL_BCC;
    if (props.EMAIL_REPLY_TO) options.replyTo = props.EMAIL_REPLY_TO;

    MailApp.sendEmail(options);
    markSummaryEmailed_(props.SPREADSHEET_ID, summaryDate, recipients);
    log_('emailBrief', 'SUCCESS',
      `Emailed ${summaryDate} brief to ${recipients} in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  } finally {
    try { DriveApp.getFileById(pdf.tempFileId).setTrashed(true); } catch (_) {}
  }
}

/**
 * Copies the letterhead plus ONLY `summaryDate`'s section into a temporary
 * Doc and converts it to PDF; the live report is never modified.
 *
 * The day is found by structure: each day starts with the "Reporting Date"
 * table that writeDailyBriefToDoc_ writes. (Horizontal rules can't be used —
 * they sit inside paragraphs, not at the top level of the body.)
 */
function createDayPdf_(documentId, tabId, summaryDate) {
  const source = DocumentApp.openById(documentId).getTab(tabId).asDocumentTab().getBody();
  const total = source.getNumChildren();
  const human = formatHumanDate_(summaryDate);

  const anchors = [];
  for (let i = 0; i < total; i++) if (isReportingDateTable_(source.getChild(i))) anchors.push(i);
  const span = findDaySpan_(anchors.map(i => source.getChild(i).asTable().getCell(0, 1).getText().trim()),
    anchors, total, human);

  const temp = DocumentApp.create(`Daily Intelligence Brief — ${summaryDate}`);
  const body = temp.getBody();
  body.clear();
  copyBodyElements_(source, body, 0, span.mastheadEnd);
  copyBodyElements_(source, body, span.start, span.end);
  if (span.fallback) log_('createDayPdf', 'ERROR', `Could not locate "${human}"; attached ${span.fallback}.`);

  body.setMarginTop(50).setMarginBottom(50).setMarginLeft(55).setMarginRight(55);
  temp.saveAndClose();
  Utilities.sleep(1500);

  return {
    pdfBlob: DriveApp.getFileById(temp.getId()).getBlob().getAs(MimeType.PDF)
      .setName(`Daily Intelligence Brief — ${summaryDate}.pdf`),
    tempFileId: temp.getId(),
  };
}

/**
 * Pure: given the date label of each anchor table, return the body range for
 * one day. Never returns the whole cumulative tab when the day is missing.
 */
function findDaySpan_(anchorDates, anchorIndexes, total, humanDate) {
  const mastheadEnd = anchorIndexes.length ? anchorIndexes[0] : 0;
  const a = anchorDates.indexOf(humanDate);
  if (a >= 0) {
    return { mastheadEnd, start: anchorIndexes[a], end: a + 1 < anchorIndexes.length ? anchorIndexes[a + 1] : total };
  }
  if (anchorIndexes.length) {
    return { mastheadEnd, start: anchorIndexes[anchorIndexes.length - 1], end: total, fallback: 'the most recent day instead' };
  }
  return { mastheadEnd, start: mastheadEnd, end: total, fallback: 'everything after the letterhead (no day sections found)' };
}

function isReportingDateTable_(child) {
  if (child.getType() !== DocumentApp.ElementType.TABLE) return false;
  try {
    const t = child.asTable();
    return t.getNumRows() >= 1 && t.getRow(0).getNumCells() >= 2 &&
      t.getCell(0, 0).getText().trim().indexOf('Reporting Date') === 0;
  } catch (_) {
    return false;
  }
}

function copyBodyElements_(source, target, start, endExclusive) {
  for (let i = start; i < endExclusive; i++) {
    const child = source.getChild(i);
    const T = DocumentApp.ElementType;
    switch (child.getType()) {
      case T.PARAGRAPH: target.appendParagraph(child.copy().asParagraph()); break;
      case T.LIST_ITEM: target.appendListItem(child.copy().asListItem()); break;
      case T.TABLE: target.appendTable(child.copy().asTable()); break;
      case T.HORIZONTAL_RULE: target.appendHorizontalRule(); break;
      case T.INLINE_IMAGE: target.appendImage(child.copy().asInlineImage()); break;
      case T.PAGE_BREAK: target.appendPageBreak(); break;
      default: console.log(`Skipped unsupported Docs element: ${child.getType()}`);
    }
  }
}
