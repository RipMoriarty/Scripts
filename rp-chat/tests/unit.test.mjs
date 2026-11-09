import assert from 'node:assert/strict';
import * as L from '../www/lib.js';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log('  ✓', name);
  } catch (e) {
    console.error('  ✗', name, '\n   ', e.message);
    process.exitCode = 1;
  }
};

const mira = L.normalizeCharacter(L.SEED_CHARACTERS[0]);
const settings = { ...L.DEFAULT_SETTINGS, userName: 'Алекс', userPersona: 'Молодой путник по имени {{user}}.' };

console.log('lib.js');

test('макросы {{char}} / {{user}} / <USER>', () => {
  assert.equal(L.applyMacros('Привет, {{user}}! Я {{ CHAR }}. <USER>/<BOT>', { char: 'Мира', user: 'Алекс' }), 'Привет, Алекс! Я Мира. Алекс/Мира');
});

test('системный промпт содержит поля персонажа и правила роли', () => {
  const p = L.buildSystemPrompt(mira, settings);
  assert.match(p, /персонажа по имени «Мира»/);
  assert.match(p, /Характер:\nОстроумная/);
  assert.match(p, /Манера речи и поведение:\nГоворит коротко/);
  assert.match(p, /Не рассказывай о прошлом наёмницы, пока Алекс не заслужит доверия/); // макрос в rules раскрыт
  assert.match(p, /Не выходи из роли/);
  assert.match(p, /Никогда не пиши реплики, мысли и действия за Алекс/);
  assert.match(p, /Молодой путник по имени Алекс/);
  assert.doesNotMatch(p, /\{\{/);
});

test('пустые поля не попадают в промпт', () => {
  const c = L.normalizeCharacter({ name: 'Тест', personality: 'Добрый' });
  const p = L.buildSystemPrompt(c, { ...settings, userPersona: '' });
  assert.match(p, /Характер:\nДобрый/);
  assert.doesNotMatch(p, /Сценарий|Пример диалога|Дополнительные правила|Персонаж пользователя/);
});

test('buildMessages: system первым, история обрезается по лимиту', () => {
  const history = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i }));
  const msgs = L.buildMessages(mira, { ...settings, contextMessages: 10 }, history);
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs.length, 11);
  assert.equal(msgs.at(-1).content, 'm49');
  assert.equal(msgs[1].content, 'm40');
});

test('buildMessages: continueLast добавляет служебную просьбу, пустые сообщения отбрасываются', () => {
  const history = [{ role: 'user', content: 'a' }, { role: 'assistant', content: '' }, { role: 'assistant', content: 'b' }];
  const msgs = L.buildMessages(mira, settings, history, { continueLast: true });
  assert.deepEqual(msgs.slice(1).map((m) => m.content), ['a', 'b', L.CONTINUE_PROMPT]);
});

test('приветствие подставляет имена', () => {
  const c = L.normalizeCharacter({ name: 'Рэй', firstMessage: 'Здравствуй, {{user}}, я {{char}}.' });
  assert.equal(L.greetingFor(c, settings), 'Здравствуй, Алекс, я Рэй.');
});

test('stripThink убирает блоки размышлений, в том числе незакрытые', () => {
  assert.equal(L.stripThink('<think>секрет</think>\n\nОтвет'), 'Ответ');
  assert.equal(L.stripThink('Привет <think>ещё думаю'), 'Привет ');
  assert.equal(L.stripThink('Без тегов'), 'Без тегов');
});

test('renderRichText: форматирование и защита от HTML', () => {
  const html = L.renderRichText('*улыбается* — **Привет**!\n`код`');
  assert.equal(html, '<em>улыбается</em> — <strong>Привет</strong>!<br><code>код</code>');
  const evil = L.renderRichText('<img src=x onerror=alert(1)><script>alert(2)</script> "q"');
  assert.ok(!evil.includes('<img') && !evil.includes('<script'));
  assert.match(evil, /&lt;img/);
});

test('describeError: классификация', () => {
  assert.equal(L.describeError(401, '{"error":{"message":"No auth"}}').kind, 'auth');
  assert.equal(L.describeError(402, '').kind, 'credits');
  assert.equal(L.describeError(429, '{"error":{"message":"rate"}}').kind, 'rate');
  assert.equal(L.describeError(404, '{"error":{"message":"No endpoints found for x"}}').kind, 'model');
  assert.equal(L.describeError(400, '{"error":{"message":"deepseek/x is not a valid model ID"}}').kind, 'model');
  assert.equal(L.describeError(503, 'oops').kind, 'server');
  const other = L.describeError(400, '{"error":{"message":"Bad temperature"}}');
  assert.equal(other.kind, 'other');
  assert.match(other.message, /Bad temperature/);
});

