// Сервер сообщества для «РП Чата»: каталог ботов и групповые комнаты.
// Только встроенные модули Node.js (нужен Node 18+), данные хранятся в одном JSON-файле.
//
// Запуск:  node server/server.mjs --invite МОЙ_КОД
// Флаги:   --port 8787  --host 0.0.0.0  --data ./rp-server-data.json  --invite КОД  --admin ТОКЕН
// Переменные окружения: RP_PORT, RP_HOST, RP_DATA, RP_INVITE, RP_ADMIN

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const LIMITS = {
  name: 30,
  roomName: 60,
  message: 8000,
  bots: 8,
  members: 20,
  catalogPerUser: 50,
  roomMessages: 5000,
  body: 400_000,
  avatar: 70_000,
};

const CARD_FIELDS = {
  name: 60,
  emoji: 8,
  tagline: 100,
  description: 4000,
  personality: 4000,
  behavior: 4000,
  scenario: 3000,
  firstMessage: 3000,
  exampleDialogue: 4000,
  rules: 3000,
};

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const rid = (n = 9) => crypto.randomBytes(n).toString('base64url');
const now = () => Date.now();
const safeEqual = (a, b) => crypto.timingSafeEqual(Buffer.from(sha(a)), Buffer.from(sha(b)));

class HttpError extends Error {
  constructor(status, message, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Оставляет в карточке только известные поля и обрезает их по длине. */
export function sanitizeCard(c) {
  if (!c || typeof c !== 'object') return null;
  const out = {};
  for (const [k, max] of Object.entries(CARD_FIELDS)) out[k] = String(c[k] ?? '').slice(0, max);
  out.name = out.name.trim();
  if (!out.name) return null;
  if (!out.emoji) out.emoji = '🙂';
  out.color = /^#[0-9a-f]{6}$/i.test(String(c.color || '')) ? c.color : '#7c5cff';
  const av = typeof c.avatar === 'string' ? c.avatar : '';
  out.avatar = av.length <= LIMITS.avatar && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(av) ? av : '';
  return out;
}

function cleanName(raw, what = 'Имя') {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > LIMITS.name) throw new HttpError(400, `${what} должно быть от 2 до ${LIMITS.name} символов.`, 'bad_name');
  return name;
}

const JOIN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function joinCode() {
  let s = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) s += JOIN_ALPHABET[bytes[i] % JOIN_ALPHABET.length];
  return s;
}

function emptyDb() {
  return { v: 1, seq: 0, users: {}, catalog: {}, rooms: {}, messages: {} };
}

function loadDb(file) {
  if (file && fs.existsSync(file)) {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...emptyDb(), ...d };
  }
  return emptyDb();
}

