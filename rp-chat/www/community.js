// Клиент сервера сообщества: каталог ботов и групповые комнаты.
import { parseSSE } from './lib.js';

export class CommunityError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    this.name = 'CommunityError';
    this.kind = kind; // network | auth | forbidden | notfound | conflict | invalid | server | config
    this.status = status;
  }
}

/** «192.168.0.5:8787» → «http://192.168.0.5:8787»; убирает хвостовой / и /api. */
export function normalizeServerUrl(u) {
  let s = String(u ?? '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s.replace(/\/+$/, '').replace(/\/api$/i, '');
}

export const MAX_BOTS = 8; // как на сервере

export const isConnected = (c) => !!(c && c.url && c.token);

function kindForStatus(status) {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notfound';
  if (status === 409) return 'conflict';
  if (status >= 500) return 'server';
  return 'invalid';
}

function networkError(url) {
  const hint = /^http:/i.test(url)
    ? ' Проверьте, что сервер запущен на компьютере, телефон в той же сети (или включён Tailscale) и адрес указан верно.'
    : '';
  return new CommunityError('network', `Не удалось связаться с сервером сообщества (${url}).${hint}`);
}

async function request(cfg, method, path, { body, signal, auth = true } = {}) {
  if (!cfg?.url) throw new CommunityError('config', 'Адрес сервера сообщества не задан. Откройте Настройки → Сообщество.');
  if (auth && !cfg.token) throw new CommunityError('config', 'Вы не подключены к серверу сообщества. Откройте Настройки → Сообщество.');
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) headers.Authorization = 'Bearer ' + cfg.token;
  let res;
  try {
    res = await fetch(cfg.url + '/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw networkError(cfg.url);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* не JSON */
  }
  if (!res.ok) {
    const msg = json?.error?.message || `Ошибка сервера (${res.status}).`;
    throw new CommunityError(kindForStatus(res.status), msg, res.status);
  }
  return json;
}

const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
};

/* ---------- подключение ---------- */
export const health = (url, signal) => request({ url: normalizeServerUrl(url) }, 'GET', '/health', { auth: false, signal });
export const register = (url, { name, invite }) => request({ url: normalizeServerUrl(url) }, 'POST', '/register', { auth: false, body: { name, invite } });
export const getMe = (cfg) => request(cfg, 'GET', '/me');
export const renameMe = (cfg, name) => request(cfg, 'PUT', '/me', { body: { name } });

/* ---------- каталог ---------- */
export const catalogList = (cfg, { q, sort, offset, limit } = {}, signal) => request(cfg, 'GET', '/catalog' + qs({ q, sort, offset, limit }), { signal });
export const catalogGet = (cfg, id) => request(cfg, 'GET', `/catalog/${encodeURIComponent(id)}`);
export const catalogPublish = (cfg, card) => request(cfg, 'POST', '/catalog', { body: { card } });
export const catalogUpdate = (cfg, id, card) => request(cfg, 'PUT', `/catalog/${encodeURIComponent(id)}`, { body: { card } });
export const catalogRemove = (cfg, id) => request(cfg, 'DELETE', `/catalog/${encodeURIComponent(id)}`);
export const catalogDownload = (cfg, id) => request(cfg, 'POST', `/catalog/${encodeURIComponent(id)}/download`, { body: {} });

