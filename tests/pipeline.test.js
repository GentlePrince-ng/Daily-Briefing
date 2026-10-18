const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('./harness').load();

// Arrays from the sandbox carry a different Array.prototype, so compare
// through JSON rather than deepStrictEqual.
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));

test('every bundled profile validates and has the fixed brief frame', () => {
  for (const id of Object.keys(G.PROFILES)) {
    const p = G.resolveProfile_(id);
    assert.equal(p.id, id);
    const headers = G.buildTopicHeaders_(p);
    assert.equal(headers.length, 4 + p.dimensions.length + 8, id);
  }
});

test('unknown profile id names the valid ones', () => {
  assert.throws(() => G.resolveProfile_('nope'), /Valid: brand-reputation/);
});

test('missing PROFILE falls back to the default', () => {
  assert.equal(G.resolveProfile_('').id, 'brand-reputation');
  assert.equal(G.resolveProfile_(null).id, 'brand-reputation');
});

test('validateProfile_ rejects the mistakes that would break the midnight run', () => {
  const base = JSON.parse(JSON.stringify(G.PROFILES['brand-reputation']));
  const noOther = Object.assign({}, base, { themes: ['A', 'B'] });
  assert.throws(() => G.validateProfile_('x', noOther), /must include "Other"/);

  const reserved = Object.assign({}, base, { dimensions: [{ key: 'sentiment', header: 'S' }] });
  assert.throws(() => G.validateProfile_('x', reserved), /reserved/);

  const dupDim = Object.assign({}, base, { dimensions: [{ key: 'a', header: 'A' }, { key: 'a', header: 'B' }] });
  assert.throws(() => G.validateProfile_('x', dupDim), /duplicated/);

  const dupSection = Object.assign({}, base, { sections: ['Executive Summary'] });
  assert.throws(() => G.validateProfile_('x', dupSection), /repeat/);

  const badKey = Object.assign({}, base, { dimensions: [{ key: 'Product Line', header: 'P' }] });
  assert.throws(() => G.validateProfile_('x', badKey), /snake_case/);
});

test('response schema makes every dimension required and enum-constrains themes/entities', () => {
  const p = G.resolveProfile_('policy-regulatory');
  const item = G.buildResponseSchema_(p).properties.classifications.items;
  for (const d of p.dimensions) assert.ok(item.required.includes(d.key), d.key);
  same(item.properties.primary_theme.enum, p.themes);
  same(item.properties.entities.items.properties.type.enum, p.entityTypes);
  same(item.properties.instrument_stage.enum, p.dimensions.find(d => d.key === 'instrument_stage').enum);
  assert.equal(item.properties.jurisdiction.enum, undefined);
});

test('prompt lists every section in order and carries the truncation note only when truncated', () => {
  const p = G.resolveProfile_('competitor-intel');
  const prompt = G.buildBriefPrompt_(p, '2026-10-17', '[]', false);
  const sections = [...G.BRIEF_OPENING_SECTIONS, ...p.sections, ...G.BRIEF_CLOSING_SECTIONS];
  let last = -1;
  for (const s of sections) {
    const at = prompt.indexOf(`## ${s}`);
    assert.ok(at > last, `section "${s}" missing or out of order`);
    last = at;
  }
  assert.ok(prompt.includes('# Daily Intelligence Brief — 2026-10-17'));
  assert.ok(!prompt.includes('coverage for this day is partial'));
  assert.ok(G.buildBriefPrompt_(p, '2026-10-17', '[]', true).includes('coverage for this day is partial'));
});

test('buildAiInput_ drops whole records at the budget and reports truncation', () => {
  const records = Array.from({ length: 50 }, (_, i) => ({ message_id: String(i), text: 'x'.repeat(100) }));
  const full = G.buildAiInput_(records, 1e6);
  assert.equal(full.truncated, false);
  assert.equal(JSON.parse(full.json).length, 50);

  const cut = G.buildAiInput_(records, 1000);
  assert.equal(cut.truncated, true);
  const parsed = JSON.parse(cut.json); // still valid JSON, no half record
  assert.equal(parsed.length, cut.included);
  assert.ok(cut.json.length <= 1000);
});

