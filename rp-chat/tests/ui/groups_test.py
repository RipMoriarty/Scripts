"""Сквозной UI-тест групп и каталога: настоящий сервер сообщества + два «телефона» (Аня и Борис).
LLM подменён заглушкой, которая отвечает от имени того бота, чей промпт пришёл.

Запуск:  python3 -I tests/ui/groups_test.py [папка_для_скриншотов]
"""
import functools
import http.server
import json
import pathlib
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
WWW = ROOT / "www"
SHOTS = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/rp-shots")
SHOTS.mkdir(parents=True, exist_ok=True)

API = "https://openrouter.ai/api/v1"
CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
}


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(WWW)))
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{httpd.server_address[1]}/index.html"

# ---------- настоящий сервер сообщества ----------
SPORT = free_port()
tmp = tempfile.mkdtemp(prefix="rp-e2e-")
server = subprocess.Popen(
    ["node", str(ROOT / "server" / "server.mjs"), "--port", str(SPORT), "--host", "127.0.0.1", "--data", tmp + "/data.json", "--invite", "kod123", "--admin", "adm"],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
)
for _ in range(100):
    try:
        socket.create_connection(("127.0.0.1", SPORT), timeout=0.2).close()
        break
    except OSError:
        time.sleep(0.1)
SERVER_URL = f"127.0.0.1:{SPORT}"

# ---------- заглушка LLM ----------
def sse(pieces):
    out = ""
    for p in pieces:
        out += "data: " + json.dumps({"choices": [{"delta": {"content": p}}]}) + "\n\n"
    return out + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'


REPLIES = {"Мира": ["*кивает* ", "Привет от Миры"], "Гоблин": ["Хе-хе от Гоблина"], "Бард": ["Ля-ля от Барда"]}
reqs = {"anya": [], "boris": []}


def make_llm(who):
    def route(route):
        req = route.request
        if req.method == "OPTIONS":
            return route.fulfill(status=204, headers=CORS)
        if req.url.endswith("/chat/completions"):
            body = json.loads(req.post_data)
            reqs[who].append(body)
            m = re.search(r"играешь персонажа по имени «([^»]+)»", body["messages"][0]["content"])
            name = m.group(1) if m else "?"
            # модель по привычке подписывается — клиент должен убрать «Имя:»
            pieces = REPLIES.get(name, ["ок"])
            if name == "Гоблин":
                pieces = ["Гоблин: ", *pieces]
            return route.fulfill(status=200, headers={**CORS, "content-type": "text/event-stream"}, body=sse(pieces))
        return route.fulfill(status=404, headers=CORS, body="{}")
    return route


def seed(user, chars):
    data = {"settings": {"apiKey": "sk-or-test", "userName": user, "model": "deepseek/deepseek-v4-flash-0731:free"}, "characters": chars, "chats": {}}
    return f"if (!localStorage.getItem('rpchat.v1')) localStorage.setItem('rpchat.v1', {json.dumps(json.dumps(data, ensure_ascii=False))});"


MIRA = {"id": "c-mira", "name": "Мира", "emoji": "🍺", "tagline": "Хозяйка таверны", "personality": "Ироничная и добрая", "firstMessage": "*Мира кивает.* Заходи, не стой в дверях."}
GOB = {"id": "c-gob", "name": "Гоблин", "emoji": "👺", "tagline": "Хитрый гоблин", "personality": "Хитрый и жадный", "firstMessage": "Хе-хе, гость!"}
BARD = {"id": "c-bard", "name": "Бард", "emoji": "🎻", "tagline": "Странствующий певец", "personality": "Мечтательный"}

problems = []
passed = 0


def check(cond, msg):
    global passed
    if cond:
        passed += 1
        print("  ✓", msg)
    else:
        problems.append(msg)
        print("  ✗", msg)


def settle(page, ms=300):
    page.wait_for_timeout(ms)


def bots_msgs(page):
    return page.locator(".row.bot .msg.bot:not(.err)").all_inner_texts()


def wait_text(page, text, timeout=8000):
    page.wait_for_selector(f".chat-scroll :text('{text}')", timeout=timeout)


