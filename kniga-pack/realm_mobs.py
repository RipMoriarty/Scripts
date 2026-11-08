#!/usr/bin/env python3
"""Модели мобов миров-походов для ресурспака «Книга Судеб».

Средневековье:  падший рыцарь (зомби, номера 7551–7555) и разбойник-лучник (скелет, 7561–7565).
Мир богов смерти: потерянная душа (зомби, 7651–7655) и жнец (скелет, 7661–7665).

Устройство то же, что у киберпсихов (cyber_mobs.py): настоящий моб невидим, на нём «едут» дисплеи с деталями —
тело с головой, правая и левая рука, правая и левая нога, номера подряд. Суставы у всех двуногих одинаковые,
они совпадают с CyberSkins.humanoid в плагине:  тело (8,10,8), руки (14,21,8) и (2,21,8), ноги (10,11,8) и (6,11,8).
Лицо смотрит на север, правая сторона персонажа — восток (+x); на текстуре кубика «north» слева — правая сторона персонажа.

python3 realm_mobs.py <каталог-для-предпросмотра>   — нарисовать предпросмотр и напечатать таблицу суставов.
"""
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cyber_mobs as cm  # noqa: E402
from cyber_mobs import C, Mob, SIZE  # noqa: E402

NEW = {
    'a': (0x8a, 0x4a, 0x2c), 'A': (0x4f, 0x26, 0x18),             # ржавчина
    'b': (0x6b, 0x44, 0x26), 'B': (0x3b, 0x25, 0x16),             # кожа
    'd': (0x14, 0x12, 0x1c), 'D': (0x08, 0x07, 0x0d),             # чёрная ткань
    'e': (0xdc, 0xd4, 0xbe), 'E': (0x8e, 0x86, 0x74),             # кость
    'f': (0xff, 0x9a, 0x2e), 'F': (0xb3, 0x4d, 0x12),             # тёплое свечение глаз
    'i': (0x7d, 0xf0, 0xff), 'I': (0x2a, 0x4a, 0x8c),             # свет души
    'j': (0xb9, 0xb4, 0xa6), 'J': (0x7c, 0x78, 0x6e),             # льняной саван
    'u': (0xa3, 0x1d, 0x26), 'U': (0x5e, 0x0f, 0x18),             # красная ткань
    'v': (0xb0, 0x4d, 0xff), 'V': (0x57, 0x1f, 0x8f),             # фиолетовый
    'x': (0xe0, 0xb0, 0x3a), 'X': (0x8a, 0x66, 0x1c),             # золото
    'z': (0x9a, 0xa0, 0xa8), 'Z': (0x4a, 0x4e, 0x58),             # сталь
    't': (0x3f, 0x5a, 0x34), 'N': (0x1f, 0x33, 0x1f),             # зелёная ткань
    'W': (0xa8, 0xc0, 0xd8), 'Q': (0x6a, 0x80, 0xa0),             # бледная кожа души
}
for _k, _v in NEW.items():
    assert _k not in C, 'буква палитры %s уже занята' % _k
    C[_k] = _v

# сустав каждой из пяти деталей (общие для всех двуногих)
JOINTS = {'body': (8, 10, 8), 'arm_r': (14, 21, 8), 'arm_l': (2, 21, 8), 'leg_r': (10, 11, 8), 'leg_l': (6, 11, 8)}


def human(name, cmd):
    m = Mob(name)
    parts = [m.part(n, cmd + i, JOINTS[n]) for i, n in enumerate(('body', 'arm_r', 'arm_l', 'leg_r', 'leg_l'))]
    return [m] + parts


def speckle(box, faces, c, p, salt=0, a=255):
    """Рассыпать по граням пятна цвета c с долей p."""
    for f in faces:
        rx, ry, rw, rh = box.region(f)
        for j in range(rh):
            for i in range(rw):
                if cm.hn(i, j, box.seed * 31 + salt + cm.FACES.index(f)) < p:
                    box.put(f, i, j, c, a)


def ragged(box, face, y0, c, a=0, salt=0):
    """Рваный нижний край: ниже y0 часть клеток становится прозрачной (a=0) или цвета c."""
    rx, ry, rw, rh = box.region(face)
    for i in range(rw):
        cut = y0 + int(cm.hn(i, 3, box.seed + salt) * (rh - y0 + 1))
        for j in range(cut, rh):
            box.put(face, i, j, c, a)


