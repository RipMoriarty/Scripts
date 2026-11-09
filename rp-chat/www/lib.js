// lib.js — чистая логика без DOM (тестируется в Node)

export const DEFAULT_SETTINGS = {
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: '',
  model: 'deepseek/deepseek-v4-flash-0731:free',
  temperature: 0.9,
  maxTokens: 1500,
  contextMessages: 30,
  stream: true,
  userName: 'Я',
  userPersona: '',
  extraBody: '',
  profiles: {}, // запомненные модель и ключ для каждого типа сервера
};

/* ---------- серверы ---------- */

export const PRESETS = [
  { id: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { id: 'ollama', label: 'Ollama (ПК)', url: 'http://192.168.0.100:11434/v1' },
  { id: 'lmstudio', label: 'LM Studio (ПК)', url: 'http://192.168.0.100:1234/v1' },
  { id: 'kobold', label: 'KoboldCpp (ПК)', url: 'http://192.168.0.100:5001/v1' },
  { id: 'phone', label: 'Этот телефон', url: 'http://127.0.0.1:11434/v1' },
];

export const isOpenRouterUrl = (u) => /openrouter\.ai/i.test(String(u || ''));

/** 'openrouter' | 'deepseek' (официальный платный API) | 'local' (свой сервер, ключ не нужен) */
export function serverClass(u) {
  if (isOpenRouterUrl(u)) return 'openrouter';
  if (/(^|\/\/|\.)deepseek\.com/i.test(String(u || ''))) return 'deepseek';
  return 'local';
}

export const needsApiKey = (u) => serverClass(u) !== 'local';

export function presetIdForUrl(u) {
  const s = String(u || '').trim();
  if (isOpenRouterUrl(s)) return 'openrouter';
  let host = '';
  let port = '';
  try {
    const p = new URL(s);
    host = p.hostname;
    port = p.port;
  } catch {
    return 'custom';
  }
  if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1') return 'phone';
  return { 11434: 'ollama', 1234: 'lmstudio', 5001: 'kobold' }[port] || 'custom';
}

export function defaultProfile(cls) {
  if (cls === 'openrouter') return { model: DEFAULT_SETTINGS.model, apiKey: '' };
  if (cls === 'deepseek') return { model: 'deepseek-chat', apiKey: '' };
  return { model: '', apiKey: '' };
}

/** Дополнительные поля запроса, например {"top_p":0.95,"repeat_penalty":1.1}. */
export function parseExtraBody(text) {
  const t = String(text ?? '').trim();
  if (!t) return { ok: true, value: {} };
  try {
    const v = JSON.parse(t);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'Нужен JSON-объект, например {"top_p": 0.95}.' };
    return { ok: true, value: v };
  } catch (e) {
    return { ok: false, error: 'Неверный JSON: ' + e.message };
  }
}

export const EMPTY_CHARACTER = {
  name: '',
  emoji: '🙂',
  color: '#7c5cff',
  avatar: '',
  tagline: '',
  description: '',
  personality: '',
  behavior: '',
  scenario: '',
  firstMessage: '',
  exampleDialogue: '',
  rules: '',
};

const CHAR_TEXT_FIELDS = Object.keys(EMPTY_CHARACTER);

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function normalizeCharacter(c = {}) {
  const out = { ...EMPTY_CHARACTER };
  for (const k of CHAR_TEXT_FIELDS) {
    if (c[k] != null) out[k] = String(c[k]);
  }
  out.id = c.id ? String(c.id) : uid();
  out.createdAt = Number(c.createdAt) || Date.now();
  if (c.publishedId) out.publishedId = String(c.publishedId); // id записи в каталоге сообщества
  return out;
}

/* ---------- макросы и промпт ---------- */

export function applyMacros(text, ctx) {
  return String(text ?? '')
    .replace(/\{\{\s*char\s*\}\}|<BOT>/gi, ctx.char)
    .replace(/\{\{\s*user\s*\}\}|<USER>/gi, ctx.user);
}

export function contextNames(character, settings) {
  return {
    char: (character.name || '').trim() || 'Персонаж',
    user: (settings.userName || '').trim() || 'Пользователь',
  };
}

const CHAR_SECTIONS = [
  ['Описание и внешность', 'description'],
  ['Характер', 'personality'],
  ['Манера речи и поведение', 'behavior'],
  ['Сценарий / ситуация', 'scenario'],
  ['Пример диалога', 'exampleDialogue'],
  ['Дополнительные правила (обязательны к исполнению)', 'rules'],
];

