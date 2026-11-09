import assert from 'node:assert/strict';
import http from 'node:http';
import { chatCompletion, fetchModels, checkKey, ApiError } from '../www/api.js';

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

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (content, extra = {}) => sse({ choices: [{ delta: { content, ...extra } }] });

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = req.url;
    if (req.method === 'GET' && url === '/v1/models') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ data: [{ id: 'deepseek/x:free', created: 1, pricing: { prompt: '0', completion: '0' } }] }));
    }
    if (req.method === 'GET' && url === '/v1/key') {
      if (req.headers.authorization !== 'Bearer good') { res.statusCode = 401; return res.end('{"error":{"message":"bad key"}}'); }
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ data: { label: 'k', is_free_tier: true } }));
    }
    if (req.method === 'POST' && url === '/v1/chat/completions') {
      const j = JSON.parse(body);
      globalThis.__lastBody = j;
      globalThis.__lastAuth = req.headers.authorization;
      const model = j.model;
      const err = (code, msg) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: { code, message: msg } })); };
      if (model === 'err401') return err(401, 'No auth credentials found');
      if (model === 'err402') return err(402, 'Insufficient credits');
      if (model === 'err429') return err(429, 'Rate limit exceeded');
      if (model === 'err404') return err(404, 'No endpoints found for deepseek/gone:free');
      if (model === 'err503') return err(503, 'Provider returned error');
      if (model === 'json') {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ choices: [{ message: { content: 'Полный ответ' }, finish_reason: 'stop' }] }));
      }
      if (model === 'json200err') {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ error: { code: 429, message: 'upstream limit' } }));
      }
      res.setHeader('content-type', 'text/event-stream');
      if (model === 'stream') {
        // кусок JSON специально разрезан посреди строки, как бывает в сети
        const full = ': OPENROUTER PROCESSING\n\n' + delta('', { reasoning: 'думаю…' }) + delta('*Улыб') + delta('ается* — При') + delta('вет!') +
          sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n';
        const mid = Math.floor(full.length / 2);
        res.write(full.slice(0, mid));
        return setTimeout(() => { res.write(full.slice(mid)); res.end(); }, 20);
      }
      if (model === 'stream-error') {
        res.write(delta('Нача'));
        res.write(sse({ error: { code: 503, message: 'Provider disconnected' } }));
        return res.end();
      }
      if (model === 'stream-empty') {
        res.write(sse({ choices: [{ delta: {}, finish_reason: 'length' }] }));
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      if (model === 'slow') {
        res.write(delta('Первый кусок'));
        return; // не закрываем — ждём abort
      }
    }
    res.statusCode = 404;
    res.end('{}');
  });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/v1`;
const S = (model, extra = {}) => ({ baseUrl: base + '/', apiKey: ' good ', model, temperature: 0.7, maxTokens: 321, stream: true, ...extra });
const MSGS = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }];

console.log('api.js');

await test('стриминг: кусочки собираются, reasoning и комментарии игнорируются, тело запроса верное', async () => {
  const pieces = [];
  const r = await chatCompletion({ settings: S('stream'), messages: MSGS, onDelta: (d) => pieces.push(d) });
  assert.equal(r.text, '*Улыбается* — Привет!');
  assert.equal(pieces.join(''), r.text);
  assert.equal(r.finish, 'stop');
  assert.equal(globalThis.__lastBody.stream, true);
  assert.equal(globalThis.__lastBody.max_tokens, 321);
  assert.equal(globalThis.__lastBody.temperature, 0.7);
  assert.deepEqual(globalThis.__lastBody.messages, MSGS);
  assert.equal(globalThis.__lastAuth, 'Bearer good'); // пробелы вокруг ключа убраны
});

await test('без стриминга: обычный JSON-ответ', async () => {
  const r = await chatCompletion({ settings: S('json', { stream: false }), messages: MSGS });
  assert.equal(r.text, 'Полный ответ');
  assert.equal(globalThis.__lastBody.stream, false);
});

await test('сервер вернул JSON вместо SSE при stream=true', async () => {
  const r = await chatCompletion({ settings: S('json'), messages: MSGS });
  assert.equal(r.text, 'Полный ответ');
});

for (const [model, kind] of [['err401', 'auth'], ['err402', 'credits'], ['err429', 'rate'], ['err404', 'model'], ['err503', 'server']]) {
  await test(`HTTP-ошибка ${model} → kind=${kind}`, async () => {
    await assert.rejects(chatCompletion({ settings: S(model), messages: MSGS }), (e) => e instanceof ApiError && e.kind === kind && e.message.length > 10);
  });
}

await test('ошибка внутри JSON с кодом 200', async () => {
  await assert.rejects(chatCompletion({ settings: S('json200err'), messages: MSGS }), (e) => e.kind === 'rate');
});

await test('ошибка посреди потока пробрасывается', async () => {
  const pieces = [];
  await assert.rejects(chatCompletion({ settings: S('stream-error'), messages: MSGS, onDelta: (d) => pieces.push(d) }), (e) => e.kind === 'server');
  assert.deepEqual(pieces, ['Нача']);
});

await test('пустой поток → пустой текст (приложение покажет подсказку)', async () => {
  const r = await chatCompletion({ settings: S('stream-empty'), messages: MSGS });
  assert.equal(r.text, '');
  assert.equal(r.finish, 'length');
});

await test('отмена запроса (Стоп) даёт AbortError, часть текста уже получена', async () => {
  const ctrl = new AbortController();
  let got = '';
  const p = chatCompletion({ settings: S('slow'), messages: MSGS, signal: ctrl.signal, onDelta: (d) => { got += d; ctrl.abort(); } });
  await assert.rejects(p, (e) => e.name === 'AbortError');
  assert.equal(got, 'Первый кусок');
});

await test('недоступный сервер → kind=network', async () => {
  await assert.rejects(chatCompletion({ settings: { ...S('x'), baseUrl: 'http://127.0.0.1:1/v1' }, messages: MSGS }), (e) => e.kind === 'network');
});

await test('конфиг: нет модели / нет адреса', async () => {
  await assert.rejects(chatCompletion({ settings: S(''), messages: MSGS }), (e) => e.kind === 'config');
  await assert.rejects(chatCompletion({ settings: { ...S('x'), baseUrl: '' }, messages: MSGS }), (e) => e.kind === 'config');
});

await test('fetchModels и checkKey', async () => {
  const j = await fetchModels(S('x'));
  assert.equal(j.data[0].id, 'deepseek/x:free');
  // base не openrouter → /models; проверим, что /key вызывается только для openrouter, поэтому тут — просто /models
  const info = await checkKey(S('x'));
  assert.deepEqual(info, {});
  await assert.rejects(checkKey({ ...S('x'), apiKey: '' }), (e) => e.kind === 'auth');
});

server.close();
console.log(`\napi: ${passed} passed`);