def bow(part, sh, wood, dark, string, x=1.5, z0=6.0):
    """Лук в левой руке. Длинная ось лука — вдоль z, поэтому при вскинутой руке он стоит вертикально, выпуклостью к цели."""
    mid = sh.alloc(1, 3, 4)
    mid.fill(wood, jitter=0.08)
    mid.rect('east', 0, 0, 4, 1, dark); mid.rect('west', 0, 0, 4, 1, dark)
    mid.rect('north', 0, 1, 1, 1, dark)
    part.add(mid, (x, 8.5, z0))
    limb = sh.alloc(1, 2, 3)
    limb.fill(wood, jitter=0.08)
    part.add(limb, (x, 10, z0 - 3))
    part.add(limb, (x, 10, z0 + 4))
    tip = sh.alloc(1, 2, 3)
    tip.fill(dark, jitter=0.06)
    part.add(tip, (x, 12, z0 - 5.5))
    part.add(tip, (x, 12, z0 + 6.5))
    st = sh.alloc(1, 1, 1)
    st.fill(string, jitter=0.03)
    part.add(st, (x + 0.3, 13.6, z0 - 5.5), geo=(0.4, 0.4, 15.0))


# ----------------------------------------------------------------------------------------------
# Падший рыцарь
# ----------------------------------------------------------------------------------------------

