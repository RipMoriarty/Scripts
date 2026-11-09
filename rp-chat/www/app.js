import * as L from './lib.js';
import { chatCompletion, fetchModels, checkKey, ApiError } from './api.js';

const STORAGE_KEY = 'rpchat.v1';
const $app = document.getElementById('app');
const $overlay = document.getElementById('overlay');
const $toasts = document.getElementById('toasts');

/* =====================================================================
   Хранилище
   ===================================================================== */
let db = loadDb();

function loadDb() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return {
        settings: { ...L.DEFAULT_SETTINGS, ...(d.settings || {}) },
        characters: (d.characters || []).map(L.normalizeCharacter),
        chats: d.chats && typeof d.chats === 'object' ? d.chats : {},
      };
    }
  } catch (e) {
    console.error('Не удалось прочитать данные', e);
  }
  return { settings: { ...L.DEFAULT_SETTINGS }, characters: L.SEED_CHARACTERS.map(L.normalizeCharacter), chats: {} };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (e) {
    console.error(e);
    toast('Не удалось сохранить данные: память заполнена?');
  }
}

const getChar = (id) => db.characters.find((c) => c.id === id);

function initialChat(ch) {
  const greeting = L.greetingFor(ch, db.settings);
  return greeting ? [{ id: L.uid(), role: 'assistant', content: greeting, ts: Date.now() }] : [];
}

/* =====================================================================
   Мелкие помощники для DOM
   ===================================================================== */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

function toast(msg, ms = 3200) {
  const t = h('div', { class: 'toast' }, msg);
  $toasts.append(t);
  setTimeout(() => t.remove(), ms);
}

function closeOverlay() {
  $overlay.classList.remove('open');
  $overlay.replaceChildren();
}

function openSheet(title, items) {
  const sheet = h(
    'div',
    { class: 'sheet' },
    title && h('div', { class: 'sheet-title' }, title),
    items.map((it) =>
      h('button', { class: 'sheet-item' + (it.danger ? ' danger' : ''), onclick: () => { closeOverlay(); it.onClick(); } }, it.label),
    ),
    h('button', { class: 'sheet-item cancel', onclick: closeOverlay }, 'Отмена'),
  );
  $overlay.replaceChildren(h('div', { class: 'backdrop', onclick: (e) => e.target === e.currentTarget && closeOverlay() }, sheet));
  $overlay.classList.add('open');
}

function openModal({ title, body, buttons }) {
  const modal = h(
    'div',
    { class: 'modal' },
    title && h('h3', {}, title),
    body,
    h(
      'div',
      { class: 'btns' },
      buttons.map((b) =>
        h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), onclick: () => { if (b.keepOpen !== true) closeOverlay(); b.onClick?.(); } }, b.label),
      ),
    ),
  );
  $overlay.replaceChildren(h('div', { class: 'backdrop center', onclick: (e) => e.target === e.currentTarget && closeOverlay() }, modal));
  $overlay.classList.add('open');
  return modal;
}