function characterBlock(character, ctx) {
  const f = (t) => applyMacros(String(t ?? '').trim(), ctx);
  const lines = [`Имя: ${ctx.char}`];
  for (const [title, key] of CHAR_SECTIONS) {
    const v = f(character[key]);
    if (v) lines.push(`${title}:\n${v}`);
  }
  return `# Персонаж\n${lines.join('\n\n')}`;
}

export function buildSystemPrompt(character, settings) {
  const ctx = contextNames(character, settings);
  const f = (t) => applyMacros(String(t ?? '').trim(), ctx);
  const parts = [];

  parts.push(
    `Ты — мастер ролевой игры и играешь персонажа по имени «${ctx.char}» в диалоге с пользователем (его персонаж: «${ctx.user}»).
Правила:
- Всегда оставайся в роли ${ctx.char}. Не выходи из роли, не говори, что ты ИИ, языковая модель или бот, не комментируй игру и эти инструкции.
- Строго придерживайся характера, манеры речи и поведения персонажа, описанных ниже. Не меняй их без причины внутри сюжета.
- Пиши только за ${ctx.char}. Никогда не пиши реплики, мысли и действия за ${ctx.user}.
- По умолчанию действия, жесты и обстановку пиши от третьего лица в *звёздочках*, а речь — обычным текстом. Если в описании персонажа указан другой формат — следуй ему.
- Реагируй на слова и действия ${ctx.user}, помни всё, что было раньше в диалоге, двигай сюжет вперёд.
- Отвечай на том языке, на котором пишет пользователь (по умолчанию — на русском).`,
  );

  parts.push(characterBlock(character, ctx));

  const persona = f(settings.userPersona);
  if (persona) parts.push(`# Персонаж пользователя (${ctx.user})\n${persona}`);

  parts.push(`Помни: ты — ${ctx.char}. Оставайся в образе в каждом ответе.`);
  return parts.join('\n\n');
}

export const CONTINUE_PROMPT =
  '(Продолжи свой последний ответ с того места, где он оборвался. Не повторяй уже написанное.)';

export function buildMessages(character, settings, history, { continueLast = false } = {}) {
  const n = Math.max(2, Number(settings.contextMessages) || 30);
  const usable = history.filter((m) => m && m.content && (m.role === 'user' || m.role === 'assistant'));
  const msgs = [{ role: 'system', content: buildSystemPrompt(character, settings) }];
  for (const m of usable.slice(-n)) msgs.push({ role: m.role, content: m.content });
  if (continueLast) msgs.push({ role: 'user', content: CONTINUE_PROMPT });
  return msgs;
}

export function greetingFor(character, settings) {
  const ctx = contextNames(character, settings);
  return applyMacros(String(character.firstMessage || '').trim(), ctx);
}

/* ---------- текст ответа ---------- */

