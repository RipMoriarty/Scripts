// api.js — запросы к OpenAI-совместимому API (OpenRouter, DeepSeek и т.п.)
import { describeError, isOpenRouterUrl, parseExtraBody } from './lib.js';

export class ApiError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

const trimBase = (u) => String(u || '').trim().replace(/\/+$/, '');
const isOpenRouter = isOpenRouterUrl;

function authHeaders(settings) {
  const key = String(settings.apiKey || '').trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function errorFromResponse(res) {
  const text = await res.text().catch(() => '');
  const d = describeError(res.status, text);
  return new ApiError(d.kind, d.message, res.status);
}

function networkError(base = '') {
  if (/^http:\/\//i.test(String(base))) {
    return new ApiError(
      'network',
      'Не удалось подключиться к серверу. Проверьте: сервер запущен; телефон и ПК в одной Wi-Fi сети; адрес и порт верны; сервер слушает все адреса (0.0.0.0), а не только 127.0.0.1; в сервере разрешён CORS.',
    );
  }
  return new ApiError('network', 'Нет соединения с сервером. Проверьте интернет и адрес API в настройках.');
}

/**
 * Отправляет диалог модели. onDelta(piece) вызывается для каждого куска текста.
 * Возвращает { text, finish }.
 */
export async function chatCompletion({ settings, messages, signal, onDelta }) {
  const base = trimBase(settings.baseUrl);
  if (!base) throw new ApiError('config', 'Не указан адрес API (Base URL) в настройках.');
  if (!String(settings.model || '').trim()) throw new ApiError('config', 'Не выбрана модель. Откройте настройки и выберите её.');

  const extra = parseExtraBody(settings.extraBody);
  if (!extra.ok) throw new ApiError('config', 'Дополнительные параметры в настройках: ' + extra.error);

  const body = {
    ...extra.value,
    model: String(settings.model).trim(),
    messages,
    temperature: Number(settings.temperature),
    max_tokens: Number(settings.maxTokens),
    stream: !!settings.stream,
  };

  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(settings) },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw networkError(base);
  }
  if (!res.ok) throw await errorFromResponse(res);

  const ctype = res.headers.get('content-type') || '';
  if (!body.stream || !res.body || ctype.includes('application/json')) {
    let j;
    try {
      j = await res.json();
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      throw networkError(base);
    }
    if (j?.error) {
      const d = describeError(j.error.code || 500, JSON.stringify(j));
      throw new ApiError(d.kind, d.message, Number(j.error.code) || 0);
    }
    const text = j?.choices?.[0]?.message?.content ?? '';
    if (text) onDelta?.(text);
    return { text, finish: j?.choices?.[0]?.finish_reason ?? null };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let finish = null;
  let done = false;

  const handleLine = (raw) => {
    const line = raw.trim();
    if (!line || line.startsWith(':') || !line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (data === '[DONE]') {
      done = true;
      return;
    }
    let j;
    try {
      j = JSON.parse(data);
    } catch {
      return;
    }
    if (j.error) {
      const d = describeError(j.error.code || 500, JSON.stringify(j));
      throw new ApiError(d.kind, d.message, Number(j.error.code) || 0);
    }
    const choice = j.choices?.[0];
    const piece = choice?.delta?.content;
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (piece) {
      text += piece;
      onDelta?.(piece);
    }
  };

  try {
    while (!done) {
      const { value, done: eof } = await reader.read();
      if (eof) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        handleLine(line);
        if (done) break;
      }
    }
    if (buf && !done) handleLine(buf);
  } catch (e) {
    if (e?.name === 'AbortError' || e instanceof ApiError) throw e;
    if (text) {
      // соединение оборвалось, но часть ответа уже есть
      return { text, finish: 'interrupted' };
    }
    throw networkError(base);
  }
  return { text, finish };
}

/** Список моделей (публичный у OpenRouter, ключ не нужен). */
export async function fetchModels(settings, signal) {
  const base = trimBase(settings.baseUrl);
  if (!base) throw new ApiError('config', 'Не указан адрес API (Base URL).');
  let res;
  try {
    res = await fetch(`${base}/models`, { headers: isOpenRouter(base) ? {} : authHeaders(settings), signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw networkError(base);
  }
  if (!res.ok) throw await errorFromResponse(res);
  return res.json();
}

/**
 * Проверка подключения без расхода лимита запросов к моделям.
 * OpenRouter: проверяет ключ (GET /key). Другие серверы: GET /models, ключ необязателен.
 */
export async function checkConnection(settings) {
  const base = trimBase(settings.baseUrl);
  if (!base) throw new ApiError('config', 'Не указан адрес API (Base URL).');
  const orouter = isOpenRouter(base);
  if (orouter && !String(settings.apiKey || '').trim()) throw new ApiError('auth', 'Ключ не введён.');
  let res;
  try {
    res = await fetch(orouter ? `${base}/key` : `${base}/models`, { headers: authHeaders(settings) });
  } catch {
    throw networkError(base);
  }
  if (!res.ok) throw await errorFromResponse(res);
  const j = await res.json().catch(() => ({}));
  if (orouter) return { kind: 'openrouter', ...(j?.data && !Array.isArray(j.data) ? j.data : {}) };
  const list = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : [];
  return { kind: 'server', count: list.length };
}
