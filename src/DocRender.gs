/* ================================
 * GOOGLE DOC — LETTERHEAD AND BRIEF RENDERING
 * ================================
 *
 * The tab is a letterhead followed by one section per day. Each day starts
 * with a two-column "Reporting Date" table; Email.gs uses those tables as
 * anchors to export exactly one day as a PDF.
 */

function initialiseDocTab_(body, title, subtitle) {
  if (body.getText().trim()) return;
  const brand = getBrand_();
  insertBrandLogo_(body, brand);

  const t = body.appendParagraph(title);
  t.setHeading(DocumentApp.ParagraphHeading.TITLE);
  styleParagraphText_(t, { color: brand.NEAR_BLACK });

  styleParagraphText_(body.appendParagraph(subtitle), { italic: true, color: brand.MUTED });
  if (brand.FOOTER) {
    const f = body.appendParagraph(brand.FOOTER);
    f.setSpacingAfter(10);
    styleParagraphText_(f, { italic: true, color: brand.MUTED, size: 9 });
  }
  body.appendHorizontalRule();
}

/** Optional logo from BRAND_LOGO_URL. A missing logo never blocks the brief. */
function insertBrandLogo_(body, brand) {
  if (!brand.LOGO_URL) return;
  try {
    const response = UrlFetchApp.fetch(brand.LOGO_URL, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return;
    const image = body.appendImage(response.getBlob());
    const ratio = image.getHeight() / image.getWidth();
    image.setWidth(150);
    image.setHeight(Math.round(150 * ratio));
  } catch (err) {
    console.warn(`Could not fetch letterhead logo: ${err}`);
  }
}

function writeDailyBriefToDoc_(documentId, tabId, date, markdown, messageCount, profile, truncated) {
  const doc = DocumentApp.openById(documentId);
  const body = doc.getTab(tabId).asDocumentTab().getBody();
  const brand = getBrand_();

  body.appendHorizontalRule();
  const meta = [
    ['Reporting Date', formatHumanDate_(date)],
    ['Messages Captured', `${messageCount} message${messageCount === 1 ? '' : 's'}`],
    ['Profile', profile.label],
  ];
  if (truncated) meta.push(['Coverage', 'Partial — input exceeded the model budget']);
  appendMetadataTable_(body, meta, brand);

  appendSimpleMarkdown_(body, markdown, brand);
  doc.saveAndClose();
}

function appendMetadataTable_(body, pairs, brand) {
  const table = body.appendTable(pairs);
  table.setBorderWidth(0.5);
  table.setBorderColor('#D9DEE5');
  for (let r = 0; r < pairs.length; r++) {
    const label = table.getCell(r, 0);
    label.setBackgroundColor(brand.METADATA_LABEL_BG);
    label.setWidth(140);
    styleParagraphText_(label.getChild(0).asParagraph(), { bold: true, color: brand.MUTED, size: 10 });
    styleParagraphText_(table.getCell(r, 1).getChild(0).asParagraph(), { bold: true, color: brand.NEAR_BLACK, size: 11 });
  }
  body.appendParagraph('');
  return table;
}

/**
 * Pure: splits the model's Markdown into typed blocks. Kept separate from
 * the Docs calls so the parsing can be unit-tested outside Apps Script.
 */
function parseBriefMarkdown_(markdown) {
  const lines = String(markdown || '').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { blocks.push({ type: 'blank' }); i++; continue; }
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      blocks.push({ type: 'heading', level: level, text: h[2].trim() });
      i++;
      if (level === 2 && /^executive summary$/i.test(h[2].trim())) {
        const buffered = [];
        while (i < lines.length && !/^#{1,3}\s/.test(lines[i].trim())) { buffered.push(lines[i].trim()); i++; }
        blocks.push({ type: 'callout', lines: buffered.filter(Boolean) });
      }
      continue;
    }
    if (/^[-*]\s+/.test(t)) { blocks.push({ type: 'bullet', text: t.replace(/^[-*]\s+/, '') }); i++; continue; }
    if (/^\d+\.\s+/.test(t)) {
      splitInlineNumberedItems_(t).forEach(item => blocks.push({ type: 'number', text: item }));
      i++;
      continue;
    }
    blocks.push({ type: 'paragraph', text: t });
    i++;
  }
  // Models pad with runs of blank lines; each would become an empty
  // paragraph, so collapse runs and trim both ends (stray blank pages).
  const tidy = blocks.filter((b, k) => !(b.type === 'blank' && k > 0 && blocks[k - 1].type === 'blank'));
  while (tidy.length && tidy[0].type === 'blank') tidy.shift();
  while (tidy.length && tidy[tidy.length - 1].type === 'blank') tidy.pop();
  return tidy;
}

/**
 * Pure: models sometimes write "1. First. 2. Second. 3. Third." on one line.
 * Split only when the inline numbers run consecutively from the leading one,
 * so a sentence like "1. Rose 2.5% in Q3" is left alone.
 */