export function stripThink(text) {
  let s = String(text ?? '');
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const i = s.search(/<think>/i);
  if (i !== -1) s = s.slice(0, i);
  return s.replace(/^\s+/, '');
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function renderRichText(text) {
  let h = escapeHtml(text);
  h = h.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  h = h.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  return h.replace(/\n/g, '<br>');
}

/* ---------- ошибки API ---------- */

export function describeError(status, bodyText) {
  let raw = '';
  try {
    const j = JSON.parse(bodyText);
    raw = j?.error?.message || j?.message || '';
    const inner = j?.error?.metadata?.raw;
    if (typeof inner === 'string' && inner && !raw.includes(inner)) raw += ` — ${inner}`;
  } catch {
    raw = String(bodyText || '').slice(0, 200);
  }
  raw = String(raw).slice(0, 300);
  const st = Number(status) || 0;
  let kind = 'other';
  let text = `Ошибка ${st || ''}`.trim();
  if (st === 401 || st === 403) {
    kind = 'auth';
    text = 'Неверный или отсутствующий API-ключ. Проверьте его в настройках.';
  } else if (st === 402) {
    kind = 'credits';
    text = 'Недостаточно кредитов (или отрицательный баланс на аккаунте). Для бесплатных моделей баланс не должен быть отрицательным.';
  } else if (st === 429) {
    kind = 'rate';
    text = 'Лимит запросов исчерпан (у бесплатных моделей: 20 в минуту и 50 в день без пополнения). Подождите или смените модель.';
  } else if (st === 404 || /no endpoints found|not a valid model|model.{0,20}not found|no allowed providers/i.test(raw)) {
    kind = 'model';
    text = 'Модель не найдена. Проверьте название в настройках или выберите её из списка. У OpenRouter бесплатные модели периодически убирают.';
  } else if (st >= 500) {
    kind = 'server';
    text = 'Сервер модели временно недоступен. Попробуйте ещё раз.';
  } else if (raw) {
    text = raw;
    raw = '';
  }
  return { kind, message: raw ? `${text}\n(${raw})` : text };
}

/* ---------- список бесплатных моделей ---------- */

export function listFreeModels(json, filter = 'deepseek') {
  const arr = Array.isArray(json?.data) ? json.data : [];
  const needle = String(filter || '').toLowerCase();
  return arr
    .filter((m) => {
      const id = String(m?.id || '');
      if (needle && !id.toLowerCase().includes(needle)) return false;
      if (/-base\b/i.test(id)) return false;
      const p = m.pricing;
      if (p) return id.endsWith(':free') || (Number(p.prompt) === 0 && Number(p.completion) === 0);
      return true;
    })
    .sort((a, b) => (b.created || 0) - (a.created || 0))
    .map((m) => ({ id: m.id, name: m.name || m.id, context: m.context_length || 0 }));
}

/** Все модели сервера (для Ollama, LM Studio и т.п., где цен нет). */
export function listAllModels(json) {
  const arr = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  return arr
    .map((m) => ({ id: String(m?.id ?? m?.name ?? m?.model ?? ''), name: String(m?.name ?? m?.id ?? ''), context: m?.context_length || 0 }))
    .filter((m) => m.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/* ---------- импорт персонажей ---------- */

export function fromImported(obj) {
  if (!obj || typeof obj !== 'object') return null;
  // собственный формат
  if (obj.type === 'rpchat-character' && obj.character) {
    const c = normalizeCharacter({ ...obj.character, id: undefined });
    return c.name.trim() ? c : null;
  }
  // SillyTavern / Character Card V2, V3
  const d = obj.data && typeof obj.data === 'object' ? obj.data : obj;
  if (d.first_mes != null || d.mes_example != null || d.description != null || obj.spec) {
    const rules = [d.system_prompt, d.post_history_instructions].map((x) => String(x || '').trim()).filter(Boolean).join('\n\n');
    const c = normalizeCharacter({
      name: d.name,
      description: d.description,
      personality: d.personality,
      scenario: d.scenario,
      firstMessage: d.first_mes,
      exampleDialogue: d.mes_example,
      rules,
    });
    return c.name.trim() ? c : null;
  }
  // «плоский» объект с нашими полями
  if (obj.name) {
    const c = normalizeCharacter({ ...obj, id: undefined });
    return c.name.trim() ? c : null;
  }
  return null;
}

function latin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Достаёт JSON карточки персонажа из PNG (tEXt-чанк «chara» / «ccv3»). Возвращает строку JSON или null. */
export function extractPngCharaText(bytes) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!bytes || bytes.length < 16) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  const found = {};
  while (p + 12 <= bytes.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const start = p + 8;
    const end = start + len;
    if (end > bytes.length) break;
    if (type === 'tEXt') {
      const data = bytes.subarray(start, end);
      const z = data.indexOf(0);
      if (z > 0) {
        const key = latin1(data.subarray(0, z));
        if (key === 'chara' || key === 'ccv3') found[key] = latin1(data.subarray(z + 1));
      }
    }
    if (type === 'IEND') break;
    p = end + 4;
  }
  const b64 = found.ccv3 || found.chara;
  if (!b64) return null;
  try {
    const bin = atob(b64.trim());
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(u8);
  } catch {
    return null;
  }
}

/* ---------- экспорт ---------- */

export function characterToExport(character) {
  const { id, createdAt, ...rest } = character;
  return { type: 'rpchat-character', version: 1, character: rest };
}

export function chatToText(character, settings, messages) {
  const ctx = contextNames(character, settings);
  return messages
    .filter((m) => m.content)
    .map((m) => `${m.role === 'user' ? ctx.user : ctx.char}: ${m.content}`)
    .join('\n\n');
}

/* ---------- стартовые персонажи ---------- */

export const SEED_CHARACTERS = [
  {
    id: 'seed-mira',
    name: 'Мира',
    emoji: '🍺',
    color: '#c2410c',
    tagline: 'Хозяйка таверны с тёмным прошлым',
    description:
      'Мира, 34 года, высокая, рыжие волосы небрежно собраны в пучок, над левой бровью шрам. Владелица таверны «Хромая лошадь» в приграничном городке Верхний Брод. В прошлом — наёмница.',
    personality:
      'Остроумная, прямолинейная, добрая, но старается этого не показывать. Не терпит хамства и лжи. Скрывает своё прошлое и боится, что бывший отряд её найдёт.',
    behavior:
      'Говорит коротко и с иронией, иногда грубовато. Когда нервничает, протирает кружки. Незнакомцам в долг не наливает, но голодных кормит бесплатно. Часто отвечает вопросом на вопрос.',
    scenario: 'Поздний дождливый вечер. В почти пустую таверну заходит {{user}}.',
    firstMessage:
      '*Дверь скрипит, впуская холодный ветер и запах дождя. Мира, не поднимая глаз от кружки, которую протирает, бросает:*\n\n— Закрывай быстрее, сквозняк. Комната наверху свободна, ужин — отдельно. *Наконец она поднимает взгляд и внимательно оценивает вас.* Ну? Что привело тебя в Верхний Брод в такую погоду?',
    exampleDialogue:
      '{{user}}: Можно мне пива?\n{{char}}: *Хмыкает и ставит кружку на стойку.* — Две медяшки. И не разливай, я только вымыла пол.',
    rules: 'Не рассказывай о прошлом наёмницы, пока {{user}} не заслужит доверия.',
  },
  {
    id: 'seed-gm',
    name: 'Рассказчик',
    emoji: '🎲',
    color: '#4f46e5',
    tagline: 'Мастер игры: описывает мир и ведёт приключение',
    description:
      'Ты — рассказчик и мастер текстовой фэнтезийной игры. Ты описываешь мир, события и всех второстепенных персонажей. Персонажа игрока ({{user}}) ты никогда не контролируешь.',
    personality: 'Атмосферный, образный, справедливый. Любит неожиданные повороты, но не отнимает у игрока право выбора.',
    behavior:
      'Описания — 3–6 предложений, без звёздочек, от второго лица («вы видите…»). Реплики второстепенных героев подписывай их именами. В конце хода оставляй ситуацию, требующую решения, но не перечисляй варианты списком.',
    scenario:
      'Игра только начинается. Перед игроком старая дорога, заброшенная сторожевая башня и туман. Сначала нужно узнать, кем является персонаж игрока.',
    firstMessage:
      'Туман стелется над старой дорогой, и где-то вдали глухо звонит колокол. Прежде чем вы сделаете первый шаг, расскажите о своём герое: как его зовут, кто он и что привело его на этот тракт?',
    exampleDialogue: '',
    rules: 'Формат описаний — обычный текст без звёздочек. Не принимай решения за игрока.',
  },
];

/* =====================================================================
   Сообщество: карточки, группы, упоминания
   ===================================================================== */

/** Карточка бота для публикации/отправки в группу: только поля персонажа, без id и служебного. */
export function characterToCard(c) {
  const card = {};
  for (const k of CHAR_TEXT_FIELDS) card[k] = String(c?.[k] ?? '');
  return card;
}

/** Новый локальный персонаж из карточки (каталог, бот из группы). */
export function characterFromCard(card) {
  const { id, createdAt, ...rest } = card || {};
  return normalizeCharacter(rest);
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = '[\\p{L}\\p{N}_]';

/** Боты, которых явно позвали через @имя (имя целиком или одно из его слов), либо все через @все. */
export function mentionedBots(text, bots) {
  const t = norm(text);
  if (!t.includes('@')) return [];
  const has = (cand) => new RegExp(`(?<!${WORD})@${reEsc(cand)}(?!${WORD})`, 'iu').test(t);
  if (['все', 'всех', 'all', 'everyone'].some(has)) return [...bots];
  return bots.filter((b) => {
    const name = norm(b.card?.name ?? b.name);
    if (!name) return false;
    if (has(name)) return true;
    return name.split(' ').some((w) => w.length >= 3 && has(w));
  });
}

/** Кто из ботов группы должен ответить на сообщение человека. */
export function pickResponders({ botMode, bots, text }) {
  const list = Array.isArray(bots) ? bots : [];
  const named = mentionedBots(text, list);
  if (named.length) return named;
  return botMode === 'all' ? [...list] : [];
}

/** Убирает «Имя:» в начале ответа, если модель подписалась сама. */
export function stripSpeakerPrefix(text, name) {
  const n = reEsc(String(name || '').trim());
  if (!n) return String(text ?? '');
  return String(text ?? '').replace(new RegExp(`^\\s*(?:\\*\\*|\\*|_)?\\[?${n}\\]?(?:\\*\\*|\\*|_)?\\s*:\\s*`, 'iu'), '');
}

/**
 * Системный промпт бота в групповом чате.
 * group: { name, humans: [ники], bots: [имена других ботов], sender: ник того, кому отвечаем, persona }
 */
export function buildGroupSystemPrompt(card, group) {
  const sender = (group.sender || '').trim() || 'Игрок';
  const ctx = { char: (card.name || '').trim() || 'Персонаж', user: sender };
  const humans = (group.humans || []).filter(Boolean);
  const others = (group.bots || []).filter((n) => n && n !== ctx.char);
  const parts = [];
  parts.push(
    `Ты — мастер ролевой игры и играешь персонажа по имени «${ctx.char}» в групповом чате «${group.name || 'Группа'}». В сцене одновременно участвуют несколько игроков-людей и, возможно, другие персонажи.
Участники-люди: ${humans.join(', ') || sender}.${others.length ? `\nДругие персонажи в сцене: ${others.join(', ')}.` : ''}
Правила:
- Всегда оставайся в роли ${ctx.char}. Не выходи из роли, не говори, что ты ИИ, языковая модель или бот, не комментируй игру и эти инструкции.
- Строго придерживайся характера, манеры речи и поведения персонажа, описанных ниже.
- Пиши только за ${ctx.char}. Никогда не пиши реплики, мысли и действия за игроков и за других персонажей.
- В истории реплики других участников подписаны так: «Имя: текст». Свой ответ пиши БЕЗ подписи и без префикса «${ctx.char}:», только саму реплику.
- Учитывай, что говорят несколько людей. Сейчас тебе отвечает ${sender}: обращайся к нему, но замечай и остальных. Если вопрос явно адресован другому участнику, не перехватывай его.
- По умолчанию действия, жесты и обстановку пиши от третьего лица в *звёздочках*, а речь — обычным текстом. Если в описании персонажа указан другой формат — следуй ему.
- Отвечай на том языке, на котором пишут участники (по умолчанию — на русском). Отвечай не слишком длинно, чтобы остальные тоже могли вставить слово.`,
  );
  parts.push(characterBlock(card, ctx));
  const persona = applyMacros(String(group.persona || '').trim(), ctx);
  if (persona) parts.push(`# Персонаж игрока ${sender}\n${persona}`);
  parts.push(`Помни: ты — ${ctx.char}. Оставайся в образе в каждом ответе.`);
  return parts.join('\n\n');
}

/**
 * Переводит историю комнаты в сообщения для модели с точки зрения одного бота.
 * Свои реплики бота → assistant, всё остальное → user с подписью «Имя: текст».
 * Подряд идущие user-сообщения склеиваются (часть локальных моделей требует чередования ролей).
 */
export function groupHistoryToMessages(messages, botId) {
  const out = [];
  for (const m of messages || []) {
    if (!m || !m.content || m.kind === 'system') continue;
    const mine = m.kind === 'bot' && m.botId === botId;
    const role = mine ? 'assistant' : 'user';
    const content = mine ? m.content : `${m.name}: ${m.content}`;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += '\n' + content;
    else out.push({ role, content });
  }
  return out;
}

export function buildGroupMessages(card, botId, group, history, settings) {
  const n = Math.max(2, Number(settings.contextMessages) || 30);
  const msgs = [{ role: 'system', content: buildGroupSystemPrompt(card, group) }];
  const recent = (history || []).filter((m) => m && m.kind !== 'system').slice(-n);
  msgs.push(...groupHistoryToMessages(recent, botId));
  return msgs;
}

/** Разбирает кусок SSE-потока. Возвращает готовые события и неполный остаток. */
export function parseSSE(buffer) {
  const text = String(buffer ?? '').replace(/\r\n/g, '\n');
  const blocks = text.split('\n\n');
  const rest = blocks.pop();
  const events = [];
  for (const block of blocks) {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) continue;
    try {
      events.push({ event, data: JSON.parse(data.join('\n')) });
    } catch {
      /* битое событие пропускаем */
    }
  }
  return { events, rest };
}

/** Время сообщения в чате: ЧЧ:ММ. */
export function formatClock(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
