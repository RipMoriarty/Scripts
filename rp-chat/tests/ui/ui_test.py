"""UI-тест приложения в headless Chromium с подменой ответов OpenRouter.

Запуск:  python3 -I tests/ui/ui_test.py [папка_для_скриншотов]
"""
import functools
import http.server
import json
import pathlib
import sys
import threading

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

# ---------- статический сервер ----------
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):  # без шума
        pass

handler = functools.partial(Quiet, directory=str(WWW))
httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{httpd.server_address[1]}/index.html"

# ---------- мок API ----------
state = {"chat_requests": [], "mode": "ok", "reply": ["*Мира хмыкает* — ", "Две медяшки, ", "путник."]}
MODELS = {
    "data": [
        {"id": "deepseek/deepseek-v4-flash-0731:free", "name": "DeepSeek V4 Flash 0731 (free)", "created": 300, "context_length": 1048576, "pricing": {"prompt": "0", "completion": "0"}},
        {"id": "deepseek/deepseek-r1:free", "name": "DeepSeek R1 (free)", "created": 100, "context_length": 163840, "pricing": {"prompt": "0", "completion": "0"}},
        {"id": "deepseek/deepseek-v4.1-flash-1017", "name": "DeepSeek V4.1 Flash", "created": 400, "pricing": {"prompt": "0.000000006", "completion": "0.0000005"}},
        {"id": "meta/llama:free", "name": "Llama", "created": 50, "pricing": {"prompt": "0", "completion": "0"}},
    ]
}


def sse(pieces):
    out = ": OPENROUTER PROCESSING\n\n"
    for p in pieces:
        out += "data: " + json.dumps({"choices": [{"delta": {"content": p}}]}) + "\n\n"
    out += 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    return out


def api_route(route):
    req = route.request
    url = req.url
    if req.method == "OPTIONS":
        return route.fulfill(status=204, headers=CORS)
    if url.endswith("/models"):
        return route.fulfill(status=200, headers={**CORS, "content-type": "application/json"}, body=json.dumps(MODELS))
    if url.endswith("/key"):
        auth = req.headers.get("authorization", "")
        if auth != "Bearer sk-or-test":
            return route.fulfill(status=401, headers={**CORS, "content-type": "application/json"}, body='{"error":{"code":401,"message":"No auth credentials found"}}')
        return route.fulfill(status=200, headers={**CORS, "content-type": "application/json"}, body='{"data":{"label":"t","is_free_tier":true}}')
    if url.endswith("/chat/completions"):
        body = json.loads(req.post_data)
        state["chat_requests"].append(body)
        mode = state["mode"]
        if mode == "429":
            return route.fulfill(status=429, headers={**CORS, "content-type": "application/json"}, body='{"error":{"code":429,"message":"Rate limit exceeded: free-models-per-day"}}')
        if mode == "gone" and body["model"] == "deepseek/deepseek-gone:free":
            return route.fulfill(status=404, headers={**CORS, "content-type": "application/json"}, body='{"error":{"code":404,"message":"No endpoints found for deepseek/deepseek-gone:free."}}')
        if mode == "think":
            return route.fulfill(status=200, headers={**CORS, "content-type": "text/event-stream"}, body=sse(["<think>Надо ответить", " кратко</think>", "Готово."]))
        if mode == "xss":
            return route.fulfill(status=200, headers={**CORS, "content-type": "text/event-stream"}, body=sse(["<img src=x onerror=\"window.__xss=1\">", "<b>жирный?</b> ok"]))
        if mode == "empty":
            return route.fulfill(status=200, headers={**CORS, "content-type": "text/event-stream"}, body=sse([]))
        return route.fulfill(status=200, headers={**CORS, "content-type": "text/event-stream"}, body=sse(state["reply"]))
    return route.fulfill(status=404, headers=CORS, body="{}")


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


