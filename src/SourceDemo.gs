/* ================================
 * SOURCE: SYNTHETIC DEMO FEED
 * ================================
 *
 * Lets anyone see the whole pipeline work without a Slack workspace.
 * Every organisation, person, outlet and URL below is FICTIONAL; links use
 * the reserved example.com / example.org domains. The feed is written to be
 * realistic for the brand-reputation profile: syndicated duplicates, a
 * rumour that needs verification, a competitor move, a regulator signal and
 * plenty of low-value noise for the model to discard.
 *
 *   runDemo()       — load the feed as "yesterday" and generate the brief
 *   loadDemoFeed()  — load only (safe to re-run; ids are de-duplicated)
 */

const DEMO_FEED = [
  ['07:02', 'News Alerts', 'Kestrel Mobility raises e-scooter unlock fee in Port Avalon from 1.00 to 1.50 — Avalon Courier https://example.com/courier/kestrel-fee-rise'],
  ['07:05', 'News Alerts', 'Kestrel Mobility unlock fee up 50% in Port Avalon (syndicated) — Metro Wire https://example.com/metrowire/kestrel-unlock-fee'],
  ['07:31', 'Social Monitor', '@avalon_commuter: "1.50 just to unlock a Kestrel?? walking it is" — 412 reposts https://example.org/social/post/88213'],
  ['07:48', 'Social Monitor', '@greenwheels_pa: fee rise is steep but Kestrel scooters are the only ones that actually work on Harbour Hill'],
  ['08:10', 'News Alerts', 'City Transport Authority to review shared-scooter permits ahead of 2027 tender — Avalon Courier https://example.com/courier/cta-permit-review'],
  ['08:15', 'Review Site', '1★ "Charged twice for one ride, support chat closed after 10 minutes" — Kestrel app review https://example.org/reviews/kestrel/55102'],
  ['08:22', 'Review Site', '1★ "Double charge again this morning. Refund pending 4 days" — Kestrel app review https://example.org/reviews/kestrel/55117'],
  ['08:40', 'News Alerts', 'Larkspur Rides launches 30-day unlimited pass in Port Avalon at 19.99 — TechHarbour https://example.com/techharbour/larkspur-pass'],
  ['08:44', 'Social Monitor', '@larkspur_rides: Unlimited rides. One price. Port Avalon, your pass is live. https://example.org/social/post/88301'],
  ['09:05', 'Social Monitor', 'UNVERIFIED: forum thread claims Kestrel battery fire at Dockside depot last night; no photos, no official report https://example.org/forum/avalon/t/9921'],
  ['09:12', 'Social Monitor', 'Reply in same thread: "my cousin works there, it was a bin fire next door, not the scooters"'],
  ['09:30', 'News Alerts', 'Kestrel Mobility CEO Dana Okafor to speak at Port Avalon Urban Transport Forum on 24 Oct — Event listing https://example.com/events/uptf-2026'],
  ['09:55', 'Broadcast', 'Avalon FM morning show: hosts discuss scooter clutter on pavements; Kestrel and Larkspur both named'],
  ['10:20', 'Review Site', '5★ "New helmet lock is brilliant, felt much safer" — Kestrel app review https://example.org/reviews/kestrel/55140'],
  ['10:41', 'News Alerts', 'City Transport Authority: permit review will weigh "pricing fairness and complaint handling" — official notice https://example.com/cta/notices/2026-118'],
  ['11:03', 'Social Monitor', '@disability_access_pa: scooters left across tactile paving on Market St again. Photo attached. Tagging Kestrel and Larkspur https://example.org/social/post/88377'],
  ['11:15', 'News Alerts', 'Kestrel fee rise: what riders need to know (explainer) — Avalon Courier https://example.com/courier/kestrel-fee-explainer'],
  ['11:40', 'Blog', 'Commute Economics blog: per-minute cost comparison puts Kestrel 12% above Larkspur after fee change https://example.com/commute-econ/scooter-costs'],
  ['12:05', 'Social Monitor', '@kestrel_help: We are aware of duplicate charges on some rides since 06:00 and are issuing automatic refunds within 48 hours.'],
  ['12:10', 'Social Monitor', '@avalon_commuter: at least they admitted the double charging. 48h is still too long'],
  ['12:30', 'News Alerts', 'Port Avalon council motion to cap e-scooter fleet sizes tabled for 3 Nov meeting — Metro Wire https://example.com/metrowire/fleet-cap-motion'],
  ['13:02', 'Forum', 'Thread: "Is Kestrel leaving Port Avalon?" — speculation only, cites no source https://example.org/forum/avalon/t/9940'],
  ['13:20', 'News Alerts', 'Weekend weather: heavy rain expected across Port Avalon — Avalon Courier https://example.com/courier/weather'],
  ['13:45', 'Social Monitor', '@techharbour: Larkspur says its pass sold 3,000 in the first 6 hours (company figure, not independently verified)'],
  ['14:10', 'Review Site', '2★ "Fee went up and the scooter near me is always flat" — Kestrel app review https://example.org/reviews/kestrel/55188'],
  ['14:32', 'News Alerts', 'Kestrel Mobility partners with Avalon University on student discount — press release https://example.com/press/kestrel-avalon-uni'],
  ['15:00', 'Social Monitor', '@avalon_uni_su: Students get 40% off Kestrel rides from Monday. Details in bio.'],
  ['15:25', 'News Alerts', 'Shared mobility firms face new data-sharing rules under draft regional transport bill — PolicyDesk https://example.com/policydesk/transport-bill-draft'],
  ['16:05', 'Social Monitor', '@greenwheels_pa: honestly the student discount makes the fee rise look worse for everyone else'],
  ['16:40', 'News Alerts', 'Kestrel Mobility raises e-scooter unlock fee in Port Avalon (syndicated) — Coastline Daily https://example.com/coastline/kestrel-fee'],
  ['17:15', 'Broadcast', 'Avalon TV evening news: 40-second segment on the fee rise, includes rider vox pops, no company statement'],
  ['18:02', 'Social Monitor', 'Automated: Kestrel mentioned 1,140 times today vs 7-day average of 310 (monitoring tool figure)'],
];