def knight():
    m, body, ra, la, rl, ll = human('knight', 7551)
    sh = m.sheet

    h = sh.alloc(8, 8, 8)                                        # закрытый шлем с прорезью
    h.fill('Z', jitter=0.1)
    h.rect('up', 0, 0, 8, 8, 'Z'); h.rect('up', 3, 0, 2, 8, 'z')
    for f in h.sides():
        h.rect(f, 0, 0, 8, 1, 'z')
    h.rect('north', 1, 3, 6, 2, 'k')
    h.put('north', 2, 3, 'f'); h.put('north', 5, 3, 'f'); h.put('north', 2, 4, 'F'); h.put('north', 5, 4, 'F')
    h.rect('north', 3, 0, 2, 8, 'z'); h.rect('north', 3, 3, 2, 2, 'k')       # налобная полоса и носовая планка
    h.put('north', 3, 3, 'k'); h.put('north', 4, 3, 'k')
    for (x, y) in ((5, 5), (6, 6), (5, 7), (1, 5), (1, 7), (2, 6)):
        h.put('north', x, y, 'k')                                           # отверстия для дыхания
    for f in ('east', 'west'):
        h.rect(f, 3, 3, 2, 2, 'k'); h.put(f, 3, 3, 'F')
        h.put(f, 0, 7, 'z'); h.put(f, 7, 7, 'z')
    h.rect('south', 3, 0, 2, 8, 'Z'); h.rect('south', 0, 3, 8, 1, 'z')
    h.rect('down', 0, 0, 8, 8, 'k')
    speckle(h, h.sides() + ('up',), 'a', 0.10, 1)
    body.add(h, (4, 23, 4))

    plume = sh.alloc(2, 3, 6)                                    # драный красный султан
    plume.fill('u', jitter=0.12)
    plume.rect('up', 0, 0, 2, 6, 'U')
    ragged(plume, 'east', 2, 'U', a=0, salt=3); ragged(plume, 'west', 2, 'U', a=0, salt=4)
    body.add(plume, (7, 31, 5))

    t = sh.alloc(8, 12, 4)                                       # кираса с красным сюрко
    t.fill('Z', jitter=0.1)
    t.rect('north', 1, 1, 6, 8, 'z')
    t.rect('north', 2, 2, 4, 10, 'u'); t.rect('north', 2, 2, 1, 10, 'U'); t.rect('north', 5, 2, 1, 10, 'U')
    t.rect('north', 3, 4, 2, 5, 'x'); t.rect('north', 2, 5, 4, 1, 'x')      # крест на груди
    t.rect('north', 3, 4, 1, 5, 'X')
    t.rect('north', 0, 9, 8, 1, 'B'); t.rect('north', 3, 9, 2, 1, 'x')       # ремень
    for x in (2, 3, 5):
        t.put('north', x, 11, 'k')                                          # рваный подол
    t.rect('south', 1, 1, 6, 8, 'Z'); t.rect('south', 3, 1, 2, 9, 'z'); t.rect('south', 0, 9, 8, 1, 'B')
    for f in ('east', 'west'):
        t.rect(f, 0, 9, 4, 1, 'B'); t.rect(f, 1, 1, 2, 7, 'z')
    t.rect('up', 0, 0, 8, 4, 'Z'); t.rect('down', 0, 0, 8, 4, 'k')
    speckle(t, t.sides(), 'a', 0.09, 5)
    body.add(t, (4, 11, 6))

    cape = sh.alloc(8, 12, 1)                                    # рваный плащ
    cape.fill('U', jitter=0.12)
    cape.rect('south', 0, 0, 8, 1, 'u'); cape.rect('south', 3, 1, 2, 10, 'u')
    ragged(cape, 'south', 8, 'k', a=0, salt=7); ragged(cape, 'north', 8, 'k', a=0, salt=7)
    ragged(cape, 'east', 8, 'k', a=0, salt=7); ragged(cape, 'west', 8, 'k', a=0, salt=7)
    body.add(cape, (4, 9, 10.2))

    def arm(box, right):                                         # латная рука: наручь, локоть, перчатка
        box.fill('Z', jitter=0.1)
        for f in box.sides():
            box.rect(f, 0, 0, 4, 2, 'z')
            box.rect(f, 0, 5, 4, 1, 'z'); box.put(f, 1, 5, 'k')
            box.rect(f, 0, 9, 4, 3, 'B'); box.rect(f, 0, 9, 4, 1, 'b')
        box.rect('down', 0, 0, 4, 4, 'k'); box.rect('up', 0, 0, 4, 4, 'z')
        speckle(box, box.sides(), 'a', 0.10, 11 if right else 12)

    a1 = sh.alloc(4, 12, 4); arm(a1, True)
    ra.add(a1, (12, 11, 6))
    pr = sh.alloc(5, 3, 6)                                       # наплечник
    pr.fill('z', jitter=0.1)
    pr.rect('up', 0, 0, 5, 6, 'Z'); pr.rect('up', 1, 1, 3, 4, 'z')
    for f in pr.sides():
        pr.rect(f, 0, 2, 5, 1, 'Z')
    speckle(pr, pr.sides() + ('up',), 'a', 0.12, 13)
    ra.add(pr, (11.5, 21, 5))
    hilt = sh.alloc(5, 1, 1)                                     # меч в правой руке: крестовина и клинок вдоль руки
    hilt.fill('X', jitter=0.08)
    hilt.rect('north', 0, 0, 5, 1, 'x'); hilt.rect('south', 0, 0, 5, 1, 'x')
    ra.add(hilt, (11.5, 10.5, 7.5))
    blade = sh.alloc(1, 10, 2)
    blade.fill('z', jitter=0.08)
    blade.rect('east', 0, 0, 2, 10, 'S'); blade.rect('west', 0, 0, 2, 10, 'z')
    blade.rect('east', 1, 0, 1, 10, 'Z')
    speckle(blade, ('east', 'west', 'north', 'south'), 'a', 0.18, 14)
    ra.add(blade, (13.5, 0.5, 7))

    a2 = sh.alloc(4, 12, 4); arm(a2, False)
    la.add(a2, (0, 11, 6))
    la.add(pr, (-0.5, 21, 5))
    sd = sh.alloc(1, 8, 8)                                       # щит на левой руке
    sd.fill('b', jitter=0.1)
    sd.rect('west', 0, 0, 8, 8, 'b')
    sd.rect('west', 0, 0, 8, 1, 'z'); sd.rect('west', 0, 7, 8, 1, 'z')
    sd.rect('west', 0, 0, 1, 8, 'z'); sd.rect('west', 7, 0, 1, 8, 'z')
    sd.rect('west', 1, 1, 6, 6, 'U'); sd.rect('west', 1, 1, 3, 3, 'e'); sd.rect('west', 4, 4, 3, 3, 'e')
    sd.rect('west', 3, 3, 2, 2, 'z'); sd.put('west', 3, 3, 'x')
    sd.put('west', 5, 2, 'k'); sd.put('west', 2, 5, 'k'); sd.put('west', 6, 3, 'k')
    sd.rect('east', 0, 0, 8, 8, 'B'); sd.rect('east', 3, 0, 1, 8, 'b')
    speckle(sd, ('west',), 'a', 0.12, 16)
    la.add(sd, (-1.3, 12.5, 4))

    def leg(box, salt):
        box.fill('d', jitter=0.1)
        for f in box.sides():
            box.rect(f, 0, 0, 4, 4, 'u'); box.rect(f, 0, 4, 4, 1, 'U')       # остатки штанов под доспехом
            box.rect(f, 0, 5, 4, 1, 'z'); box.put(f, 1, 5, 'x')              # наколенник
            box.rect(f, 0, 6, 4, 3, 'Z'); box.rect(f, 1, 6, 1, 3, 'z')       # поножи
            box.rect(f, 0, 9, 4, 2, 'B'); box.rect(f, 0, 10, 4, 1, 'k')      # сапоги
        box.rect('down', 0, 0, 4, 4, 'k'); box.rect('up', 0, 0, 4, 4, 'u')
        speckle(box, box.sides(), 'a', 0.10, salt)

    l1 = sh.alloc(4, 11, 4); leg(l1, 17)
    rl.add(l1, (8, 0, 6))
    ll.add(l1, (4, 0, 6))
    return m


