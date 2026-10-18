// Loads every src/*.gs file into one sandbox, the way Apps Script shares a
// single global scope across files, and returns the functions under test.
// Apps Script services are deliberately absent: only pure functions are
// tested here, and a test that reaches a service fails loudly.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');

const EXPORTS = [
  'PROFILES', 'BASE_HEADERS', 'MSG_COL', 'DEMO_FEED', 'BRIEF_OPENING_SECTIONS', 'BRIEF_CLOSING_SECTIONS',
  'resolveProfile_', 'validateProfile_', 'buildTopicHeaders_', 'buildTopicRow_',
  'buildBriefPrompt_', 'buildResponseSchema_', 'buildAiInput_', 'rowsToRecords_', 'parseGeminiResponse_',
  'cleanSlackText_', 'extractSlackMessageContent_', 'isRelevantListeningMessage_',
  'collectSlackLinks_', 'deduplicateMessages_', 'countReactions_',
  'parseBriefMarkdown_', 'tokenizeInlineMarkdown_', 'findDaySpan_',
  'parseBackfillDates_', 'normaliseSyncMinutes_', 'classificationCoverage_', 'splitInlineNumberedItems_', 'demoFeedRecords_', 'buildMessageRow_', 'escapeHtml_',
];

function load() {
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort();
  const source = files.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n;\n');
  const sandbox = { console };
  vm.createContext(sandbox);
  return vm.runInContext(`${source}\n;({ ${EXPORTS.join(', ')} });`, sandbox, { filename: 'gas-bundle.js' });
}

module.exports = { load };