def connect(page, nick, invite="kod123"):
    page.locator(".tab[data-tab=groups]").click()
    page.get_by_role("button", name="Подключиться к серверу").click()
    page.wait_for_selector("text=Сервер сообщества")
    page.fill("input[placeholder='http://192.168.0.100:8787']", SERVER_URL)
    page.fill("input[placeholder='Ваш ник в группах']", nick)
    page.fill("input[placeholder='Если сервер просит']", invite)
    page.get_by_role("button", name="Подключиться", exact=True).click()


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    errors = []

    def new_phone(who, user, chars):
        c = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True, locale="ru-RU")
        c.add_init_script(seed(user, chars))
        c.route(API + "/**", make_llm(who))
        p = c.new_page()
        p.on("pageerror", lambda e: errors.append(f"{who} pageerror: {e}"))
        p.on("console", lambda m: errors.append(f"{who} console.{m.type}: {m.text}") if m.type == "error" and "Failed to load resource" not in m.text else None)
        p.goto(BASE)
        p.wait_for_selector(".card")
        return c, p

    ca, anya = new_phone("anya", "Аня", [MIRA, GOB])
    cb, boris = new_phone("boris", "Борис", [BARD])

    # ---- 1. вкладки и подключение ----
    check(anya.locator(".tabbar .tab").count() == 3, "внизу три вкладки")
    check(anya.locator(".tab.sel").inner_text().strip().endswith("Персонажи"), "активна вкладка «Персонажи»")
    anya.locator(".tab[data-tab=groups]").click()
    anya.wait_for_selector(".empty")
    check("сервер сообщества" in anya.locator(".empty").inner_text(), "без подключения во вкладке «Группы» — приглашение подключиться")
    anya.locator(".tab[data-tab=catalog]").click()
    anya.wait_for_selector(".empty")
    check("сервер сообщества" in anya.locator(".empty").inner_text(), "и во вкладке «Каталог» тоже")

    connect(anya, "Аня", invite="неверный")
    anya.wait_for_selector(".status-bad")
    check("код доступа" in anya.locator(".status-bad").inner_text().lower(), "неверный код доступа → понятная ошибка")
    anya.fill("input[placeholder='Если сервер просит']", "kod123")
    anya.get_by_role("button", name="Подключиться", exact=True).click()
    anya.wait_for_selector(".conn-card")
    check("Подключено" in anya.locator(".conn-card").inner_text() and "Аня" in anya.locator(".conn-card").inner_text(), "после верного кода — «Подключено», ник виден")
    shot_path = SHOTS / "g01_settings_connected.png"
    anya.screenshot(path=str(shot_path))
    com = anya.evaluate("JSON.parse(localStorage.getItem('rpchat.v1')).community")
    check(com["url"] == "http://" + SERVER_URL and len(com["token"]) > 20 and com["name"] == "Аня", "адрес нормализован, токен сохранён")

    connect_b = lambda: None
    boris.locator(".tab[data-tab=groups]").click()
    boris.get_by_role("button", name="Подключиться к серверу").click()
    boris.fill("input[placeholder='http://192.168.0.100:8787']", SERVER_URL)
    boris.fill("input[placeholder='Ваш ник в группах']", "Аня")
    boris.fill("input[placeholder='Если сервер просит']", "kod123")
    boris.get_by_role("button", name="Подключиться", exact=True).click()
    boris.wait_for_selector(".status-bad")
    check("занят" in boris.locator(".status-bad").inner_text(), "ник «Аня» уже занят — Борис получает ошибку")
    boris.fill("input[placeholder='Ваш ник в группах']", "Борис")
    boris.get_by_role("button", name="Подключиться", exact=True).click()
    boris.wait_for_selector(".conn-card")

    # ---- 2. создание группы ----
    anya.locator(".icon-btn[aria-label=Назад]").click()
    anya.locator(".tab[data-tab=groups]").click()
    anya.wait_for_selector("text=Групп пока нет")
    anya.get_by_role("button", name="＋ Создать группу").click()
    anya.wait_for_selector("text=Новая группа")
    anya.fill("input[placeholder^='Например, Таверна']", "Таверна «Верхний брод»")
    anya.locator(".pill", has_text="Мира").click()
    anya.locator(".pill", has_text="Гоблин").click()
    check("Выбрано: 2" in anya.locator(".hint", has_text="Выбрано").inner_text(), "выбрано два бота")
    anya.screenshot(path=str(SHOTS / "g02_group_new.png"))
    anya.locator(".text-btn", has_text="Создать").click()
    anya.wait_for_selector(".chat-scroll")
    wait_text(anya, "Хе-хе, гость!")
    wait_text(anya, "Заходи, не стой")
    check(anya.locator(".bar .title b").inner_text() == "Таверна «Верхний брод»", "в заголовке — название группы")
    check("👤 1" in anya.locator(".bar .title small").inner_text() and "🤖 2" in anya.locator(".bar .title small").inner_text(), "в подзаголовке — 1 участник и 2 бота")
    check(anya.locator(".who .tag").count() >= 2, "у сообщений ботов есть метка «бот»")
    check(anya.locator(".mention-row .chip").all_inner_texts() == ["@Мира", "@Гоблин", "@все"], "под чатом — кнопки для упоминаний")

    # ---- 3. код приглашения ----
    anya.locator(".icon-btn[aria-label=Меню]").click()
    anya.locator(".sheet-item", has_text="Пригласить друзей").click()
    anya.wait_for_selector(".modal textarea")
    invite_text = anya.locator(".modal textarea").input_value()
    m = re.search(r"Код группы: ([A-Z0-9]{8})", invite_text)
    check(bool(m) and "Адрес сервера: http://" + SERVER_URL in invite_text, "приглашение содержит адрес сервера и 8-значный код")
    code = m.group(1)
    anya.get_by_role("button", name="Закрыть").click()

    # ---- 4. Борис входит по коду ----
    boris.locator(".icon-btn[aria-label=Назад]").click()
    boris.locator(".tab[data-tab=groups]").click()
    boris.get_by_role("button", name="Войти по коду").click()
    boris.fill(".modal input", code.lower())
    boris.locator(".modal .btn.primary").click()
    boris.wait_for_selector(".chat-scroll")
    wait_text(boris, "Хе-хе, гость!")
    check("👤 2" in boris.locator(".bar .title small").inner_text(), "Борис в группе: участников 2")
    wait_text(anya, "Борис присоединился")
    check(True, "Аня видит системное сообщение о вступлении Бориса (через SSE)")
    boris.screenshot(path=str(SHOTS / "g03_group_boris.png"))

    # ---- 5. сообщение → отвечают оба бота (режим «все»), генерирует клиент отправителя ----
    boris.fill("textarea", "Привет всем!")
    boris.locator(".send").click()
    wait_text(boris, "Привет от Миры")
    wait_text(boris, "Хе-хе от Гоблина")
    wait_text(anya, "Привет от Миры")
    wait_text(anya, "Хе-хе от Гоблина")
    check(len(reqs["boris"]) == 2 and len(reqs["anya"]) == 0, f"запросы к LLM сделал только отправитель: boris={len(reqs['boris'])}, anya={len(reqs['anya'])}")
    sysmsg = reqs["boris"][0]["messages"][0]["content"]
    check("групповом чате «Таверна «Верхний брод»»" in sysmsg and "Участники-люди: Аня, Борис" in sysmsg, "в промпте — групповой контекст и участники")
    last = reqs["boris"][0]["messages"][-1]
    check(last["role"] == "user" and last["content"].endswith("Борис: Привет всем!"), f"последняя реплика в промпте подписана ником: {last['content'][-40:]!r}")
    second = reqs["boris"][1]["messages"]
    check(any(m["role"] == "user" and "Мира: *кивает* Привет от Миры" in m["content"] for m in second), "второй бот видит ответ первого как реплику другого участника")
    texts = bots_msgs(boris)
    check(any(t.startswith("Хе-хе от Гоблина") for t in texts), f"подпись «Гоблин:» от модели убрана: {texts[-1]!r}")
    boris.screenshot(path=str(SHOTS / "g04_bots_replied.png"))
    anya.screenshot(path=str(SHOTS / "g05_group_anya.png"))

    # ---- 6. @упоминание ----
    n0 = len(reqs["boris"])
    boris.locator(".mention-row .chip", has_text="@Гоблин").click()
    check(boris.input_value("textarea") == "@Гоблин ", "кнопка @Гоблин вставляет упоминание в поле")
    boris.fill("textarea", "@гоблин, а ты что скажешь?")
    boris.locator(".send").click()
    boris.wait_for_function("document.querySelectorAll('.row.bot .msg.bot:not(#g-stream)').length >= 5")
    settle(boris, 400)
    check(len(reqs["boris"]) == n0 + 1, "на @гоблин ответил только Гоблин (один запрос)")

    # ---- 7. создатель переключает режим на «только по @» ----
    anya.locator(".icon-btn[aria-label=Меню]").click()
    anya.locator(".sheet-item", has_text="Участники, боты и настройки").click()
    anya.wait_for_selector(".modal .code")
    check(anya.locator(".modal .code").inner_text() == code, "в окне группы показан код приглашения")
    members = anya.locator(".modal .li").all_inner_texts()
    check(any("Аня" in x and "👑" in x for x in members) and any("Борис" in x for x in members), f"список участников: {members}")
    settle(anya, 400)
    anya.screenshot(path=str(SHOTS / "g06_group_info.png"))
    anya.locator(".modal .chip", has_text="Только когда позвали").click()
    anya.locator(".modal .btn.primary").click()
    anya.wait_for_selector("text=Сохранено")
    n1 = len(reqs["boris"])
    settle(boris, 600)
    boris.fill("textarea", "Просто болтаю")
    boris.locator(".send").click()
    boris.wait_for_selector(".row.user .msg:has-text('Просто болтаю')")
    settle(boris, 1200)
    check(len(reqs["boris"]) == n1, "в режиме «только по @» на обычное сообщение боты молчат (настройка дошла до Бориса)")
    boris.fill("textarea", "@все, слушайте")
    boris.locator(".send").click()
    boris.wait_for_function("document.querySelectorAll('.row.bot .msg.bot:not(#g-stream)').length >= 7")
    check(len(reqs["boris"]) == n1 + 2, f"@все зовёт всех ботов даже в режиме «только по @» (запросов: было {n1}, стало {len(reqs['boris'])})")

    # ---- 8. удаление сообщения ----
    boris.locator(".row.user .msg", has_text="Просто болтаю").click()
    boris.locator(".sheet-item", has_text="Удалить сообщение").click()
    boris.wait_for_selector(".row.user .msg:has-text('Просто болтаю')", state="detached")
    anya.wait_for_selector(".row.bot .msg:has-text('Просто болтаю')", state="detached")
    check(True, "удалённое Борисом сообщение исчезло у обоих")

    # ---- 10. каталог ----
    anya.locator(".icon-btn[aria-label=Назад]").click()
    anya.wait_for_selector(".tabbar")
    anya.locator(".tab[data-tab=home]").click()
    anya.locator(".card", has_text="Мира").locator(".more").click()
    anya.locator(".sheet-item", has_text="Опубликовать в каталог").click()
    anya.locator(".modal .btn.primary").click()
    anya.wait_for_selector("text=Опубликовано в каталоге")
    check(bool(anya.evaluate("JSON.parse(localStorage.getItem('rpchat.v1')).characters.find(c => c.id === 'c-mira').publishedId")), "у опубликованного персонажа сохранён publishedId")
    anya.locator(".card", has_text="Мира").locator(".more").click()
    check(anya.locator(".sheet-item", has_text="Обновить в каталоге").count() == 1 and anya.locator(".sheet-item", has_text="Снять с публикации").count() == 1, "в меню теперь «Обновить» и «Снять с публикации»")
    anya.locator(".sheet-item", has_text="Отмена").click()

    boris.locator(".icon-btn[aria-label=Назад]").click()
    boris.locator(".tab[data-tab=catalog]").click()
    boris.wait_for_selector(".catalog-list .card")
    check(boris.locator(".catalog-list .card .info b").all_inner_texts() == ["Мира"], "Борис видит Миру в каталоге")
    check("от Аня" in boris.locator(".catalog-list .card").inner_text(), "указан автор")
    boris.screenshot(path=str(SHOTS / "g07_catalog.png"))
    boris.fill("input.search", "несуществующее")
    boris.wait_for_selector("text=Ничего не найдено")
    boris.fill("input.search", "хозяйка")
    boris.wait_for_selector(".catalog-list .card")
    boris.locator(".catalog-list .card").click()
    boris.wait_for_selector(".detail-head")
    check("Ироничная и добрая" in boris.locator(".scroll").inner_text(), "в карточке виден характер бота: " + boris.locator(".scroll").inner_text()[:200].replace("\n", " | "))
    boris.screenshot(path=str(SHOTS / "g08_catalog_item.png"))
    boris.get_by_role("button", name="➕ Добавить к моим персонажам").click()
    boris.wait_for_selector("text=добавлен(а)")
    boris.get_by_role("button", name="💬 Открыть чат").wait_for()
    boris.locator(".icon-btn[aria-label=Назад]").click()
    boris.locator(".tab[data-tab=home]").click()
    check(sorted(boris.locator(".card .info b").all_inner_texts()) == ["Бард", "Мира"], "Мира появилась в «Персонажах» у Бориса")
    chars_b = boris.evaluate("JSON.parse(localStorage.getItem('rpchat.v1')).characters")
    check(all(not c.get("publishedId") for c in chars_b), "скачанная копия не считается опубликованной")
    # скачивания посчитаны
    boris.locator(".tab[data-tab=catalog]").click()
    boris.wait_for_selector(".catalog-list .card")
    check("⬇ 1" in boris.locator(".catalog-list .card").inner_text(), "счётчик скачиваний вырос до 1")

    # автор снимает с публикации
    anya.locator(".tab[data-tab=catalog]").click()
    anya.wait_for_selector(".catalog-list .card")
    anya.locator(".catalog-list .card").click()
    anya.get_by_role("button", name="🚫 Снять с публикации").click()
    anya.locator(".modal .btn.danger").click()
    anya.wait_for_selector("text=Снято с публикации")
    anya.wait_for_selector("text=В каталоге пока пусто")
    check(True, "после снятия каталог пуст")

    # ---- 11. добавление бота в группу, выход ----
    anya.locator(".tab[data-tab=groups]").click()
    anya.locator(".card", has_text="Таверна").click()
    anya.wait_for_selector(".chat-scroll")
    check("Привет от Миры" in anya.locator(".chat-scroll").inner_text(), "Аня при возврате в группу видит всю историю")
    boris.locator(".tab[data-tab=groups]").click()
    boris.locator(".card", has_text="Таверна").click()
    boris.wait_for_selector(".chat-scroll")
    boris.locator(".icon-btn[aria-label=Меню]").click()
    boris.locator(".sheet-item", has_text="Добавить бота").click()
    boris.locator(".sheet-item", has_text="Бард").click()
    boris.wait_for_selector("text=Бард")
    boris.wait_for_function("document.querySelector('.bar .title small').textContent.includes('🤖 3')")
    wait_text(anya, "добавил(а) бота Бард")
    check("🤖 3" in anya.locator(".bar .title small").inner_text(), "бот Бориса добавлен — у Ани тоже 3 бота (через SSE)")

    boris.locator(".icon-btn[aria-label=Меню]").click()
    boris.locator(".sheet-item", has_text="Выйти из группы").click()
    boris.locator(".modal .btn.danger").click()
    boris.wait_for_selector("text=Групп пока нет")
    wait_text(anya, "Борис покинул")
    check(True, "после выхода Бориса Аня видит об этом сообщение")

    # ---- 12. резервная копия не содержит секретов ----
    anya.locator(".icon-btn[aria-label=Назад]").click()
    anya.locator(".bar .icon-btn[aria-label=Настройки]").click()
    anya.get_by_role("button", name="📤 Резервная копия (персонажи и чаты)").click()
    anya.wait_for_selector(".modal textarea")
    backup = anya.locator(".modal textarea").input_value()
    anya.get_by_role("button", name="Закрыть").click()
    token = com["token"]
    check(token not in backup and "sk-or-test" not in backup and "community" not in backup, "в резервной копии нет API-ключа и токена сообщества")

    # ---- 13. отключение ----
    anya.locator(".scroll.form").evaluate("e => e.scrollTo(0, 99999)")
    anya.get_by_role("button", name="Отключиться").click()
    anya.locator(".modal .btn.danger").click()
    anya.wait_for_selector("text=Подключиться", timeout=3000)
    com2 = anya.evaluate("JSON.parse(localStorage.getItem('rpchat.v1')).community")
    check(com2["token"] == "" and com2["url"].endswith(str(SPORT)), "после отключения токен стёрт, адрес сервера остался")

    errs = [e for e in errors if "ERR_CONNECTION" not in e]
    check(not errs, f"нет ошибок JS/консоли: {errs[:3]}")
    browser.close()

server.terminate()
print(f"\ngroups-ui: {passed} passed, {len(problems)} failed")
if problems:
    print("Провалено:", *problems, sep="\n - ")
    sys.exit(1)
