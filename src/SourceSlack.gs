/* ================================
 * SOURCE: SLACK CHANNEL
 * ================================ */

/**
 * Trigger entry point (every minute). Pulls every message newer than the
 * LAST_SLACK_TS watermark, walking Slack's cursor until it catches up, hits
 * MAX_PAGES_PER_RUN, or is rate-limited (HTTP 429) — whichever comes first.
 *
 * Progress is saved in SLACK_CATCHUP_CURSOR / SLACK_CATCHUP_TARGET_TS so the
 * next run resumes exactly where this one stopped. The watermark only moves
 * once a catch-up sequence is complete, so a large backlog drained under the
 * 15-messages-per-minute cap can never cause older messages to be skipped.
 */
function syncSlackMessages() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw new Error('Another automation is currently running and holding the script lock.');
  }
  const started = Date.now();
  try {
    runSlackSyncStep_(started);
  } catch (err) {
    log_('syncSlackMessages', 'ERROR', err.stack || err.message);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function runSlackSyncStep_(started) {
  const props = getRequiredProperties_(['SPREADSHEET_ID', 'SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID']);
  const scriptProps = PropertiesService.getScriptProperties();
  const oldest = scriptProps.getProperty('LAST_SLACK_TS') || '0';
  let cursor = scriptProps.getProperty('SLACK_CATCHUP_CURSOR') || '';
  let catchupTargetTs = scriptProps.getProperty('SLACK_CATCHUP_TARGET_TS') || '';

  const existingIds = getExistingMessageIds_(props.SPREADSHEET_ID);
  let allMessages = [];
  let pagesFetched = 0;
  let stoppedOnRateLimit = false;
  let reachedEnd = false;

  while (pagesFetched < CONFIG.MAX_PAGES_PER_RUN) {
    let page;
    try {
      page = fetchSlackHistoryPage_(props.SLACK_CHANNEL_ID, oldest, cursor, props.SLACK_BOT_TOKEN);
    } catch (err) {
      if (String(err.message || '').indexOf('RATE_LIMITED') === 0) {
        stoppedOnRateLimit = true;
        break;
      }
      throw err;
    }
    pagesFetched++;
    allMessages = allMessages.concat(page.messages);

    // With only `oldest` bounded, Slack returns newest-first, so the first
    // page of a fresh sequence holds the timestamp to adopt as the watermark
    // once the whole sequence has drained.
    if (!catchupTargetTs && page.messages.length) {
      catchupTargetTs = page.messages.reduce((max, m) => Number(m.ts) > Number(max) ? m.ts : max, oldest);
    }
    if (page.hasMore && page.nextCursor) {
      cursor = page.nextCursor;
    } else {
      reachedEnd = true;
      break;
    }
  }

  const fresh = deduplicateMessages_(allMessages)
    .filter(m => Number(m.ts) > Number(oldest))
    .filter(isRelevantListeningMessage_)
    .filter(m => !existingIds.has(String(m.ts)))
    .sort((a, b) => Number(a.ts) - Number(b.ts));

  if (fresh.length) {
    const senderCache = {};
    const tz = getTimezone_();
    const rows = fresh.map(m => slackMessageToRow_(m, props.SLACK_CHANNEL_ID, props.SLACK_BOT_TOKEN, senderCache, tz));
    appendRows_(props.SPREADSHEET_ID, CONFIG.MESSAGE_SHEET, rows);
  }

  if (reachedEnd) {
    if (catchupTargetTs) scriptProps.setProperty('LAST_SLACK_TS', catchupTargetTs);
    scriptProps.deleteProperty('SLACK_CATCHUP_CURSOR');
    scriptProps.deleteProperty('SLACK_CATCHUP_TARGET_TS');
  } else {
    if (cursor) scriptProps.setProperty('SLACK_CATCHUP_CURSOR', cursor);
    if (catchupTargetTs) scriptProps.setProperty('SLACK_CATCHUP_TARGET_TS', catchupTargetTs);
  }

  const suffix = stoppedOnRateLimit
    ? ' Stopped early on a Slack rate limit; will resume next run.'
    : (!reachedEnd ? ' Backlog remains; will resume next run.' : '');
  log_('syncSlackMessages', 'SUCCESS',
    `Stored ${fresh.length} messages across ${pagesFetched} page(s) in ` +
    `${((Date.now() - started) / 1000).toFixed(1)}s.${suffix}`);
}

/** One page of conversations.history. `oldest` stays fixed for a whole sequence. */
function fetchSlackHistoryPage_(channelId, oldest, cursor, token) {
  const params = { channel: channelId, oldest: oldest, inclusive: false, limit: CONFIG.SLACK_PAGE_SIZE };
  if (cursor) params.cursor = cursor;
  const data = slackGet_(CONFIG.SLACK_HISTORY_URL, params, token);
  return {
    messages: data.messages || [],
    hasMore: Boolean(data.has_more),
    nextCursor: (data.response_metadata && data.response_metadata.next_cursor) || '',
  };
}

function slackGet_(url, params, token) {
  const query = Object.keys(params)
    .filter(k => params[k] !== '' && params[k] !== null && params[k] !== undefined)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  const response = UrlFetchApp.fetch(`${url}?${query}`, {
    method: 'get',
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  if (status === 429) {
    const retryAfter = Number(response.getHeaders()['Retry-After'] || 60);
    // Tagged so the sync loop can tell "stop and resume later" from a failure.
    throw new Error(`RATE_LIMITED: Slack rate limit reached. Retry after ${retryAfter} seconds.`);
  }
  let data;
  try {
    data = JSON.parse(response.getContentText());
  } catch (e) {
    throw new Error(`Slack returned non-JSON response (${status}).`);
  }
  if (status < 200 || status >= 300 || !data.ok) {
    throw new Error(`Slack API error: ${data.error || status}`);
  }
  return data;
}

function slackMessageToRow_(m, channelId, token, cache, tz) {
  const dt = new Date(Number(m.ts) * 1000);
  const sender = resolveSlackSender_(m, token, cache);
  return buildMessageRow_({
    id: m.ts,
    date: Utilities.formatDate(dt, tz, 'yyyy-MM-dd'),
    time: Utilities.formatDate(dt, tz, 'HH:mm:ss'),
    iso: Utilities.formatDate(dt, tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    channelId: channelId,
    senderId: m.user || m.bot_id || m.username || '',
    senderName: sender.name,
    senderType: sender.type,
    text: extractSlackMessageContent_(m),
    url: buildSlackMessageUrl_(channelId, m.ts),
    threadTs: m.thread_ts || '',
    replyCount: Number(m.reply_count || 0),
    reactionCount: countReactions_(m.reactions),
    links: collectSlackLinks_(m),
    raw: m,
    source: 'slack',
  });
}

function resolveSlackSender_(m, token, cache) {
  if (m.user) {
    const key = `user:${m.user}`;
    if (!cache[key]) {
      try {
        const data = slackGet_(CONFIG.SLACK_USERS_URL, { user: m.user }, token);
        const profile = (data.user && data.user.profile) || {};
        cache[key] = {
          name: profile.display_name || profile.real_name || data.user.real_name || m.user,
          type: data.user && data.user.is_bot ? 'Bot' : 'User',
        };
      } catch (e) {
        cache[key] = { name: m.username || m.user, type: 'User' };
      }
    }
    return cache[key];
  }
  if (m.bot_id) {
    const key = `bot:${m.bot_id}`;
    if (!cache[key]) {
      try {
        const data = slackGet_(CONFIG.SLACK_BOTS_URL, { bot: m.bot_id }, token);
        cache[key] = { name: (data.bot && data.bot.name) || m.username || m.bot_id, type: 'Bot' };
      } catch (e) {
        cache[key] = { name: m.username || m.bot_id, type: 'Bot' };
      }
    }
    return cache[key];
  }
  return { name: m.username || 'Unknown source', type: 'Unknown' };
}

function buildSlackMessageUrl_(channelId, ts) {
  const workspaceUrl = PropertiesService.getScriptProperties().getProperty('SLACK_WORKSPACE_URL');
  if (!workspaceUrl) return '';
  return `${workspaceUrl.replace(/\/$/, '')}/archives/${channelId}/p${String(ts).replace('.', '')}`;
}

/** Pure: Slack mrkdwn → plain text, keeping link targets visible. */
function cleanSlackText_(text) {
  return String(text || '')
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<([^>]+)>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/** Pure */
function collectSlackLinks_(m) {
  const links = [];
  (m.files || []).forEach(f => {
    if (f.permalink) links.push(f.permalink);
    else if (f.url_private) links.push(f.url_private);
  });
  (m.attachments || []).forEach(a => {
    if (a.title_link) links.push(a.title_link);
    if (a.from_url) links.push(a.from_url);
  });
  links.push(...(String(m.text || '').match(/https?:\/\/[^\s>|]+/g) || []));
  return [...new Set(links)];
}

/** Pure */
function countReactions_(reactions) {
  return (reactions || []).reduce((sum, r) => sum + Number(r.count || 0), 0);
}

/** Pure: last write wins per ts. */
function deduplicateMessages_(messages) {
  const map = new Map();
  messages.forEach(m => { if (m && m.ts) map.set(m.ts, m); });
  return [...map.values()];
}

/** Pure: drops channel housekeeping events and empty messages. */
function isRelevantListeningMessage_(message) {
  const excludedSubtypes = new Set(['channel_join', 'channel_leave', 'channel_name',
    'channel_purpose', 'channel_topic', 'channel_archive', 'channel_unarchive',
    'bot_add', 'bot_remove']);
  if (excludedSubtypes.has(message.subtype || '')) return false;

  const content = extractSlackMessageContent_(message);
  if (!content) return false;
  const lower = content.toLowerCase();
  return !['has joined the channel', 'has left the channel', 'has renamed the channel',
    'added an integration to this channel'].some(phrase => lower.includes(phrase));
}

/**
 * Pure: monitoring bots put the substance in attachments and blocks, not in
 * `text`, so read all three and de-duplicate the pieces.
 */
function extractSlackMessageContent_(message) {
  const parts = [];
  if (message.text) parts.push(cleanSlackText_(message.text));

  (message.attachments || []).forEach(a => {
    ['pretext', 'title', 'text'].forEach(k => { if (a[k]) parts.push(cleanSlackText_(a[k])); });
    (a.fields || []).forEach(f => {
      const fieldText = [f.title || '', f.value || ''].filter(Boolean).join(': ');
      if (fieldText) parts.push(cleanSlackText_(fieldText));
    });
    if (a.from_url) parts.push(a.from_url);
    if (a.title_link) parts.push(a.title_link);
  });

  (message.blocks || []).forEach(block => {
    if (block.text && block.text.text) parts.push(cleanSlackText_(block.text.text));
    (block.elements || []).forEach(el => {
      if (el.text) parts.push(cleanSlackText_(el.text));
      (el.elements || []).forEach(child => {
        if (child.text) parts.push(cleanSlackText_(child.text));
        if (child.url) parts.push(child.url);
      });
    });
  });

  return [...new Set(parts.filter(Boolean))].join('\n');
}
