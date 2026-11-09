import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, sanitizeCard, LIMITS } from '../server/server.mjs';

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log('  ✓', name);
  } catch (e) {
    console.error('  ✗', name, '\n   ', e.stack || e.message);
    process.exitCode = 1;
  }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-srv-'));
const dataFile = path.join(tmp, 'data.json');

async function start(opts = {}) {
  const app = createApp({ dataFile, invite: 'secret', adminToken: 'adm', ...opts });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, p, { token, body, headers } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json, headers: res.headers };
  };
  return { app, base, call };
}

const card = (name, extra = {}) => ({ name, emoji: '🐺', personality: 'Грубоватая и честная', firstMessage: 'Привет', ...extra });

let S = await start();
const reg = async (name, invite = 'secret') => {
  const r = await S.call('POST', '/api/register', { body: { name, invite } });
  return r;
};

await test('health доступен без токена и сообщает про код доступа', async () => {
  const r = await S.call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.inviteRequired, true);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
});

await test('OPTIONS отвечает 204 с CORS', async () => {
  const res = await fetch(S.base + '/api/rooms', { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.match(res.headers.get('access-control-allow-headers'), /Authorization/);
});

await test('регистрация: неверный код → 403, верный → токен', async () => {
  assert.equal((await reg('Аня', 'nope')).status, 403);
  assert.equal((await reg('Аня', '')).status, 403);
  const ok = await reg('Аня');
  assert.equal(ok.status, 200);
  assert.ok(ok.json.token.length > 20);
});

await test('ник: занятый (без учёта регистра) → 409, слишком короткий → 400', async () => {
  assert.equal((await reg('аНя')).status, 409);
  assert.equal((await reg('Я')).status, 400);
  assert.equal((await reg('x'.repeat(31))).status, 400);
});

const anya = (await S.call('POST', '/api/register', { body: { name: 'Аня_2', invite: 'secret' } })).json;
const boris = (await reg('Борис')).json;
const vera = (await reg('Вера')).json;

await test('без токена или с чужим токеном → 401', async () => {
  assert.equal((await S.call('GET', '/api/me')).status, 401);
  assert.equal((await S.call('GET', '/api/me', { token: 'garbage' })).status, 401);
  const me = await S.call('GET', '/api/me', { token: boris.token });
  assert.equal(me.json.name, 'Борис');
});

await test('смена ника: можно, но не на занятый', async () => {
  assert.equal((await S.call('PUT', '/api/me', { token: vera.token, body: { name: 'борис' } })).status, 409);
  const r = await S.call('PUT', '/api/me', { token: vera.token, body: { name: 'Вера К' } });
  assert.equal(r.json.name, 'Вера К');
});

await test('sanitizeCard: обрезает, отбрасывает лишнее и плохой аватар', () => {
  const c = sanitizeCard({ name: '  Мира ', emoji: '', personality: 'x'.repeat(9999), evil: '<script>', color: 'red', avatar: 'javascript:alert(1)' });
  assert.equal(c.name, 'Мира');
  assert.equal(c.emoji, '🙂');
  assert.equal(c.personality.length, 4000);
  assert.equal(c.evil, undefined);
  assert.equal(c.color, '#7c5cff');
  assert.equal(c.avatar, '');
  assert.equal(sanitizeCard({ name: '   ' }), null);
  assert.equal(sanitizeCard(null), null);
  const ok = sanitizeCard({ name: 'A', avatar: 'data:image/png;base64,AAAA' });
  assert.equal(ok.avatar, 'data:image/png;base64,AAAA');
});

let itemId;
await test('каталог: публикация, чтение, поиск, сортировка', async () => {
  const pub = await S.call('POST', '/api/catalog', { token: anya.token, body: { card: card('Волчица', { description: 'Лесная охотница' }) } });
  assert.equal(pub.status, 200);
  itemId = pub.json.id;
  assert.equal(pub.json.authorName, 'Аня_2');
  const pub2 = await S.call('POST', '/api/catalog', { token: boris.token, body: { card: card('Дракон') } });
  const list = await S.call('GET', '/api/catalog', { token: vera.token });
  assert.equal(list.json.total, 2);
  assert.equal(list.json.items[0].name, 'Дракон'); // новее — выше
  assert.equal(list.json.items[0].card, undefined); // в списке нет полной карточки
  const q = await S.call('GET', '/api/catalog?q=' + encodeURIComponent('охотн'), { token: vera.token });
  assert.equal(q.json.total, 1);
  assert.equal(q.json.items[0].name, 'Волчица');
  const byAuthor = await S.call('GET', '/api/catalog?q=' + encodeURIComponent('борис'), { token: vera.token });
  assert.equal(byAuthor.json.total, 1);
  await S.call('POST', `/api/catalog/${itemId}/download`, { token: vera.token });
  const dl = await S.call('POST', `/api/catalog/${itemId}/download`, { token: boris.token });
  assert.equal(dl.json.downloads, 2);
  const pop = await S.call('GET', '/api/catalog?sort=popular', { token: vera.token });
  assert.equal(pop.json.items[0].id, itemId);
  const full = await S.call('GET', `/api/catalog/${itemId}`, { token: vera.token });
  assert.equal(full.json.card.personality, 'Грубоватая и честная');
  assert.ok(pub2.json.id);
});

await test('каталог: чужого бота нельзя менять или снимать, админ может снять', async () => {
  assert.equal((await S.call('PUT', `/api/catalog/${itemId}`, { token: boris.token, body: { card: card('Взлом') } })).status, 403);
  assert.equal((await S.call('DELETE', `/api/catalog/${itemId}`, { token: boris.token })).status, 403);
  assert.equal((await S.call('DELETE', `/api/catalog/${itemId}`, { token: boris.token, headers: { 'X-Admin-Token': 'wrong' } })).status, 403);
  const upd = await S.call('PUT', `/api/catalog/${itemId}`, { token: anya.token, body: { card: card('Волчица 2') } });
  assert.equal(upd.json.name, 'Волчица 2');
  const del = await S.call('DELETE', `/api/catalog/${itemId}`, { token: boris.token, headers: { 'X-Admin-Token': 'adm' } });
  assert.equal(del.status, 200);
  assert.equal((await S.call('GET', `/api/catalog/${itemId}`, { token: boris.token })).status, 404);
});

await test('каталог: бот без имени отклоняется; лимит публикаций', async () => {
  assert.equal((await S.call('POST', '/api/catalog', { token: anya.token, body: { card: { name: ' ' } } })).status, 400);
  assert.equal((await S.call('POST', '/api/catalog', { token: anya.token, body: {} })).status, 400);
  let last;
  for (let i = 0; i < LIMITS.catalogPerUser + 1; i++) last = await S.call('POST', '/api/catalog', { token: vera.token, body: { card: card('Б' + i) } });
  assert.equal(last.status, 409);
});

let room;
await test('комната: создание, код приглашения, вступление, список', async () => {
  const r = await S.call('POST', '/api/rooms', { token: anya.token, body: { name: 'Таверна', botMode: 'mention', bots: [card('Мира'), card('Гоблин'), { name: '' }] } });
  assert.equal(r.status, 200);
  room = r.json;
  assert.equal(room.bots.length, 2);
  assert.equal(room.botMode, 'mention');
  assert.match(room.joinCode, /^[A-HJKMNP-Z2-9]{8}$/);
  // вступление по коду, в том числе в нижнем регистре и с пробелами
  const j = await S.call('POST', '/api/rooms/join', { token: boris.token, body: { code: ' ' + room.joinCode.toLowerCase() + ' ' } });
  assert.equal(j.status, 200);
  assert.equal(j.json.members.length, 2);
  // повторное вступление не дублирует участника
  const j2 = await S.call('POST', '/api/rooms/join', { token: boris.token, body: { code: room.joinCode } });
  assert.equal(j2.json.members.length, 2);
  assert.equal((await S.call('POST', '/api/rooms/join', { token: vera.token, body: { code: 'ZZZZZZZZ' } })).status, 404);
  const list = await S.call('GET', '/api/rooms', { token: boris.token });
  assert.equal(list.json.rooms.length, 1);
  assert.deepEqual(list.json.rooms[0].bots, ['Мира', 'Гоблин']);
  assert.equal((await S.call('GET', '/api/rooms', { token: vera.token })).json.rooms.length, 0);
});

await test('комната: посторонний не видит ни комнату, ни сообщения', async () => {
  assert.equal((await S.call('GET', `/api/rooms/${room.id}`, { token: vera.token })).status, 403);
  assert.equal((await S.call('GET', `/api/rooms/${room.id}/messages`, { token: vera.token })).status, 403);
  assert.equal((await S.call('POST', `/api/rooms/${room.id}/messages`, { token: vera.token, body: { content: 'эй' } })).status, 403);
  assert.equal((await S.call('GET', `/api/rooms/nope`, { token: vera.token })).status, 404);
});

await test('сообщения: отправка, курсор after, лимиты, сообщение от бота', async () => {
  const m1 = await S.call('POST', `/api/rooms/${room.id}/messages`, { token: anya.token, body: { content: 'Привет, <b>все</b>' } });
  assert.equal(m1.json.kind, 'user');
  assert.equal(m1.json.name, 'Аня_2');
  assert.equal(m1.json.content, 'Привет, <b>все</b>'); // хранится как есть, экранирует клиент
  assert.equal((await S.call('POST', `/api/rooms/${room.id}/messages`, { token: anya.token, body: { content: '   ' } })).status, 400);
  assert.equal((await S.call('POST', `/api/rooms/${room.id}/messages`, { token: anya.token, body: { content: 'я'.repeat(LIMITS.message + 1) } })).status, 400);
  const botId = room.bots[0].id;
  const m2 = await S.call('POST', `/api/rooms/${room.id}/messages`, { token: boris.token, body: { content: 'Добро пожаловать!', botId } });
  assert.equal(m2.json.kind, 'bot');
  assert.equal(m2.json.name, 'Мира');
  assert.equal(m2.json.userId, boris.userId);
  assert.equal((await S.call('POST', `/api/rooms/${room.id}/messages`, { token: boris.token, body: { content: 'x', botId: 'нет' } })).status, 404);
  const all = await S.call('GET', `/api/rooms/${room.id}/messages`, { token: anya.token });
  // системное «присоединился» + 2 сообщения
  assert.equal(all.json.messages.length, 3);
  const after = await S.call('GET', `/api/rooms/${room.id}/messages?after=${m1.json.id}`, { token: anya.token });
  assert.deepEqual(after.json.messages.map((m) => m.id), [m2.json.id]);
  assert.ok(m2.json.id > m1.json.id);
});

await test('удаление сообщений: своё можно, чужое — только владельцу группы, системное нельзя', async () => {
  const a = (await S.call('POST', `/api/rooms/${room.id}/messages`, { token: anya.token, body: { content: 'от Ани' } })).json;
  const b = (await S.call('POST', `/api/rooms/${room.id}/messages`, { token: boris.token, body: { content: 'от Бориса' } })).json;
  assert.equal((await S.call('DELETE', `/api/rooms/${room.id}/messages/${a.id}`, { token: boris.token })).status, 403);
  assert.equal((await S.call('DELETE', `/api/rooms/${room.id}/messages/${b.id}`, { token: boris.token })).status, 200);
  assert.equal((await S.call('DELETE', `/api/rooms/${room.id}/messages/${b.id}`, { token: anya.token })).status, 404);
  const own = (await S.call('POST', `/api/rooms/${room.id}/messages`, { token: boris.token, body: { content: 'ещё' } })).json;
  assert.equal((await S.call('DELETE', `/api/rooms/${room.id}/messages/${own.id}`, { token: anya.token })).status, 200); // владелец
  const msgs = (await S.call('GET', `/api/rooms/${room.id}/messages`, { token: anya.token })).json.messages;
  const sys = msgs.find((m) => m.kind === 'system');
  assert.equal((await S.call('DELETE', `/api/rooms/${room.id}/messages/${sys.id}`, { token: anya.token })).status, 403);
});

await test('боты в группе: добавить, лимит, убрать (владелец или добавивший)', async () => {
  const add = await S.call('POST', `/api/rooms/${room.id}/bots`, { token: boris.token, body: { card: card('Бард') } });
  assert.equal(add.status, 200);
  assert.equal((await S.call('POST', `/api/rooms/${room.id}/bots`, { token: boris.token, body: { card: {} } })).status, 400);
  // Аня (владелец) удаляет бота Бориса — можно; Борис удаляет бота Ани — нельзя
  const mira = room.bots[0];
  assert.equal((await S.call('DELETE', `/api/rooms/${room.id}/bots/${mira.id}`, { token: boris.token })).status, 403);
  assert.equal((await S.call('DELETE', `/api/rooms/${room.id}/bots/${add.json.id}`, { token: boris.token })).status, 200);
  const add2 = await S.call('POST', `/api/rooms/${room.id}/bots`, { token: boris.token, body: { card: card('Ещё') } });
  assert.equal((await S.call('DELETE', `/api/rooms/${room.id}/bots/${add2.json.id}`, { token: anya.token })).status, 200);
  assert.equal((await S.call('DELETE', `/api/rooms/${room.id}/bots/nope`, { token: anya.token })).status, 404);
  for (let i = 0; i < 10; i++) await S.call('POST', `/api/rooms/${room.id}/bots`, { token: anya.token, body: { card: card('Бот' + i) } });
  const full = await S.call('GET', `/api/rooms/${room.id}`, { token: anya.token });
  assert.equal(full.json.bots.length, LIMITS.bots);
  assert.equal((await S.call('POST', `/api/rooms/${room.id}/bots`, { token: anya.token, body: { card: card('Лишний') } })).status, 409);
});

await test('настройки группы меняет только владелец', async () => {
  assert.equal((await S.call('PATCH', `/api/rooms/${room.id}`, { token: boris.token, body: { name: 'Взлом' } })).status, 403);
  const r = await S.call('PATCH', `/api/rooms/${room.id}`, { token: anya.token, body: { name: 'Таверна 2', botMode: 'all' } });
  assert.equal(r.json.name, 'Таверна 2');
  assert.equal(r.json.botMode, 'all');
  assert.equal((await S.call('PATCH', `/api/rooms/${room.id}`, { token: anya.token, body: { name: 'я' } })).status, 400);
});

await test('SSE: подключённый участник получает сообщения, typing и системные события', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${S.base}/api/rooms/${room.id}/events?after=999999`, { headers: { Authorization: 'Bearer ' + boris.token }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const waitFor = async (re) => {
    const t0 = Date.now();
    while (!re.test(buf)) {
      if (Date.now() - t0 > 4000) throw new Error('не дождались ' + re + ' в: ' + buf);
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
    }
  };
  await waitFor(/: connected/);
  await S.call('POST', `/api/rooms/${room.id}/messages`, { token: anya.token, body: { content: 'живое сообщение' } });
  await waitFor(/event: message\ndata: .*живое сообщение/);
  await S.call('POST', `/api/rooms/${room.id}/typing`, { token: anya.token, body: { botId: room.bots[0].id, on: true } });
  await waitFor(/event: typing\ndata: .*"name":"Мира".*"on":true/);
  await S.call('PATCH', `/api/rooms/${room.id}`, { token: anya.token, body: { name: 'Таверна 3' } });
  await waitFor(/event: room/);
  ctrl.abort();
});

await test('SSE: дозагрузка пропущенного через after; чужой не подключится', async () => {
  const all = (await S.call('GET', `/api/rooms/${room.id}/messages`, { token: anya.token })).json.messages;
  const mid = all[all.length - 2].id;
  const ctrl = new AbortController();
  const res = await fetch(`${S.base}/api/rooms/${room.id}/events?after=${mid}&token=${boris.token}`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const t0 = Date.now();
  while (!/живое сообщение|ещё|от Ани/.test(buf) && Date.now() - t0 < 4000) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  assert.match(buf, new RegExp(`"id":${all[all.length - 1].id}`));
  assert.doesNotMatch(buf, new RegExp(`"id":${mid},`));
  ctrl.abort();
  const bad = await fetch(`${S.base}/api/rooms/${room.id}/events`, { headers: { Authorization: 'Bearer ' + vera.token } });
  assert.equal(bad.status, 403);
});

await test('выход: владелец уходит → владельцем становится другой; последний ушёл → группа удалена', async () => {
  const leave = await S.call('POST', `/api/rooms/${room.id}/leave`, { token: anya.token });
  assert.equal(leave.status, 200);
  const r = await S.call('GET', `/api/rooms/${room.id}`, { token: boris.token });
  assert.equal(r.json.ownerId, boris.userId);
  assert.equal(r.json.members.length, 1);
  assert.equal((await S.call('GET', `/api/rooms/${room.id}`, { token: anya.token })).status, 403);
  await S.call('POST', `/api/rooms/${room.id}/leave`, { token: boris.token });
  assert.equal((await S.call('GET', `/api/rooms/${room.id}`, { token: boris.token })).status, 404);
});

await test('удаление группы — только владелец', async () => {
  const r = (await S.call('POST', '/api/rooms', { token: anya.token, body: { name: 'Временная' } })).json;
  await S.call('POST', '/api/rooms/join', { token: boris.token, body: { code: r.joinCode } });
  assert.equal((await S.call('DELETE', `/api/rooms/${r.id}`, { token: boris.token })).status, 403);
  assert.equal((await S.call('DELETE', `/api/rooms/${r.id}`, { token: anya.token })).status, 200);
  assert.equal((await S.call('GET', `/api/rooms/${r.id}`, { token: anya.token })).status, 404);
});

await test('код приглашения виден только участникам (в DTO для не-участника нет joinCode)', async () => {
  const r = (await S.call('POST', '/api/rooms', { token: anya.token, body: { name: 'Секретная' } })).json;
  assert.ok(r.joinCode);
  const list = await S.call('GET', '/api/rooms', { token: boris.token });
  assert.ok(!JSON.stringify(list.json).includes(r.joinCode));
});

await test('большой запрос → 413, плохой JSON → 400, неизвестный путь → 404', async () => {
  const big = await S.call('POST', '/api/catalog', { token: anya.token, body: JSON.stringify({ card: { name: 'x', description: 'я'.repeat(LIMITS.body) } }) }).catch((e) => ({ status: 'closed', e }));
  // сервер может оборвать соединение после 413 — оба исхода означают, что запрос отклонён
  assert.ok(big.status === 413 || big.status === 'closed', String(big.status));
  const bad = await S.call('POST', '/api/register', { body: '{oops' });
  assert.equal(bad.status, 400);
  assert.equal((await S.call('GET', '/api/nope')).status, 404);
});

await test('токены не хранятся в открытом виде', async () => {
  S.app.flush();
  const raw = fs.readFileSync(dataFile, 'utf8');
  assert.ok(!raw.includes(boris.token));
  assert.ok(raw.includes('tokenHash'));
});

await test('данные переживают перезапуск: пользователи, каталог, группы, сообщения, токены', async () => {
  const before = (await S.call('GET', '/api/catalog', { token: anya.token })).json.total;
  const roomsBefore = (await S.call('GET', '/api/rooms', { token: anya.token })).json.rooms.length;
  await S.app.close();
  S = await start();
  const me = await S.call('GET', '/api/me', { token: boris.token });
  assert.equal(me.json.name, 'Борис');
  assert.equal((await S.call('GET', '/api/catalog', { token: anya.token })).json.total, before);
  assert.equal((await S.call('GET', '/api/rooms', { token: anya.token })).json.rooms.length, roomsBefore);
  // счётчик id сообщений продолжается, а не начинается заново
  const r = (await S.call('GET', '/api/rooms', { token: anya.token })).json.rooms[0];
  const m = await S.call('POST', `/api/rooms/${r.id}/messages`, { token: anya.token, body: { content: 'после перезапуска' } });
  assert.ok(m.json.id > 5);
});

await test('сервер без кода доступа пускает всех', async () => {
  await S.app.close();
  const open = await start({ invite: '', dataFile: null });
  const r = await open.call('POST', '/api/register', { body: { name: 'Гость' } });
  assert.equal(r.status, 200);
  assert.equal((await open.call('GET', '/api/health')).json.inviteRequired, false);
  await open.app.close();
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nserver.test: ${passed} passed${process.exitCode ? ' (есть ошибки)' : ''}`);