test('listFreeModels: только бесплатные DeepSeek, новые первыми', () => {
  const json = {
    data: [
      { id: 'deepseek/old:free', name: 'Old', created: 100, pricing: { prompt: '0', completion: '0' } },
      { id: 'deepseek/new:free', name: 'New', created: 300, pricing: { prompt: '0', completion: '0' }, context_length: 1048576 },
      { id: 'deepseek/paid', name: 'Paid', created: 400, pricing: { prompt: '0.000001', completion: '0.000002' } },
      { id: 'deepseek/v3-base:free', name: 'Base', created: 500, pricing: { prompt: '0', completion: '0' } },
      { id: 'meta/llama:free', name: 'Llama', created: 600, pricing: { prompt: '0', completion: '0' } },
    ],
  };
  assert.deepEqual(L.listFreeModels(json, 'deepseek').map((m) => m.id), ['deepseek/new:free', 'deepseek/old:free']);
  assert.equal(L.listFreeModels(json, '').length, 3); // old, new, llama (платная и base отфильтрованы)
  assert.deepEqual(L.listFreeModels({}, 'deepseek'), []);
});

test('импорт: собственный формат (экспорт → импорт)', () => {
  const exported = L.characterToExport(mira);
  assert.equal(exported.character.id, undefined);
  const back = L.fromImported(JSON.parse(JSON.stringify(exported)));
  assert.equal(back.name, 'Мира');
  assert.equal(back.behavior, mira.behavior);
  assert.notEqual(back.id, mira.id);
});

test('импорт: SillyTavern V2', () => {
  const c = L.fromImported({
    spec: 'chara_card_v2',
    data: { name: 'Кай', description: 'Вор', personality: 'Хитрый', scenario: 'Рынок', first_mes: '*ухмыляется*', mes_example: '<START>', system_prompt: 'Правило 1', post_history_instructions: 'Правило 2' },
  });
  assert.equal(c.name, 'Кай');
  assert.equal(c.firstMessage, '*ухмыляется*');
  assert.equal(c.exampleDialogue, '<START>');
  assert.equal(c.rules, 'Правило 1\n\nПравило 2');
});

test('импорт: SillyTavern V1 и мусор', () => {
  assert.equal(L.fromImported({ name: 'Ли', description: 'd', first_mes: 'hi', mes_example: '' }).firstMessage, 'hi');
  assert.equal(L.fromImported({ foo: 1 }), null);
  assert.equal(L.fromImported(null), null);
  assert.equal(L.fromImported({ spec: 'chara_card_v2', data: { description: 'без имени' } }), null);
});

function pngWithText(keyword, text) {
  const enc = new TextEncoder();
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set(enc.encode(type), 4);
    out.set(data, 8);
    return out;
  };
  const key = enc.encode(keyword);
  const val = enc.encode(text);
  const textData = new Uint8Array(key.length + 1 + val.length);
  textData.set(key, 0);
  textData.set(val, key.length + 1);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', new Uint8Array(13)), chunk('tEXt', textData), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const all = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}

test('PNG-карточка: достаём JSON из tEXt «chara» (UTF-8 в base64)', () => {
  const json = JSON.stringify({ spec: 'chara_card_v2', data: { name: 'Юки', first_mes: 'こんにちは, привет!' } });
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  const text = L.extractPngCharaText(pngWithText('chara', b64));
  assert.equal(text, json);
  assert.equal(L.fromImported(JSON.parse(text)).firstMessage, 'こんにちは, привет!');
});

test('PNG без карточки / не PNG → null', () => {
  assert.equal(L.extractPngCharaText(pngWithText('Comment', 'abc')), null);
  assert.equal(L.extractPngCharaText(new Uint8Array(40)), null);
});

test('chatToText использует имена', () => {
  const t = L.chatToText(mira, settings, [{ role: 'assistant', content: 'Привет' }, { role: 'user', content: 'Здравствуй' }]);
  assert.equal(t, 'Мира: Привет\n\nАлекс: Здравствуй');
});

