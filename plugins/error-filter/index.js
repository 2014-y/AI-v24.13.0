/**
 * error-filter — 拦截带 ⚠️ / 系统失败样式的外发回复，避免刷到 QQ/飞书/微信/桌面会话
 *
 * OpenClaw 2026.7+：用 { id, register } + message_sending 返回 { cancel: true }
 */

const PLUGIN_ID = 'error-filter';

/** 命中任一即拦截（会话可见文案） */
const BLOCK_SUBSTRINGS = [
  '⚠️',
  '🛠️',
  '✉️ Message:',
  'Exec failed',
  'tool failed',
  'TOOL_FAILED',
  'openclaw-screenshot-latest',
];

/** 正则补充（大小写不敏感） */
const BLOCK_REGEXES = [
  /^\s*⚠️/,
  /Message:\s*.+\s+failed/i,
  /Exec failed/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
];

function extractText(event) {
  if (!event) return '';
  if (typeof event.content === 'string') return event.content;
  if (typeof event.text === 'string') return event.text;
  if (Array.isArray(event.content)) {
    return event.content
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p.text === 'string') return p.text;
        return '';
      })
      .join('\n');
  }
  if (event.payload && typeof event.payload.text === 'string') return event.payload.text;
  return '';
}

function shouldBlockOutbound(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  for (const s of BLOCK_SUBSTRINGS) {
    if (raw.includes(s)) return true;
  }
  for (const re of BLOCK_REGEXES) {
    try {
      if (re.test(raw)) return true;
    } catch (_) {}
  }
  return false;
}

function register(api) {
  try {
    api.logger?.info?.(`[${PLUGIN_ID}] loaded — suppress ⚠️ / system-failure outbound`);
  } catch (_) {}

  api.on('message_sending', async (event) => {
    try {
      const text = extractText(event);
      if (!shouldBlockOutbound(text)) return;
      const preview = text.replace(/\s+/g, ' ').slice(0, 100);
      try {
        api.logger?.info?.(`[${PLUGIN_ID}] cancelled outbound: ${preview}`);
      } catch (_) {}
      console.log(`[${PLUGIN_ID}] cancelled outbound: ${preview}`);
      return {
        cancel: true,
        cancelReason: 'error-filter:suppress-warning-banner',
      };
    } catch (e) {
      console.warn(`[${PLUGIN_ID}] message_sending hook error:`, e && e.message);
    }
  });
}

const pluginEntry = {
  id: PLUGIN_ID,
  name: 'Error Notification Filter',
  description: 'Suppresses ⚠️ / system failure banners from being delivered to user chats',
  register,
};

export default pluginEntry;
export function activate(api) {
  return register(api);
}