function confirmDialog(text, okLabel = 'Удалить', danger = true) {
  return new Promise((resolve) => {
    openModal({
      body: h('p', {}, text),
      buttons: [
        { label: 'Отмена', onClick: () => resolve(false) },
        { label: okLabel, primary: !danger, danger, onClick: () => resolve(true) },
      ],
    });
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = h('textarea', { value: text });
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function showTextModal(title, text) {
  const ta = h('textarea', { readOnly: true, value: text });
  openModal({
    title,
    body: ta,
    buttons: [
      { label: 'Закрыть' },
      { label: 'Скопировать', primary: true, keepOpen: true, onClick: async () => toast((await copyText(text)) ? 'Скопировано' : 'Не удалось скопировать — выделите текст вручную') },
    ],
  });
  ta.select?.();
}

function getSharePlugin() {
  try {
    const C = window.Capacitor;
    if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
    return C.Plugins?.Share || C.registerPlugin?.('Share') || null;
  } catch {
    return null;
  }
}

async function shareOrShow(title, text) {
  const Share = getSharePlugin();
  if (Share) {
    try {
      await Share.share({ title, text, dialogTitle: title });
      return;
    } catch (e) {
      if (/cancel/i.test(String(e?.message || e))) return;
    }
  }
  showTextModal(title, text);
}

function avatarEl(ch, size = '') {
  const el = h('div', { class: 'avatar ' + size });
  el.style.background = ch.color || '#6f5cf0';
  if (ch.avatar) el.append(h('img', { src: ch.avatar, alt: '' }));
  else el.append(ch.emoji || '🙂');
  return el;
}

function field(label, input, hint) {
  return h('div', { class: 'field' }, label && h('label', {}, label), input, hint && h('div', { class: 'hint' }, hint));
}

const shortModel = (m) => String(m || 'модель не выбрана').split('/').pop();

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
}

/* =====================================================================
   Навигация
   ===================================================================== */
function currentRoute() {
  const p = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  return { name: p[0] || 'home', id: p[1] ? decodeURIComponent(p[1]) : null };
}
function go(path) {
  const depth = (history.state?.depth || 0) + 1;
  history.pushState({ depth }, '', '#' + path);
  render();
}
function replace(path) {
  history.replaceState({ depth: history.state?.depth || 0 }, '', '#' + path);
  render();
}
function back() {
  if ((history.state?.depth || 0) > 0) history.back();
  else replace('/');
}
window.addEventListener('popstate', () => {
  closeOverlay();
  render();
});

let chatUI = null;

function render() {
  const r = currentRoute();
  chatUI = null;
  let view;
  if (r.name === 'chat' && r.id) view = viewChat(r.id);
  else if (r.name === 'edit' && r.id) view = viewEdit(r.id);
  else if (r.name === 'settings') view = viewSettings();
  else view = viewHome();
  $app.replaceChildren(...view);
  if (chatUI) chatUI.list.scrollTop = chatUI.list.scrollHeight;
}

/* =====================================================================
   Главный экран
   ===================================================================== */
function lastSnippet(ch) {
  const chat = db.chats[ch.id];
  const last = chat && chat[chat.length - 1];
  if (!last) return ch.tagline || 'Нажмите, чтобы начать диалог';
  const t = last.content.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  return (last.role === 'user' ? 'Вы: ' : '') + t;
}

function viewHome() {
  const list = h('div', { class: 'scroll pad-bottom' });

  if (!db.settings.apiKey.trim()) {
    list.append(
      h(
        'div',
        { class: 'banner' },
        h('b', {}, 'Нужен API-ключ'),
        h('p', {}, 'Чтобы персонажи отвечали, добавьте бесплатный ключ OpenRouter — это займёт минуту.'),
        h('button', { class: 'btn primary', onclick: () => go('/settings') }, 'Открыть настройки'),
      ),
    );
  }

  if (!db.characters.length) {
    list.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, '🎭'), 'Персонажей пока нет.', h('br'), 'Создайте первого или импортируйте карточку.'));
  }

  const sorted = [...db.characters].sort((a, b) => lastActivity(b) - lastActivity(a));
  for (const ch of sorted) {
    list.append(
      h(
        'div',
        { class: 'card', role: 'button', tabIndex: 0, onclick: () => go('/chat/' + encodeURIComponent(ch.id)) },
        avatarEl(ch),
        h('div', { class: 'info' }, h('b', {}, ch.name), h('span', {}, lastSnippet(ch))),
        h('button', { class: 'more', 'aria-label': 'Действия', onclick: (e) => { e.stopPropagation(); characterMenu(ch); } }, '⋮'),
      ),
    );
  }

  const bar = h(
    'div',
    { class: 'bar' },
    h('h1', {}, 'Персонажи'),
    h('button', { class: 'icon-btn', 'aria-label': 'Настройки', onclick: () => go('/settings') }, '⚙️'),
  );
  const fab = h(
    'div',
    { class: 'fab-row' },
    h('button', { class: 'btn primary grow', onclick: () => go('/edit/new') }, '＋ Создать персонажа'),
    h('button', { class: 'btn', onclick: importMenu }, 'Импорт'),
  );
  return [bar, list, fab];
}

function lastActivity(ch) {
  const chat = db.chats[ch.id];
  const last = chat && chat[chat.length - 1];
  return last ? last.ts || 0 : 0;
}

function characterMenu(ch) {
  openSheet(ch.name, [
    { label: '✏️ Редактировать', onClick: () => go('/edit/' + encodeURIComponent(ch.id)) },
    { label: '📄 Дублировать', onClick: () => { db.characters.push(L.normalizeCharacter({ ...ch, id: undefined, name: ch.name + ' (копия)' })); save(); render(); } },
    { label: '📤 Экспорт карточки', onClick: () => shareOrShow('Карточка: ' + ch.name, JSON.stringify(L.characterToExport(ch), null, 2)) },
    { label: '🗑 Удалить', danger: true, onClick: () => deleteCharacter(ch) },
  ]);
}

