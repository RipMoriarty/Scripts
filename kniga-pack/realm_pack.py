#!/usr/bin/env python3
"""Иконки и звуки миров-походов (средневековье и мир богов смерти) для ресурспака «Книга Судеб».

Подключается из make_cyber_pack.py: он передаёт себя в icons(M) и sounds(M), чтобы не дублировать рисование иконок
(класс Icon, палитра PAL) и синтез звука (saw, lowpass, echo, ...).

  * 20 иконок 16×16: по 4 припаса и 6 реликвий на мир (модели по CustomModelData, номера совпадают с RealmDef.java),
  * 8 звуков: на мир — привязка реликвии, сдача, завершение и фоновая музыка (петля ровно 64 секунды).
"""
import math

import numpy as np

SR = 44100

NEW_PAL = {
    'a': (0x8a, 0x4a, 0x2c), 'A': (0x4f, 0x26, 0x18),
    'd': (0x6b, 0x44, 0x26), 'B': (0x3b, 0x25, 0x16), 'n': (0xc0, 0x8a, 0x52),
    'e': (0xdc, 0xd4, 0xbe), 'E': (0x8e, 0x86, 0x74),
    'f': (0xe8, 0x3a, 0x12), 'h': (0xff, 0xf1, 0xa8),
    'i': (0x7d, 0xf0, 0xff), 'I': (0x2a, 0x4a, 0x8c),
    'u': (0xa3, 0x1d, 0x26), 'U': (0x5e, 0x0f, 0x18),
    'v': (0xb0, 0x4d, 0xff), 'V': (0x57, 0x1f, 0x8f),
    'x': (0xe0, 0xb0, 0x3a), 'X': (0x8a, 0x66, 0x1c),
    'z': (0x9a, 0xa0, 0xa8), 'Z': (0x4a, 0x4e, 0x58),
    'q': (0xdd, 0xe3, 0xea), 'Q': (0x8d, 0x96, 0xa6),
    'N': (0x1f, 0x33, 0x1f),
}

# (имя файла, какой ванильный предмет заменяем, CustomModelData) — должно совпадать с RealmDef.java
MODELS = [
    ('medieval/zhelezo', 'iron_ingot', 7511), ('medieval/kozha', 'leather', 7512), ('medieval/drevko', 'stick', 7513),
    ('medieval/serebro', 'gold_nugget', 7514),
    ('medieval/drakon', 'dragon_breath', 7501), ('medieval/rytsar', 'iron_horse_armor', 7502),
    ('medieval/zhrets', 'glistering_melon_slice', 7503), ('medieval/klinok', 'nether_brick', 7504),
    ('medieval/ten', 'phantom_membrane', 7505), ('medieval/gnev', 'prismarine_shard', 7506),
    ('shinigami/kosti', 'bone', 7611), ('shinigami/pepel', 'gray_dye', 7612), ('shinigami/sleza', 'ghast_tear', 7613),
    ('shinigami/pero', 'feather', 7614),
    ('shinigami/glaza', 'fermented_spider_eye', 7601), ('shinigami/kosa', 'rabbit_foot', 7602),
    ('shinigami/yabloko', 'red_dye', 7603), ('shinigami/tsepi', 'flint', 7604),
    ('shinigami/otsrochka', 'nautilus_shell', 7605), ('shinigami/zov', 'heart_of_the_sea', 7606),
]

# у этих предметов в игре «ручная» модель, а не плоская картинка
PARENT = {'stick': 'minecraft:item/handheld'}


