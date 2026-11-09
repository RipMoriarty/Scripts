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

console.log(`\nunit: ${passed} passed`);