export function createApp({ dataFile = null, invite = '', adminToken = '', log = () => {} } = {}) {
  const db = loadDb(dataFile);
  const byToken = new Map(Object.values(db.users).map((u) => [u.tokenHash, u.id]));
  const subs = new Map(); // roomId -> Set<{res, userId}>

  /* ---------- сохранение ---------- */
  let timer = null;
  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dataFile) return;
    fs.mkdirSync(path.dirname(path.resolve(dataFile)), { recursive: true });
    const tmp = dataFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, dataFile);
  }
  function persist() {
    if (!dataFile || timer) return;
    timer = setTimeout(flush, 400);
    timer.unref?.();
  }

  /* ---------- вспомогательное ---------- */
  const userName = (id) => db.users[id]?.name || '—';

  function emit(roomId, event, data) {
    const set = subs.get(roomId);
    if (!set) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const s of set) s.res.write(payload);
  }

  function addMessage(room, { kind, userId = null, botId = null, name = '', content }) {
    const msg = { id: ++db.seq, kind, userId, botId, name, content: String(content), ts: now() };
    const list = (db.messages[room.id] ||= []);
    list.push(msg);
    if (list.length > LIMITS.roomMessages) list.splice(0, list.length - LIMITS.roomMessages);
    persist();
    emit(room.id, 'message', msg);
    return msg;
  }

  function roomDto(room, user) {
    return {
      id: room.id,
      name: room.name,
      ownerId: room.ownerId,
      botMode: room.botMode,
      joinCode: room.members.includes(user.id) ? room.joinCode : undefined,
      createdAt: room.createdAt,
      members: room.members.map((id) => ({ id, name: userName(id) })),
      bots: room.bots.map((b) => ({ id: b.id, addedBy: b.addedBy, card: b.card })),
    };
  }

  function catalogDto(item, full = false) {
    const c = item.card;
    const base = {
      id: item.id,
      name: c.name,
      emoji: c.emoji,
      color: c.color,
      avatar: c.avatar,
      tagline: c.tagline,
      authorId: item.authorId,
      authorName: userName(item.authorId),
      downloads: item.downloads,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
    return full ? { ...base, card: c } : base;
  }

  function authenticate(req, url) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : url.searchParams.get('token') || '';
    const id = token ? byToken.get(sha(token)) : null;
    if (!id || !db.users[id]) throw new HttpError(401, 'Нужно войти: ключ доступа не найден. Подключитесь к серверу заново в настройках.', 'unauthorized');
    return db.users[id];
  }

  function getRoom(ctx) {
    const room = db.rooms[ctx.params.id];
    if (!room) throw new HttpError(404, 'Группа не найдена.', 'no_room');
    if (!room.members.includes(ctx.user.id)) throw new HttpError(403, 'Вы не участник этой группы.', 'not_member');
    return room;
  }

  function dropRoom(room) {
    emit(room.id, 'room', { deleted: true });
    for (const s of subs.get(room.id) || []) s.res.end();
    subs.delete(room.id);
    delete db.rooms[room.id];
    delete db.messages[room.id];
    persist();
  }

  /* ---------- маршруты ---------- */
  const routes = [];
  const route = (method, pattern, auth, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([A-Za-z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, auth, handler });
  };
  const STREAM = Symbol('stream');

  route('GET', '/api/health', false, () => ({ ok: true, app: 'rp-chat-server', version: 1, inviteRequired: !!invite }));

  route('POST', '/api/register', false, ({ body }) => {
    if (invite && !safeEqual(body.invite ?? '', invite)) throw new HttpError(403, 'Неверный код доступа к серверу.', 'bad_invite');
    const name = cleanName(body.name, 'Ник');
    if (Object.values(db.users).some((u) => u.nameKey === name.toLowerCase())) throw new HttpError(409, 'Такой ник уже занят, выберите другой.', 'name_taken');
    const id = rid(8);
    const token = rid(24);
    db.users[id] = { id, name, nameKey: name.toLowerCase(), tokenHash: sha(token), createdAt: now() };
    byToken.set(sha(token), id);
    persist();
    log(`+ пользователь ${name}`);
    return { userId: id, token, name };
  });

  route('GET', '/api/me', true, ({ user }) => ({ id: user.id, name: user.name }));

  route('PUT', '/api/me', true, ({ user, body }) => {
    const name = cleanName(body.name, 'Ник');
    if (Object.values(db.users).some((u) => u.id !== user.id && u.nameKey === name.toLowerCase())) throw new HttpError(409, 'Такой ник уже занят.', 'name_taken');
    user.name = name;
    user.nameKey = name.toLowerCase();
    persist();
    return { id: user.id, name };
  });

  /* ----- каталог ----- */
  route('GET', '/api/catalog', true, ({ query }) => {
    const q = (query.get('q') || '').trim().toLowerCase();
    const sort = query.get('sort') === 'popular' ? 'popular' : 'new';
    const limit = Math.min(60, Math.max(1, Number(query.get('limit')) || 30));
    const offset = Math.max(0, Number(query.get('offset')) || 0);
    let items = Object.values(db.catalog);
    if (q) {
      items = items.filter((it) => [it.card.name, it.card.tagline, it.card.description, userName(it.authorId)].some((s) => String(s).toLowerCase().includes(q)));
    }
    items.sort(sort === 'popular' ? (a, b) => b.downloads - a.downloads || b.updatedAt - a.updatedAt : (a, b) => b.updatedAt - a.updatedAt);
    return { total: items.length, items: items.slice(offset, offset + limit).map((it) => catalogDto(it)) };
  });

  route('GET', '/api/catalog/:id', true, ({ params }) => {
    const it = db.catalog[params.id];
    if (!it) throw new HttpError(404, 'Бот не найден (возможно, его сняли с публикации).', 'no_item');
    return catalogDto(it, true);
  });

  route('POST', '/api/catalog', true, ({ user, body }) => {
    const card = sanitizeCard(body.card);
    if (!card) throw new HttpError(400, 'У бота должно быть имя.', 'bad_card');
    if (Object.values(db.catalog).filter((i) => i.authorId === user.id).length >= LIMITS.catalogPerUser) throw new HttpError(409, `Нельзя опубликовать больше ${LIMITS.catalogPerUser} ботов.`, 'limit');
    const id = rid(8);
    db.catalog[id] = { id, authorId: user.id, card, downloads: 0, createdAt: now(), updatedAt: now() };
    persist();
    return catalogDto(db.catalog[id], true);
  });

  route('PUT', '/api/catalog/:id', true, ({ user, params, body }) => {
    const it = db.catalog[params.id];
    if (!it) throw new HttpError(404, 'Бот не найден.', 'no_item');
    if (it.authorId !== user.id) throw new HttpError(403, 'Изменять можно только своих ботов.', 'forbidden');
    const card = sanitizeCard(body.card);
    if (!card) throw new HttpError(400, 'У бота должно быть имя.', 'bad_card');
    it.card = card;
    it.updatedAt = now();
    persist();
    return catalogDto(it, true);
  });

  route('DELETE', '/api/catalog/:id', true, ({ user, params, req }) => {
    const it = db.catalog[params.id];
    if (!it) throw new HttpError(404, 'Бот не найден.', 'no_item');
    const admin = adminToken && req.headers['x-admin-token'] && safeEqual(req.headers['x-admin-token'], adminToken);
    if (it.authorId !== user.id && !admin) throw new HttpError(403, 'Снять с публикации можно только своего бота.', 'forbidden');
    delete db.catalog[params.id];
    persist();
    return { ok: true };
  });

  route('POST', '/api/catalog/:id/download', true, ({ params }) => {
    const it = db.catalog[params.id];
    if (!it) throw new HttpError(404, 'Бот не найден.', 'no_item');
    it.downloads += 1;
    persist();
    return { downloads: it.downloads };
  });

  /* ----- комнаты ----- */
  route('GET', '/api/rooms', true, ({ user }) => {
    const rooms = Object.values(db.rooms).filter((r) => r.members.includes(user.id));
    const list = rooms.map((r) => {
      const msgs = db.messages[r.id] || [];
      const last = [...msgs].reverse().find((m) => m.kind !== 'system') || null;
      return {
        id: r.id,
        name: r.name,
        members: r.members.length,
        bots: r.bots.map((b) => b.card.name),
        last: last ? { name: last.name, content: last.content.slice(0, 140), ts: last.ts } : null,
        activity: last ? last.ts : r.createdAt,
      };
    });
    list.sort((a, b) => b.activity - a.activity);
    return { rooms: list };
  });

  route('POST', '/api/rooms', true, ({ user, body }) => {
    const name = cleanName(body.name, 'Название группы');
    if (name.length > LIMITS.roomName) throw new HttpError(400, 'Слишком длинное название.', 'bad_name');
    const cards = (Array.isArray(body.bots) ? body.bots : []).slice(0, LIMITS.bots).map(sanitizeCard).filter(Boolean);
    let code = joinCode();
    while (Object.values(db.rooms).some((r) => r.joinCode === code)) code = joinCode();
    const room = {
      id: rid(8),
      name,
      ownerId: user.id,
      joinCode: code,
      botMode: body.botMode === 'mention' ? 'mention' : 'all',
      createdAt: now(),
      members: [user.id],
      bots: cards.map((card) => ({ id: rid(6), addedBy: user.id, card })),
    };
    db.rooms[room.id] = room;
    db.messages[room.id] = [];
    persist();
    return roomDto(room, user);
  });

  route('POST', '/api/rooms/join', true, ({ user, body }) => {
    const code = String(body.code ?? '').trim().toUpperCase();
    const room = Object.values(db.rooms).find((r) => r.joinCode === code);
    if (!code || !room) throw new HttpError(404, 'Группа с таким кодом не найдена.', 'no_room');
    if (!room.members.includes(user.id)) {
      if (room.members.length >= LIMITS.members) throw new HttpError(409, 'В группе нет мест.', 'full');
      room.members.push(user.id);
      addMessage(room, { kind: 'system', content: `${user.name} присоединился(ась) к группе` });
      emit(room.id, 'room', {});
      persist();
    }
    return roomDto(room, user);
  });

  route('GET', '/api/rooms/:id', true, (ctx) => roomDto(getRoom(ctx), ctx.user));

  route('PATCH', '/api/rooms/:id', true, (ctx) => {
    const room = getRoom(ctx);
    if (room.ownerId !== ctx.user.id) throw new HttpError(403, 'Менять настройки группы может только её создатель.', 'forbidden');
    if (ctx.body.name != null) room.name = cleanName(ctx.body.name, 'Название группы');
    if (ctx.body.botMode === 'all' || ctx.body.botMode === 'mention') room.botMode = ctx.body.botMode;
    persist();
    emit(room.id, 'room', {});
    return roomDto(room, ctx.user);
  });

  route('DELETE', '/api/rooms/:id', true, (ctx) => {
    const room = getRoom(ctx);
    if (room.ownerId !== ctx.user.id) throw new HttpError(403, 'Удалить группу может только её создатель.', 'forbidden');
    dropRoom(room);
    return { ok: true };
  });

  route('POST', '/api/rooms/:id/leave', true, (ctx) => {
    const room = getRoom(ctx);
    room.members = room.members.filter((id) => id !== ctx.user.id);
    if (!room.members.length) {
      dropRoom(room);
      return { ok: true };
    }
    if (room.ownerId === ctx.user.id) room.ownerId = room.members[0];
    addMessage(room, { kind: 'system', content: `${ctx.user.name} покинул(а) группу` });
    emit(room.id, 'room', {});
    persist();
    return { ok: true };
  });

  route('POST', '/api/rooms/:id/bots', true, (ctx) => {
    const room = getRoom(ctx);
    if (room.bots.length >= LIMITS.bots) throw new HttpError(409, `В группе не может быть больше ${LIMITS.bots} ботов.`, 'limit');
    const card = sanitizeCard(ctx.body.card);
    if (!card) throw new HttpError(400, 'У бота должно быть имя.', 'bad_card');
    const bot = { id: rid(6), addedBy: ctx.user.id, card };
    room.bots.push(bot);
    addMessage(room, { kind: 'system', content: `${ctx.user.name} добавил(а) бота ${card.name}` });
    emit(room.id, 'room', {});
    persist();
    return { id: bot.id, addedBy: bot.addedBy, card: bot.card };
  });

  route('DELETE', '/api/rooms/:id/bots/:botId', true, (ctx) => {
    const room = getRoom(ctx);
    const bot = room.bots.find((b) => b.id === ctx.params.botId);
    if (!bot) throw new HttpError(404, 'Бот не найден в группе.', 'no_bot');
    if (room.ownerId !== ctx.user.id && bot.addedBy !== ctx.user.id) throw new HttpError(403, 'Убрать бота может создатель группы или тот, кто его добавил.', 'forbidden');
    room.bots = room.bots.filter((b) => b !== bot);
    addMessage(room, { kind: 'system', content: `${ctx.user.name} убрал(а) бота ${bot.card.name}` });
    emit(room.id, 'room', {});
    persist();
    return { ok: true };
  });

  route('GET', '/api/rooms/:id/messages', true, (ctx) => {
    const room = getRoom(ctx);
    const list = db.messages[room.id] || [];
    const afterRaw = ctx.query.get('after');
    const limit = Math.min(500, Math.max(1, Number(ctx.query.get('limit')) || 100));
    if (afterRaw != null && afterRaw !== '') {
      const after = Number(afterRaw) || 0;
      return { messages: list.filter((m) => m.id > after).slice(0, limit) };
    }
    return { messages: list.slice(-limit) };
  });

  route('POST', '/api/rooms/:id/messages', true, (ctx) => {
    const room = getRoom(ctx);
    const content = String(ctx.body.content ?? '').trim();
    if (!content) throw new HttpError(400, 'Пустое сообщение.', 'empty');
    if (content.length > LIMITS.message) throw new HttpError(400, `Сообщение длиннее ${LIMITS.message} символов.`, 'too_long');
    if (ctx.body.botId) {
      const bot = room.bots.find((b) => b.id === ctx.body.botId);
      if (!bot) throw new HttpError(404, 'Такого бота нет в группе.', 'no_bot');
      return addMessage(room, { kind: 'bot', userId: ctx.user.id, botId: bot.id, name: bot.card.name, content });
    }
    return addMessage(room, { kind: 'user', userId: ctx.user.id, name: ctx.user.name, content });
  });

  route('DELETE', '/api/rooms/:id/messages/:mid', true, (ctx) => {
    const room = getRoom(ctx);
    const list = db.messages[room.id] || [];
    const idx = list.findIndex((m) => m.id === Number(ctx.params.mid));
    if (idx < 0) throw new HttpError(404, 'Сообщение не найдено.', 'no_message');
    const m = list[idx];
    if (m.kind === 'system') throw new HttpError(403, 'Системные сообщения удалять нельзя.', 'forbidden');
    if (m.userId !== ctx.user.id && room.ownerId !== ctx.user.id) throw new HttpError(403, 'Удалить можно только своё сообщение.', 'forbidden');
    list.splice(idx, 1);
    persist();
    emit(room.id, 'deleted', { id: m.id });
    return { ok: true };
  });

  route('POST', '/api/rooms/:id/typing', true, (ctx) => {
    const room = getRoom(ctx);
    const bot = ctx.body.botId ? room.bots.find((b) => b.id === ctx.body.botId) : null;
    emit(room.id, 'typing', { userId: ctx.user.id, botId: bot ? bot.id : null, name: bot ? bot.card.name : ctx.user.name, on: ctx.body.on !== false });
    return { ok: true };
  });

  route('GET', '/api/rooms/:id/events', true, (ctx) => {
    const room = getRoom(ctx);
    const { req, res } = ctx;
    const after = Number(ctx.query.get('after')) || 0;
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...CORS,
    });
    res.write(': connected\n\n');
    for (const m of (db.messages[room.id] || []).filter((x) => x.id > after).slice(0, 500)) res.write(`event: message\ndata: ${JSON.stringify(m)}\n\n`);
    const sub = { res, userId: ctx.user.id };
    if (!subs.has(room.id)) subs.set(room.id, new Set());
    subs.get(room.id).add(sub);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      subs.get(room.id)?.delete(sub);
    });
    return STREAM;
  });

  /* ---------- HTTP ---------- */
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Admin-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
  };

  function send(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...CORS });
    res.end(body);
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > LIMITS.body) {
          reject(new HttpError(413, 'Слишком большой запрос.', 'too_large'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text.trim()) return resolve({});
        try {
          const v = JSON.parse(text);
          resolve(v && typeof v === 'object' ? v : {});
        } catch {
          reject(new HttpError(400, 'Некорректный JSON.', 'bad_json'));
        }
      });
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        return res.end();
      }
      const url = new URL(req.url, 'http://localhost');
      let hit = null;
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (m) {
          hit = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
          break;
        }
      }
      if (!hit) throw new HttpError(404, 'Не найдено.', 'not_found');
      const ctx = { req, res, url, query: url.searchParams, params: hit.params, user: null, body: {} };
      if (hit.r.auth) ctx.user = authenticate(req, url);
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) ctx.body = await readJson(req);
      const out = await hit.r.handler(ctx);
      if (out === STREAM) return;
      send(res, 200, out);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) return send(res, e.status, { error: { code: e.code, message: e.message } });
      log('ошибка: ' + (e?.stack || e));
      send(res, 500, { error: { code: 'internal', message: 'Внутренняя ошибка сервера.' } });
    }
  });

  function close() {
    flush();
    for (const set of subs.values()) for (const s of set) s.res.end();
    subs.clear();
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  return { server, flush, close, db };
}

/* ---------- запуск из командной строки ---------- */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const port = Number(a.port || process.env.RP_PORT || process.env.PORT || 8787);
  const host = a.host || process.env.RP_HOST || '0.0.0.0';
  const dataFile = a.data || process.env.RP_DATA || path.join(path.dirname(fileURLToPath(import.meta.url)), 'rp-server-data.json');
  const invite = a.invite || process.env.RP_INVITE || '';
  const adminToken = a.admin || process.env.RP_ADMIN || '';
  const app = createApp({ dataFile, invite, adminToken, log: (m) => console.log(new Date().toLocaleTimeString(), m) });
  app.server.listen(port, host, () => {
    console.log('РП Чат: сервер сообщества запущен.');
    console.log(`Данные: ${dataFile}`);
    console.log('Адреса для подключения из приложения (выберите тот, что в вашей сети или в Tailscale, 100.x.x.x):');
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`  http://${n.address}:${port}`);
    }
    console.log(invite ? 'Регистрация только по коду доступа (--invite).' : 'ВНИМАНИЕ: код доступа не задан, зарегистрироваться может любой, кто видит сервер. Запустите с --invite КОД.');
  });
  const stop = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
