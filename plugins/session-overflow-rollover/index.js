/**
 * session-overflow-rollover
 *
 * 上下文溢出 / 自动压缩失败时：
 * 1) 拦截「请 /new」类恢复文案
 * 2) 归档旧会话（sessions.reset reason=new → *.reset.<ts>）
 * 3) 在新会话里重提上一问，让模型继续回答
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const PLUGIN_ID = 'session-overflow-rollover';
const COOLDOWN_MS = 20_000;
const TRIGGER_FILE = 'overflow-rollover.trigger.json';
const ARCHIVE_NOTE_DIR_REL = path.join('workspace', 'compact-history');

/** @type {Map<string, { text: string, at: number }>} */
const lastUserBySession = new Map();
/** @type {Map<string, number>} */
const lastRolloverAt = new Map();
/** @type {Set<string>} */
const inFlight = new Set();

function stateDir() {
  return (
    process.env.OPENCLAW_STATE_DIR ||
    path.join(
      process.env.OPENCLAW_HOME || process.env.USERPROFILE || process.env.HOME || os.homedir(),
      '.openclaw'
    )
  );
}

function extractText(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload.trim();
  if (typeof payload !== 'object') return '';
  const keys = [
    'content',
    'text',
    'body',
    'Body',
    'bodyForAgent',
    'BodyForAgent',
    'message',
    'rawBody',
    'RawBody',
    'commandBody',
  ];
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object') {
      if (typeof v.text === 'string' && v.text.trim()) return v.text.trim();
      if (typeof v.content === 'string' && v.content.trim()) return v.content.trim();
    }
  }
  if (Array.isArray(payload.content)) {
    return payload.content
      .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function resolveSessionKey(event, ctx) {
  const cands = [
    ctx && ctx.sessionKey,
    ctx && ctx.session_key,
    event && event.sessionKey,
    event && event.session_key,
    event && event.key,
    ctx && ctx.key,
    event && event.to && event.to.sessionKey,
    event && event.payload && event.payload.sessionKey,
  ];
  for (const k of cands) {
    if (typeof k === 'string' && k.trim()) return k.trim();
  }
  return '';
}

function resolveSessionKeyWithFallback(event, ctx) {
  const direct = resolveSessionKey(event, ctx);
  if (direct) return direct;
  let best = '';
  let bestAt = 0;
  for (const [k, v] of lastUserBySession.entries()) {
    if (v && v.at > bestAt) {
      bestAt = v.at;
      best = k;
    }
  }
  return best;
}

function resolveSessionFile(event, ctx) {
  const cands = [
    ctx && ctx.sessionFile,
    event && event.sessionFile,
    event && event.session_file,
  ];
  for (const p of cands) {
    if (typeof p === 'string' && p && fs.existsSync(p)) return p;
  }
  const sessionId =
    (ctx && (ctx.sessionId || ctx.sessionID)) ||
    (event && (event.sessionId || event.sessionID)) ||
    '';
  if (!sessionId) return '';
  const direct = path.join(stateDir(), 'agents', 'main', 'sessions', `${sessionId}.jsonl`);
  return fs.existsSync(direct) ? direct : '';
}

function readLastUserTextFromSessionFile(sessionFile) {
  try {
    if (!sessionFile || !fs.existsSync(sessionFile)) return '';
    const lines = fs.readFileSync(sessionFile, 'utf8').split(/\r?\n/).filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        const msg = obj && obj.message;
        if (!msg || msg.role !== 'user') continue;
        const text = extractText(msg);
        if (text && !isOverflowRecoveryText(text) && !text.startsWith('/')) return text;
      } catch (_) {}
    }
  } catch (_) {}
  return '';
}