def icons(M):
    """Словарь «имя → функция, рисующая иконку»."""
    for k, v in NEW_PAL.items():
        assert k not in M.PAL, 'буква палитры %s уже занята' % k
        M.PAL[k] = v
    Icon = M.Icon

    def hn(x, y, s):
        h = (x * 73856093) ^ (y * 19349663) ^ (s * 83492791)
        h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
        return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0

    # ---------------- средневековье ----------------

    def zhelezo():
        i = Icon()
        i.rows(4, [(5, 14), (4, 13), (3, 12)], 'z')
        i.rect(3, 7, 12, 10, 'Z')
        i.rect(3, 7, 12, 7, 'q')
        for k in range(5):
            i.px(13, 6 + k, 'Q')
            i.px(14, 5 + k, 'Q')
        i.px(6, 4, 'w'); i.px(7, 4, 'w'); i.px(5, 5, 'q')
        for (x, y) in ((5, 9), (8, 8), (7, 10), (10, 9)):
            i.px(x, y, 'g')
        i.px(12, 9, 'o'); i.px(12, 10, 'o'); i.px(11, 10, 'y')
        i.outline()
        return i

    def kozha():
        i = Icon()
        i.rows(3, [(4, 11), (3, 12), (3, 12), (2, 13), (2, 13), (2, 13), (3, 12), (3, 12), (4, 12), (5, 11)], 'd')
        i.rows(3, [(4, 8), (3, 7), (3, 5)], 'n')
        i.line(4, 12, 11, 4, 'B')
        for (x, y) in ((3, 6), (3, 8), (2, 10), (12, 5), (12, 7), (13, 9)):
            i.px(x, y, 'x')
        i.rows(9, [(9, 12), (10, 12)], 'n')
        i.px(8, 7, 'a'); i.px(5, 9, 'a'); i.px(10, 8, 'a')
        i.outline()
        return i

    def drevko():
        i = Icon()
        i.line(2, 13, 12, 3, 'd')
        i.line(3, 13, 13, 3, 'd')
        i.line(2, 12, 11, 3, 'n')
        i.line(3, 14, 13, 4, 'B')
        for (x, y) in ((6, 9), (9, 6)):
            i.px(x, y, 'B'); i.px(x + 1, y, 'B')
        i.px(11, 2, 'x'); i.px(12, 2, 'x'); i.px(13, 2, 'x')                  # зарубка под наконечник
        i.px(2, 11, 'L'); i.px(1, 12, 'L'); i.px(1, 11, 'l')                  # листик
        i.outline()
        return i

    def serebro():
        i = Icon()
        i.disc(7.5, 7.5, 0, 5.7, 'Q')
        i.disc(7.5, 7.5, 0, 4.6, 's')
        i.disc(7.5, 7.5, 3.6, 4.6, 'q')
        for y in range(16):
            for x in range(16):
                d = math.hypot(x - 7.5, y - 7.5)
                if 4.0 < d <= 5.7 and x + y > 15:
                    i.px(x, y, 'G')
        i.rect(7, 4, 8, 11, 'G'); i.rect(4, 7, 11, 8, 'G')                    # крест на аверсе
        i.px(7, 7, 'w'); i.px(8, 7, 'q'); i.px(7, 8, 'q'); i.px(8, 8, 'Q')
        i.px(4, 4, 'w'); i.px(5, 3, 'w')
        i.outline()
        return i

    def drakon():
        i = Icon()
        i.rect(6, 1, 9, 2, 'd')
        i.rect(6, 2, 9, 2, 'B')
        i.rect(6, 3, 9, 4, 'q')
        spans = [(5, 10), (4, 11), (3, 12), (3, 12), (3, 12), (3, 12), (4, 11), (5, 10), (6, 9)]
        i.rows(5, spans, 'q')
        i.rows(7, [(4, 11), (3, 12), (3, 12), (3, 12), (4, 11), (5, 10), (6, 9)], 'o')
        i.rows(9, [(3, 12), (3, 12), (4, 11), (5, 10), (6, 9)], 'f')
        for (x, y) in ((6, 7), (8, 8), (7, 10), (9, 9), (5, 9)):
            i.px(x, y, 'y')
        i.px(7, 8, 'h'); i.px(8, 9, 'h')
        i.px(4, 6, 'w'); i.px(4, 7, 'w'); i.px(3, 9, 'w')
        for y in range(7, 12):
            i.px(12, y, 'u')
        i.px(8, 0, 'G'); i.px(9, 0, 'g'); i.px(7, 0, 'g')
        i.outline()
        return i

    def rytsar():
        i = Icon()
        i.rows(0, [(7, 9), (6, 10)], 'u')
        i.px(8, 0, 'r'); i.px(9, 1, 'U'); i.px(10, 1, 'U')
        i.rows(2, [(5, 10), (4, 11), (3, 12), (3, 12), (3, 12)], 'z')
        i.rows(7, [(3, 12), (3, 12), (3, 12), (3, 12), (4, 11), (4, 11), (5, 10)], 'z')
        i.rect(3, 3, 4, 12, 'q'); i.rect(11, 4, 12, 12, 'Z')
        i.rect(4, 7, 11, 8, 'k')
        i.px(5, 7, 'f'); i.px(10, 7, 'f')
        i.rect(7, 2, 8, 13, 'Q')
        i.rect(7, 7, 8, 8, 'k')
        i.rect(7, 3, 8, 4, 'x')
        for (x, y) in ((10, 10), (11, 11), (10, 12), (4, 10), (4, 12), (5, 11)):
            i.px(x, y, 'k')
        i.outline()
        return i

    def zhrets():
        i = Icon()
        for (x, y) in ((1, 1), (2, 2), (3, 3), (14, 1), (13, 2), (12, 3), (1, 14), (2, 13), (3, 12), (14, 14), (13, 13), (12, 12)):
            i.px(x, y, 'y')
        for (x, y) in ((0, 7), (1, 7), (14, 7), (15, 7), (7, 0), (8, 0), (7, 15), (8, 15)):
            i.px(x, y, 'h')
        i.rect(7, 2, 8, 13, 'x'); i.rect(4, 5, 11, 6, 'x')
        i.rect(8, 3, 8, 13, 'X'); i.rect(8, 6, 11, 6, 'X')
        i.rect(7, 4, 7, 12, 'y'); i.rect(4, 5, 7, 5, 'y')
        i.px(7, 5, 'w'); i.px(7, 6, 'h'); i.px(8, 5, 'h')
        i.outline()
        return i

    def klinok():
        i = Icon()
        for (x, y) in ((8, 6), (10, 4), (6, 8), (12, 2), (5, 5), (11, 7), (7, 11), (13, 5)):
            i.px(x, y, 'V')
        i.line(4, 11, 12, 3, 'q')
        i.line(5, 11, 12, 4, 'Q')
        i.line(4, 10, 11, 3, 'w')
        i.px(13, 2, 'w'); i.px(12, 2, 'q'); i.px(13, 3, 'q')
        i.line(2, 9, 6, 13, 'x')
        i.line(3, 9, 6, 12, 'X')
        i.line(3, 13, 1, 15, 'B'); i.px(0, 15, 'x'); i.px(1, 14, 'B')
        for (x, y) in ((7, 8), (9, 6), (6, 9), (10, 5)):
            i.px(x, y, 'v')
        i.outline()
        return i

    def ten():
        i = Icon()
        spans = [(7, 8), (6, 9), (5, 10), (5, 10), (4, 11), (4, 11), (4, 11), (3, 12), (3, 12), (3, 12), (2, 13), (2, 13), (2, 13), (1, 14)]
        i.rows(1, spans, 'V')
        i.rows(5, [(6, 9), (5, 10), (5, 10), (6, 9), (6, 9)], 'k')
        i.px(6, 7, 'i'); i.px(9, 7, 'i'); i.px(6, 8, 'c'); i.px(9, 8, 'c')
        i.line(4, 10, 2, 14, 'v'); i.line(3, 9, 3, 11, 'v')
        i.line(11, 10, 13, 14, 'M'); i.line(12, 9, 12, 12, 'M')
        i.line(7, 10, 6, 14, 'M'); i.line(9, 10, 10, 14, 'M')
        for x in (2, 4, 6, 8, 10, 12):
            i.px(x, 14, None)
        i.outline()
        return i

    def gnev():
        i = Icon()
        i.rows(1, [(5, 10), (3, 12), (2, 13), (2, 13), (3, 12), (4, 11)], 'G')
        i.rows(1, [(6, 9), (4, 8)], 's')
        i.rows(5, [(3, 12), (4, 11)], 'g')
        rows = [(9, 11), (8, 10), (7, 9), (6, 11), (8, 10), (7, 9), (6, 8), (6, 7)]
        i.rows(7, rows, 'y')
        for k, (a, b) in enumerate(rows):
            i.px(a, 7 + k, 'w')
        i.px(12, 10, 'y'); i.px(13, 10, 'h')
        i.outline()
        return i

    # ---------------- мир богов смерти ----------------

    def kosti():
        i = Icon()

        def bone(x0, y0, x1, y1, c, sh):
            i.line(x0, y0, x1, y1, c)
            i.line(x0 + 1, y0, x1 + 1, y1, sh)
            for (cx, cy) in ((x0, y0), (x1, y1)):
                i.disc(cx + 0.5, cy + 0.5, 0, 1.9, c)
                i.px(cx + 1, cy + 1, sh)
        bone(2, 12, 11, 3, 'e', 'E')
        bone(3, 3, 12, 12, 'E', 'e')
        i.px(7, 7, 'w'); i.px(8, 8, 'e')
        i.outline()
        return i

    def pepel():
        i = Icon()
        i.rows(8, [(6, 9), (5, 10), (4, 11), (3, 12), (2, 13), (2, 13), (3, 12)], 'G')
        i.rows(8, [(6, 8), (5, 7), (4, 6)], 's')
        i.rows(13, [(3, 12)], 'g')
        for (x, y) in ((6, 9), (9, 10), (5, 11), (10, 12), (7, 12)):
            i.px(x, y, 'Q')
        i.px(8, 9, 'o'); i.px(4, 12, 'o'); i.px(11, 11, 'f'); i.px(7, 10, 'y')
        for (x, y) in ((8, 6), (9, 5), (8, 4), (7, 3), (8, 2), (9, 1)):
            i.px(x, y, 'Q')
        i.px(8, 5, 's'); i.px(7, 4, 's')
        i.outline()
        return i

    def sleza():
        i = Icon()
        spans = [(8, 8), (7, 9), (7, 9), (6, 10), (6, 10), (5, 11), (5, 11), (4, 12), (4, 12), (4, 12), (4, 12), (5, 11), (6, 10), (7, 9)]
        i.rows(1, spans, 'b')
        for k in range(len(spans)):
            a, bb = spans[k]
            if bb - a >= 2:
                i.px(bb, 1 + k, 'I'); i.px(bb - 1, 1 + k, 'I')
        i.rows(11, [(5, 10), (6, 10)], 'I')
        i.px(6, 7, 'c'); i.px(5, 8, 'c'); i.px(5, 9, 'c'); i.px(5, 10, 'c')
        i.px(6, 8, 'w'); i.px(6, 9, 'w')
        i.px(9, 11, 'c')
        i.outline()
        return i

    def pero():
        i = Icon()
        x0, y0, x1, y1 = 2.5, 13.5, 13.5, 2.5
        for y in range(16):
            for x in range(16):
                sp = ((x - x0) - (y - y0)) / ((x1 - x0) * 2)          # 0..1 вдоль стержня
                d = ((x - x0) + (y - y0)) / math.sqrt(2)                # расстояние поперёк (со знаком)
                if sp < 0.08 or sp > 1.02:
                    continue
                w = 3.9 * math.sin(math.pi * min(1.0, max(0.0, (sp - 0.08) / 0.95)) ** 0.85) + 0.4
                if abs(d) <= w:
                    i.px(x, y, 'g' if d > 0 else 'V')
                    if abs(d) >= w - 1.1 and sp > 0.3:
                        i.px(x, y, 'Z' if d > 0 else 'v')
        for t in range(0, 12):                                          # стержень
            i.px(int(round(2 + t * 11 / 11.0)), int(round(14 - t * 12 / 11.0)), 'q')
        i.px(1, 15, 'Q'); i.px(2, 14, 'q'); i.px(2, 15, 'Q')
        for (x, y) in ((9, 6), (7, 8), (10, 8), (8, 5), (5, 10)):
            i.px(x, y, 'k')
        i.outline('V')
        return i

    def glaza():
        i = Icon()
        i.rows(4, [(6, 9), (4, 11), (2, 13), (1, 14), (1, 14), (2, 13), (4, 11), (6, 9)], 's')
        i.rows(4, [(6, 9), (4, 11), (2, 13)], 'q')
        i.disc(7.5, 7.5, 0, 3.3, 'r')
        i.disc(7.5, 7.5, 2.4, 3.3, 'U')
        i.rect(7, 5, 8, 10, 'k')
        i.px(6, 6, 'w'); i.px(9, 9, 'o')
        i.line(1, 7, 3, 5, 'U'); i.line(14, 7, 12, 5, 'U')
        i.rect(6, 3, 9, 3, 'U'); i.rect(6, 12, 9, 12, 'U')
        i.px(7, 1, 'v'); i.px(8, 1, 'v'); i.px(7, 14, 'v'); i.px(8, 14, 'v')
        i.outline()
        return i

    def kosa():
        i = Icon()
        i.line(2, 14, 9, 5, 'd')
        i.line(3, 14, 10, 5, 'd')
        i.line(2, 13, 8, 5, 'n')
        i.px(4, 11, 'B'); i.px(6, 8, 'B')
        i.px(9, 5, 'x'); i.px(10, 5, 'x'); i.px(9, 6, 'X')
        shape = {1: (9, 11), 2: (8, 13), 3: (9, 14), 4: (11, 15), 5: (13, 15), 6: (14, 15), 7: (14, 15), 8: (15, 15)}
        for y, (a, b) in shape.items():
            for x in range(a, b + 1):
                i.px(x, y, 'q')
        for x in range(9, 12):
            i.px(x, 1, 'w')
        i.px(8, 2, 'w'); i.px(9, 2, 'w'); i.px(10, 2, 'w'); i.px(11, 2, 'w'); i.px(12, 2, 'q'); i.px(13, 2, 'w'); i.px(14, 3, 'w')
        i.px(15, 4, 'w'); i.px(15, 5, 'q'); i.px(15, 6, 'q')
        for (x, y) in ((9, 3), (10, 3), (11, 4), (12, 4), (13, 5), (14, 6), (14, 7), (15, 8)):
            i.px(x, y, 'Q')
        i.px(13, 3, 'V'); i.px(12, 3, 'V')
        i.outline()
        return i

    def yabloko():
        i = Icon()
        i.disc(7.5, 9, 0, 5.3, 'r')
        for y in range(16):
            for x in range(16):
                d = math.hypot(x - 7.5, y - 9)
                if d <= 5.3 and x >= 10:
                    i.px(x, y, 'U')
                elif d <= 5.3 and d > 4.2 and y >= 11:
                    i.px(x, y, 'U')
        i.rect(5, 3, 6, 3, 'r'); i.rect(9, 3, 10, 3, 'r')
        i.px(7, 4, 'U'); i.px(8, 4, 'U')
        for (x, y) in ((11, 6), (12, 6), (12, 7), (11, 7), (12, 8)):
            i.px(x, y, None)
        i.px(11, 8, 'e'); i.px(10, 7, 'e'); i.px(10, 6, 'e')
        i.px(4, 7, 'w'); i.px(5, 6, 'w'); i.px(4, 8, 'h')
        i.rect(7, 1, 8, 4, 'B')
        i.rows(1, [(9, 11), (9, 10)], 'L'); i.px(11, 1, 'l')
        i.px(4, 13, 'V'); i.px(3, 12, 'v')
        i.outline()
        return i

    def tsepi():
        i = Icon()

        def ring(cx, cy, rx, ry):
            for y in range(16):
                for x in range(16):
                    q = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
                    if 0.45 <= q <= 1.2:
                        i.px(x, y, 'q' if (x - cx) + (y - cy) < 0 else 'Q')
        ring(3.8, 12.0, 3.3, 2.1)
        ring(6.4, 9.0, 2.1, 3.3)
        ring(9.2, 6.2, 3.3, 2.1)
        ring(11.9, 3.7, 2.1, 3.1)
        for (x, y) in ((4, 12), (6, 9), (9, 6), (12, 4)):
            i.px(x, y, 'i')
        i.px(12, 13, 'c'); i.px(14, 12, 'C'); i.px(1, 6, 'c'); i.px(2, 5, 'C')
        i.outline()
        return i

    def otsrochka():
        i = Icon()
        i.rect(3, 3, 3, 12, 'X'); i.rect(12, 3, 12, 12, 'X')
        i.rect(3, 1, 12, 2, 'x'); i.rect(3, 13, 12, 14, 'x')
        i.rect(3, 2, 12, 2, 'X'); i.rect(3, 14, 12, 14, 'X')
        top = [(4, 11), (4, 11), (5, 10), (6, 9), (7, 8)]
        bot = [(7, 8), (6, 9), (5, 10), (4, 11), (4, 11)]
        i.rows(3, top, 'q')
        i.rows(8, bot, 'q')
        i.rows(5, [(5, 10), (6, 9), (7, 8)], 'v')
        i.rows(8, [(7, 8)], 'v')
        i.rows(9, [(7, 8)], 'v')
        i.rows(10, [(6, 9), (5, 10), (4, 11)], 'v')
        i.px(5, 4, 'w'); i.px(5, 5, 'w'); i.px(5, 9, 'w')
        i.px(7, 5, 'P'); i.px(9, 11, 'P')
        i.outline()
        return i

    def zov():
        i = Icon()
        i.rect(7, 1, 8, 2, 'x')
        i.rows(3, [(7, 8), (6, 9), (5, 10), (5, 10), (5, 10), (4, 11), (4, 11), (3, 12), (3, 12)], 'V')
        i.rect(5, 5, 6, 10, 'v')
        i.rows(5, [(9, 10), (9, 10), (9, 10)], 'M')
        i.rect(2, 12, 13, 12, 'x')
        i.rect(3, 12, 12, 12, 'x'); i.rect(2, 12, 2, 12, 'X'); i.rect(13, 12, 13, 12, 'X')
        i.rect(7, 13, 8, 14, 'x'); i.px(7, 13, 'y')
        i.px(6, 4, 'P'); i.px(5, 6, 'P')
        for (x, y) in ((0, 6), (0, 7), (0, 8), (1, 5), (1, 9), (15, 6), (15, 7), (15, 8), (14, 5), (14, 9)):
            i.px(x, y, 'i')
        i.px(1, 7, 'c'); i.px(14, 7, 'c')
        i.outline()
        return i

    return {
        'medieval/zhelezo': zhelezo, 'medieval/kozha': kozha, 'medieval/drevko': drevko, 'medieval/serebro': serebro,
        'medieval/drakon': drakon, 'medieval/rytsar': rytsar, 'medieval/zhrets': zhrets, 'medieval/klinok': klinok,
        'medieval/ten': ten, 'medieval/gnev': gnev,
        'shinigami/kosti': kosti, 'shinigami/pepel': pepel, 'shinigami/sleza': sleza, 'shinigami/pero': pero,
        'shinigami/glaza': glaza, 'shinigami/kosa': kosa, 'shinigami/yabloko': yabloko, 'shinigami/tsepi': tsepi,
        'shinigami/otsrochka': otsrochka, 'shinigami/zov': zov,
    }