async function deleteCharacter(ch) {
  if (!(await confirmDialog(`Удалить «${ch.name}» вместе с историей диалога?`))) return;
  db.characters = db.characters.filter((c) => c.id !== ch.id);
  delete db.chats[ch.id];
  save();
  const r = currentRoute();
  if (r.name === 'home') render();
  else replace('/');
  toast('Персонаж удалён');
}

/* ---------- импорт ---------- */
function importMenu() {
  openSheet('Импорт карточки', [
    { label: '📁 Из файла (.json или .png)', onClick: pickCharacterFile },
    { label: '📋 Вставить JSON текстом', onClick: pasteCharacter },
  ]);
}

function pickCharacterFile() {
  const input = h('input', { type: 'file', accept: '.json,.png,application/json,image/png' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      let text;
      if (/\.png$/i.test(file.name) || file.type === 'image/png') {
        text = L.extractPngCharaText(new Uint8Array(await file.arrayBuffer()));
        if (!text) throw new Error('В этом PNG нет данных карточки персонажа.');
      } else {
        text = await file.text();
      }
      importCharacterText(text);
    } catch (e) {
      toast('Не удалось импортировать: ' + (e.message || e));
    }
  });
  input.click();
}

function pasteCharacter() {
  const ta = h('textarea', { placeholder: 'Вставьте JSON карточки (SillyTavern V1/V2/V3 или из этого приложения)' });
  openModal({
    title: 'Импорт карточки',
    body: ta,
    buttons: [{ label: 'Отмена' }, { label: 'Импортировать', primary: true, onClick: () => importCharacterText(ta.value) }],
  });
}

function importCharacterText(text) {
  let obj;
  try {
    obj = JSON.parse(String(text).trim());
  } catch {
    toast('Это не похоже на JSON карточки.');
    return;
  }
  if (obj?.type === 'rpchat-backup') return restoreBackup(obj);
  const ch = L.fromImported(obj);
  if (!ch) {
    toast('Не нашёл в файле карточку персонажа.');
    return;
  }
  db.characters.push(ch);
  save();
  toast(`Импортирован: ${ch.name}`);
  render();
}

/* =====================================================================
   Редактирование персонажа
   ===================================================================== */