function isOverflowRecoveryText(text) {
  const t = String(text || '');
  if (!t) return false;
  return (
    /Auto-compaction could not recover/i.test(t) ||
    /auto-compaction could not recover/i.test(t) ||
    /auto-compaction failed/i.test(t) ||
    /Context overflow/i.test(t) ||
    /context[_\s-]?overflow/i.test(t) ||
    /prompt too large for the model/i.test(t) ||
    /Compaction timed out/i.test(t) ||
    /compaction timeout/i.test(t) ||
    /compaction[-_ ]?diag/i.test(t) ||
    /trigger\s*=\s*overflow/i.test(t) ||
    /diagId\s*=\s*ovf-/i.test(t) ||
    /\[agent\/embedded\].*(overflow|compaction)/i.test(t) ||
    /use \/compact/i.test(t) ||
    /increase your compaction buffer/i.test(t) ||
    /reserveTokensFloor/i.test(t) ||
    /上下文过长|上下文溢出|自动压缩失败|请使用\s*\/new/i.test(t)
  );
}

function isRateLimitBannerText(text) {
  const t = String(text || '');
  if (!t) return false;
  if (isOverflowRecoveryText(t)) return false;
  return (
    /All models are temporarily rate-limited/i.test(t) ||
    /temporarily rate-limited/i.test(t) ||
    /API rate limit reached/i.test(t) ||
    /Rate-limited\s*[—\-]/i.test(t) ||
    /temporarily overloaded/i.test(t) ||
    /Please try again in a few minutes/i.test(t)
  );
}

function isUserFacingSystemErrorText(text) {
  return isOverflowRecoveryText(text) || isRateLimitBannerText(text);
}

function looksLikeOverflowFailure(event, ctx) {
  const parts = [];
  const push = (v) => {
    if (v == null) return;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      parts.push(String(v));
      return;
    }
    try {
      parts.push(JSON.stringify(v));
    } catch (_) {
      parts.push(String(v));
    }
  };
  if (event) {
    for (const k of ['error', 'rawError', 'message', 'reason', 'detail', 'errorMessage', 'note', 'status', 'outcome']) {
      push(event[k]);
    }
    if (event.data && typeof event.data === 'object') {
      for (const k of ['error', 'rawError', 'message', 'kind', 'reason', 'outcome', 'trigger']) {
        push(event.data[k]);
      }
    }
    push(event.kind);
    // 兜底：整包扫描，避免字段名变动漏检
    try {
      parts.push(JSON.stringify(event));
    } catch (_) {}
  }
  if (ctx) {
    push(ctx.error);
    try {
      parts.push(JSON.stringify(ctx));
    } catch (_) {}
  }
  const blob = parts.join('\n');
  if (isOverflowRecoveryText(blob)) return true;
  if (/context_overflow|compaction_failure|compaction.?timeout|compaction[-_ ]?diag|overflow recovery|trigger\s*=\s*overflow|diagId\s*=\s*ovf-|outcome\s*=\s*failed[\s\S]{0,80}(overflow|compaction|timeout)|reason\s*=\s*timeout/i.test(blob)) {
    return true;
  }
  if (event && event.success === false && /overflow|compaction|too large|precheck|timeout/i.test(blob)) {
    return true;
  }
  return false;
}

function rememberUserText(sessionKey, text) {
  if (!sessionKey || !text) return;
  if (isUserFacingSystemErrorText(text)) return;
  if (text.startsWith('/')) return;
  lastUserBySession.set(sessionKey, { text, at: Date.now() });
}

function pickLastUserText(sessionKey, event, ctx) {
  const cached = lastUserBySession.get(sessionKey);
  if (cached && cached.text) return cached.text;
  const file = resolveSessionFile(event, ctx);
  return readLastUserTextFromSessionFile(file);
}

function writeArchiveNote(sessionKey, lastUserText) {
  try {
    const dir = path.join(stateDir(), ARCHIVE_NOTE_DIR_REL);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeKey = String(sessionKey || 'session').replace(/[^\w.-]+/g, '_').slice(0, 80);
    const file = path.join(dir, `rollover_${safeKey}_${stamp}.md`);
    const body = [
      `# 会话自动归档`,
      ``,
      `- 时间: ${new Date().toISOString()}`,
      `- sessionKey: ${sessionKey}`,
      `- 原因: 上下文溢出 / 自动压缩失败`,
      ``,
      `## 待续问`,
      ``,
      lastUserText || '(无)',
      ``,
    ].join('\n');
    fs.writeFileSync(file, body, 'utf8');
    return file;
  } catch (_) {
    return '';
  }
}