test('серверы: класс, пресет, необходимость ключа', () => {
  assert.equal(L.serverClass('https://openrouter.ai/api/v1'), 'openrouter');
  assert.equal(L.serverClass('https://api.deepseek.com'), 'deepseek');
  assert.equal(L.serverClass('http://192.168.0.100:11434/v1'), 'local');
  assert.equal(L.needsApiKey('https://openrouter.ai/api/v1'), true);
  assert.equal(L.needsApiKey('http://192.168.0.100:1234/v1'), false);
  assert.equal(L.presetIdForUrl('http://10.0.0.5:11434/v1'), 'ollama');
  assert.equal(L.presetIdForUrl('http://10.0.0.5:1234/v1'), 'lmstudio');
  assert.equal(L.presetIdForUrl('http://10.0.0.5:5001/v1'), 'kobold');
  assert.equal(L.presetIdForUrl('http://127.0.0.1:8080/v1'), 'phone');
  assert.equal(L.presetIdForUrl('http://localhost:11434/v1'), 'phone');
  assert.equal(L.presetIdForUrl('http://10.0.0.5:9999/v1'), 'custom');
  assert.equal(L.presetIdForUrl('мусор'), 'custom');
  for (const pr of L.PRESETS) assert.equal(L.presetIdForUrl(pr.url), pr.id, pr.id);
  assert.deepEqual(L.defaultProfile('local'), { model: '', apiKey: '' });
  assert.equal(L.defaultProfile('openrouter').model, L.DEFAULT_SETTINGS.model);
});

test('parseExtraBody', () => {
  assert.deepEqual(L.parseExtraBody(''), { ok: true, value: {} });
  assert.deepEqual(L.parseExtraBody('{"top_p":0.9}'), { ok: true, value: { top_p: 0.9 } });
  assert.equal(L.parseExtraBody('[1]').ok, false);
  assert.equal(L.parseExtraBody('null').ok, false);
  const bad = L.parseExtraBody('{oops');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Неверный JSON/);
});

test('listAllModels: Ollama / LM Studio / Kobold', () => {
  const ollama = { object: 'list', data: [{ id: 'qwen2.5:7b' }, { id: 'llama3.1:8b' }] };
  assert.deepEqual(L.listAllModels(ollama).map((m) => m.id), ['llama3.1:8b', 'qwen2.5:7b']);
  assert.deepEqual(L.listAllModels({ models: [{ name: 'x' }] }).map((m) => m.id), ['x']);
  assert.deepEqual(L.listAllModels(null), []);
});

console.log('группы и сообщество');

const bots = [
  { id: 'b1', card: { name: 'Мира' } },
  { id: 'b2', card: { name: 'Старый Гоблин' } },
  { id: 'b3', card: { name: 'Ёжик' } },
];

test('mentionedBots: имя, слово из имени, регистр, ё/е, границы слов', () => {
  const ids = (t) => L.mentionedBots(t, bots).map((b) => b.id);
  assert.deepEqual(ids('@Мира, привет'), ['b1']);
  assert.deepEqual(ids('эй @мира!'), ['b1']);
  assert.deepEqual(ids('@гоблин, а ты?'), ['b2']);
  assert.deepEqual(ids('@Старый Гоблин, а ты?'), ['b2']);
  assert.deepEqual(ids('@Ежик иди сюда'), ['b3']);
  assert.deepEqual(ids('привет, Мира'), []); // без @ не считается
  assert.deepEqual(ids('@Мирабель'), []); // не часть более длинного слова
  assert.deepEqual(ids('почта a@Мира.ru'), []); // перед @ — буква
  assert.deepEqual(ids('@Мира и @Гоблин'), ['b1', 'b2']);
  assert.deepEqual(ids('@все, слушайте'), ['b1', 'b2', 'b3']);
  assert.deepEqual(ids('@all'), ['b1', 'b2', 'b3']);
});

test('pickResponders: all отвечают все, mention — только позванные, @ важнее режима', () => {
  const ids = (a) => a.map((b) => b.id);
  assert.deepEqual(ids(L.pickResponders({ botMode: 'all', bots, text: 'привет' })), ['b1', 'b2', 'b3']);
  assert.deepEqual(ids(L.pickResponders({ botMode: 'mention', bots, text: 'привет' })), []);
  assert.deepEqual(ids(L.pickResponders({ botMode: 'mention', bots, text: '@мира привет' })), ['b1']);
  assert.deepEqual(ids(L.pickResponders({ botMode: 'all', bots, text: '@мира привет' })), ['b1']);
  assert.deepEqual(L.pickResponders({ botMode: 'all', bots: [], text: 'x' }), []);
});