# ----------------------------------------------------------------------------------------------
# Разбойник-лучник
# ----------------------------------------------------------------------------------------------

def bandit():
    m, body, ra, la, rl, ll = human('bandit', 7561)
    sh = m.sheet

    h = sh.alloc(8, 8, 8)                                        # капюшон, лицо под красной повязкой
    h.fill('N', jitter=0.1)
    h.rect('up', 0, 0, 8, 8, 'N'); h.rect('up', 3, 0, 2, 8, 't')
    h.rect('north', 1, 2, 6, 5, 'p')
    h.rect('north', 0, 0, 8, 2, 't'); h.rect('north', 0, 2, 1, 6, 'N'); h.rect('north', 7, 2, 1, 6, 'N')
    h.rect('north', 1, 2, 6, 1, 'P')                                      # тень от капюшона
    h.put('north', 2, 3, 'w'); h.put('north', 5, 3, 'w'); h.put('north', 3, 3, 'k'); h.put('north', 6, 3, 'k')
    h.rect('north', 1, 3, 2, 1, 'B'); h.put('north', 3, 3, 'k')
    h.put('north', 6, 3, 'k'); h.put('north', 4, 3, 'k')
    h.put('north', 4, 4, 'P')
    h.rect('north', 1, 5, 6, 2, 'u'); h.rect('north', 1, 6, 6, 1, 'U'); h.put('north', 6, 5, 'U')   # повязка на лице
    h.put('north', 7, 7, 'u')
    for f in ('east', 'west'):
        h.rect(f, 0, 0, 8, 2, 't'); h.rect(f, 0, 2, 2, 6, 'N'); h.rect(f, 2, 2, 6, 6, 'N')
        h.rect(f, 6, 2, 2, 5, 'p'); h.rect(f, 6, 5, 2, 1, 'u')
        h.rect(f, 5, 2, 1, 3, 'N')
    h.rect('south', 0, 0, 8, 8, 'N'); h.rect('south', 3, 0, 2, 8, 't'); h.rect('south', 0, 7, 8, 1, 'u')
    h.rect('down', 0, 0, 8, 8, 'p')
    speckle(h, ('up', 'east', 'west', 'south'), 'k', 0.07, 21)
    body.add(h, (4, 23, 4))

    tail = sh.alloc(6, 6, 2)                                     # хвост капюшона на спину
    tail.fill('N', jitter=0.1)
    tail.rect('south', 0, 0, 6, 1, 't')
    ragged(tail, 'south', 4, 'k', a=0, salt=22); ragged(tail, 'east', 4, 'k', a=0, salt=22); ragged(tail, 'west', 4, 'k', a=0, salt=22)
    body.add(tail, (5, 20.5, 12))

    t = sh.alloc(8, 12, 4)                                       # кожаный жилет поверх рубахи
    t.fill('b', jitter=0.12)
    t.rect('north', 3, 0, 2, 5, 'j')                                       # рубаха в вырезе
    t.rect('north', 3, 0, 2, 1, 'J')
    for i in range(4):
        t.put('north', 3 + (i % 2), 1 + i, 'B')                            # шнуровка
    t.rect('north', 0, 9, 8, 1, 'B'); t.rect('north', 3, 9, 2, 1, 'x')      # ремень
    for i in range(7):
        t.put('north', i, 1 + i, 'B')                                       # перевязь через грудь
        t.put('north', i + 1, 1 + i, 'B')
    t.rect('north', 0, 10, 8, 2, 'N')
    t.rect('north', 1, 10, 2, 2, 'a'); t.put('north', 2, 10, 'x')           # подсумок
    t.rect('south', 0, 0, 8, 12, 'b'); t.rect('south', 3, 0, 2, 12, 'B'); t.rect('south', 0, 9, 8, 1, 'B')
    t.rect('south', 0, 10, 8, 2, 'N')
    for f in ('east', 'west'):
        t.rect(f, 0, 0, 4, 9, 'b'); t.rect(f, 0, 9, 4, 1, 'B'); t.rect(f, 0, 10, 4, 2, 'N')
    t.rect('up', 0, 0, 8, 4, 'B'); t.rect('down', 0, 0, 8, 4, 'k')
    speckle(t, t.sides(), 'B', 0.12, 23)
    body.add(t, (4, 11, 6))

    qv = sh.alloc(3, 9, 3)                                       # колчан на спине
    qv.fill('B', jitter=0.1)
    for f in qv.sides():
        qv.rect(f, 0, 0, 3, 1, 'x'); qv.rect(f, 0, 8, 3, 1, 'x'); qv.rect(f, 1, 1, 1, 7, 'b')
    qv.rect('up', 0, 0, 3, 3, 'k')
    body.add(qv, (6, 12, 10))
    ar = sh.alloc(1, 3, 1)                                       # перья стрел
    ar.fill('w', jitter=0.05)
    ar.rect('north', 0, 0, 1, 1, 'r'); ar.rect('south', 0, 0, 1, 1, 'r'); ar.rect('east', 0, 0, 1, 1, 'r'); ar.rect('west', 0, 0, 1, 1, 'r')
    body.add(ar, (6.5, 21, 10.5))
    body.add(ar, (7.8, 21, 11.2))
    body.add(ar, (8.4, 21, 10.4))

    def arm(box, bracer):
        box.fill('N', jitter=0.1)
        for f in box.sides():
            box.rect(f, 0, 0, 4, 2, 'b')                                     # плечо жилета
            box.rect(f, 0, 6, 4, 1, 'B')
            box.rect(f, 0, 7, 4, 3, 'b' if bracer else 'N')                  # наручи
            box.rect(f, 0, 7, 4, 1, 'B')
            box.rect(f, 0, 10, 4, 2, 'p'); box.rect(f, 0, 10, 4, 1, 'B')     # ладонь
        box.rect('down', 0, 0, 4, 4, 'P'); box.rect('up', 0, 0, 4, 4, 'b')
        speckle(box, box.sides(), 'k', 0.06, 24)

    a1 = sh.alloc(4, 12, 4); arm(a1, True)
    ra.add(a1, (12, 11, 6))
    a2 = sh.alloc(4, 12, 4); arm(a2, False)
    la.add(a2, (0, 11, 6))
    bow(la, sh, 'b', 'B', 'j')

    def leg(box, salt):
        box.fill('B', jitter=0.1)
        for f in box.sides():
            box.rect(f, 0, 0, 4, 6, 'B'); box.rect(f, 0, 6, 4, 1, 'j')       # отворот сапога
            box.rect(f, 0, 7, 4, 4, 'b'); box.rect(f, 0, 10, 4, 1, 'k')
            box.put(f, 1, 8, 'B'); box.put(f, 2, 9, 'B')
        box.rect('down', 0, 0, 4, 4, 'k'); box.rect('up', 0, 0, 4, 4, 'B')
        speckle(box, box.sides(), 'k', 0.07, salt)

    l1 = sh.alloc(4, 11, 4); leg(l1, 25)
    rl.add(l1, (8, 0, 6))
    l2 = sh.alloc(4, 11, 4); leg(l2, 26)
    ll.add(l2, (4, 0, 6))
    return m