def shot(page, name):
    page.screenshot(path=str(SHOTS / f"{name}.png"))


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True, locale="ru-RU")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" and "Failed to load resource" not in m.text else None)
    page.route(API + "/**", api_route)

    # ---- 1. главный экран ----
    page.goto(BASE)
    page.wait_for_selector(".card")
    names = page.locator(".card .info b").all_inner_texts()
    check(set(names) == {"Мира", "Рассказчик"}, f"на главном экране стартовые персонажи: {names}")
    check(page.locator(".banner").count() == 1, "баннер «Нужен API-ключ» показан без ключа")
    shot(page, "01_home")

    # ---- 2. чат без ключа ----
    page.locator(".card", has_text="Мира").click()
    page.wait_for_selector(".msg.bot")
    check("Закрывай быстрее" in page.locator(".msg.bot").first.inner_text(), "приветствие персонажа показано")
    check(page.locator(".msg.bot em").count() >= 1, "*действия* отрисованы курсивом")
    page.fill("textarea", "Привет!")
    page.click(".send")
    page.wait_for_selector(".msg.err")
    check("API-ключ" in page.locator(".msg.err").inner_text(), "без ключа — понятная ошибка с кнопкой настроек")
    check(len(state["chat_requests"]) == 0, "без ключа запрос к API не отправляется")
    shot(page, "02_no_key")

    # ---- 3. настройки ----
    page.locator(".chip", has_text="Настройки").click()
    page.wait_for_selector("text=Подключение к модели")
    page.fill("input[type=password]", "sk-or-bad")
    page.click("text=Проверить ключ")
    page.wait_for_selector(".status-bad")
    check("API-ключ" in page.locator(".status-bad").inner_text(), "неверный ключ → сообщение об ошибке")
    page.fill("input[type=password]", "sk-or-test")
    page.click("text=Проверить ключ")
    page.wait_for_selector(".status-ok")
    check("Ключ работает" in page.locator(".status-ok").inner_text(), "верный ключ принят")
    page.get_by_role("button", name="Найти бесплатные DeepSeek").click()
    page.wait_for_selector(".pill")
    ids = [t.split("\n")[0] for t in page.locator(".pill").all_inner_texts()]
    check(ids == ["deepseek/deepseek-v4-flash-0731:free", "deepseek/deepseek-r1:free"], f"найдены только бесплатные DeepSeek, новые первыми: {ids}")
    shot(page, "03_settings_models")
    page.locator(".pill", has_text="deepseek-r1").click()
    check(page.input_value("input[placeholder='deepseek/…:free']") == "deepseek/deepseek-r1:free", "выбор модели записан в поле")
    stored = page.evaluate("JSON.parse(localStorage.getItem('rpchat.v1')).settings")
    check(stored["apiKey"] == "sk-or-test" and stored["model"] == "deepseek/deepseek-r1:free", "настройки сохранены в localStorage")
    page.fill("input[placeholder='Как к вам обращаться']", "Алекс")
    page.locator(".scroll.form").evaluate("e => e.scrollTo(0, e.scrollHeight)")
    shot(page, "04_settings_bottom")

    # ---- 4. отправка сообщения, стриминг ----
    page.go_back()  # в чат
    page.wait_for_selector(".composer textarea")
    page.locator(".msg.err").wait_for(state="attached")
    page.locator(".msg.err .chip", has_text="Повторить").click()
    page.wait_for_function("[...document.querySelectorAll('.msg.bot')].some(e => e.innerText.includes('Две медяшки, путник.'))")
    check("Две медяшки, путник." in page.locator(".msg.bot").nth(1).inner_text(), "ответ модели собран из потока")
    req = state["chat_requests"][-1]
    check(req["model"] == "deepseek/deepseek-r1:free" and req["stream"] is True, "в запросе выбранная модель и stream=true")
    check(req["messages"][0]["role"] == "system" and "Мира" in req["messages"][0]["content"] and "Алекс" in req["messages"][0]["content"], "system-промпт содержит персонажа и имя игрока")
    check(req["messages"][-1] == {"role": "user", "content": "Привет!"}, "последнее сообщение — реплика игрока")
    check(req["messages"][1]["role"] == "assistant", "приветствие персонажа есть в истории")
    shot(page, "05_chat")

    # ---- 5. перегенерация / продолжение ----
    state["reply"] = ["Другой ответ."]
    page.locator(".chip", has_text="Заново").click()
    page.wait_for_function("document.querySelectorAll('.msg.bot').length >= 2 && [...document.querySelectorAll('.msg.bot')].some(e => e.innerText.includes('Другой ответ.'))")
    check(page.locator(".msg.bot", has_text="Две медяшки").count() == 0, "перегенерация заменила последний ответ")
    check(page.locator(".msg.user").count() == 1, "реплика игрока осталась одна")
    state["reply"] = ["И добавила шёпотом."]
    page.locator(".chip", has_text="Продолжить").click()
    page.wait_for_function("[...document.querySelectorAll('.msg.bot')].some(e => e.innerText.includes('Другой ответ. И добавила шёпотом.'))")
    check(state["chat_requests"][-1]["messages"][-1]["content"].startswith("(Продолжи"), "«Продолжить» отправляет служебную просьбу")
    check(page.locator(".msg.bot").count() == 2, "продолжение добавилось к тому же сообщению")

    # ---- 6. ошибка лимита и повтор ----
    state["mode"] = "429"
    page.fill("textarea", "Ещё вопрос")
    page.click(".send")
    page.wait_for_selector(".msg.err")
    check("Лимит запросов" in page.locator(".msg.err").inner_text(), "429 → понятное объяснение лимитов")
    state["mode"] = "ok"
    state["reply"] = ["Ответ после повтора."]
    page.locator(".chip", has_text="Повторить").click()
    page.wait_for_function("[...document.querySelectorAll('.msg.bot')].some(e => e.innerText.includes('Ответ после повтора.'))")
    check(page.locator(".msg.user", has_text="Ещё вопрос").count() == 1, "при повторе реплика игрока не дублируется")

    # ---- 7. модель исчезла → автозамена ----
    page.evaluate("() => { const d = window.__rp.db; d.settings.model = 'deepseek/deepseek-gone:free'; localStorage.setItem('rpchat.v1', JSON.stringify(d)); }")
    state["mode"] = "gone"
    state["reply"] = ["Ответ новой моделью."]
    page.fill("textarea", "Проверка модели")
    page.click(".send")
    page.wait_for_function("[...document.querySelectorAll('.msg.bot')].some(e => e.innerText.includes('Ответ новой моделью.'))")
    check(page.evaluate("window.__rp.db.settings.model") == "deepseek/deepseek-v4-flash-0731:free", "недоступная модель автоматически заменена на свежую бесплатную")
    shot(page, "06_after_model_swap")
    state["mode"] = "ok"

    # ---- 8. размышления и XSS ----
    state["mode"] = "think"
    page.fill("textarea", "Думай")
    page.click(".send")
    page.wait_for_function("[...document.querySelectorAll('.msg.bot')].some(e => e.innerText.trim() === 'Готово.')")
    check(page.locator(".msg.bot", has_text="Надо ответить").count() == 0, "блок <think> скрыт")
    state["mode"] = "xss"
    page.fill("textarea", "Атака")
    page.click(".send")
    page.wait_for_function("[...document.querySelectorAll('.msg.bot')].some(e => e.innerText.includes('жирный?'))")
    check(page.evaluate("window.__xss") is None, "HTML из ответа модели не выполняется")
    check(page.locator(".chat-scroll img[src='x']").count() == 0, "HTML-теги из ответа экранируются")
    state["mode"] = "empty"
    page.fill("textarea", "Пусто")
    page.click(".send")
    page.wait_for_selector(".msg.err")
    check("пустой ответ" in page.locator(".msg.err").inner_text(), "пустой ответ модели → подсказка про токены")
    state["mode"] = "ok"
    page.locator(".msg.err .chip", has_text="Повторить").click()
    page.wait_for_selector(".msg.err", state="detached")

    # ---- 9. меню сообщения: изменить / откат ----
    n_before = page.locator(".msg").count()
    page.locator(".msg.user").first.click()
    page.wait_for_selector(".sheet")
    page.click(".sheet-item >> text=Изменить")
    page.fill(".modal textarea", "Привет, отредактировано!")
    page.click(".modal .btn.primary")
    check(page.locator(".msg.user", has_text="отредактировано").count() == 1, "сообщение игрока можно изменить")
    page.locator(".msg.user").first.click()
    page.click(".sheet-item >> text=Откатить")
    check(page.locator(".msg").count() < n_before and page.locator(".msg.bot").count() == 1 + 1 - 1, "откат удаляет всё ниже выбранного сообщения")
    shot(page, "07_menu_rewind")

    # ---- 10. создание персонажа ----
    page.go_back()
    page.wait_for_selector(".card")
    page.click("text=Создать персонажа")
    page.wait_for_selector("text=Новый персонаж")
    page.click("text=Сохранить")
    check(page.locator(".toast", has_text="Укажите имя").count() == 1, "нельзя сохранить персонажа без имени")
    page.fill("input[placeholder='Например, Мира']", "Лорд Кассиан")
    page.fill("textarea[placeholder^='Черты']", "Надменный, но справедливый.")
    page.fill("textarea[placeholder^='С чего персонаж']", "*Поднимает бровь.* — Вы опоздали, {{user}}.")
    page.fill("input[aria-label='Эмодзи']", "👑")
    shot(page, "08_edit_character")
    page.click("text=Сохранить")
    page.wait_for_selector(".card >> text=Лорд Кассиан")
    check(page.locator(".card").count() == 3, "новый персонаж появился в списке")
    page.locator(".card", has_text="Лорд Кассиан").click()
    page.wait_for_selector(".msg.bot")
    check("Вы опоздали, Алекс." in page.locator(".msg.bot").first.inner_text(), "в первом сообщении подставлено имя игрока")
    page.fill("textarea", "Простите")
    page.click(".send")
    page.wait_for_function("document.querySelectorAll('.msg.bot').length >= 2")
    sysmsg = state["chat_requests"][-1]["messages"][0]["content"]
    check("Надменный, но справедливый." in sysmsg and "Лорд Кассиан" in sysmsg, "характер нового персонажа попал в system-промпт")
    page.go_back()

    # ---- 11. импорт карточки SillyTavern ----
    page.click("text=Импорт")
    page.click(".sheet-item >> text=Вставить JSON")
    card = {"spec": "chara_card_v2", "data": {"name": "Кай", "description": "Вор с рынка", "personality": "Хитрый", "first_mes": "*Ухмыляется.* — Кошелёк, {{user}}?", "mes_example": "", "scenario": "Рынок"}}
    page.fill(".modal textarea", json.dumps(card, ensure_ascii=False))
    page.click(".modal .btn.primary")
    page.wait_for_selector(".card >> text=Кай")
    check(page.locator(".card").count() == 4, "карточка SillyTavern импортирована")

    # ---- 12. удаление, главный экран, резервная копия ----
    page.locator(".card", has_text="Кай").locator(".more").click()
    page.click(".sheet-item >> text=Удалить")
    page.click(".modal .btn.danger")
    page.wait_for_function("document.querySelectorAll('.card').length === 3")
    check(page.locator(".banner").count() == 0, "после ввода ключа баннер скрыт")
    shot(page, "09_home_final")

    page.reload()
    page.wait_for_selector(".card")
    check(page.locator(".card").count() == 3 and page.evaluate("window.__rp.db.settings.apiKey") == "sk-or-test", "данные переживают перезапуск")

    # ---- 13. навигация «назад» ----
    page.locator(".card", has_text="Мира").click()
    page.wait_for_selector(".composer")
    page.click("button[aria-label='Назад']")
    page.wait_for_selector(".card")
    check(page.url.endswith("#/"), "кнопка «←» возвращает на главный экран")

    check(not errors, f"нет ошибок JS/консоли: {errors}")
    browser.close()

httpd.shutdown()
print(f"\nui: {passed} passed, {len(problems)} failed")
if problems:
    print("FAILED:", *problems, sep="\n  - ")
    sys.exit(1)