/* ---------- группы ---------- */
export const roomsList = (cfg, signal) => request(cfg, 'GET', '/rooms', { signal });
export const roomCreate = (cfg, { name, botMode, bots }) => request(cfg, 'POST', '/rooms', { body: { name, botMode, bots } });
export const roomJoin = (cfg, code) => request(cfg, 'POST', '/rooms/join', { body: { code } });
export const roomGet = (cfg, id, signal) => request(cfg, 'GET', `/rooms/${encodeURIComponent(id)}`, { signal });
export const roomPatch = (cfg, id, patch) => request(cfg, 'PATCH', `/rooms/${encodeURIComponent(id)}`, { body: patch });
export const roomDelete = (cfg, id) => request(cfg, 'DELETE', `/rooms/${encodeURIComponent(id)}`);
export const roomLeave = (cfg, id) => request(cfg, 'POST', `/rooms/${encodeURIComponent(id)}/leave`, { body: {} });
export const roomAddBot = (cfg, id, card) => request(cfg, 'POST', `/rooms/${encodeURIComponent(id)}/bots`, { body: { card } });
export const roomRemoveBot = (cfg, id, botId) => request(cfg, 'DELETE', `/rooms/${encodeURIComponent(id)}/bots/${encodeURIComponent(botId)}`);
export const messagesList = (cfg, id, { after, limit } = {}, signal) => request(cfg, 'GET', `/rooms/${encodeURIComponent(id)}/messages` + qs({ after, limit }), { signal });
export const messageSend = (cfg, id, { content, botId }) => request(cfg, 'POST', `/rooms/${encodeURIComponent(id)}/messages`, { body: { content, botId } });
export const messageDelete = (cfg, id, mid) => request(cfg, 'DELETE', `/rooms/${encodeURIComponent(id)}/messages/${mid}`);
export const sendTyping = (cfg, id, { botId, on }) => request(cfg, 'POST', `/rooms/${encodeURIComponent(id)}/typing`, { body: { botId, on } }).catch(() => null);

/**
 * Подписка на события комнаты (SSE поверх fetch, чтобы передать заголовок Authorization).
 * onEvent(event, data) вызывается для message / typing / room / deleted.
 * onStatus('open' | 'reconnecting' | 'fatal', CommunityError?) — состояние канала.
 * Переподключается сам и запрашивает пропущенное через ?after=<последний id>. Возвращает stop().
 */
export function streamRoom(cfg, roomId, { after = 0, onEvent, onStatus = () => {} }) {
  let stopped = false;
  let ctrl = null;
  let last = after;
  let delay = 1000;
  let lastByte = Date.now();
  let forced = false;

  // Телефон «уснул» / сеть сменилась: соединение могло молча умереть — переподключаемся сразу.
  const doc = globalThis.document;
  const win = globalThis.window;
  const wake = () => {
    if (stopped || (doc && doc.visibilityState === 'hidden')) return;
    forced = true;
    ctrl?.abort();
  };
  doc?.addEventListener?.('visibilitychange', wake);
  win?.addEventListener?.('online', wake);
  // Сервер шлёт «пинг» каждые 15 с; если тишина дольше 40 с — соединение мёртвое.
  const watchdog = setInterval(() => {
    if (!stopped && ctrl && Date.now() - lastByte > 40000) {
      forced = true;
      ctrl.abort();
    }
  }, 10000);

  const run = async () => {
    while (!stopped) {
      ctrl = new AbortController();
      lastByte = Date.now();
      try {
        const res = await fetch(`${cfg.url}/api/rooms/${encodeURIComponent(roomId)}/events${qs({ after: last })}`, {
          headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'text/event-stream' },
          signal: ctrl.signal,
        });
        if (!res.ok) {
          let msg = `Ошибка сервера (${res.status}).`;
          try { msg = (await res.json())?.error?.message || msg; } catch { /* не JSON */ }
          if (res.status === 401 || res.status === 403 || res.status === 404) {
            onStatus('fatal', new CommunityError(kindForStatus(res.status), msg, res.status));
            return;
          }
          throw new Error(msg);
        }
        onStatus('open');
        delay = 1000;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          lastByte = Date.now();
          buf += dec.decode(value, { stream: true });
          const { events, rest } = parseSSE(buf);
          buf = rest;
          for (const ev of events) {
            if (ev.event === 'message' && typeof ev.data?.id === 'number') last = Math.max(last, ev.data.id);
            onEvent(ev.event, ev.data);
          }
        }
      } catch {
        /* сеть пропала или соединение прервано — переподключимся */
      }
      if (stopped) return;
      if (forced) {
        forced = false; // сознательный перезапуск: без паузы и без мигания статуса
        continue;
      }
      onStatus('reconnecting');
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 10000);
    }
  };
  run();

  return () => {
    stopped = true;
    clearInterval(watchdog);
    doc?.removeEventListener?.('visibilitychange', wake);
    win?.removeEventListener?.('online', wake);
    ctrl?.abort();
  };
}