test('stripSpeakerPrefix убирает подпись «Имя:» только в начале', () => {
  assert.equal(L.stripSpeakerPrefix('Мира: *кивает* Да.', 'Мира'), '*кивает* Да.');
  assert.equal(L.stripSpeakerPrefix('**Мира**: Да.', 'Мира'), 'Да.');
  assert.equal(L.stripSpeakerPrefix('[Мира]: Да.', 'Мира'), 'Да.');
  assert.equal(L.stripSpeakerPrefix('Она сказала Мира: нет', 'Мира'), 'Она сказала Мира: нет');
  assert.equal(L.stripSpeakerPrefix('Просто текст', 'Мира'), 'Просто текст');
});

test('buildGroupSystemPrompt: участники, роль, макросы на отправителя, персона', () => {
  const card = L.characterToCard({ ...mira, description: 'Хозяйка таверны для {{user}}.' });
  const p = L.buildGroupSystemPrompt(card, { name: 'Таверна', humans: ['Аня', 'Борис'], bots: ['Мира', 'Гоблин'], sender: 'Борис', persona: 'Борис — бард.' });
  assert.match(p, /«Мира» в групповом чате «Таверна»/);
  assert.match(p, /Участники-люди: Аня, Борис/);
  assert.match(p, /Другие персонажи в сцене: Гоблин\./); // себя в списке нет
  assert.match(p, /Хозяйка таверны для Борис\./);
  assert.match(p, /Персонаж игрока Борис\nБорис — бард\./);
  assert.match(p, /БЕЗ подписи/);
  assert.doesNotMatch(p, /\{\{/);
});

test('groupHistoryToMessages: свои реплики — assistant, остальные — user с подписью, склейка и пропуск системных', () => {
  const msgs = [
    { kind: 'system', content: 'Аня присоединилась' },
    { kind: 'user', name: 'Аня', content: 'Привет всем' },
    { kind: 'user', name: 'Борис', content: 'Здорово' },
    { kind: 'bot', name: 'Мира', botId: 'b1', content: '*кивает*' },
    { kind: 'bot', name: 'Гоблин', botId: 'b2', content: 'Хе-хе' },
    { kind: 'user', name: 'Аня', content: '@Мира, пива' },
  ];
  assert.deepEqual(L.groupHistoryToMessages(msgs, 'b1'), [
    { role: 'user', content: 'Аня: Привет всем\nБорис: Здорово' },
    { role: 'assistant', content: '*кивает*' },
    { role: 'user', content: 'Гоблин: Хе-хе\nАня: @Мира, пива' },
  ]);
  // с точки зрения Гоблина Мира — «другой участник», её реплика склеена с предыдущими user-сообщениями
  const g = L.groupHistoryToMessages(msgs, 'b2');
  assert.deepEqual(g.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.match(g[0].content, /Борис: Здорово\nМира: \*кивает\*$/);
  assert.equal(g[1].content, 'Хе-хе');
  assert.equal(g[2].content, 'Аня: @Мира, пива');
});

test('buildGroupMessages: system первым, окно contextMessages, последним — сообщение человека', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ kind: 'user', name: 'Аня', content: 'м' + i }));
  const card = L.characterToCard(mira);
  const m = L.buildGroupMessages(card, 'b1', { name: 'Г', humans: ['Аня'], bots: [], sender: 'Аня' }, history, { contextMessages: 3 });
  assert.equal(m[0].role, 'system');
  assert.equal(m.at(-1).role, 'user');
  assert.match(m.at(-1).content, /м9$/);
  assert.equal(m.at(-1).content.includes('м6'), false);
  assert.match(m.at(-1).content, /м7/);
});

test('parseSSE: события, комментарии, CRLF, неполный хвост, битый JSON', () => {
  const r = L.parseSSE(': connected\n\nevent: message\ndata: {"id":1}\n\nevent: typing\r\ndata: {"on":true}\r\n\r\nevent: message\ndata: {"id"');
  assert.deepEqual(r.events, [{ event: 'message', data: { id: 1 } }, { event: 'typing', data: { on: true } }]);
  assert.match(r.rest, /^event: message/);
  const r2 = L.parseSSE(r.rest + ':2}\n\nevent: x\ndata: не json\n\n');
  assert.deepEqual(r2.events, [{ event: 'message', data: { id: 2 } }]);
  assert.equal(r2.rest, '');
});

test('characterToCard / characterFromCard: только поля персонажа, новый id', () => {
  const card = L.characterToCard({ ...mira, apiKey: 'секрет', chat: [1] });
  assert.equal(card.id, undefined);
  assert.equal(card.apiKey, undefined);
  assert.equal(card.name, 'Мира');
  const back = L.characterFromCard({ ...card, id: 'чужой' });
  assert.notEqual(back.id, 'чужой');
  assert.equal(back.name, 'Мира');
});

console.log(`\nunit: ${passed} passed`);