function buildContinuePrompt(lastUserText) {
  // 对用户完全静默：不提及归档/中断/新会话，只重提原问题
  const q = String(lastUserText || '').trim();
  return q;
}

async function gatewayRequest(api, method, params) {
  const gw = api && api.runtime && api.runtime.gateway;
  if (!gw || typeof gw.request !== 'function') {
    throw new Error('api.runtime.gateway.request unavailable');
  }
  return gw.request(method, params);
}

async function performRollover(api, sessionKey, lastUserText, via) {
  if (!sessionKey) return false;
  if (inFlight.has(sessionKey)) return false;
  const now = Date.now();
  const prev = lastRolloverAt.get(sessionKey) || 0;
  if (now - prev < COOLDOWN_MS) {
    console.log(`[${PLUGIN_ID}] skip rollover (cooldown) key=${sessionKey} via=${via}`);
    return false;
  }

  inFlight.add(sessionKey);
  try {
    const note = writeArchiveNote(sessionKey, lastUserText);
    console.log(
      `[${PLUGIN_ID}] rollover start via=${via} key=${sessionKey}` +
        (note ? ` note=${note}` : '') +
        ` lastUserChars=${(lastUserText || '').length}`
    );

    await gatewayRequest(api, 'sessions.reset', {
      key: sessionKey,
      reason: 'new',
    });

    const continueText = buildContinuePrompt(lastUserText);
    if (!continueText) {
      // 没有可续问的内容：只静默归档换新会话，不向用户发任何提示
      lastRolloverAt.set(sessionKey, Date.now());
      console.log(`[${PLUGIN_ID}] rollover archived without resume (empty last user) key=${sessionKey}`);
      return true;
    }

    await gatewayRequest(api, 'chat.send', {
      sessionKey,
      message: continueText,
      idempotencyKey: crypto.randomUUID(),
    });

    lastRolloverAt.set(sessionKey, Date.now());
    console.log(`[${PLUGIN_ID}] rollover done key=${sessionKey}`);
    try {
      api.logger?.info?.(`[${PLUGIN_ID}] archived & resumed: ${sessionKey}`);
    } catch (_) {}
    return true;
  } catch (e) {
    // 失败不占冷却，否则主进程日志桥/二次触发会被错误挡住
    lastRolloverAt.delete(sessionKey);
    console.error(`[${PLUGIN_ID}] rollover failed:`, e && e.message ? e.message : e);
    // 最后兜底：RPC 不可用时至少清空过大会话文件，避免下一轮继续 overflow 哑火
    try {
      filesystemEmergencyReset(sessionKey, lastUserText);
    } catch (_) {}
    return false;
  } finally {
    inFlight.delete(sessionKey);
  }
}

function filesystemEmergencyReset(sessionKey, lastUserText) {
  try {
    const storePath = path.join(stateDir(), 'agents', 'main', 'sessions', 'sessions.json');
    if (!fs.existsSync(storePath)) return false;
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8').replace(/^\uFEFF/, ''));
    const entry = store && store[sessionKey];
    const sid = entry && entry.sessionId;
    if (!sid) return false;
    const file = path.join(stateDir(), 'agents', 'main', 'sessions', `${sid}.jsonl`);
    if (fs.existsSync(file)) {
      try {
        fs.copyFileSync(file, `${file}.bak-emergency-${Date.now()}`);
      } catch (_) {}
      fs.writeFileSync(file, '', 'utf8');
    }
    if (entry && typeof entry === 'object') {
      for (const k of Object.keys(entry)) {
        if (/estimated|overflow|compaction|totalTokens|inputTokens|promptTokens|contextTokens/i.test(k)) {
          delete entry[k];
        }
      }
      try {
        fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
      } catch (_) {}
    }
    writeArchiveNote(sessionKey, lastUserText);
    console.log(`[${PLUGIN_ID}] filesystem emergency reset key=${sessionKey} sid=${sid}`);
    return true;
  } catch (e) {
    console.warn(`[${PLUGIN_ID}] filesystem emergency reset failed:`, e && e.message);
    return false;
  }
}