test('parseGeminiResponse_ unwraps good output and explains bad output', () => {
  const ok = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"brief":"# B","unique_story_count":2,"classifications":[]}' }] } }] };
  assert.equal(G.parseGeminiResponse_(ok).unique_story_count, 2);
  assert.throws(() => G.parseGeminiResponse_({ promptFeedback: { blockReason: 'SAFETY' } }), /SAFETY/);
  assert.throws(() => G.parseGeminiResponse_({ candidates: [{ finishReason: 'RECITATION' }] }), /RECITATION/);
  const cut = { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"brief":"tru' }] } }] };
  assert.throws(() => G.parseGeminiResponse_(cut), /MAX_TOKENS/);
  const empty = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"brief":"  ","unique_story_count":0,"classifications":[]}' }] } }] };
  assert.throws(() => G.parseGeminiResponse_(empty), /no brief/);
});

test('Slack text cleaning keeps link targets and decodes entities', () => {
  assert.equal(G.cleanSlackText_('<https://ex.com|Story> &amp; more'), 'Story (https://ex.com) & more');
  assert.equal(G.cleanSlackText_('<https://ex.com>'), 'https://ex.com');
});

test('monitoring-bot content in attachments and blocks is extracted and de-duplicated', () => {
  const m = {
    text: 'Alert',
    attachments: [{ title: 'Headline', text: 'Body', title_link: 'https://example.com/a', fields: [{ title: 'Source', value: 'Wire' }] }],
    blocks: [{ text: { text: 'Headline' }, elements: [{ elements: [{ text: 'Inner', url: 'https://example.com/b' }] }] }],
  };
  const out = G.extractSlackMessageContent_(m).split('\n');
  assert.equal(out.filter(x => x === 'Headline').length, 1);
  for (const want of ['Alert', 'Body', 'Source: Wire', 'https://example.com/a', 'Inner', 'https://example.com/b']) {
    assert.ok(out.includes(want), want);
  }
});

test('housekeeping events are not treated as monitored messages', () => {
  assert.equal(G.isRelevantListeningMessage_({ subtype: 'channel_join', text: 'x joined' }), false);
  assert.equal(G.isRelevantListeningMessage_({ text: 'Ada has joined the channel' }), false);
  assert.equal(G.isRelevantListeningMessage_({ text: '' }), false);
  assert.equal(G.isRelevantListeningMessage_({ text: 'Real alert' }), true);
});

test('links, reactions and duplicate timestamps', () => {
  same(G.collectSlackLinks_({ text: 'see https://a.example and https://a.example', files: [{ permalink: 'https://f.example' }] }),
    ['https://f.example', 'https://a.example']);
  assert.equal(G.countReactions_([{ count: 2 }, { count: 3 }]), 5);
  assert.equal(G.deduplicateMessages_([{ ts: '1', v: 1 }, { ts: '1', v: 2 }, { ts: '2' }]).length, 2);
});

test('markdown parser boxes the Executive Summary up to the next heading', () => {
  const blocks = G.parseBriefMarkdown_('# Title\n\n## Executive Summary\nLine one\n\nLine two\n## Major Developments\n- item\n1. step\nPlain');
  same(blocks.map(b => b.type), ['heading', 'blank', 'heading', 'callout', 'heading', 'bullet', 'number', 'paragraph']);
  same(blocks[3].lines, ['Line one', 'Line two']);
});

