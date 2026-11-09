// Клиент community.js против настоящего сервера.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as C from '../www/community.js';
import { createApp } from '../server/server.mjs';

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-cli-'));
const dataFile = path.join(tmp, 'd.json');
const launch = async (port = 0) => {
  const app = createApp({ dataFile, invite: 'kod' });
  await new Promise((r) => app.server.listen(port, '127.0.0.1', r));
  return { app, port: app.server.address().port };
};
let { app, port } = await launch();
const url = `127.0.0.1:${port}`;

await test('normalizeServerUrl', () => {
  assert.equal(C.normalizeServerUrl(' 192.168.0.5:8787/ '), 'http://192.168.0.5:8787');
  assert.equal(C.normalizeServerUrl('https://x.example/api/'), 'https://x.example');
  assert.equal(C.normalizeServerUrl(''), '');
});

await test('health и ошибки: неверный код → forbidden; недоступный сервер → network', async () => {
  const h = await C.health(url);
  assert.equal(h.inviteRequired, true);
  await assert.rejects(C.register(url, { name: 'Аня', invite: 'не тот' }), (e) => e instanceof C.CommunityError && e.kind === 'forbidden');
  await assert.rejects(C.health('127.0.0.1:1'), (e) => e.kind === 'network' && /сервером сообщества/.test(e.message));
  await assert.rejects(C.getMe({ url: '' }), (e) => e.kind === 'config');
  await assert.rejects(C.getMe({ url: 'http://x' }), (e) => e.kind === 'config');
});

const reg = async (name) => {
  const r = await C.register(url, { name, invite: 'kod' });
  return { url: C.normalizeServerUrl(url), token: r.token, userId: r.userId, name };
};
const anya = await reg('Аня');
const boris = await reg('Борис');

await test('getMe/renameMe и плохой токен → auth', async () => {
  assert.equal((await C.getMe(anya)).name, 'Аня');
  assert.equal((await C.renameMe(anya, 'Аня К')).name, 'Аня К');
  await assert.rejects(C.getMe({ ...anya, token: 'x' }), (e) => e.kind === 'auth');
  assert.equal(C.isConnected(anya), true);
  assert.equal(C.isConnected({ url: 'x' }), false);
});

await test('каталог: публикация → поиск → скачивание → обновление → снятие', async () => {
  const card = { name: 'Волчица', emoji: '🐺', personality: 'Дикая', firstMessage: 'Р-р' };
  const pub = await C.catalogPublish(anya, card);
  const found = await C.catalogList(boris, { q: 'волч', sort: 'popular' });
  assert.equal(found.total, 1);
  assert.equal(found.items[0].id, pub.id);
  assert.equal((await C.catalogGet(boris, pub.id)).card.personality, 'Дикая');
  assert.equal((await C.catalogDownload(boris, pub.id)).downloads, 1);
  await assert.rejects(C.catalogRemove(boris, pub.id), (e) => e.kind === 'forbidden');
  assert.equal((await C.catalogUpdate(anya, pub.id, { ...card, name: 'Волчица II' })).name, 'Волчица II');
  await C.catalogRemove(anya, pub.id);
  await assert.rejects(C.catalogGet(boris, pub.id), (e) => e.kind === 'notfound');
  assert.equal((await C.catalogList(boris)).total, 0);
});

let room;
await test('группы: создание, вступление по коду, сообщения, бот-реплики, удаление', async () => {
  room = await C.roomCreate(anya, { name: 'Таверна', botMode: 'all', bots: [{ name: 'Мира' }] });
  const joined = await C.roomJoin(boris, room.joinCode);
  assert.equal(joined.members.length, 2);
  await assert.rejects(C.roomJoin(boris, 'НЕТ'), (e) => e.kind === 'notfound');
  const m = await C.messageSend(anya, room.id, { content: 'Привет' });
  const bm = await C.messageSend(anya, room.id, { content: 'Здравствуйте', botId: room.bots[0].id });
  assert.equal(bm.kind, 'bot');
  const list = await C.messagesList(boris, room.id, { after: m.id - 1 });
  assert.deepEqual(list.messages.map((x) => x.id), [m.id, bm.id]);
  assert.equal((await C.roomsList(boris)).rooms.length, 1);
  await C.messageDelete(anya, room.id, m.id);
  assert.equal((await C.roomPatch(anya, room.id, { botMode: 'mention' })).botMode, 'mention');
  const added = await C.roomAddBot(boris, room.id, { name: 'Бард' });
  await C.roomRemoveBot(boris, room.id, added.id);
});

await test('streamRoom: события приходят, переподключение после рестарта сервера дозагружает пропущенное', async () => {
  const got = [];
  const statuses = [];
  const waitFor = async (pred, ms = 8000) => {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > ms) throw new Error('таймаут; got=' + JSON.stringify(got) + ' statuses=' + statuses);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const stop = C.streamRoom(boris, room.id, {
    after: 0,
    onEvent: (ev, d) => got.push([ev, d]),
    onStatus: (s) => statuses.push(s),
  });
  await waitFor(() => statuses.includes('open'));
  await C.messageSend(anya, room.id, { content: 'живое-1' });
  await waitFor(() => got.some(([e, d]) => e === 'message' && d.content === 'живое-1'));
  await C.sendTyping(anya, room.id, { botId: room.bots[0].id, on: true });
  await waitFor(() => got.some(([e, d]) => e === 'typing' && d.name === 'Мира'));

  // сервер падает; пока он лежит, сообщение дописывается в файл данных новым экземпляром позже
  await app.close();
  await waitFor(() => statuses.includes('reconnecting'));
  ({ app } = await launch(port));
  await C.messageSend(anya, room.id, { content: 'пока-вас-не-было' });
  await waitFor(() => got.some(([e, d]) => e === 'message' && d.content === 'пока-вас-не-было'), 12000);
  const ids = got.filter(([e]) => e === 'message').map(([, d]) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'дубликатов быть не должно: ' + ids);
  stop();
  const n = got.length;
  await C.messageSend(anya, room.id, { content: 'после-стопа' });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(got.length, n, 'после stop() события не приходят');
});

await test('streamRoom: чужой / несуществующий → fatal без бесконечных повторов', async () => {
  const carol = await reg('Карол');
  const statuses = [];
  const stop = C.streamRoom(carol, room.id, { onEvent() {}, onStatus: (s, e) => statuses.push([s, e?.kind]) });
  await new Promise((r) => setTimeout(r, 400));
  stop();
  assert.deepEqual(statuses, [['fatal', 'forbidden']]);
});

await test('выход и удаление группы', async () => {
  await C.roomLeave(boris, room.id);
  await assert.rejects(C.roomGet(boris, room.id), (e) => e.kind === 'forbidden');
  await C.roomDelete(anya, room.id);
  await assert.rejects(C.roomGet(anya, room.id), (e) => e.kind === 'notfound');
});

await app.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\ncommunity: ${passed} passed`);