# ----------------------------------------------------------------------------------------------
# Потерянная душа
# ----------------------------------------------------------------------------------------------

def soul():
    m, body, ra, la, rl, ll = human('soul', 7651)
    sh = m.sheet

    h = sh.alloc(8, 8, 8)                                        # серое измождённое лицо с пустыми глазницами
    h.fill('W', jitter=0.08)
    h.rect('up', 0, 0, 8, 8, 'I'); h.rect('up', 2, 1, 4, 6, 'Q')
    h.rect('north', 0, 0, 8, 2, 'I')                                       # волосы
    h.rect('north', 0, 2, 1, 6, 'I'); h.rect('north', 7, 2, 1, 6, 'I')
    h.rect('north', 1, 3, 2, 2, 'k'); h.rect('north', 5, 3, 2, 2, 'k')       # глазницы
    h.put('north', 1, 4, 'i'); h.put('north', 6, 4, 'i')
    h.put('north', 2, 3, 'i'); h.put('north', 5, 3, 'i')
    h.rect('north', 1, 2, 2, 1, 'Q'); h.rect('north', 5, 2, 2, 1, 'Q')
    h.put('north', 3, 5, 'Q'); h.put('north', 4, 5, 'Q')                     # нос
    h.rect('north', 2, 6, 4, 2, 'k'); h.rect('north', 3, 7, 2, 1, 'I')       # раскрытый в крике рот
    h.put('north', 3, 6, 'e'); h.put('north', 4, 6, 'e')
    for f in ('east', 'west'):
        h.rect(f, 0, 0, 8, 3, 'I'); h.rect(f, 5, 3, 3, 5, 'I'); h.rect(f, 2, 4, 2, 1, 'Q')
    h.rect('south', 0, 0, 8, 8, 'I'); h.rect('south', 3, 0, 2, 8, 'V')
    h.rect('down', 0, 0, 8, 8, 'Q')
    body.add(h, (4, 23, 4))

    hair = sh.alloc(8, 9, 2)                                     # длинные спутанные пряди за спиной
    hair.fill('I', jitter=0.15)
    for i in range(8):
        n = 3 + int(cm.hn(i, 1, hair.seed) * 6)
        for j in range(n, 9):
            hair.put('south', i, j, 'I', 0); hair.put('north', i, j, 'I', 0)
    body.add(hair, (4, 21, 12))

    flame = sh.alloc(2, 3, 2)                                    # огонёк души над головой
    for f in cm.FACES:
        rx, ry, rw, rh = flame.region(f)
        for j in range(rh):
            for i in range(rw):
                a = 235 if j >= rh // 2 else 150 - 20 * (rh // 2 - j)
                sh.px[ry + j, rx + i] = cm.col('w' if j == rh - 1 else 'i', max(a, 70))
    body.add(flame, (7, 31, 7))

    t = sh.alloc(8, 12, 4)                                       # погребальный саван
    t.fill('j', jitter=0.08)
    for f in t.sides():
        for x in (1, 3, 6):
            t.rect(f, x, 0, 1, 12, 'J')                                    # складки
    t.rect('north', 2, 0, 4, 1, 'W')                                       # ключицы в вырезе
    t.rect('north', 3, 1, 2, 4, 'Q'); t.put('north', 3, 2, 'k'); t.put('north', 4, 2, 'k')
    t.put('north', 3, 4, 'i'); t.put('north', 4, 4, 'i')                     # душа светится в груди
    t.rect('north', 0, 7, 8, 1, 'J')                                       # верёвка на поясе
    t.put('north', 4, 8, 'J'); t.put('north', 4, 9, 'J')
    for (x, y) in ((1, 3), (6, 5), (2, 9), (5, 10)):
        t.put('north', x, y, 'I')                                           # пятна
    ragged(t, 'north', 10, 'k', salt=31); ragged(t, 'south', 10, 'k', salt=32)
    t.rect('up', 0, 0, 8, 4, 'j'); t.rect('down', 0, 0, 8, 4, 'I')
    body.add(t, (4, 11, 6))

    ch = sh.alloc(1, 7, 1)                                       # цепь, свисающая с пояса
    ch.fill('G', jitter=0.1)
    for f in ch.sides():
        for y in range(0, 7, 2):
            ch.put(f, 0, y, 'S')
    body.add(ch, (8, 4, 5.4))
    body.add(ch, (11.3, 5, 7.5))

    def arm(box, salt):
        box.fill('W', jitter=0.08)
        for f in box.sides():
            box.rect(f, 0, 0, 4, 5, 'j'); box.rect(f, 0, 4, 4, 1, 'J')
            box.rect(f, 1, 6, 2, 1, 'Q'); box.rect(f, 0, 9, 4, 3, 'Q')
            box.rect(f, 0, 11, 4, 1, 'I')
        ragged(box, 'north', 4, 'k', salt=salt); ragged(box, 'south', 4, 'k', salt=salt)
        for f in box.sides():
            for x in range(4):
                if cm.hn(x, 5, box.seed + salt) < 0.4:
                    box.put(f, x, 4, 'j', 0)
        box.rect('down', 0, 0, 4, 4, 'I'); box.rect('up', 0, 0, 4, 4, 'j')

    a1 = sh.alloc(4, 12, 4); arm(a1, 33)
    ra.add(a1, (12, 11, 6))
    a2 = sh.alloc(4, 12, 4); arm(a2, 34)
    la.add(a2, (0, 11, 6))
    claw = sh.alloc(1, 3, 1)                                     # когти на пальцах
    claw.fill('e', jitter=0.05)
    for x in (12.4, 13.4, 14.4, 15.0):
        ra.add(claw, (x, 8.5, 7.2 + (x - 12.4) * 0.1))
    for x in (0.4, 1.4, 2.4, 3.0):
        la.add(claw, (x, 8.5, 7.2 + (x - 0.4) * 0.1))

    def leg(box, salt):
        box.fill('j', jitter=0.08)
        for f in box.sides():
            box.rect(f, 0, 0, 4, 7, 'j'); box.rect(f, 1, 0, 1, 7, 'J')
            for j, (c, a) in enumerate((('I', 210), ('I', 150), ('i', 100), ('i', 60))):
                box.rect(f, 0, 7 + j, 4, 1, c, a)
        for f in box.sides():
            for x in range(4):
                if cm.hn(x, 8, box.seed + salt) < 0.35:
                    box.put(f, x, 7, 'j', 0)
        box.rect('down', 0, 0, 4, 4, 'i', 90); box.rect('up', 0, 0, 4, 4, 'j')

    l1 = sh.alloc(4, 11, 4); leg(l1, 35)
    rl.add(l1, (8, 0, 6))
    l2 = sh.alloc(4, 11, 4); leg(l2, 36)
    ll.add(l2, (4, 0, 6))
    return m