function viewEdit(id) {
  const isNew = id === 'new';
  const existing = isNew ? null : getChar(id);
  if (!isNew && !existing) {
    setTimeout(() => replace('/'), 0);
    return [h('div')];
  }
  const draft = existing ? { ...existing } : { ...L.normalizeCharacter({}), id: undefined };

  const preview = h('div');
  const refreshPreview = () => preview.replaceChildren(avatarEl({ ...draft, emoji: draft.emoji || '🙂' }, 'xl'));
  refreshPreview();

  const bind = (key, tag, props = {}) => {
    const el = h(tag, { ...props, value: draft[key] || '' });
    el.addEventListener('input', () => { draft[key] = el.value; });
    return el;
  };

  const emojiInput = bind('emoji', 'input', { type: 'text', maxLength: 8, 'aria-label': 'Эмодзи' });
  emojiInput.addEventListener('input', refreshPreview);
  const colorInput = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(draft.color) ? draft.color : '#7c5cff' });
  colorInput.addEventListener('input', () => { draft.color = colorInput.value; refreshPreview(); });

  const fileBtn = h('button', { class: 'btn', onclick: () => {
    const input = h('input', { type: 'file', accept: 'image/*' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      try { draft.avatar = await fileToAvatar(f); refreshPreview(); } catch { toast('Не удалось загрузить картинку'); }
    });
    input.click();
  } }, '🖼 Картинка');
  const clearBtn = h('button', { class: 'btn', onclick: () => { draft.avatar = ''; refreshPreview(); } }, 'Убрать картинку');

  const form = h(
    'div',
    { class: 'scroll form' },
    h('div', { class: 'avatar-edit' }, preview, h('div', { class: 'col' }, emojiInput, colorInput)),
    h('div', { class: 'inline' }, fileBtn, clearBtn),
    field('Имя *', bind('name', 'input', { type: 'text', placeholder: 'Например, Мира', maxLength: 60 })),
    field('Краткое описание', bind('tagline', 'input', { type: 'text', placeholder: 'Подпись в списке персонажей', maxLength: 100 })),
    field('Описание и внешность', bind('description', 'textarea', { placeholder: 'Кто это, как выглядит, возраст, профессия, прошлое…' })),
    field('Характер', bind('personality', 'textarea', { placeholder: 'Черты, ценности, страхи, привычки мышления…' })),
    field('Манера речи и поведение', bind('behavior', 'textarea', { placeholder: 'Как говорит, как себя ведёт, жесты, любимые фразы…' })),
    field('Сценарий / ситуация', bind('scenario', 'textarea', { placeholder: 'Где и при каких обстоятельствах начинается история' })),
    field('Первое сообщение', bind('firstMessage', 'textarea', { placeholder: 'С чего персонаж начнёт диалог (можно *действия* в звёздочках)' }), 'Применяется к новому чату. Можно использовать {{user}} и {{char}}.'),
    field('Пример диалога (необязательно)', bind('exampleDialogue', 'textarea', { placeholder: '{{user}}: Привет!\n{{char}}: *улыбается* — Привет!' })),
    field('Жёсткие правила (необязательно)', bind('rules', 'textarea', { placeholder: 'Что персонаж делает всегда или никогда' })),
    existing && h('button', { class: 'btn block', onclick: () => shareOrShow('Карточка: ' + existing.name, JSON.stringify(L.characterToExport(existing), null, 2)) }, '📤 Экспорт карточки'),
    existing && h('button', { class: 'btn block danger', onclick: () => deleteCharacter(existing) }, '🗑 Удалить персонажа'),
  );

  const saveFn = () => {
    if (!String(draft.name || '').trim()) {
      toast('Укажите имя персонажа');
      return;
    }
    if (existing) {
      Object.assign(existing, L.normalizeCharacter({ ...draft, id: existing.id, createdAt: existing.createdAt }));
    } else {
      draft.id = undefined;
      db.characters.push(L.normalizeCharacter(draft));
    }
    save();
    toast('Сохранено');
    back();
  };

  const bar = h(
    'div',
    { class: 'bar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: () => back() }, '←'),
    h('h1', {}, isNew ? 'Новый персонаж' : 'Редактирование'),
    h('button', { class: 'text-btn', onclick: saveFn }, 'Сохранить'),
  );
  return [bar, form];
}

async function fileToAvatar(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const size = 192;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const s = Math.min(img.width, img.height);
    c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* =====================================================================
   Чат
   ===================================================================== */
let active = null; // { charId, controller, text, prefix }
const chatErrors = {}; // charId -> { message, kind }
const drafts = {}; // charId -> текст в поле ввода

function viewChat(id) {
  const ch = getChar(id);
  if (!ch) {
    setTimeout(() => replace('/'), 0);
    return [h('div')];
  }
  if (!db.chats[id]) {
    db.chats[id] = initialChat(ch);
    save();
  }

  const bar = h(
    'div',
    { class: 'bar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: () => back() }, '←'),
    avatarEl(ch, 'sm'),
    h('div', { class: 'title' }, h('b', {}, ch.name), h('small', {}, shortModel(db.settings.model))),
    h('button', { class: 'icon-btn', 'aria-label': 'Меню', onclick: () => chatMenu(ch) }, '⋮'),
  );

  const list = h('div', { class: 'chat-scroll' });
  const ta = h('textarea', { rows: 1, placeholder: `Сообщение для ${ch.name}…`, value: drafts[id] || '' });
  ta.addEventListener('input', () => { drafts[id] = ta.value; autoGrow(ta); });
  ta.addEventListener('focus', () => setTimeout(() => { list.scrollTop = list.scrollHeight; }, 350));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSend(); }
  });
  const sendBtn = h('button', { class: 'send', onclick: () => (active ? active.controller.abort() : doSend()) });
  const composer = h('div', { class: 'composer' }, ta, sendBtn);

  function doSend() {
    const text = ta.value.trim();
    if (!text || active) return;
    ta.value = '';
    drafts[id] = '';
    autoGrow(ta);
    db.chats[id].push({ id: L.uid(), role: 'user', content: text, ts: Date.now() });
    delete chatErrors[id];
    save();
    runGeneration(id);
  }

  chatUI = { id, ch, list, sendBtn };
  refreshChat(true);
  setTimeout(() => autoGrow(ta), 0);
  return [bar, list, composer];
}