function scheduleRollover(api, sessionKey, lastUserText, via) {
  if (!sessionKey) return;
  setTimeout(() => {
    performRollover(api, sessionKey, lastUserText, via).catch(() => {});
  }, 80);
}

async function performSilentRetry(api, sessionKey, lastUserText, via) {
  if (!sessionKey || !lastUserText) return false;
  if (inFlight.has(sessionKey)) return false;
  const now = Date.now();
  const prev = lastRolloverAt.get(sessionKey) || 0;
  if (now - prev < COOLDOWN_MS) {
    console.log(`[${PLUGIN_ID}] skip silent-retry (cooldown) key=${sessionKey} via=${via}`);
    return false;
  }
  inFlight.add(sessionKey);
  try {
    console.log(
      `[${PLUGIN_ID}] silent-retry start via=${via} key=${sessionKey} lastUserChars=${lastUserText.length}`
    );
    await gatewayRequest(api, 'chat.send', {
      sessionKey,
      message: String(lastUserText).trim(),
      idempotencyKey: crypto.randomUUID(),
    });
    lastRolloverAt.set(sessionKey, Date.now());
    console.log(`[${PLUGIN_ID}] silent-retry done key=${sessionKey}`);
    return true;
  } catch (e) {
    lastRolloverAt.delete(sessionKey);
    console.error(`[${PLUGIN_ID}] silent-retry failed:`, e && e.message ? e.message : e);
    return false;
  } finally {
    inFlight.delete(sessionKey);
  }
}

function scheduleSilentRetry(api, sessionKey, lastUserText, via) {
  if (!sessionKey || !lastUserText) return;
  setTimeout(() => {
    performSilentRetry(api, sessionKey, lastUserText, via).catch(() => {});
  }, 120);
}

function resolveFreshestInteractiveSessionKey() {
  try {
    const store = path.join(stateDir(), 'agents', 'main', 'sessions', 'sessions.json');
    if (!fs.existsSync(store)) return '';
    const raw = JSON.parse(fs.readFileSync(store, 'utf8').replace(/^\uFEFF/, ''));
    if (!raw || typeof raw !== 'object') return '';
    let best = '';
    let bestAt = 0;
    for (const [k, v] of Object.entries(raw)) {
      if (!k || /:cron:|:heartbeat:|:discord:channel:/i.test(k)) continue;
      const at = Number(v && (v.lastInteractionAt || v.updatedAt)) || 0;
      if (at >= bestAt) {
        bestAt = at;
        best = k;
      }
    }
    return best || 'agent:main:main';
  } catch (_) {
    return 'agent:main:main';
  }
}

function consumeMainProcessTrigger() {
  const file = path.join(stateDir(), TRIGGER_FILE);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    try {
      fs.unlinkSync(file);
    } catch (_) {}
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    const at = Number(obj.at) || 0;
    if (at && Date.now() - at > 120_000) return null;
    return {
      sessionKey: typeof obj.sessionKey === 'string' ? obj.sessionKey.trim() : '',
      reason: typeof obj.reason === 'string' ? obj.reason : 'main-trigger',
    };
  } catch (_) {
    try {
      fs.unlinkSync(file);
    } catch (__) {}
    return null;
  }
}

function pollMainProcessTrigger(api) {
  try {
    const hit = consumeMainProcessTrigger();
    if (!hit) return;
    const key = hit.sessionKey || resolveFreshestInteractiveSessionKey() || resolveSessionKeyWithFallback({}, {});
    if (!key || /:cron:|:heartbeat:/i.test(key)) return;
    const lastUser = pickLastUserText(key, {}, {});
    console.log(`[${PLUGIN_ID}] main-process trigger key=${key} reason=${hit.reason}`);
    scheduleRollover(api, key, lastUser, 'main-log-trigger');
  } catch (e) {
    console.warn(`[${PLUGIN_ID}] trigger poll error:`, e && e.message);
  }
}