# ----------------------------------------------------------------------------------------------
# Жнец
# ----------------------------------------------------------------------------------------------

def reaper():
    m, body, ra, la, rl, ll = human('reaper', 7661)
    sh = m.sheet

    h = sh.alloc(8, 8, 8)                                        # капюшон и череп-маска
    h.fill('d', jitter=0.08)
    h.rect('up', 0, 0, 8, 8, 'd'); h.rect('up', 3, 0, 2, 8, 'D')
    h.rect('north', 0, 0, 8, 1, 'D'); h.rect('north', 0, 1, 1, 7, 'D'); h.rect('north', 7, 1, 1, 7, 'D')
    h.rect('north', 1, 1, 6, 6, 'e')                                       # маска-череп
    h.rect('north', 1, 1, 6, 1, 'E')
    h.rect('north', 1, 3, 2, 2, 'k'); h.rect('north', 5, 3, 2, 2, 'k')       # глазницы
    h.put('north', 2, 4, 'r'); h.put('north', 5, 4, 'r')
    h.put('north', 1, 3, 'V'); h.put('north', 6, 3, 'V')
    h.put('north', 3, 5, 'k'); h.put('north', 4, 5, 'k')                     # нос
    h.rect('north', 1, 6, 6, 1, 'E')
    for x in (2, 4, 6):
        h.put('north', x - 1 if x < 6 else 5, 6, 'k')                         # щели зубов
    h.rect('north', 2, 7, 4, 1, 'd')
    h.put('north', 0, 4, 'E'); h.put('north', 7, 4, 'E')
    for f in ('east', 'west'):
        h.rect(f, 0, 0, 8, 8, 'd'); h.rect(f, 0, 0, 8, 1, 'D'); h.rect(f, 5, 1, 3, 6, 'D')
        h.rect(f, 0, 6, 8, 1, 'V')
    h.rect('south', 0, 0, 8, 8, 'd'); h.rect('south', 3, 0, 2, 8, 'D'); h.rect('south', 0, 6, 8, 1, 'V')
    h.rect('down', 0, 0, 8, 8, 'D')
    body.add(h, (4, 23, 4))

    horn = sh.alloc(1, 3, 1)                                     # костяные рожки на капюшоне
    horn.fill('e', jitter=0.06)
    horn.rect('north', 0, 0, 1, 1, 'E')
    body.add(horn, (4.2, 31, 5.5))
    body.add(horn, (10.8, 31, 5.5))

    t = sh.alloc(8, 12, 4)                                       # чёрная ряса, в вырезе виднеются рёбра
    t.fill('d', jitter=0.08)
    t.rect('north', 2, 0, 4, 8, 'D')
    for y in range(1, 8, 2):
        t.rect('north', 3, y, 2, 1, 'e')                                   # рёбра
    t.rect('north', 3, 0, 2, 8, 'E'); t.rect('north', 3, 0, 2, 8, 'D')
    for y in range(1, 8, 2):
        t.rect('north', 2, y, 4, 1, 'e'); t.put('north', 2, y, 'E'); t.put('north', 5, y, 'E')
    t.rect('north', 0, 0, 2, 12, 'd'); t.rect('north', 6, 0, 2, 12, 'd')
    t.rect('north', 0, 8, 8, 1, 'V'); t.rect('north', 0, 9, 8, 1, 'v')       # пояс
    t.put('north', 3, 9, 'x'); t.put('north', 4, 9, 'x')
    t.rect('north', 3, 10, 2, 2, 'e'); t.put('north', 3, 10, 'k'); t.put('north', 4, 10, 'k')   # подвеска-череп
    t.rect('south', 0, 0, 8, 12, 'd'); t.rect('south', 3, 0, 2, 12, 'D'); t.rect('south', 0, 8, 8, 2, 'V')
    for f in ('east', 'west'):
        t.rect(f, 0, 8, 4, 2, 'V'); t.rect(f, 1, 0, 1, 8, 'D')
    t.rect('up', 0, 0, 8, 4, 'D'); t.rect('down', 0, 0, 8, 4, 'D')
    body.add(t, (4, 11, 6))

    sp = sh.alloc(1, 8, 1)                                       # хребет на спине
    sp.fill('e', jitter=0.05)
    for f in sp.sides():
        for y in range(0, 8, 2):
            sp.put(f, 0, y, 'E')
    body.add(sp, (7.5, 12, 10.1))

    wing = sh.alloc(1, 10, 3)                                    # крылья из чёрных перьев (ступенями)
    wing.fill('D', jitter=0.1)
    for f in ('east', 'west'):
        for i in range(3):
            wing.rect(f, i, 0, 1, 10, 'D' if i != 1 else 'd')
        for y in range(0, 10, 3):
            wing.put(f, 0, y, 'V')
    wing2 = sh.alloc(1, 7, 3)
    wing2.fill('D', jitter=0.1)
    for f in ('east', 'west'):
        for y in range(0, 7, 3):
            wing2.put(f, 1, y, 'V')
    wing3 = sh.alloc(1, 4, 3)
    wing3.fill('d', jitter=0.1)
    for sgn, x in ((0, 11.5), (1, 3.5)):
        body.add(wing, (x, 14.5, 10.4))
        body.add(wing2, (x + (0.3 if sgn == 0 else -0.3), 15, 13.4))
        body.add(wing3, (x + (0.6 if sgn == 0 else -0.6), 15.5, 16.4))

    def arm(box, salt):
        box.fill('d', jitter=0.08)
        for f in box.sides():
            box.rect(f, 0, 0, 4, 1, 'e')                                     # костяной наплечник
            box.rect(f, 0, 7, 4, 1, 'V'); box.rect(f, 0, 8, 4, 1, 'v')       # манжета
            box.rect(f, 0, 9, 4, 3, 'e'); box.rect(f, 0, 9, 4, 1, 'E')       # костяная кисть
            box.put(f, 1, 10, 'E'); box.put(f, 2, 11, 'E')
        box.rect('down', 0, 0, 4, 4, 'E'); box.rect('up', 0, 0, 4, 4, 'D')
        speckle(box, box.sides(), 'D', 0.12, salt)

    a1 = sh.alloc(4, 12, 4); arm(a1, 41)
    ra.add(a1, (12, 11, 6))
    a2 = sh.alloc(4, 12, 4); arm(a2, 42)
    la.add(a2, (0, 11, 6))
    bow(la, sh, 'e', 'E', 'v')

    def leg(box, salt):
        box.fill('d', jitter=0.08)
        for f in box.sides():
            box.rect(f, 0, 7, 4, 1, 'V'); box.rect(f, 0, 8, 4, 1, 'v')
            box.rect(f, 0, 9, 4, 2, 'e'); box.rect(f, 0, 10, 4, 1, 'E')      # костяные ступни
            box.rect(f, 1, 0, 1, 7, 'D')
        box.rect('down', 0, 0, 4, 4, 'E'); box.rect('up', 0, 0, 4, 4, 'D')
        speckle(box, box.sides(), 'D', 0.12, salt)

    l1 = sh.alloc(4, 11, 4); leg(l1, 43)
    rl.add(l1, (8, 0, 6))
    l2 = sh.alloc(4, 11, 4); leg(l2, 44)
    ll.add(l2, (4, 0, 6))
    return m