function updateSendButton() {
  if (!chatUI) return;
  const busy = !!active;
  chatUI.sendBtn.className = 'send' + (busy ? ' stop' : '');
  chatUI.sendBtn.textContent = busy ? '■' : '➤';
  chatUI.sendBtn.setAttribute('aria-label', busy ? 'Остановить' : 'Отправить');
}

function nearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 140;
}

function refreshChat(stick = false) {
  if (!chatUI) return;
  const r = currentRoute();
  if (r.name !== 'chat' || r.id !== chatUI.id) return;
  const { list } = chatUI;
  const wasNear = nearBottom(list);
  list.replaceChildren(...buildRows(chatUI.id));
  updateSendButton();
  if (stick || wasNear) list.scrollTop = list.scrollHeight;
}

function buildRows(id) {
  const ch = getChar(id);
  const chat = db.chats[id] || [];
  const rows = [];
  chat.forEach((m, i) => {
    const bot = m.role === 'assistant';
    const bubble = h('div', { class: 'msg ' + (bot ? 'bot' : 'user'), html: L.renderRichText(m.content), onclick: () => messageMenu(ch, i) });
    rows.push(h('div', { class: 'row ' + (bot ? 'bot' : 'user') }, bot && avatarEl(ch, 'sm'), bubble));
  });

  if (active && active.charId === id) {
    const body = h('div', { class: 'msg bot', id: 'stream-body' });
    body.innerHTML = streamHtml();
    rows.push(h('div', { class: 'row bot' }, avatarEl(ch, 'sm'), body));
  } else if (chatErrors[id]) {
    const e = chatErrors[id];
    const retry = h('div', { class: 'actions', style: 'margin-left:0;margin-top:10px' },
      h('button', { class: 'chip', onclick: () => { delete chatErrors[id]; runGeneration(id); } }, '↻ Повторить'),
      ['auth', 'model', 'config'].includes(e.kind) && h('button', { class: 'chip', onclick: () => go('/settings') }, '⚙️ Настройки'),
    );
    rows.push(h('div', { class: 'row bot' }, avatarEl(ch, 'sm'), h('div', { class: 'msg bot err' }, h('div', { style: 'white-space:pre-wrap' }, '⚠️ ' + e.message), retry)));
  } else {
    const last = chat[chat.length - 1];
    if (last && last.role === 'assistant' && chat.some((m) => m.role === 'user')) {
      rows.push(
        h('div', { class: 'actions' },
          h('button', { class: 'chip', onclick: () => regenerate(id) }, '↻ Заново'),
          h('button', { class: 'chip', onclick: () => runGeneration(id, { continueLast: true }) }, '▶ Продолжить'),
        ),
      );
    }
  }
  return rows;
}

function streamHtml() {
  const t = L.stripThink(active?.text || '');
  return t ? L.renderRichText(t) : '<span class="typing"><span></span><span></span><span></span></span>';
}

function updateStream() {
  const el = document.getElementById('stream-body');
  if (!el || !chatUI) return;
  const wasNear = nearBottom(chatUI.list);
  el.innerHTML = streamHtml();
  if (wasNear) chatUI.list.scrollTop = chatUI.list.scrollHeight;
}

function regenerate(id) {
  if (active) return;
  const chat = db.chats[id];
  if (chat.length && chat[chat.length - 1].role === 'assistant') chat.pop();
  delete chatErrors[id];
  save();
  runGeneration(id);
}

async function autoPickModel() {
  try {
    const json = await fetchModels(db.settings);
    const list = L.listFreeModels(json, 'deepseek').filter((m) => m.id !== db.settings.model);
    if (!list.length) return null;
    db.settings.model = list[0].id;
    save();
    return list[0].id;
  } catch {
    return null;
  }
}