test('inline markdown tokenizer', () => {
  same(G.tokenizeInlineMarkdown_('a **b** *c* [d](https://e.example) f'), [
    { text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', italic: true },
    { text: ' ' }, { text: 'd', link: 'https://e.example' }, { text: ' f' },
  ]);
});

test('PDF day span: exact day, missing day, no anchors', () => {
  same(G.findDaySpan_(['16 October 2026', '17 October 2026'], [5, 40], 70, '16 October 2026'),
    { mastheadEnd: 5, start: 5, end: 40 });
  same(G.findDaySpan_(['16 October 2026', '17 October 2026'], [5, 40], 70, '17 October 2026'),
    { mastheadEnd: 5, start: 40, end: 70 });
  const missing = G.findDaySpan_(['16 October 2026'], [5], 70, '1 January 2026');
  assert.equal(missing.start, 5);
  assert.ok(missing.fallback);
  assert.ok(G.findDaySpan_([], [], 10, 'x').fallback);
});

test('backfill dates are validated, de-duplicated and sorted', () => {
  same(G.parseBackfillDates_('2026-07-21, 2026-07-19,2026-07-21'), ['2026-07-19', '2026-07-21']);
  assert.throws(() => G.parseBackfillDates_('2026-13-40'), /invalid/);
  assert.throws(() => G.parseBackfillDates_('19/07/2026'), /invalid/);
  assert.throws(() => G.parseBackfillDates_(''), /empty/);
});

test('demo feed is fictional, uniquely keyed and fits the Messages layout', () => {
  const recs = G.demoFeedRecords_('2026-10-17');
  assert.equal(new Set(recs.map(r => r.id)).size, recs.length);
  for (const r of recs) {
    assert.match(r.time, /^\d{2}:\d{2}:\d{2}$/);
    for (const url of r.links) assert.match(url, /^https:\/\/example\.(com|org)\//, url);
    const row = G.buildMessageRow_(r);
    assert.equal(row.length, G.BASE_HEADERS.Messages.length);
    assert.equal(row[G.MSG_COL['Message ID']], `'${r.id}`); // stored as text
    assert.equal(row[G.MSG_COL['Source']], 'demo');
  }
});

test('rowsToRecords_ reads the columns buildMessageRow_ writes', () => {
  const written = G.buildMessageRow_({ id: 'm1', date: '2026-10-17', time: '09:00:00', senderName: 'Bot', text: 'hello', links: ['https://example.com/x'] });
  // Sheets hides the text-forcing apostrophe: getValues() returns the bare string.
  const row = written.map(v => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v));
  const [rec] = G.rowsToRecords_([row]);
  assert.equal(rec.time, '09:00:00');
  assert.equal(rec.message_id, 'm1');
  assert.equal(rec.text, 'hello');
  assert.equal(rec.links, 'https://example.com/x');
});

test('topic rows line up with topic headers for every profile', () => {
  for (const id of Object.keys(G.PROFILES)) {
    const p = G.resolveProfile_(id);
    const c = { message_id: 'm1', primary_theme: 'Other', secondary_themes: ['a', 'b'], confidence: 0.8 };
    p.dimensions.forEach(d => { c[d.key] = `v-${d.key}`; });
    const row = G.buildTopicRow_(c, '2026-10-17', p, 'batch', 'now');
    const headers = G.buildTopicHeaders_(p);
    assert.equal(row.length, headers.length, id);
    p.dimensions.forEach(d => assert.equal(row[headers.indexOf(d.header)], `v-${d.key}`, `${id}:${d.key}`));
    assert.equal(row[headers.indexOf('Profile')], id);
  }
});

test('escapeHtml_', () => {
  assert.equal(G.escapeHtml_(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#039;&amp;&#039;&lt;/a&gt;');
});

test('sync interval only accepts values Apps Script triggers support', () => {
  assert.equal(G.normaliseSyncMinutes_(null), 1);
  assert.equal(G.normaliseSyncMinutes_('5'), 5);
  assert.throws(() => G.normaliseSyncMinutes_('2'), /must be one of/);
});

test('blank-line runs collapse and ends are trimmed (no trailing blank pages)', () => {
  const blocks = G.parseBriefMarkdown_('\n\n# T\n\n\n\nPara\n\n\n\n\n');
  same(blocks.map(b => b.type), ['heading', 'blank', 'paragraph']);
});

test('prompt demands one classification per message and carries the verification rules', () => {
  const p = G.resolveProfile_('brand-reputation');
  const prompt = G.buildBriefPrompt_(p, '2026-10-17', JSON.stringify([{}, {}, {}]), false);
  assert.ok(prompt.includes('3 messages, 3 classifications'));
  assert.ok(prompt.includes('does NOT settle it either way'));
  assert.ok(prompt.includes('Never upgrade one source'));
});

test('classification coverage', () => {
  assert.equal(G.classificationCoverage_(9, 32), 9 / 32);
  assert.equal(G.classificationCoverage_(40, 32), 1);
  assert.equal(G.classificationCoverage_(0, 0), 1);
});

test('numbered items run together on one line are split; decimals are not', () => {
  same(G.splitInlineNumberedItems_('1. Expedite refunds. 2. Prepare talking points for 24 Oct. 3. Consider an offer.'),
    ['Expedite refunds.', 'Prepare talking points for 24 Oct.', 'Consider an offer.']);
  same(G.splitInlineNumberedItems_('1. Fees rose 2.5% and 3. was skipped'), ['Fees rose 2.5% and 3. was skipped']);
  same(G.parseBriefMarkdown_('1. A 2. B').map(b => b.text), ['A', 'B']);
});