function register(api) {
  try {
    api.logger?.info?.(`[${PLUGIN_ID}] loaded`);
  } catch (_) {}
  console.log(`[${PLUGIN_ID}] loaded (overflow → archive+resume; rate-limit → silent retry; log-bridge)`);

  // 主进程日志桥：compaction-diag 只出现在 stdout 时也能静默续聊
  try {
    setInterval(() => pollMainProcessTrigger(api), 1000);
  } catch (_) {}

  try {
    api.on('message_received', async (event, ctx) => {
      try {
        const key = resolveSessionKey(event, ctx);
        const text = extractText(event);
        if (key && text) rememberUserText(key, text);
      } catch (_) {}
    });
  } catch (_) {}

  try {
    api.on('before_dispatch', async (event, ctx) => {
      try {
        const key = resolveSessionKey(event, ctx);
        const text = extractText(event);
        if (key && text) rememberUserText(key, text);
      } catch (_) {}
    });
  } catch (_) {}

  api.on('agent_end', async (event, ctx) => {
    try {
      if (!looksLikeOverflowFailure(event, ctx)) return;
      const key = resolveSessionKeyWithFallback(event, ctx);
      if (!key) return;
      const lastUser = pickLastUserText(key, event, ctx);
      scheduleRollover(api, key, lastUser, 'agent_end');
    } catch (e) {
      console.warn(`[${PLUGIN_ID}] agent_end error:`, e && e.message);
    }
  });

  try {
    api.on('llm_output', async (event, ctx) => {
      try {
        const text = extractText(event) || extractText(event && event.payload);
        if (!isOverflowRecoveryText(text) && !looksLikeOverflowFailure(event, ctx)) return;
        const key = resolveSessionKeyWithFallback(event, ctx);
        if (!key) return;
        const lastUser = pickLastUserText(key, event, ctx);
        scheduleRollover(api, key, lastUser, 'llm_output');
      } catch (_) {}
    });
  } catch (_) {}

  api.on('message_sending', async (event, ctx) => {
    try {
      const text = extractText(event);
      if (!isUserFacingSystemErrorText(text)) return;
      const key = resolveSessionKeyWithFallback(event, ctx);
      const lastUser = key ? pickLastUserText(key, event, ctx) : '';
      if (isOverflowRecoveryText(text)) {
        if (key) scheduleRollover(api, key, lastUser, 'message_sending');
        console.log(`[${PLUGIN_ID}] cancel overflow recovery banner`);
        return {
          cancel: true,
          cancelReason: 'session-overflow-rollover:auto-archive-and-resume',
        };
      }
      // 限流/过载横幅：对用户静默，并在后台重提原问题（不重置会话）
      if (key && lastUser) scheduleSilentRetry(api, key, lastUser, 'message_sending');
      console.log(`[${PLUGIN_ID}] cancel rate-limit banner`);
      return {
        cancel: true,
        cancelReason: 'session-overflow-rollover:suppress-rate-limit-banner',
      };
    } catch (e) {
      console.warn(`[${PLUGIN_ID}] message_sending error:`, e && e.message);
    }
  });

  try {
    api.on('reply_payload_sending', async (event, ctx) => {
      try {
        const text = extractText(event?.payload) || extractText(event);
        if (!isUserFacingSystemErrorText(text)) return;
        const key = resolveSessionKeyWithFallback(event, ctx);
        const lastUser = key ? pickLastUserText(key, event, ctx) : '';
        if (isOverflowRecoveryText(text)) {
          if (key) scheduleRollover(api, key, lastUser, 'reply_payload_sending');
          return {
            cancel: true,
            cancelReason: 'session-overflow-rollover:auto-archive-and-resume',
          };
        }
        if (key && lastUser) scheduleSilentRetry(api, key, lastUser, 'reply_payload_sending');
        return {
          cancel: true,
          cancelReason: 'session-overflow-rollover:suppress-rate-limit-banner',
        };
      } catch (_) {}
    });
  } catch (_) {}
}

const pluginEntry = {
  id: PLUGIN_ID,
  name: 'Session Overflow Rollover',
  description:
    'On context overflow / compaction failure: archive session, start fresh, and resume the last user question',
  register,
};

export default pluginEntry;
export function activate(api) {
  return register(api);
}