async function runGeneration(id, { continueLast = false } = {}) {
  if (active) return;
  const ch = getChar(id);
  const chat = db.chats[id];
  if (!ch || !chat) return;
  const s = db.settings;
  if (!s.apiKey.trim() && /openrouter|deepseek/i.test(s.baseUrl)) {
    chatErrors[id] = { kind: 'auth', message: 'Не указан API-ключ. Откройте настройки и вставьте ключ OpenRouter.' };
    refreshChat(true);
    return;
  }

  const last = chat[chat.length - 1];
  const prefix = continueLast && last && last.role === 'assistant' ? last.content : '';
  const controller = new AbortController();
  active = { charId: id, controller, text: '', prefix };
  refreshChat(true);

  let retriedModel = false;
  try {
    for (;;) {
      try {
        const messages = L.buildMessages(ch, db.settings, chat, { continueLast: !!prefix });
        const res = await chatCompletion({
          settings: db.settings,
          messages,
          signal: controller.signal,
          onDelta: (d) => { active.text += d; updateStream(); },
        });
        const clean = L.stripThink(active.text || res.text);
        if (!clean.trim()) {
          throw new ApiError('empty', 'Модель вернула пустой ответ. Попробуйте ещё раз. Если повторяется — увеличьте «Макс. длину ответа» в настройках (модели с «размышлением» тратят на него часть токенов) или смените модель.');
        }
        commitReply(chat, clean, prefix);
        break;
      } catch (e) {
        if (e instanceof ApiError && e.kind === 'model' && !retriedModel) {
          retriedModel = true;
          const picked = await autoPickModel();
          if (picked) {
            toast(`Модель заменена на ${picked}`, 4500);
            active.text = '';
            continue;
          }
        }
        throw e;
      }
    }
  } catch (e) {
    const partial = L.stripThink(active?.text || '');
    if (e?.name === 'AbortError') {
      if (partial.trim()) commitReply(chat, partial, prefix);
    } else {
      if (partial.trim()) commitReply(chat, partial, prefix);
      chatErrors[id] = { kind: e.kind || 'other', message: e.message || String(e) };
    }
  } finally {
    active = null;
    save();
    refreshChat(true);
  }
}

function commitReply(chat, text, prefix) {
  if (prefix) {
    const last = chat[chat.length - 1];
    last.content = prefix.replace(/\s+$/, '') + (/^[\s.,!?…—-]/.test(text) ? '' : ' ') + text;
  } else {
    chat.push({ id: L.uid(), role: 'assistant', content: text, ts: Date.now() });
  }
  save();
}

/* ---------- меню сообщений и чата ---------- */
function messageMenu(ch, index) {
  if (active) return;
  const chat = db.chats[ch.id];
  const m = chat[index];
  if (!m) return;
  const items = [
    { label: '📋 Копировать', onClick: async () => toast((await copyText(m.content)) ? 'Скопировано' : 'Не удалось скопировать') },
    { label: '✏️ Изменить', onClick: () => editMessage(ch, index) },
  ];
  if (index < chat.length - 1) items.push({ label: '⏪ Откатить диалог сюда (удалить всё ниже)', onClick: () => { chat.splice(index + 1); delete chatErrors[ch.id]; save(); refreshChat(); } });
  items.push({ label: '🗑 Удалить сообщение', danger: true, onClick: () => { chat.splice(index, 1); save(); refreshChat(); } });
  openSheet(m.role === 'user' ? 'Ваше сообщение' : ch.name, items);
}

function editMessage(ch, index) {
  const chat = db.chats[ch.id];
  const ta = h('textarea', { value: chat[index].content });
  openModal({
    title: 'Изменить сообщение',
    body: ta,
    buttons: [
      { label: 'Отмена' },
      { label: 'Сохранить', primary: true, onClick: () => { const v = ta.value.trim(); if (v) { chat[index].content = v; save(); refreshChat(); } } },
    ],
  });
}

function chatMenu(ch) {
  openSheet(ch.name, [
    { label: '✏️ Редактировать персонажа', onClick: () => go('/edit/' + encodeURIComponent(ch.id)) },
    { label: '🆕 Новый чат (начать заново)', onClick: async () => {
      if (active) active.controller.abort();
      if (!(await confirmDialog('Начать заново? Текущая переписка будет удалена.', 'Начать заново'))) return;
      db.chats[ch.id] = initialChat(ch);
      delete chatErrors[ch.id];
      save();
      refreshChat(true);
    } },
    { label: '📤 Поделиться перепиской', onClick: () => shareOrShow('Чат с ' + ch.name, L.chatToText(ch, db.settings, db.chats[ch.id] || [])) },
  ]);
}

/* =====================================================================
   Настройки
   ===================================================================== */