function splitInlineNumberedItems_(line) {
  const first = Number(line.match(/^(\d+)\./)[1]);
  const rest = line.replace(/^\d+\.\s+/, '');
  const parts = [];
  let expected = first + 1;
  let remaining = rest;
  for (;;) {
    const re = new RegExp(`\\s${expected}\\.\\s+(?=\\S)`);
    const m = remaining.match(re);
    if (!m) break;
    parts.push(remaining.substring(0, m.index).trim());
    remaining = remaining.substring(m.index + m[0].length);
    expected++;
  }
  parts.push(remaining.trim());
  return parts.filter(Boolean);
}

function appendSimpleMarkdown_(body, markdown, brand) {
  parseBriefMarkdown_(markdown).forEach(b => {
    switch (b.type) {
      case 'blank': body.appendParagraph(''); break;
      case 'heading': appendStyledHeading_(body, b.text, b.level, brand); break;
      case 'callout': appendCalloutBox_(body, b.lines, brand); break;
      case 'bullet': appendFormattedListItem_(body, b.text, DocumentApp.GlyphType.BULLET, brand); break;
      case 'number': appendFormattedListItem_(body, b.text, DocumentApp.GlyphType.NUMBER, brand); break;
      default: {
        const p = body.appendParagraph('');
        p.setSpacingAfter(6);
        parseInlineMarkdown_(p, b.text, brand);
      }
    }
  });
}

function appendStyledHeading_(body, text, level, brand) {
  if (level === 1) return appendBannerHeading_(body, text, brand);
  const p = body.appendParagraph(text);
  p.setHeading(level === 2 ? DocumentApp.ParagraphHeading.HEADING2 : DocumentApp.ParagraphHeading.HEADING3);
  p.setSpacingBefore(level === 2 ? 18 : 12);
  p.setSpacingAfter(level === 2 ? 6 : 4);
  styleParagraphText_(p, {
    bold: true,
    color: level === 2 ? brand.DARK : brand.PRIMARY,
    size: brand.HEADING_SIZES[level],
    italic: level === 3,
  });
  return p;
}

/** Full-width banner for the one level-1 heading per day. */
function appendBannerHeading_(body, text, brand) {
  const table = body.appendTable([[text]]);
  table.setBorderWidth(0);
  const cell = table.getCell(0, 0);
  cell.setBackgroundColor(brand.DARK);
  cell.setPaddingTop(8).setPaddingBottom(8).setPaddingLeft(12).setPaddingRight(12);
  styleParagraphText_(cell.getChild(0).asParagraph(), { bold: true, color: '#FFFFFF', size: brand.HEADING_SIZES[1] });
  body.appendParagraph('');
  return table;
}

function appendFormattedListItem_(body, text, glyphType, brand) {
  const item = body.appendListItem('');
  item.setGlyphType(glyphType);
  item.setSpacingAfter(4);
  parseInlineMarkdown_(item, text, brand);
  return item;
}

/** Shaded box around the Executive Summary, the most-read part of the brief. */
function appendCalloutBox_(body, lines, brand) {
  if (!lines.length) return;
  const table = body.appendTable([['']]);
  table.setBorderWidth(0);
  const cell = table.getCell(0, 0);
  cell.setBackgroundColor(brand.CALLOUT_BG);
  cell.setPaddingTop(10).setPaddingBottom(10).setPaddingLeft(14).setPaddingRight(14);

  // The cell already holds one empty paragraph; use it for the first line.
  const first = cell.getChild(0).asParagraph();
  parseInlineMarkdown_(first, lines[0], brand);
  styleParagraphText_(first, { size: 11 });
  for (let j = 1; j < lines.length; j++) {
    const p = cell.appendParagraph('');
    parseInlineMarkdown_(p, lines[j], brand);
    styleParagraphText_(p, { size: 11 });
  }
  body.appendParagraph('');
}

function styleParagraphText_(element, options) {
  const text = element.editAsText();
  const len = text.getText().length;
  if (len === 0) return;
  const end = len - 1;
  if (options.bold !== undefined) text.setBold(0, end, options.bold);
  if (options.italic !== undefined) text.setItalic(0, end, options.italic);
  if (options.color) text.setForegroundColor(0, end, options.color);
  if (options.size) text.setFontSize(0, end, options.size);
}

/**
 * Pure: splits a line into runs of plain / bold / italic / link text.
 */
function tokenizeInlineMarkdown_(text) {
  const regex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  const runs = [];
  let last = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) runs.push({ text: text.substring(last, m.index) });
    if (m[1] !== undefined) runs.push({ text: m[1], link: m[2] });
    else if (m[3] !== undefined) runs.push({ text: m[3], bold: true });
    else runs.push({ text: m[4], italic: true });
    last = regex.lastIndex;
  }
  if (last < text.length) runs.push({ text: text.substring(last) });
  return runs;
}

function parseInlineMarkdown_(element, text, brand) {
  tokenizeInlineMarkdown_(text).forEach(run => {
    // appendText inherits the previous run's attributes, so set every run
    // explicitly or plain text after a bold run comes out bold too.
    const t = element.appendText(run.text);
    t.setBold(Boolean(run.bold));
    t.setItalic(Boolean(run.italic));
    if (run.link) t.setLinkUrl(run.link);
    if (run.bold) t.setForegroundColor(brand.DARK);
  });
}