MOBS = [knight, bandit, soul, reaper]


def all_mobs():
    return [fn() for fn in MOBS]


def files(png_bytes):
    return cm.files(png_bytes, all_mobs())


def preview(path):
    mobs = all_mobs()
    sc = 7
    views = [0, 40, 90, 180]
    rows = []
    for m in mobs:
        row = [cm.render(m, v, sc, {}) for v in views]
        row.append(cm.render(m, 40, sc, {'arm_r': -78, 'arm_l': -78}))                         # руки вперёд (атака)
        row.append(cm.render(m, 90, sc, {'leg_r': 35, 'leg_l': -35, 'arm_r': -30, 'arm_l': 30}))   # шаг
        rows.append(row)
    W = max(sum(i.width for i in r) for r in rows)
    H = sum(r[0].height for r in rows)
    sheet = Image.new('RGB', (W, H), (24, 26, 40))
    y = 0
    for r in rows:
        x = 0
        for i in r:
            sheet.paste(i, (x, y))
            x += i.width
        y += r[0].height
    sheet.save(os.path.join(path, 'realm_mobs.png'))
    for m in mobs:
        big = m.sheet.image().resize((SIZE * 8, SIZE * 8), Image.NEAREST)
        bg = Image.new('RGBA', big.size, (60, 60, 70, 255))
        bg.alpha_composite(big)
        bg.save(os.path.join(path, 'tex_%s.png' % m.name))


def table():
    """Положения суставов в блоках (для сверки с CyberSkins.humanoid) и контроль номеров."""
    seen = set()
    for m in all_mobs():
        for p in m.parts:
            assert p.cmd not in seen, 'номер %d занят' % p.cmd
            seen.add(p.cmd)
            p.elements()                                       # проверка пределов −16..32
            jx = -(p.joint[0] - 8) / 16.0
            print('%s %-6s cmd=%d  jx=%+.5f jy=%.5f jz=%+.5f' % (m.name, p.name, p.cmd, jx, p.joint[1] / 16.0, -(p.joint[2] - 8) / 16.0))


if __name__ == '__main__':
    if len(sys.argv) > 1:
        os.makedirs(sys.argv[1], exist_ok=True)
        preview(sys.argv[1])
    table()
