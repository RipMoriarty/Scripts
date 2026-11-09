// Интерфейс сообщества: вкладки «Группы» и «Каталог», групповой чат, подключение к серверу.
// Модуль получает помощников приложения через createGroups(ctx), чтобы не зависеть от app.js циклически.
import * as L from './lib.js';
import * as C from './community.js';
import { chatCompletion, ApiError } from './api.js';

export function createGroups(ctx) {
  const { h, toast, openSheet, openModal, confirmDialog, avatarEl, field, autoGrow } = ctx;
  const closeOverlay = () => ctx.closeOverlay();
  const getDb = () => ctx.getDb();

  /* ---------- общее ---------- */
  const cfg = () => {
    const c = getDb().community;
    return c && c.url && c.token ? c : null;
  };

  function fail(e) {
    if (e?.name === 'AbortError') return;
    toast(e?.message || String(e), 5000);
  }

  const hashColor = (s) => {
    let x = 0;
    for (const ch of String(s)) x = (x * 31 + ch.codePointAt(0)) >>> 0;
    return `hsl(${x % 360} 50% 42%)`;
  };

  /** Карточка с сервера приходит от чужих людей — приводим к безопасному виду для отрисовки. */
  const safeCard = (c = {}) => ({
    ...c,
    color: /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#7c5cff',
    avatar: /^data:image\/(jpeg|png|webp);base64,/.test(c.avatar || '') ? c.avatar : '',
    emoji: c.emoji || '🙂',
  });
  const userAvatar = (name, size = 'sm') => avatarEl({ emoji: (String(name || '?').trim()[0] || '?').toUpperCase(), color: hashColor(name) }, size);

  const nearBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  const flatSnippet = (t) => String(t || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();

  function tabbar(active) {
    const tabs = [
      ['home', '🎭', 'Персонажи', '/'],
      ['groups', '👥', 'Группы', '/groups'],
      ['catalog', '🌐', 'Каталог', '/catalog'],
    ];
    return h(
      'nav',
      { class: 'tabbar' },
      tabs.map(([id, icon, label, path]) =>
        h('button', { class: 'tab' + (id === active ? ' sel' : ''), 'data-tab': id, onclick: () => id !== active && ctx.replace(path) }, h('span', { class: 'ic' }, icon), h('span', {}, label)),
      ),
    );
  }

  const tabBar = (title, extra) =>
    h('div', { class: 'bar' }, h('h1', {}, title), extra, h('button', { class: 'icon-btn', 'aria-label': 'Настройки', onclick: () => ctx.go('/settings') }, '⚙️'));

  function notConnected(what) {
    return h(
      'div',
      { class: 'empty' },
      h('div', { class: 'big' }, '🔌'),
      `${what} работают через сервер сообщества.`,
      h('br'),
      'Его запускает ваш друг или вы сами на компьютере — подробности в README.',
      h('div', { style: 'margin-top:16px' }, h('button', { class: 'btn primary', onclick: openCommunitySettings }, 'Подключиться к серверу')),
    );
  }

  let scrollToCommunity = false;
  function openCommunitySettings() {
    scrollToCommunity = true;
    ctx.go('/settings');
  }

  /* =====================================================================
     Список групп
     ===================================================================== */
  function viewGroups() {
    const list = h('div', { class: 'scroll' });
    const refresh = h('button', { class: 'icon-btn', 'aria-label': 'Обновить', onclick: () => load() }, '↻');
    const bar = tabBar('Группы', cfg() && refresh);
    if (!cfg()) {
      list.append(notConnected('Группы'));
      return [bar, list, tabbar('groups')];
    }
    const fab = h(
      'div',
      { class: 'fab-row' },
      h('button', { class: 'btn primary grow', onclick: () => ctx.go('/group-new') }, '＋ Создать группу'),
      h('button', { class: 'btn', onclick: joinDialog }, 'Войти по коду'),
    );

    async function load() {
      list.replaceChildren(h('div', { class: 'empty' }, 'Загрузка…'));
      try {
        const { rooms } = await C.roomsList(cfg());
        if (!rooms.length) {
          list.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'big' }, '👥'), 'Групп пока нет.', h('br'), 'Создайте свою или войдите по коду от друга.'));
          return;
        }
        list.replaceChildren(
          ...rooms.map((r) =>
            h(
              'div',
              { class: 'card', role: 'button', tabIndex: 0, onclick: () => ctx.go('/group/' + encodeURIComponent(r.id)) },
              avatarEl({ emoji: '👥', color: hashColor(r.name) }),
              h(
                'div',
                { class: 'info' },
                h('b', {}, r.name),
                h('span', {}, r.last ? `${r.last.name}: ${flatSnippet(r.last.content)}` : 'Сообщений пока нет'),
                h('span', { class: 'meta' }, `👤 ${r.members}` + (r.bots.length ? ` · 🤖 ${r.bots.join(', ')}` : '')),
              ),
            ),
          ),
        );
      } catch (e) {
        list.replaceChildren(
          h('div', { class: 'empty' }, h('div', { class: 'big' }, '⚠️'), e.message, h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: load }, '↻ Повторить'))),
        );
      }
    }
    load();
    return [bar, list, fab, tabbar('groups')];
  }

  function joinDialog() {
    const input = h('input', { type: 'text', placeholder: 'Например, K7M2QX9P', autocapitalize: 'characters', autocomplete: 'off', maxLength: 16 });
    openModal({
      title: 'Войти в группу',
      body: field('Код группы', input, 'Код можно найти в меню группы у друга: ⋮ → «Пригласить друзей».'),
      buttons: [
        { label: 'Отмена' },
        {
          label: 'Войти',
          primary: true,
          onClick: async () => {
            try {
              const r = await C.roomJoin(cfg(), input.value);
              ctx.go('/group/' + encodeURIComponent(r.id));
            } catch (e) {
              fail(e);
            }
          },
        },
      ],
    });
    setTimeout(() => input.focus(), 50);
  }

  /* =====================================================================
     Создание группы
     ===================================================================== */
  const BOT_MODES = [
    ['all', 'Отвечают все боты', 'Каждый бот отвечает на каждое сообщение. Позвать только одного — написать @имя.'],
    ['mention', 'Только когда позвали', 'Боты молчат, пока их не позовут через @имя (или @все).'],
  ];

  function viewGroupNew() {
    if (!cfg()) {
      setTimeout(() => ctx.replace('/groups'), 0);
      return [h('div')];
    }
    const draft = { name: '', botMode: 'all', picked: new Set() };
    const nameInput = h('input', { type: 'text', placeholder: 'Например, Таверна «Верхний брод»', maxLength: 60 });
    nameInput.addEventListener('input', () => (draft.name = nameInput.value));
    const modeHint = h('div', { class: 'hint' });
    const modeChips = BOT_MODES.map(([id, label]) => h('button', { class: 'chip', onclick: () => setMode(id) }, label));
    const setMode = (id) => {
      draft.botMode = id;
      BOT_MODES.forEach(([mid, , hint], i) => {
        modeChips[i].classList.toggle('sel', mid === id);
        if (mid === id) modeHint.textContent = hint;
      });
    };
    setMode('all');

    const chars = getDb().characters;
    const counter = h('div', { class: 'hint' });
    const updateCounter = () => (counter.textContent = `Выбрано: ${draft.picked.size} из ${C.MAX_BOTS}. Ботов можно добавлять и позже.`);
    updateCounter();
    const pills = chars.map((ch) => {
      const pill = h('button', { class: 'pill' }, `${ch.emoji || '🙂'} ${ch.name}`, h('small', {}, ch.tagline || ''));
      pill.addEventListener('click', () => {
        if (draft.picked.has(ch.id)) draft.picked.delete(ch.id);
        else if (draft.picked.size >= C.MAX_BOTS) return toast(`Не больше ${C.MAX_BOTS} ботов`);
        else draft.picked.add(ch.id);
        pill.classList.toggle('sel', draft.picked.has(ch.id));
        updateCounter();
      });
      return pill;
    });

    let busy = false;
    const create = async () => {
      const name = draft.name.trim();
      if (name.length < 2) return toast('Введите название группы (от 2 символов)');
      if (busy) return;
      busy = true;
      try {
        const bots = chars.filter((c) => draft.picked.has(c.id)).map(L.characterToCard);
        const c = cfg();
        const room = await C.roomCreate(c, { name, botMode: draft.botMode, bots });
        for (const b of room.bots) await postGreeting(c, room.id, b);
        ctx.replace('/group/' + encodeURIComponent(room.id));
      } catch (e) {
        busy = false;
        fail(e);
      }
    };

    const form = h(
      'div',
      { class: 'scroll form' },
      field('Название группы *', nameInput),
      h('div', { class: 'field' }, h('label', {}, 'Как отвечают боты'), h('div', { class: 'chips' }, modeChips), modeHint),
      h('div', { class: 'section-title' }, 'Боты в группе'),
      chars.length ? h('div', { class: 'pill-list' }, pills) : h('div', { class: 'hint' }, 'У вас пока нет персонажей — создайте их на вкладке «Персонажи» или возьмите в «Каталоге».'),
      counter,
      h('div', { class: 'hint' }, 'Друзей можно позвать после создания — по коду приглашения.'),
    );
    const bar = h(
      'div',
      { class: 'bar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: () => ctx.back() }, '←'),
      h('h1', {}, 'Новая группа'),
      h('button', { class: 'text-btn', onclick: create }, 'Создать'),
    );
    return [bar, form];
  }

  async function postGreeting(c, roomId, bot) {
    const text = L.greetingFor(bot.card, { userName: c.name });
    if (text) await C.messageSend(c, roomId, { content: text, botId: bot.id });
  }

  /* =====================================================================
     Групповой чат
     ===================================================================== */
  const drafts = {};
  let G = null;

  function teardown() {
    if (!G) return;
    G.dead = true;
    G.stop?.();
    clearInterval(G.tick);
    G.queue.length = 0;
    G.gen?.controller.abort();
    G = null;
  }

  function viewGroup(id) {
    const c = cfg();
    if (!c) {
      setTimeout(() => ctx.replace('/groups'), 0);
      return [h('div')];
    }
    const g = (G = { id, room: null, messages: [], typing: new Map(), status: 'loading', gen: null, queue: [], pumping: false, dead: false, leaving: false, error: null, stop: null, tick: null });
    const draftKey = 'g:' + id;

    /* ---- каркас ---- */
    const titleB = h('b', {}, 'Группа');
    const titleS = h('small', {}, 'Загрузка…');
    const bar = h(
      'div',
      { class: 'bar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: () => ctx.back() }, '←'),
      h('div', { class: 'title' }, titleB, titleS),
      h('button', { class: 'icon-btn', 'aria-label': 'Меню', onclick: () => g.room && groupMenu() }, '⋮'),
    );
    const list = h('div', { class: 'chat-scroll' });
    const typingLine = h('div', { class: 'typing-line', hidden: true });
    const stopRow = h('div', { class: 'stop-row', hidden: true }, h('button', { class: 'chip', onclick: stopAll }, '■ Остановить ответы ботов'));
    const mentionRow = h('div', { class: 'mention-row', hidden: true });
    const ta = h('textarea', { rows: 1, placeholder: 'Сообщение в группу…', value: drafts[draftKey] || '' });
    ta.addEventListener('input', () => {
      drafts[draftKey] = ta.value;
      autoGrow(ta);
    });
    ta.addEventListener('focus', () => setTimeout(() => (list.scrollTop = list.scrollHeight), 350));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        doSend();
      }
    });
    const sendBtn = h('button', { class: 'send', 'aria-label': 'Отправить', onclick: doSend }, '➤');
    const composer = h('div', { class: 'composer' }, ta, sendBtn);

    /* ---- отрисовка ---- */
    function renderBar() {
      if (g.dead) return;
      titleB.textContent = g.room?.name || 'Группа';
      titleS.textContent =
        g.status === 'reconnecting' ? '⚠️ Нет связи, переподключаюсь…' : g.status === 'loading' ? 'Загрузка…' : g.room ? `👤 ${g.room.members.length} · 🤖 ${g.room.bots.length}` : '';
      titleS.classList.toggle('status-bad', g.status === 'reconnecting');
      mentionRow.replaceChildren();
      const bots = g.room?.bots || [];
      bots.forEach((b) => mentionRow.append(h('button', { class: 'chip', onclick: () => insertMention(b.card.name) }, '@' + b.card.name)));
      if (bots.length > 1) mentionRow.append(h('button', { class: 'chip', onclick: () => insertMention('все') }, '@все'));
      mentionRow.hidden = !bots.length;
    }

    function insertMention(name) {
      const v = ta.value;
      const pos = ta.selectionStart ?? v.length;
      const pre = v.slice(0, pos);
      ta.value = pre + (pre && !/\s$/.test(pre) ? ' ' : '') + '@' + name + ' ' + v.slice(pos);
      drafts[draftKey] = ta.value;
      autoGrow(ta);
      ta.focus();
    }

    function rowFor(m) {
      if (m.kind === 'system') return h('div', { class: 'sys' }, m.content);
      const mine = m.kind === 'user' && m.userId === c.userId;
      const bubble = h('div', { class: 'msg ' + (mine ? 'user' : 'bot'), html: L.renderRichText(m.content), onclick: () => messageMenu(m) });
      if (mine) return h('div', { class: 'row user' }, bubble);
      const bot = m.kind === 'bot' ? g.room?.bots.find((b) => b.id === m.botId) : null;
      const av = m.kind === 'bot' ? avatarEl(safeCard(bot?.card || { emoji: '🤖', name: m.name }), 'sm') : userAvatar(m.name);
      return h('div', { class: 'row bot' }, av, h('div', { class: 'bubble-col' }, h('div', { class: 'who' }, m.name, m.kind === 'bot' && h('span', { class: 'tag' }, 'бот'), h('span', { class: 'time' }, L.formatClock(m.ts))), bubble));
    }

    function renderList(stick = false) {
      if (g.dead) return;
      const wasNear = nearBottom(list);
      const rows = g.messages.map(rowFor);
      if (g.gen) {
        const bot = g.room?.bots.find((b) => b.id === g.gen.botId);
        const body = h('div', { class: 'msg bot', id: 'g-stream' });
        body.innerHTML = streamHtml();
        rows.push(h('div', { class: 'row bot' }, avatarEl(safeCard(bot?.card || {}), 'sm'), h('div', { class: 'bubble-col' }, h('div', { class: 'who' }, bot?.card.name || 'Бот', h('span', { class: 'tag' }, 'бот')), body)));
      }
      if (g.error) {
        const e = g.error;
        rows.push(
          h(
            'div',
            { class: 'row bot' },
            h('div', { class: 'msg bot err' }, h('div', { style: 'white-space:pre-wrap' }, '⚠️ ' + e.message), h('div', { class: 'actions', style: 'margin:10px 0 0' },
              e.job && h('button', { class: 'chip', onclick: () => { g.error = null; g.queue.unshift(e.job); pump(); } }, '↻ Повторить'),
              ['auth', 'model', 'config', 'network'].includes(e.kind) && e.job && h('button', { class: 'chip', onclick: () => ctx.go('/settings') }, '⚙️ Настройки'),
              h('button', { class: 'chip', onclick: () => { g.error = null; renderList(); } }, 'Скрыть'),
            )),
          ),
        );
      }
      if (!g.messages.length && !g.gen && g.status !== 'loading') rows.push(h('div', { class: 'empty' }, h('div', { class: 'big' }, '💬'), 'Пока тихо. Напишите первое сообщение.'));
      list.replaceChildren(...rows);
      if (stick || wasNear) list.scrollTop = list.scrollHeight;
      stopRow.hidden = !(g.gen || g.queue.length);
    }

    const streamHtml = () => {
      const t = L.stripThink(g.gen?.text || '');
      return t ? L.renderRichText(t) : '<span class="typing"><span></span><span></span><span></span></span>';
    };
    function updateStream() {
      const el = document.getElementById('g-stream');
      if (!el || g.dead) return;
      const wasNear = nearBottom(list);
      el.innerHTML = streamHtml();
      if (wasNear) list.scrollTop = list.scrollHeight;
    }

    function renderTyping() {
      if (g.dead) return;
      const names = [...g.typing.values()].map((t) => t.name);
      typingLine.hidden = !names.length;
      typingLine.textContent = names.length ? `${names.join(', ')} ${names.length > 1 ? 'печатают' : 'печатает'}…` : '';
    }

    /* ---- данные ---- */
    function addMessage(m) {
      if (g.messages.some((x) => x.id === m.id)) return false;
      g.messages.push(m);
      g.messages.sort((a, b) => a.id - b.id);
      if (g.messages.length > 600) g.messages.splice(0, g.messages.length - 600);
      return true;
    }

    async function refreshRoom() {
      try {
        g.room = await C.roomGet(c, id);
        renderBar();
        renderList();
      } catch (e) {
        if (['forbidden', 'notfound'].includes(e.kind)) leave('Вы больше не в этой группе.');
      }
    }

    function leave(msg) {
      if (g.leaving || g.dead) return;
      g.leaving = true;
      toast(msg);
      ctx.replace('/groups');
    }

    function onEvent(ev, d) {
      if (g.dead) return;
      if (ev === 'message') {
        if (d.kind === 'bot') g.typing.delete(d.botId);
        if (addMessage(d)) renderList();
        renderTyping();
      } else if (ev === 'typing') {
        if (d.userId === c.userId) return;
        const key = d.botId || 'u:' + d.userId;
        if (d.on) g.typing.set(key, { name: d.name, until: Date.now() + 7000 });
        else g.typing.delete(key);
        renderTyping();
      } else if (ev === 'deleted') {
        g.messages = g.messages.filter((m) => m.id !== d.id);
        renderList();
      } else if (ev === 'room') {
        if (d.deleted) leave('Группа удалена её создателем.');
        else refreshRoom();
      }
    }

    (async () => {
      try {
        const [room, msgs] = await Promise.all([C.roomGet(c, id), C.messagesList(c, id, { limit: 200 })]);
        if (g.dead) return;
        g.room = room;
        g.messages = msgs.messages;
        g.status = 'open';
        renderBar();
        renderList(true);
        const after = g.messages.reduce((mx, m) => Math.max(mx, m.id), 0);
        g.stop = C.streamRoom(c, id, {
          after,
          onEvent,
          onStatus: (s, err) => {
            if (g.dead) return;
            if (s === 'fatal') return leave(err?.message || 'Группа недоступна.');
            g.status = s === 'open' ? 'open' : 'reconnecting';
            renderBar();
          },
        });
        g.tick = setInterval(() => {
          let changed = false;
          for (const [k, t] of g.typing) if (t.until < Date.now()) { g.typing.delete(k); changed = true; }
          if (changed) renderTyping();
        }, 1000);
      } catch (e) {
        if (g.dead) return;
        if (['forbidden', 'notfound'].includes(e.kind)) return leave(e.message);
        list.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'big' }, '⚠️'), e.message, h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: () => ctx.replace('/group/' + encodeURIComponent(id)) }, '↻ Повторить'))));
        titleS.textContent = 'Нет связи';
      }
    })();

    /* ---- отправка и ответы ботов ---- */
    let posting = false;
    async function doSend() {
      const text = ta.value.trim();
      if (!text || posting || !g.room) return;
      posting = true;
      sendBtn.disabled = true;
      try {
        const msg = await C.messageSend(c, id, { content: text });
        ta.value = '';
        drafts[draftKey] = '';
        autoGrow(ta);
        if (addMessage(msg)) renderList(true);
        for (const b of L.pickResponders({ botMode: g.room.botMode, bots: g.room.bots, text })) g.queue.push({ botId: b.id, sender: c.name });
        pump();
      } catch (e) {
        fail(e);
      } finally {
        posting = false;
        sendBtn.disabled = false;
      }
    }

    function stopAll() {
      g.queue.length = 0;
      g.gen?.controller.abort();
      renderList();
    }

    async function pump() {
      if (g.pumping) return;
      g.pumping = true;
      try {
        while (g.queue.length) {
          const job = g.queue.shift();
          const bot = g.room?.bots.find((b) => b.id === job.botId);
          if (!bot) continue;
          await generateFor(bot, job);
          if (g.error || g.dead) {
            g.queue.length = 0;
            break;
          }
        }
      } finally {
        g.pumping = false;
        renderList();
      }
    }

    async function postBot(bot, text) {
      const m = await C.messageSend(c, id, { content: text, botId: bot.id });
      addMessage(m);
    }

    const cleanReply = (text, bot) => L.stripSpeakerPrefix(L.stripThink(text || ''), bot.card.name).trim();

    async function generateFor(bot, job) {
      const s = getDb().settings;
      if (L.needsApiKey(s.baseUrl) && !s.apiKey.trim()) {
        g.error = { kind: 'auth', message: 'Не указан API-ключ. Откройте настройки и вставьте ключ или выберите свой сервер.', job };
        renderList(true);
        return;
      }
      const controller = new AbortController();
      g.gen = { botId: bot.id, controller, text: '' };
      g.error = null;
      renderList(true);
      C.sendTyping(c, id, { botId: bot.id, on: true });
      const iv = setInterval(() => C.sendTyping(c, id, { botId: bot.id, on: true }), 4000);
      let retriedModel = false;
      try {
        for (;;) {
          try {
            const info = {
              name: g.room.name,
              humans: g.room.members.map((m) => m.name),
              bots: g.room.bots.map((b) => b.card.name),
              sender: job.sender,
              persona: s.userPersona,
            };
            const messages = L.buildGroupMessages(bot.card, bot.id, info, g.messages, s);
            const res = await chatCompletion({
              settings: s,
              messages,
              signal: controller.signal,
              onDelta: (d) => {
                g.gen.text += d;
                updateStream();
              },
            });
            const clean = cleanReply(g.gen.text || res.text, bot);
            if (!clean) throw new ApiError('empty', 'Модель вернула пустой ответ. Попробуйте ещё раз или увеличьте «Макс. длину ответа» в настройках.');
            await postBot(bot, clean);
            break;
          } catch (e) {
            if (e instanceof ApiError && e.kind === 'model' && !retriedModel) {
              retriedModel = true;
              const picked = await ctx.autoPickModel();
              if (picked) {
                toast(`Модель заменена на ${picked}`, 4500);
                g.gen.text = '';
                continue;
              }
            }
            throw e;
          }
        }
      } catch (e) {
        const partial = cleanReply(g.gen?.text, bot);
        if (partial) await postBot(bot, partial).catch(() => {});
        if (e?.name !== 'AbortError') g.error = { kind: e.kind || 'other', message: e.message || String(e), job };
      } finally {
        clearInterval(iv);
        C.sendTyping(c, id, { botId: bot.id, on: false });
        g.gen = null;
        renderList(true);
      }
    }

    /* ---- меню ---- */
    function lastRealMessage() {
      return [...g.messages].reverse().find((m) => m.kind !== 'system');
    }

    function messageMenu(m) {
      if (!g.room) return;
      const own = m.userId === c.userId;
      const owner = g.room.ownerId === c.userId;
      const items = [{ label: '📋 Копировать', onClick: async () => toast((await ctx.copyText(m.content)) ? 'Скопировано' : 'Не удалось скопировать') }];
      if (m.kind === 'bot' && own && lastRealMessage()?.id === m.id && g.room.bots.some((b) => b.id === m.botId)) {
        items.push({
          label: '↻ Переписать ответ',
          onClick: async () => {
            try {
              await C.messageDelete(c, id, m.id);
              g.messages = g.messages.filter((x) => x.id !== m.id);
              const sender = [...g.messages].reverse().find((x) => x.kind === 'user')?.name || c.name;
              g.queue.push({ botId: m.botId, sender });
              renderList();
              pump();
            } catch (e) {
              fail(e);
            }
          },
        });
      }
      if (own || owner) {
        items.push({
          label: '🗑 Удалить сообщение',
          danger: true,
          onClick: async () => {
            try {
              await C.messageDelete(c, id, m.id);
              g.messages = g.messages.filter((x) => x.id !== m.id);
              renderList();
            } catch (e) {
              fail(e);
            }
          },
        });
      }
      openSheet(m.name, items);
    }

    function groupMenu() {
      const owner = g.room.ownerId === c.userId;
      const items = [
        { label: 'ℹ️ Участники, боты и настройки', onClick: showInfo },
        { label: '➕ Добавить бота', onClick: addBotMenu },
        { label: '🔑 Пригласить друзей (код)', onClick: invite },
        {
          label: owner && g.room.members.length > 1 ? '🚪 Выйти (группу получит другой)' : '🚪 Выйти из группы',
          danger: !owner,
          onClick: async () => {
            if (!(await confirmDialog(`Выйти из группы «${g.room.name}»?` + (g.room.members.length === 1 ? ' Вы тут последний — группа будет удалена.' : ''), 'Выйти'))) return;
            try {
              await C.roomLeave(c, id);
              g.leaving = true;
              ctx.replace('/groups');
            } catch (e) {
              fail(e);
            }
          },
        },
      ];
      if (owner) {
        items.push({
          label: '🗑 Удалить группу для всех',
          danger: true,
          onClick: async () => {
            if (!(await confirmDialog(`Удалить группу «${g.room.name}» вместе с перепиской у всех участников?`))) return;
            try {
              await C.roomDelete(c, id);
              g.leaving = true;
              ctx.replace('/groups');
            } catch (e) {
              fail(e);
            }
          },
        });
      }
      openSheet(g.room.name, items);
    }

    function invite() {
      const text = `Заходи в мою группу «${g.room.name}» в приложении РП Чат!\nАдрес сервера: ${c.url}\nКод группы: ${g.room.joinCode}\n(Группы → «Войти по коду». Если ещё не подключён к серверу — Настройки → Сервер сообщества.)`;
      ctx.shareOrShow('Приглашение в группу', text);
    }

    function addBotMenu() {
      const chars = getDb().characters;
      if (!chars.length) return toast('У вас нет персонажей. Создайте их или возьмите в каталоге.');
      if (g.room.bots.length >= C.MAX_BOTS) return toast(`В группе уже ${C.MAX_BOTS} ботов — это максимум`);
      openSheet(
        'Добавить бота в группу',
        chars.map((ch) => ({
          label: `${ch.emoji || '🙂'} ${ch.name}`,
          onClick: async () => {
            try {
              const bot = await C.roomAddBot(c, id, L.characterToCard(ch));
              await postGreeting(c, id, bot);
              await refreshRoom();
            } catch (e) {
              fail(e);
            }
          },
        })),
      );
    }

    function showInfo() {
      const room = g.room;
      const owner = room.ownerId === c.userId;
      const nameInput = h('input', { type: 'text', value: room.name, maxLength: 60 });
      let mode = room.botMode;
      const hint = h('div', { class: 'hint' });
      const chips = BOT_MODES.map(([mid, label]) => h('button', { class: 'chip', disabled: !owner, onclick: () => setM(mid) }, label));
      const setM = (mid) => {
        mode = mid;
        BOT_MODES.forEach(([x, , t], i) => {
          chips[i].classList.toggle('sel', x === mid);
          if (x === mid) hint.textContent = t;
        });
      };
      setM(mode);
      const memberRows = room.members.map((m) => h('div', { class: 'li' }, userAvatar(m.name), h('span', {}, m.name + (m.id === room.ownerId ? ' 👑' : '') + (m.id === c.userId ? ' (вы)' : ''))));
      const botRows = room.bots.length
        ? room.bots.map((b) =>
            h(
              'div',
              { class: 'li' },
              avatarEl(safeCard(b.card), 'sm'),
              h('span', {}, b.card.name),
              (owner || b.addedBy === c.userId) &&
                h('button', {
                  class: 'chip',
                  onclick: async () => {
                    try {
                      await C.roomRemoveBot(c, id, b.id);
                      closeOverlay();
                      toast(`${b.card.name} убран(а) из группы`);
                      refreshRoom();
                    } catch (e) {
                      fail(e);
                    }
                  },
                }, 'Убрать'),
            ),
          )
        : [h('div', { class: 'hint' }, 'Ботов пока нет.')];
      const body = h(
        'div',
        { class: 'info-box' },
        owner ? field('Название', nameInput) : null,
        h('div', { class: 'section-title' }, 'Участники'),
        memberRows,
        h('div', { class: 'section-title' }, 'Боты'),
        botRows,
        h('div', { class: 'section-title' }, 'Как отвечают боты' + (owner ? '' : ' (меняет создатель)')),
        h('div', { class: 'chips' }, chips),
        hint,
        h('div', { class: 'section-title' }, 'Код приглашения'),
        h('div', { class: 'code' }, room.joinCode),
      );
      openModal({
        title: 'Группа',
        body,
        buttons: [
          { label: 'Закрыть' },
          owner && {
            label: 'Сохранить',
            primary: true,
            onClick: async () => {
              const patch = {};
              if (nameInput.value.trim() && nameInput.value.trim() !== room.name) patch.name = nameInput.value.trim();
              if (mode !== room.botMode) patch.botMode = mode;
              if (!Object.keys(patch).length) return;
              try {
                g.room = await C.roomPatch(c, id, patch);
                renderBar();
                toast('Сохранено');
              } catch (e) {
                fail(e);
              }
            },
          },
        ].filter(Boolean),
      });
    }

    renderBar();
    renderList();
    setTimeout(() => autoGrow(ta), 0);
    return [bar, list, typingLine, stopRow, mentionRow, composer];
  }

  /* =====================================================================
     Каталог
     ===================================================================== */
  const catalogState = { q: '', sort: 'new' };

  function catalogCard(item) {
    return h(
      'div',
      { class: 'card', role: 'button', tabIndex: 0, onclick: () => ctx.go('/catalog/' + encodeURIComponent(item.id)) },
      avatarEl(safeCard(item)),
      h('div', { class: 'info' }, h('b', {}, item.name), h('span', {}, item.tagline || 'Без описания'), h('span', { class: 'meta' }, `от ${item.authorName} · ⬇ ${item.downloads}`)),
    );
  }

  function viewCatalog() {
    const list = h('div', { class: 'catalog-list' });
    const scroll = h('div', { class: 'scroll' });
    const bar = tabBar('Каталог');
    if (!cfg()) {
      scroll.append(notConnected('Каталог'));
      return [bar, scroll, tabbar('catalog')];
    }
    const search = h('input', { type: 'text', placeholder: '🔍 Поиск: имя, описание, автор', value: catalogState.q, autocomplete: 'off', class: 'search' });
    const sortEls = {};
    for (const [id, label] of [['new', 'Новые'], ['popular', 'Популярные']]) {
      sortEls[id] = h('button', {
        class: 'chip' + (catalogState.sort === id ? ' sel' : ''),
        onclick: () => {
          catalogState.sort = id;
          for (const [k, el] of Object.entries(sortEls)) el.classList.toggle('sel', k === id);
          load(true);
        },
      }, label);
    }
    const more = h('button', { class: 'btn block', hidden: true }, 'Показать ещё');
    let items = [];
    let total = 0;
    let seq = 0;
    let timer = null;

    search.addEventListener('input', () => {
      catalogState.q = search.value;
      clearTimeout(timer);
      timer = setTimeout(() => load(true), 350);
    });
    more.addEventListener('click', () => load(false));

    async function load(reset) {
      const my = ++seq;
      if (reset) {
        items = [];
        list.replaceChildren(h('div', { class: 'empty' }, 'Загрузка…'));
      }
      more.hidden = true;
      try {
        const res = await C.catalogList(cfg(), { q: catalogState.q.trim(), sort: catalogState.sort, offset: items.length, limit: 30 });
        if (my !== seq) return;
        total = res.total;
        items = items.concat(res.items);
        if (!items.length) {
          list.replaceChildren(
            h('div', { class: 'empty' }, h('div', { class: 'big' }, '🌐'), catalogState.q ? 'Ничего не найдено.' : 'В каталоге пока пусто.', h('br'), 'Опубликуйте своего бота: на вкладке «Персонажи» нажмите ⋮ → «Опубликовать в каталог».'),
          );
        } else {
          list.replaceChildren(...items.map(catalogCard));
        }
        more.hidden = items.length >= total;
      } catch (e) {
        if (my !== seq) return;
        list.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'big' }, '⚠️'), e.message, h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: () => load(true) }, '↻ Повторить'))));
      }
    }

    scroll.append(h('div', { class: 'field' }, search), h('div', { class: 'chips', style: 'margin-bottom:12px' }, Object.values(sortEls)), list, more);
    load(true);
    return [bar, scroll, tabbar('catalog')];
  }

  function viewCatalogItem(id) {
    const bar = h('div', { class: 'bar' }, h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: () => ctx.back() }, '←'), h('h1', {}, 'Бот из каталога'));
    const scroll = h('div', { class: 'scroll form' }, h('div', { class: 'empty' }, 'Загрузка…'));
    if (!cfg()) {
      setTimeout(() => ctx.replace('/catalog'), 0);
      return [bar, scroll];
    }
    (async () => {
      try {
        const item = await C.catalogGet(cfg(), id);
        const card = safeCard(item.card);
        const mine = item.authorId === cfg().userId;
        let addedId = null;
        const addBtn = h('button', { class: 'btn primary block' }, '➕ Добавить к моим персонажам');
        addBtn.addEventListener('click', () => {
          if (addedId) return ctx.go('/chat/' + encodeURIComponent(addedId));
          const ch = L.characterFromCard({ ...item.card, color: card.color, avatar: card.avatar });
          getDb().characters.push(ch);
          ctx.save();
          addedId = ch.id;
          C.catalogDownload(cfg(), id).catch(() => {});
          addBtn.textContent = '💬 Открыть чат';
          toast(`«${ch.name}» добавлен(а) на вкладку «Персонажи»`);
        });
        const section = (title, text) => (String(text || '').trim() ? [h('div', { class: 'section-title' }, title), h('div', { class: 'pre' }, text)] : []);
        const parts = [
          h('div', { class: 'detail-head' }, avatarEl(card, 'xl'), h('h2', {}, card.name), card.tagline && h('div', { class: 'hint' }, card.tagline), h('div', { class: 'hint' }, `от ${item.authorName} · ⬇ ${item.downloads}`)),
          addBtn,
          mine &&
            h('button', {
              class: 'btn block danger',
              onclick: async () => {
                if (!(await confirmDialog(`Снять «${card.name}» с публикации? У тех, кто уже добавил, бот останется.`, 'Снять'))) return;
                try {
                  await C.catalogRemove(cfg(), id);
                  for (const ch of getDb().characters) if (ch.publishedId === id) ch.publishedId = '';
                  ctx.save();
                  toast('Снято с публикации');
                  ctx.back();
                } catch (e) {
                  fail(e);
                }
              },
            }, '🚫 Снять с публикации'),
          section('Описание и внешность', card.description),
          section('Характер', card.personality),
          section('Манера речи и поведение', card.behavior),
          section('Сценарий / ситуация', card.scenario),
          section('Первое сообщение', card.firstMessage),
          section('Пример диалога', card.exampleDialogue),
          section('Правила', card.rules),
          h('div', { class: 'hint', style: 'text-align:center' }, 'Карточка написана другим участником. Проверьте текст перед использованием.'),
        ];
        scroll.replaceChildren(...parts.flat().filter(Boolean));
      } catch (e) {
        scroll.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'big' }, '⚠️'), e.message));
      }
    })();
    return [bar, scroll];
  }

  /* ---------- публикация своих персонажей ---------- */
  async function publishCharacter(ch) {
    const c = cfg();
    if (!c) {
      toast('Сначала подключитесь к серверу сообщества');
      return openCommunitySettings();
    }
    const update = !!ch.publishedId;
    if (!update && !(await confirmDialog(`Опубликовать «${ch.name}» в каталоге? Карточку увидят и смогут взять все участники сервера. Не указывайте в ней личные данные.`, 'Опубликовать', false))) return;
    try {
      const card = L.characterToCard(ch);
      let res;
      if (update) {
        try {
          res = await C.catalogUpdate(c, ch.publishedId, card);
        } catch (e) {
          if (e.kind !== 'notfound' && e.kind !== 'forbidden') throw e;
          res = await C.catalogPublish(c, card);
        }
      } else {
        res = await C.catalogPublish(c, card);
      }
      ch.publishedId = res.id;
      ctx.save();
      toast(update ? 'Обновлено в каталоге' : 'Опубликовано в каталоге');
    } catch (e) {
      fail(e);
    }
  }

  async function unpublishCharacter(ch) {
    const c = cfg();
    if (!c || !ch.publishedId) return;
    if (!(await confirmDialog(`Снять «${ch.name}» с публикации? У тех, кто уже добавил, бот останется.`, 'Снять'))) return;
    try {
      await C.catalogRemove(c, ch.publishedId);
    } catch (e) {
      if (e.kind !== 'notfound') return fail(e);
    }
    ch.publishedId = '';
    ctx.save();
    toast('Снято с публикации');
  }

  /* =====================================================================
     Настройки: подключение к серверу
     ===================================================================== */
  function settingsSection() {
    const box = h('div', { class: 'form-sub' });
    const status = h('div', { class: 'hint' });
    const setStatus = (t, bad) => {
      status.textContent = t;
      status.className = 'hint' + (bad ? ' status-bad' : '');
    };

    function draw() {
      box.replaceChildren(...(cfg() ? connectedUI() : connectUI()));
    }

    function connectUI() {
      const com = getDb().community;
      const urlInput = h('input', { type: 'text', value: com.url || '', placeholder: 'http://192.168.0.100:8787', autocapitalize: 'off', autocomplete: 'off' });
      urlInput.addEventListener('input', () => { com.url = urlInput.value; ctx.save(); });
      const nameInput = h('input', { type: 'text', value: com.name || getDb().settings.userName || '', placeholder: 'Ваш ник в группах', maxLength: 30 });
      const inviteInput = h('input', { type: 'text', placeholder: 'Если сервер просит', autocapitalize: 'off', autocomplete: 'off' });
      const keyInput = h('input', { type: 'password', placeholder: 'Ключ доступа' });
      const keyField = h('div', { hidden: true }, field('Ключ доступа', keyInput, 'Вход на уже созданный аккаунт (после переустановки или с другого телефона).'), h('button', { class: 'btn block', onclick: keyLogin }, 'Войти по ключу'));

      async function connect() {
        const url = C.normalizeServerUrl(urlInput.value);
        const name = nameInput.value.trim();
        if (!url) return setStatus('Укажите адрес сервера.', true);
        if (name.length < 2) return setStatus('Ник — от 2 символов.', true);
        setStatus('Подключаюсь…');
        try {
          const hl = await C.health(url);
          if (hl?.app !== 'rp-chat-server') throw new C.CommunityError('config', 'По этому адресу отвечает не сервер РП Чата.');
          if (hl.inviteRequired && !inviteInput.value.trim()) throw new C.CommunityError('forbidden', 'Серверу нужен код доступа — спросите его у владельца сервера.');
          const r = await C.register(url, { name, invite: inviteInput.value.trim() });
          getDb().community = { url, token: r.token, userId: r.userId, name: r.name };
          ctx.save();
          toast('Подключено');
          setStatus('');
          draw();
        } catch (e) {
          setStatus(e.message, true);
        }
      }

      async function keyLogin() {
        const url = C.normalizeServerUrl(urlInput.value);
        const token = keyInput.value.trim();
        if (!url || !token) return setStatus('Укажите адрес сервера и ключ доступа.', true);
        setStatus('Проверяю ключ…');
        try {
          const me = await C.getMe({ url, token });
          getDb().community = { url, token, userId: me.id, name: me.name };
          ctx.save();
          toast(`Вы вошли как ${me.name}`);
          setStatus('');
          draw();
        } catch (e) {
          setStatus(e.message, true);
        }
      }

      return [
        h('div', { class: 'hint' }, 'Сервер сообщества нужен для групповых чатов и общего каталога ботов. Его запускает один человек (на компьютере), остальные подключаются по адресу — в одной сети Wi-Fi или через Tailscale. Инструкция — в README.'),
        field('Адрес сервера', urlInput, 'Например, http://192.168.0.100:8787 или http://100.x.x.x:8787 (Tailscale).'),
        field('Ваш ник', nameInput),
        field('Код доступа к серверу', inviteInput, 'Его задаёт владелец сервера.'),
        h('button', { class: 'btn primary block', onclick: connect }, 'Подключиться'),
        h('button', { class: 'text-btn', style: 'align-self:center', onclick: () => (keyField.hidden = !keyField.hidden) }, 'У меня уже есть ключ доступа'),
        keyField,
        status,
      ];
    }

    function connectedUI() {
      const com = getDb().community;
      return [
        h('div', { class: 'conn-card' }, h('b', { class: 'status-ok' }, '✅ Подключено'), h('div', {}, 'Сервер: ' + com.url), h('div', {}, 'Ваш ник: ' + com.name)),
        h('button', { class: 'btn block', onclick: check }, 'Проверить связь'),
        h('button', { class: 'btn block', onclick: rename }, 'Сменить ник'),
        h('button', { class: 'btn block', onclick: showKey }, '🔑 Показать ключ доступа'),
        h('button', { class: 'btn block danger', onclick: disconnect }, 'Отключиться'),
        status,
      ];
    }

    async function check() {
      setStatus('Проверяю…');
      try {
        await C.health(cfg().url);
        const me = await C.getMe(cfg());
        setStatus(`Связь есть. Вы — ${me.name}.`);
      } catch (e) {
        setStatus(e.message, true);
      }
    }

    function rename() {
      const input = h('input', { type: 'text', value: cfg().name, maxLength: 30 });
      openModal({
        title: 'Сменить ник',
        body: field('Новый ник', input),
        buttons: [
          { label: 'Отмена' },
          {
            label: 'Сохранить',
            primary: true,
            onClick: async () => {
              try {
                const me = await C.renameMe(cfg(), input.value);
                getDb().community.name = me.name;
                ctx.save();
                draw();
                toast('Ник изменён');
              } catch (e) {
                fail(e);
              }
            },
          },
        ],
      });
    }

    function showKey() {
      const c = cfg();
      const ta = h('textarea', { readOnly: true, value: c.token, style: 'min-height:70px;font-family:monospace' });
      openModal({
        title: 'Ключ доступа',
        body: h('div', {}, h('p', {}, 'Это ваш пароль на сервере. Никому его не показывайте. Он нужен, чтобы войти под своим ником после переустановки или с другого устройства (адрес сервера тоже понадобится).'), ta),
        buttons: [{ label: 'Закрыть' }, { label: 'Скопировать', primary: true, keepOpen: true, onClick: async () => toast((await ctx.copyText(c.token)) ? 'Скопировано' : 'Не удалось скопировать') }],
      });
    }

    async function disconnect() {
      if (!(await confirmDialog('Отключиться от сервера? Группы и каталог станут недоступны, пока не подключитесь снова. Сохраните ключ доступа, если хотите вернуться под этим ником.', 'Отключиться'))) return;
      const com = getDb().community;
      getDb().community = { url: com.url, token: '', userId: '', name: com.name };
      ctx.save();
      setStatus('');
      draw();
    }

    draw();
    if (scrollToCommunity) {
      scrollToCommunity = false;
      setTimeout(() => box.scrollIntoView({ block: 'start' }), 60);
    }
    return box;
  }

  return { teardown, tabbar, viewGroups, viewGroupNew, viewGroup, viewCatalog, viewCatalogItem, publishCharacter, unpublishCharacter, settingsSection, openCommunitySettings };
}