function viewSettings() {
  const s = db.settings;
  const put = (key, val) => { s[key] = val; save(); };

  const textInput = (key, props = {}) => {
    const el = h('input', { type: 'text', value: s[key] ?? '', autocapitalize: 'off', autocomplete: 'off', spellcheck: false, ...props });
    el.addEventListener('input', () => put(key, el.value));
    return el;
  };

  const keyInput = textInput('apiKey', { type: 'password', placeholder: 'sk-or-v1-…' });
  const eye = h('button', { class: 'btn', 'aria-label': 'Показать ключ', onclick: () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; } }, '👁');
  const modelInput = textInput('model', { placeholder: 'deepseek/…:free' });
  const keyStatus = h('div', { class: 'hint' });
  const modelStatus = h('div', { class: 'hint' });
  const modelList = h('div', { class: 'pill-list' });

  const showModels = (models) => {
    modelList.replaceChildren(
      ...models.slice(0, 12).map((m) =>
        h('button', { class: 'pill' + (m.id === s.model ? ' sel' : ''), onclick: () => { put('model', m.id); modelInput.value = m.id; showModels(models); } },
          m.id, h('small', {}, m.name + (m.context ? ` · контекст ${Math.round(m.context / 1000)}k` : ''))),
      ),
    );
  };

  async function findModels(filter) {
    modelStatus.className = 'hint';
    modelStatus.textContent = 'Ищу…';
    modelList.replaceChildren();
    try {
      const models = L.listFreeModels(await fetchModels(s), filter);
      if (!models.length) {
        modelStatus.textContent = filter
          ? 'Бесплатных DeepSeek сейчас нет. Нажмите «Все бесплатные», чтобы выбрать другую модель.'
          : 'Бесплатных моделей не найдено.';
        return;
      }
      modelStatus.textContent = `Найдено: ${models.length}. Нажмите на модель, чтобы выбрать.`;
      showModels(models);
    } catch (e) {
      modelStatus.className = 'hint status-bad';
      modelStatus.textContent = e.message || String(e);
    }
  }

  async function testKey() {
    keyStatus.className = 'hint';
    keyStatus.textContent = 'Проверяю…';
    try {
      const info = await checkKey(s);
      keyStatus.className = 'hint status-ok';
      const extra = info.is_free_tier === true ? ' Тариф: бесплатный (лимиты free-моделей: 50 запросов в день).' : '';
      keyStatus.textContent = '✓ Ключ работает.' + extra;
    } catch (e) {
      keyStatus.className = 'hint status-bad';
      keyStatus.textContent = e.message || String(e);
    }
  }

  const temp = h('input', { type: 'range', min: 0, max: 2, step: 0.05, value: s.temperature });
  const tempLabel = h('label', {}, `Температура: ${Number(s.temperature).toFixed(2)}`);
  temp.addEventListener('input', () => { put('temperature', Number(temp.value)); tempLabel.textContent = `Температура: ${Number(temp.value).toFixed(2)}`; });

  const numInput = (key, min, max, step = 1) => {
    const el = h('input', { type: 'number', inputMode: 'numeric', min, max, step, value: s[key] });
    el.addEventListener('change', () => {
      const v = Math.min(max, Math.max(min, Number(el.value) || L.DEFAULT_SETTINGS[key]));
      el.value = v;
      put(key, v);
    });
    return el;
  };

  const streamBox = h('input', { type: 'checkbox', checked: !!s.stream });
  streamBox.addEventListener('change', () => put('stream', streamBox.checked));

  const personaTa = h('textarea', { value: s.userPersona || '', placeholder: 'Кто вы в игре: внешность, характер, история (необязательно)' });
  personaTa.addEventListener('input', () => put('userPersona', personaTa.value));

  const form = h(
    'div',
    { class: 'scroll form' },
    h('div', { class: 'section-title' }, 'Подключение к модели'),
    h('div', { class: 'banner' },
      h('b', {}, 'Как получить бесплатный доступ к DeepSeek'),
      h('ol', { class: 'steps' },
        h('li', { html: 'Зарегистрируйтесь на <a href="https://openrouter.ai">openrouter.ai</a> (можно через Google или GitHub).' }),
        h('li', { html: 'Откройте <a href="https://openrouter.ai/keys">openrouter.ai/keys</a> → Create Key и скопируйте ключ.' }),
        h('li', {}, 'Вставьте ключ ниже и нажмите «Найти бесплатные DeepSeek».'),
      ),
    ),
    field('API-ключ', h('div', { class: 'inline' }, keyInput, eye), 'Хранится только на этом телефоне.'),
    h('button', { class: 'btn block', onclick: testKey }, 'Проверить ключ'),
    keyStatus,
    field('Модель', modelInput, 'Бесплатные модели у OpenRouter имеют суффикс :free и со временем меняются — используйте поиск ниже.'),
    h('div', { class: 'inline' },
      h('button', { class: 'btn grow', onclick: () => findModels('deepseek') }, 'Найти бесплатные DeepSeek'),
      h('button', { class: 'btn', onclick: () => findModels('') }, 'Все бесплатные'),
    ),
    modelStatus,
    modelList,
    field('Адрес API (Base URL)', textInput('baseUrl', { type: 'url', placeholder: 'https://openrouter.ai/api/v1' }), 'Подойдёт любой OpenAI-совместимый API, например https://api.deepseek.com (платный).'),

    h('div', { class: 'section-title' }, 'Генерация'),
    h('div', { class: 'field' }, tempLabel, temp, h('div', { class: 'hint' }, 'Выше — креативнее, ниже — предсказуемее. Для РП обычно 0.8–1.1.')),
    field('Макс. длина ответа (токенов)', numInput('maxTokens', 100, 8000, 50), 'Если ответы пустые или обрываются — увеличьте.'),
    field('Сколько последних сообщений помнить', numInput('contextMessages', 4, 200)),
    h('label', { class: 'check' }, streamBox, 'Показывать ответ по мере набора'),

    h('div', { class: 'section-title' }, 'Вы в игре'),
    field('Ваше имя', textInput('userName', { placeholder: 'Как к вам обращаться', maxLength: 40 })),
    field('Описание вашего персонажа', personaTa),

    h('div', { class: 'section-title' }, 'Данные'),
    h('button', { class: 'btn block', onclick: exportBackup }, '📤 Резервная копия (персонажи и чаты)'),
    h('button', { class: 'btn block', onclick: importBackupFile }, '📥 Восстановить из копии'),
    h('button', { class: 'btn block danger', onclick: resetAll }, '🗑 Удалить все данные'),
    h('div', { class: 'hint', style: 'text-align:center;margin-top:8px' }, 'РП Чат · данные хранятся на устройстве'),
  );

  const bar = h('div', { class: 'bar' }, h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: () => back() }, '←'), h('h1', {}, 'Настройки'));
  return [bar, form];
}