/** Load the feed as yesterday's messages, then generate the brief. */
function runDemo() {
  const date = dateWithOffset_(CONFIG.SUMMARY_DAY_OFFSET);
  const added = loadDemoFeed(date);
  log_('runDemo', 'SUCCESS', `Loaded ${added} demo messages for ${date}.`);
  const outcome = generateBriefForDate_(date);
  console.log(`Demo brief for ${date}: ${outcome}`);
}

/** Writes DEMO_FEED into the Messages sheet for `date`. Returns rows added. */
function loadDemoFeed(date) {
  const props = getRequiredProperties_(['SPREADSHEET_ID']);
  const day = date || dateWithOffset_(CONFIG.SUMMARY_DAY_OFFSET);
  const existing = getExistingMessageIds_(props.SPREADSHEET_ID);
  const tz = getTimezone_();

  const rows = demoFeedRecords_(day)
    .filter(r => !existing.has(r.id))
    .map(r => {
      const dt = Utilities.parseDate(`${day} ${r.time}`, tz, 'yyyy-MM-dd HH:mm:ss');
      return buildMessageRow_(Object.assign(r, {
        iso: Utilities.formatDate(dt, tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      }));
    });

  appendRows_(props.SPREADSHEET_ID, CONFIG.MESSAGE_SHEET, rows);
  return rows.length;
}

/** Pure: DEMO_FEED → row specs for one day, with stable per-day ids. */
function demoFeedRecords_(day) {
  return DEMO_FEED.map(([time, sender, text], i) => ({
    id: `demo-${day}-${String(i + 1).padStart(2, '0')}`,
    date: day,
    time: `${time}:00`.substring(0, 8),
    channelId: 'demo',
    senderId: sender.toLowerCase().replace(/\s+/g, '-'),
    senderName: sender,
    senderType: 'Bot',
    text: text,
    url: (text.match(/https?:\/\/\S+/) || [''])[0],
    links: (text.match(/https?:\/\/\S+/g) || []),
    raw: { demo: true },
    source: 'demo',
  }));
}

/**
 * Wipes demo output so runDemo() can be re-run cleanly: clears data rows in
 * every pipeline sheet and resets the brief tab to its letterhead. Refuses to
 * run unless SOURCE is demo, so it can never empty a live deployment.
 */
function resetDemo() {
  if (getSource_() !== 'demo') throw new Error('resetDemo() only runs when SOURCE is demo.');
  const props = getRequiredProperties_(['SPREADSHEET_ID', 'DOCUMENT_ID', 'DOC_SUMMARY_TAB_ID']);
  const ss = SpreadsheetApp.openById(props.SPREADSHEET_ID);
  [CONFIG.MESSAGE_SHEET, CONFIG.TOPIC_SHEET, CONFIG.ENTITY_SHEET, CONFIG.SUMMARY_SHEET, CONFIG.LOG_SHEET]
    .forEach(name => {
      const sheet = ss.getSheetByName(name);
      if (sheet && sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
    });
  const doc = DocumentApp.openById(props.DOCUMENT_ID);
  const body = doc.getTab(props.DOC_SUMMARY_TAB_ID).asDocumentTab().getBody();
  body.clear();
  doc.saveAndClose();
  setupSystem(); // re-draws the letterhead on the now-empty tab
  console.log('Demo reset. Run runDemo() for a fresh brief.');
}