# ----------------------------------------------------------------------------------------------
# Звуки
# ----------------------------------------------------------------------------------------------

AMBIENT_SECONDS = 64


def sounds(M):
    """Список «событие, файл, функция, каналов, стрим» в том же виде, как SOUNDS в make_cyber_pack."""
    t_of, saw, lowpass, highpass, bandpass, noise = M.t_of, M.saw, M.lowpass, M.highpass, M.bandpass, M.noise
    put, echo, norm, env_ad, bitcrush, sine_sweep = M.put, M.echo, M.norm, M.env_ad, M.bitcrush, M.sine_sweep

    def strike(f, dur, partials=(1.0, 2.76, 5.4, 8.93, 13.3), tone=1.0):
        """Удар по металлу или колоколу: неточные обертоны, у верхних затухание быстрее."""
        t = t_of(dur)
        s = np.zeros_like(t)
        for k, r in enumerate(partials):
            s += np.sin(2 * math.pi * f * r * t) * np.exp(-t / (dur * 0.33 / (1 + 0.9 * k))) / (1 + k * 0.8 * tone)
        return s * np.minimum(1.0, t / 0.002)

    def thud(f0, f1, dur, level=0.8):
        s, _ = sine_sweep(f0, f1, dur)
        return s * env_ad(len(s), 0.003, dur * 0.35) * level

    def wrap_add(lay, i0, left, right=None):
        n = len(lay[0])
        idx = (np.arange(len(left)) + i0) % n
        np.add.at(lay[0], idx, left)
        np.add.at(lay[1], idx, left if right is None else right)

    # ---------------- средневековье ----------------

    def med_bind():
        out = np.zeros(int(2.4 * SR))
        for at, f, g in ((0.0, 523.0, 0.55), (0.17, 698.0, 0.45)):                  # два удара молота по наковальне
            t = t_of(0.12)
            put(out, highpass(noise(len(t), int(f)), 2500) * env_ad(len(t), 0.0005, 0.012) * 0.6, at)
            put(out, strike(f, 0.9, (1.0, 2.4, 4.1, 6.7)) * g, at)
        put(out, strike(110.0, 2.0) * 0.55, 0.34)                                    # низкий колокол
        put(out, strike(220.0, 1.6) * 0.25, 0.34)
        t = t_of(1.4)
        swell = lowpass(saw(np.full_like(t, 146.83), t, 8), 1200) * np.minimum(1, t / 0.5) * np.exp(-t / 0.7) * 0.18
        put(out, swell, 0.45)
        return norm(echo(out, 0.21, 0.32, 4), 0.85)

    def med_deposit():
        out = np.zeros(int(0.9 * SR))
        t = t_of(0.35)
        put(out, bandpass(noise(len(t), 9), 1500, 6500) * np.sin(np.linspace(0, math.pi, len(t))) ** 2 * 0.22, 0.0)   # шорох свитка
        put(out, thud(180, 70, 0.16, 0.7), 0.12)                                                                      # стук печати
        put(out, strike(2800, 0.45, (1.0, 2.1, 3.3)) * 0.3, 0.2)
        put(out, strike(3650, 0.4, (1.0, 2.2, 3.5)) * 0.25, 0.27)
        return norm(echo(out, 0.11, 0.3, 2), 0.8)

    def med_complete():
        out = np.zeros(int(4.0 * SR))
        melody = ((293.66, 0.0, 0.34), (440.0, 0.32, 0.34), (587.33, 0.64, 0.5))
        for f, at, dur in melody:
            t = t_of(dur + 0.3)
            s = lowpass(saw(np.full_like(t, f), t, 14), 2100) * np.minimum(1, t / 0.04) * np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.08))
            put(out, s * 0.32, at)
        for f in (293.66, 440.0, 587.33, 739.99):
            t = t_of(2.4)
            s = lowpass(saw(np.full_like(t, f), t, 12), 1700) * np.minimum(1, t / 0.12) * np.exp(-np.maximum(0, t - 1.0) / 0.55)
            put(out, s * 0.17, 1.15)
        put(out, strike(146.83, 3.0) * 0.5, 1.15)
        put(out, strike(293.66, 2.4) * 0.22, 1.15)
        return norm(echo(out, 0.23, 0.33, 4), 0.85)

    def med_ambient():
        n = AMBIENT_SECONDS * SR
        rng = np.random.RandomState(1348)
        lay = {k: [np.zeros(n), np.zeros(n)] for k in ('drone', 'lute', 'drum', 'bell', 'wind', 'flute')}
        beat = 0.8
        # гул: рука-на-квинте, плавные перетекающие куски по 16 секунд
        for k in range(4):
            seg = int(20.0 * SR)
            t = np.arange(seg) / SR
            env = np.minimum(1, t / 4.0) * np.minimum(1, (20.0 - t) / 4.0)
            v = np.zeros(seg)
            for f, g in ((73.42, 1.0), (110.0, 0.7), (146.83, 0.35)):
                for d in (-0.5, 0.5):
                    v += saw(np.full(seg, f + d), t, 6) * 0.05 * g
            v = lowpass(v, 520) * env
            wrap_add(lay['drone'], int(k * 16.0 * SR), v * 0.9, v * 1.1)
        # лютня: арпеджио по ладам дорийского лада
        chords = [(146.83, 174.61, 220.0, 293.66), (130.81, 164.81, 196.0, 261.63), (146.83, 174.61, 220.0, 293.66),
                  (98.0, 116.54, 146.83, 196.0), (110.0, 146.83, 164.81, 220.0)]
        order = (0, 2, 1, 3, 2, 1, 3, 2)
        for st in range(160):                                                         # 160 восьмых по 0.4 с
            at = st * beat / 2
            ch = chords[int(at // 12.8) % 5]
            if rng.rand() < 0.22 and st % 8 not in (0, 4):
                continue
            f = ch[order[st % 8]] * (2 if st % 8 in (3, 6) else 1)
            seg = int(1.6 * SR)
            t = np.arange(seg) / SR
            v = np.zeros(seg)
            for k in range(1, 8):
                v += np.sin(2 * math.pi * f * k * t) * np.exp(-t * (2.2 + k * 2.6)) / (k ** 1.15)
            v *= np.minimum(1, t / 0.002) * 0.16
            pan = 0.3 + 0.4 * ((st // 2) % 2)
            wrap_add(lay['lute'], int(at * SR), v * (1 - pan) * 1.4, v * pan * 1.4)
        # барабан: тихий удар на первую долю каждого такта и полегче на третью
        for bar in range(20):
            for b, g in ((0, 1.0), (2, 0.55)):
                at = (bar * 4 + b) * beat
                s, _ = sine_sweep(125, 52, 0.4)
                v = s * np.exp(-np.arange(len(s)) / SR / 0.13) * 0.4 * g
                v = v + lowpass(noise(len(s), 40 + bar * 4 + b), 700) * np.exp(-np.arange(len(s)) / SR / 0.03) * 0.15 * g
                wrap_add(lay['drum'], int(at * SR), v)
        # колокол вдали
        for at, f in ((3.2, 293.66), (25.6, 220.0), (48.0, 293.66)):
            v = strike(f, 6.0, (1.0, 2.0, 2.76, 4.1, 5.4), 1.6) * 0.1
            wrap_add(lay['bell'], int(at * SR), v * 0.6, v * 1.0)
        # свирель: редкие протяжные ноты
        for at, f in ((6.4, 587.33), (9.6, 523.25), (32.0, 440.0), (35.2, 493.88), (54.4, 587.33)):
            seg = int(3.0 * SR)
            t = np.arange(seg) / SR
            vib = 1 + 0.006 * np.sin(2 * math.pi * 5.0 * t)
            v = np.sin(2 * math.pi * np.cumsum(np.full(seg, f) * vib) / SR) + 0.25 * np.sin(2 * math.pi * np.cumsum(np.full(seg, f * 2) * vib) / SR)
            v *= np.minimum(1, t / 0.5) * np.exp(-np.maximum(0, t - 0.8) / 0.9) * 0.05
            v += bandpass(noise(seg, int(f)), 2500, 7000) * np.minimum(1, t / 0.4) * np.exp(-t / 0.6) * 0.004
            wrap_add(lay['flute'], int(at * SR), v * 0.8, v * 1.2)
        # ветер
        t_all = np.arange(n) / SR
        sway = 0.55 + 0.45 * np.sin(2 * math.pi * t_all / AMBIENT_SECONDS * 3 + 1.0)
        for ch in (0, 1):
            lay['wind'][ch] += bandpass(noise(n, 700 + ch), 180, 1400) * 0.07 * sway
        gain = {'drone': 1.0, 'lute': 1.0, 'drum': 0.6, 'bell': 1.0, 'wind': 1.0, 'flute': 1.0}
        L = sum(lay[k][0] * gain[k] for k in lay)
        R = sum(lay[k][1] * gain[k] for k in lay)
        for dly, g in ((0.19, 0.26), (0.31, 0.2), (0.47, 0.15)):
            sh = int(dly * SR)
            L = L + np.roll(R, sh) * g
            R = R + np.roll(L, sh + 41) * g
        m = max(np.max(np.abs(L)), np.max(np.abs(R)))
        return np.stack([L * (0.8 / m), R * (0.8 / m)], axis=1)

    # ---------------- мир богов смерти ----------------

    def whisper(sec, seed, lo=700, hi=4200):
        t = t_of(sec)
        base = bandpass(noise(len(t), seed), lo, hi)
        mod = 0.5 + 0.5 * np.sin(2 * math.pi * 3.1 * t + 2 * np.sin(2 * math.pi * 0.7 * t))
        return base * mod * np.sin(np.linspace(0, math.pi, len(t))) ** 1.5

    def shi_bind():
        out = np.zeros(int(2.8 * SR))
        t = t_of(0.9)
        rev = bandpass(noise(len(t), 77), 400, 6000) * (t / 0.9) ** 2.2
        put(out, rev * 0.3, 0.0)                                                      # обратный шорох
        put(out, strike(65.4, 3.2, (1.0, 2.0, 2.76, 4.2, 5.9)) * 0.7, 0.85)           # глубокий гонг
        put(out, strike(130.8, 2.4) * 0.22, 0.85)
        put(out, whisper(1.5, 5) * 0.3, 0.7)
        put(out, thud(70, 30, 0.5, 0.55), 0.85)
        return norm(echo(out, 0.27, 0.35, 4), 0.85)

    def shi_deposit():
        out = np.zeros(int(1.1 * SR))
        rng = np.random.RandomState(31)
        for k in range(7):                                                            # перестук костей
            at = 0.02 + k * 0.045 + rng.rand() * 0.02
            n = int(0.05 * SR)
            click = bandpass(noise(n, 200 + k), 1800, 6500) * np.exp(-np.arange(n) / SR / 0.009)
            ping = np.sin(2 * math.pi * (1300 + rng.rand() * 900) * np.arange(n) / SR) * np.exp(-np.arange(n) / SR / 0.012)
            put(out, click * 0.55 + ping * 0.2, at)
        t = t_of(0.7)
        hum = (np.sin(2 * math.pi * 87.31 * t) + 0.5 * np.sin(2 * math.pi * 130.81 * t)) * np.minimum(1, t / 0.12) * np.exp(-t / 0.28) * 0.35
        put(out, hum, 0.28)
        put(out, strike(523.0, 0.9, (1.0, 2.76, 5.4)) * 0.12, 0.3)
        return norm(echo(out, 0.17, 0.33, 3), 0.8)

    def shi_complete():
        out = np.zeros(int(4.4 * SR))
        put(out, strike(55.0, 4.0, (1.0, 2.0, 2.76, 4.2)) * 0.75, 0.0)
        chord = (146.83, 174.61, 220.0, 277.18, 349.23)
        for f in chord:                                                                # хор из зубастых пил с вибрато
            for d in (-0.8, 0.0, 0.8):
                t = t_of(3.8)
                vib = 1 + 0.004 * np.sin(2 * math.pi * 5.3 * t + f)
                s = saw((f + d) * vib, t, 8)
                s = lowpass(s, 1100) * np.minimum(1, t / 1.2) * np.minimum(1, np.maximum(0, 3.8 - t) / 1.4) * 0.05
                put(out, s, 0.4)
        put(out, whisper(2.0, 9, 900, 5200) * 0.22, 0.2)
        put(out, strike(880.0, 2.5, (1.0, 2.76, 5.4)) * 0.1, 1.8)
        return norm(echo(out, 0.3, 0.35, 4), 0.85)

    def shi_ambient():
        n = AMBIENT_SECONDS * SR
        rng = np.random.RandomState(1999)
        lay = {k: [np.zeros(n), np.zeros(n)] for k in ('drone', 'choir', 'gong', 'chime', 'whisper', 'heart', 'wind')}
        # гул: тритон и малая секунда, перетекающие куски
        for k in range(4):
            seg = int(22.0 * SR)
            t = np.arange(seg) / SR
            env = np.minimum(1, t / 5.0) * np.minimum(1, (22.0 - t) / 5.0)
            v = np.zeros(seg)
            for f, g in ((36.71, 1.2), (73.42, 1.0), (77.78, 0.8), (103.83, 0.4)):
                v += saw(np.full(seg, f), t, 5) * 0.05 * g
            v = lowpass(v, 330) * env
            wrap_add(lay['drone'], int(k * 16.0 * SR), v * 1.1, v * 0.9)
        # хор: четыре аккорда по 16 секунд
        chords = [(146.83, 207.65, 220.0, 293.66), (130.81, 196.0, 233.08, 311.13), (110.0, 164.81, 207.65, 277.18), (98.0, 146.83, 233.08, 349.23)]
        for ci, ch in enumerate(chords):
            seg = int(21.0 * SR)
            t = np.arange(seg) / SR
            env = np.minimum(1, t / 5.0) * np.minimum(1, (21.0 - t) / 5.0)
            L = np.zeros(seg)
            R = np.zeros(seg)
            for vi, f in enumerate(ch):
                for d, pan in ((-0.9, 0.3), (0.0, 0.5), (0.9, 0.7)):
                    vib = 1 + 0.004 * np.sin(2 * math.pi * (4.8 + vi * 0.3) * t + vi)
                    v = saw((f + d) * vib, t, 6) * 0.035
                    L += v * (1 - pan)
                    R += v * pan
            wrap_add(lay['choir'], int(ci * 16.0 * SR), lowpass(L, 900) * env, lowpass(R, 900) * env)
        # гонги
        for at, f, g in ((0.0, 55.0, 0.16), (21.0, 73.42, 0.12), (42.0, 49.0, 0.14)):
            v = strike(f, 8.0, (1.0, 2.0, 2.76, 4.2, 5.9), 1.4) * g
            wrap_add(lay['gong'], int(at * SR), v * 1.0, v * 0.8)
        # костяные колокольчики: редкие звонкие ноты случайных высот
        scale = (587.33, 622.25, 783.99, 880.0, 932.33, 1174.66)
        for k in range(14):
            at = 2.0 + k * 4.4 + rng.rand() * 2.0
            f = scale[rng.randint(len(scale))]
            v = strike(f, 2.4, (1.0, 2.76, 5.4), 2.0) * 0.035
            pan = rng.rand()
            wrap_add(lay['chime'], int(at * SR), v * (1 - pan) * 1.4, v * pan * 1.4)
        # шёпот
        for k in range(6):
            at = 3.0 + k * 10.5 + rng.rand() * 2.0
            v = whisper(3.5, 300 + k) * 0.05
            w2 = whisper(3.5, 400 + k) * 0.05
            wrap_add(lay['whisper'], int(at * SR), v, w2)
        # сердцебиение: 50 ударов по 1.28 с, ровно 64 с
        for k in range(50):
            at = k * 1.28
            for dt, g in ((0.0, 1.0), (0.3, 0.6)):
                s, _ = sine_sweep(72, 34, 0.22)
                v = s * np.exp(-np.arange(len(s)) / SR / 0.07) * 0.25 * g
                wrap_add(lay['heart'], int((at + dt) * SR), v)
        t_all = np.arange(n) / SR
        sway = 0.5 + 0.5 * np.sin(2 * math.pi * t_all / AMBIENT_SECONDS * 4 + 0.5)
        for ch in (0, 1):
            lay['wind'][ch] += bandpass(noise(n, 900 + ch), 120, 900) * 0.08 * sway
        gain = {'drone': 1.0, 'choir': 1.0, 'gong': 1.0, 'chime': 1.0, 'whisper': 1.0, 'heart': 0.7, 'wind': 1.0}
        L = sum(lay[k][0] * gain[k] for k in lay)
        R = sum(lay[k][1] * gain[k] for k in lay)
        for dly, g in ((0.23, 0.3), (0.37, 0.24), (0.53, 0.18)):
            sh = int(dly * SR)
            L = L + np.roll(R, sh) * g
            R = R + np.roll(L, sh + 53) * g
        m = max(np.max(np.abs(L)), np.max(np.abs(R)))
        return np.stack([L * (0.8 / m), R * (0.8 / m)], axis=1)

    return [
        ('medieval.bind', 'medieval/bind', med_bind, 1, False),
        ('medieval.deposit', 'medieval/deposit', med_deposit, 1, False),
        ('medieval.complete', 'medieval/complete', med_complete, 1, False),
        ('medieval.ambient', 'medieval/ambient', med_ambient, 2, True),
        ('shinigami.bind', 'shinigami/bind', shi_bind, 1, False),
        ('shinigami.deposit', 'shinigami/deposit', shi_deposit, 1, False),
        ('shinigami.complete', 'shinigami/complete', shi_complete, 1, False),
        ('shinigami.ambient', 'shinigami/ambient', shi_ambient, 2, True),
    ]