function exportBackup() {
  const { apiKey, ...settings } = db.settings;
  const data = { type: 'rpchat-backup', version: 1, exportedAt: new Date().toISOString(), settings, characters: db.characters, chats: db.chats };
  shareOrShow('Резервная копия РП Чат', JSON.stringify(data));
}

function importBackupFile() {
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try { importCharacterText(await f.text()); } catch { toast('Не удалось прочитать файл'); }
  });
  const ta = h('textarea', { placeholder: 'Вставьте сюда текст резервной копии' });
  openModal({
    title: 'Восстановление',
    body: h('div', {}, ta, h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn block', onclick: () => input.click() }, '📁 Выбрать файл'))),
    buttons: [{ label: 'Отмена' }, { label: 'Восстановить', primary: true, onClick: () => importCharacterText(ta.value) }],
  });
}

async function restoreBackup(obj) {
  if (!Array.isArray(obj.characters)) { toast('Копия повреждена'); return; }
  if (!(await confirmDialog('Заменить текущих персонажей и чаты данными из копии? Ваш API-ключ сохранится.', 'Восстановить', false))) return;
  db = {
    settings: { ...L.DEFAULT_SETTINGS, ...(obj.settings || {}), apiKey: db.settings.apiKey },
    characters: obj.characters.map(L.normalizeCharacter),
    chats: obj.chats && typeof obj.chats === 'object' ? obj.chats : {},
  };
  save();
  toast('Восстановлено');
  replace('/');
}

async function resetAll() {
  if (!(await confirmDialog('Удалить всех персонажей, чаты и настройки (включая ключ)? Это нельзя отменить.', 'Удалить всё'))) return;
  localStorage.removeItem(STORAGE_KEY);
  db = loadDb();
  toast('Данные удалены');
  replace('/');
}

/* =====================================================================
   Старт
   ===================================================================== */
if (!location.hash) history.replaceState({ depth: 0 }, '', '#/');
else history.replaceState({ depth: history.state?.depth || 0 }, '', location.hash);
render();

// Для автотестов и отладки
window.__rp = { get db() { return db; } };
