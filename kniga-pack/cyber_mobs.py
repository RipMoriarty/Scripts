#!/usr/bin/env python3
"""Модели киберпсихов (зомби) и дронов-стрелков (скелеты) для ресурспака «Книга Судеб».

Ванильный ресурспак не умеет подменять внешность отдельного моба, поэтому плагин (CyberSkins.java) делает так:
настоящий моб становится невидимым, а на нём «едут» предметы-дисплеи, и каждый показывает одну деталь модели.
Здесь рисуются эти детали: кубики (как в Blockbench), текстура 64×64 на моба и JSON-модели предметов.

Система координат модели — единицы 1/16 блока, как в моделях предметов. Лицо персонажа смотрит на север (−z),
его правая сторона — восток (+x). Ноги стоят на y = 0 (в кубе предмета это y = −2: тело опущено на 2, чтобы ирокез
не вылез за предел 32). Подвижные детали (руки, ноги, винты) сделаны так, чтобы сустав лежал в центре куба предмета
(8, 8, 8): тогда плагину достаточно повернуть дисплей вокруг его центра.

python3 cyber_mobs.py <каталог-для-предпросмотра>   — нарисовать предпросмотр и напечатать таблицу суставов для Java.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

SIZE = 64
FACES = ('east', 'north', 'west', 'south', 'up', 'down')

C = {
    'k': (0x0d, 0x0e, 0x1c), 'n': (0x15, 0x17, 0x24), 'g': (0x2b, 0x2f, 0x45), 'G': (0x5c, 0x62, 0x7d),
    'S': (0x9a, 0xa3, 0xc0), 's': (0xc9, 0xd2, 0xe6), 'w': (0xee, 0xf0, 0xff),
    'c': (0x19, 0xe3, 0xff), 'C': (0x0b, 0x8a, 0xa8), 'T': (0x0a, 0x3d, 0x4c),
    'm': (0xff, 0x2b, 0xd6), 'M': (0x9b, 0x13, 0x7f), 'h': (0xff, 0x7a, 0xe8),
    'y': (0xff, 0xd2, 0x3f), 'Y': (0xb8, 0x86, 0x1c), 'o': (0xff, 0x7a, 0x1a), 'O': (0xb3, 0x45, 0x0a),
    'r': (0xff, 0x33, 0x55), 'R': (0x8a, 0x10, 0x28), 'l': (0x7d, 0xff, 0x4f),
    'p': (0xc2, 0xa4, 0xa0), 'P': (0x96, 0x7e, 0x82), 'q': (0xda, 0xc2, 0xbc),
}


def col(c, a=255):
    """Буква палитры или тройка → RGBA."""
    if isinstance(c, str):
        c = C[c]
    return (c[0], c[1], c[2], a)


def mul(c, k):
    c = C[c] if isinstance(c, str) else c
    return tuple(max(0, min(255, int(v * k))) for v in c[:3])


def hn(x, y, s):
    h = (x * 73856093) ^ (y * 19349663) ^ (s * 83492791)
    h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


class Sheet:
    """Одна текстура 64×64 и простая укладка прямоугольных раскладок кубиков (полками)."""

    def __init__(self):
        self.px = np.zeros((SIZE, SIZE, 4), np.uint8)
        self.cx = self.cy = self.rowh = 0
        self.seed = 1

    def alloc(self, w, h, d):
        bw, bh = 2 * (w + d), d + h
        if self.cx + bw > SIZE:
            self.cx = 0
            self.cy += self.rowh
            self.rowh = 0
        assert self.cy + bh <= SIZE, 'текстура 64×64 переполнена'
        self.seed += 1
        b = Box(self, self.cx, self.cy, w, h, d, self.seed)
        self.cx += bw
        self.rowh = max(self.rowh, bh)
        return b

    def image(self):
        return Image.fromarray(self.px, 'RGBA')


class Box:
    """Раскладка одного кубика на текстуре (как у скина игрока): [восток | север | запад | юг], сверху и снизу — верх/низ."""

    def __init__(self, sheet, u, v, w, h, d, seed):
        self.s, self.u, self.v, self.w, self.h, self.d, self.seed = sheet, u, v, w, h, d, seed

    def region(self, f):
        u, v, w, h, d = self.u, self.v, self.w, self.h, self.d
        return {
            'east': (u, v + d, d, h), 'north': (u + d, v + d, w, h), 'west': (u + d + w, v + d, d, h),
            'south': (u + 2 * d + w, v + d, w, h), 'up': (u + d, v, w, d), 'down': (u + d + w, v, w, d),
        }[f]

    def uv(self, f):
        """Координаты текстуры в модели — всегда в долях 0–16, а не в пикселях (ключ texture_size игра не читает)."""
        x, y, w, h = self.region(f)
        k = 16.0 / SIZE
        if f == 'down':                                   # у нижней грани игра кладёт верх картинки на южный край, а мы рисуем с северного
            return [x * k, (y + h) * k, (x + w) * k, y * k]
        return [x * k, y * k, (x + w) * k, (y + h) * k]

    def put(self, f, x, y, c, a=255):
        rx, ry, rw, rh = self.region(f)
        if 0 <= x < rw and 0 <= y < rh:
            self.s.px[ry + y, rx + x] = col(c, a)

    def rect(self, f, x, y, w, h, c, a=255):
        for j in range(h):
            for i in range(w):
                self.put(f, x + i, y + j, c, a)

    def fill(self, c, faces=FACES, jitter=0.07, a=255):
        base = C[c] if isinstance(c, str) else c
        for f in faces:
            rx, ry, rw, rh = self.region(f)
            for j in range(rh):
                for i in range(rw):
                    k = 1.0 + (hn(i, j, self.seed * 7 + FACES.index(f)) - 0.5) * 2 * jitter
                    self.s.px[ry + j, rx + i] = col(mul(base, k), a)

    def sides(self):
        return ('east', 'north', 'west', 'south')


class Part:
    """Одна деталь модели: набор кубиков и положение сустава (в единицах, в «абсолютных» координатах от ног)."""

    def __init__(self, name, cmd, joint):
        self.name, self.cmd, self.joint = name, cmd, joint
        self.shift = (joint[0] - 8, joint[1] - 8, joint[2] - 8)    # куб предмета = абсолютные координаты − shift
        self.items = []                                           # (Box, from_abs, size_geo)

    def add(self, box, frm, geo=None):
        self.items.append((box, tuple(float(v) for v in frm), tuple(float(v) for v in (geo or (box.w, box.h, box.d)))))
        return box

    def elements(self):
        out = []
        for box, frm, geo in self.items:
            f = [frm[i] - self.shift[i] for i in range(3)]
            t = [f[i] + geo[i] for i in range(3)]
            for v in f + t:
                assert -16 <= v <= 32, '%s: координата %s вне пределов модели' % (self.name, v)
            out.append({'from': f, 'to': t, 'faces': {fc: {'uv': box.uv(fc), 'texture': '#t'} for fc in FACES}})
        return out

    def model(self, tex):
        return {'texture_size': [SIZE, SIZE], 'textures': {'t': tex, 'particle': tex}, 'elements': self.elements()}


class Mob:
    def __init__(self, name):
        self.name = name
        self.sheet = Sheet()
        self.parts = []

    def part(self, name, cmd, joint):
        p = Part(name, cmd, joint)
        self.parts.append(p)
        return p

    def tex_ref(self):
        return 'kniga:item/cyber/mob/%s' % self.name      # текстуры вне папок block/ и item/ игра в атлас не берёт (с 1.19.3)


# ----------------------------------------------------------------------------------------------
# Киберпсих
# ----------------------------------------------------------------------------------------------

def psycho():
    m = Mob('psycho')
    sh = m.sheet
    body = m.part('body', 7301, (8, 10, 8))
    rarm = m.part('arm_r', 7302, (14.5, 21, 8))
    larm = m.part('arm_l', 7303, (2, 21, 8))
    rleg = m.part('leg_r', 7304, (10, 11, 8))
    lleg = m.part('leg_l', 7305, (6, 11, 8))

    # ---- голова
    head = sh.alloc(8, 8, 8)
    head.fill('p')
    head.rect('up', 0, 0, 8, 8, 'n')
    head.rect('up', 3, 0, 2, 8, 'm')                                   # ирокез сверху
    for f in head.sides():
        head.rect(f, 0, 0, 8, 2, 'n')                                  # волосы по краю
    head.rect('north', 0, 2, 8, 1, 'P')                                # лоб в тени
    head.rect('north', 0, 2, 2, 1, 'n'); head.rect('north', 6, 2, 2, 1, 'n')
    head.rect('north', 1, 3, 3, 1, 'c'); head.put('north', 2, 3, 'w')  # киберглаз справа от персонажа (слева на картинке)
    head.rect('north', 1, 4, 3, 1, 'C')
    head.rect('north', 5, 3, 2, 1, 'w'); head.put('north', 5, 3, 'r'); head.put('north', 6, 3, 'r')
    head.rect('north', 5, 2, 2, 1, 'n')                                # хмурая бровь
    head.put('north', 4, 4, 'P'); head.put('north', 4, 5, 'P')
    head.rect('north', 2, 6, 4, 1, 'k')                                # оскал
    for i, x in enumerate(range(2, 6)):
        head.put('north', x, 6, 'w' if i % 2 == 0 else 'k')
    head.rect('north', 0, 4, 1, 3, 'S'); head.put('north', 0, 5, 'w')  # пластина на щеке
    for f in ('east', 'west'):
        head.rect(f, 6, 3, 1, 2, 'P')                                  # ухо
    head.rect('east', 2, 3, 5, 3, 'S'); head.rect('east', 2, 3, 5, 1, 's')   # хромированная щека
    head.put('east', 3, 4, 'c'); head.put('east', 5, 4, 'o')
    head.rect('south', 0, 2, 8, 4, 'n'); head.rect('south', 3, 5, 2, 3, 'k')
    head.put('south', 3, 5, 'c'); head.put('south', 4, 6, 'c')        # разъём на затылке
    head.rect('down', 0, 0, 8, 8, 'P')
    body.add(head, (4, 23, 4))

    mohawk = sh.alloc(2, 3, 8)
    mohawk.fill('m', jitter=0.1)
    mohawk.rect('up', 0, 0, 2, 8, 'h')
    for y in range(0, 8, 2):
        mohawk.rect('up', 0, y, 2, 1, 'm')
    body.add(mohawk, (7, 31, 4))

    # ---- торс
    torso = sh.alloc(8, 12, 4)
    torso.fill('n', jitter=0.1)
    f = 'north'
    torso.rect(f, 0, 0, 8, 1, 'g'); torso.rect(f, 2, 0, 4, 1, 'c')            # воротник с неоном
    torso.rect(f, 3, 1, 2, 7, 'g')                                              # майка под курткой
    torso.rect(f, 3, 1, 2, 1, 'P')
    for i in range(5):                                                          # диагональные неоновые полосы
        torso.put(f, i, 2 + i, 'm'); torso.put(f, 7 - i, 2 + i, 'm')
    torso.rect(f, 3, 4, 2, 2, 'T'); torso.rect(f, 3, 4, 2, 2, 'C')            # реактор на груди
    torso.put(f, 3, 4, 'w'); torso.put(f, 4, 4, 'c'); torso.put(f, 3, 5, 'c'); torso.put(f, 4, 5, 'C')
    torso.rect(f, 0, 9, 8, 1, 'G'); torso.rect(f, 3, 9, 2, 1, 'y')            # ремень и пряжка
    torso.rect(f, 0, 10, 8, 2, 'k')                                             # штаны на поясе
    f = 'south'
    torso.rect(f, 2, 2, 4, 5, 'g')
    for (x, y) in ((3, 3), (4, 3), (3, 4), (4, 4), (2, 5), (5, 5), (3, 6), (4, 6)):
        torso.put(f, x, y, 'm')                                                 # череп на спине
    torso.put(f, 3, 4, 'k'); torso.put(f, 4, 4, 'k'); torso.put(f, 3, 5, 'k'); torso.put(f, 4, 5, 'k')
    torso.rect(f, 3, 7, 2, 1, 'k')
    torso.rect(f, 0, 7, 8, 1, 'c')                                              # неон под черепом
    torso.rect(f, 0, 9, 8, 1, 'G'); torso.rect(f, 0, 10, 8, 2, 'k')
    for f in ('east', 'west'):
        torso.rect(f, 1, 0, 1, 10, 'g'); torso.rect(f, 2, 0, 1, 9, 'M')       # шов и неоновая полоса сбоку
        torso.rect(f, 0, 9, 4, 1, 'G'); torso.rect(f, 0, 10, 4, 2, 'k')
    torso.rect('up', 0, 0, 8, 4, 'g'); torso.rect('down', 0, 0, 8, 4, 'k')
    body.add(torso, (4, 11, 6))

    belt = sh.alloc(9, 2, 5)
    belt.fill('G', jitter=0.1)
    belt.rect('north', 3, 0, 3, 2, 'k'); belt.rect('north', 4, 0, 1, 2, 'y')
    belt.rect('north', 0, 0, 9, 1, 'S')
    body.add(belt, (3.5, 11, 5.5))

    # ---- правая рука: киберпротез «горилла»
    ra = sh.alloc(5, 12, 5)
    ra.fill('G', jitter=0.08)
    for f in ra.sides():
        ra.rect(f, 0, 0, 5, 3, 'g')                                             # плечевой блок
        ra.rect(f, 0, 0, 5, 1, 'S')
        ra.rect(f, 0, 3, 1, 5, 'c'); ra.rect(f, 4, 3, 1, 5, 'c')                # приводы
        ra.rect(f, 1, 3, 3, 1, 's')
        ra.rect(f, 0, 8, 5, 1, 'k'); ra.put(f, 2, 8, 'o')                       # локтевой сустав
        ra.rect(f, 1, 9, 3, 2, 'S'); ra.rect(f, 1, 10, 3, 1, 'G')
        ra.rect(f, 0, 11, 5, 1, 'k')
    ra.rect('north', 2, 4, 1, 3, 'C'); ra.put('north', 2, 5, 'w')
    ra.rect('down', 0, 0, 5, 5, 'k'); ra.rect('up', 0, 0, 5, 5, 'g')
    rarm.add(ra, (12, 11, 5.5))

    # ---- левая рука: рукав и перчатка
    la = sh.alloc(4, 12, 4)
    la.fill('n', jitter=0.1)
    for f in la.sides():
        la.rect(f, 0, 6, 4, 1, 'm')                                             # неоновая манжета
        la.rect(f, 0, 7, 4, 5, 'k')                                             # перчатка
        la.rect(f, 0, 8, 4, 1, 'G')                                             # накладка на костяшках
        la.put(f, 1, 9, 'G'); la.put(f, 2, 9, 'G')
    la.rect('north', 1, 1, 1, 5, 'g'); la.rect('south', 2, 1, 1, 5, 'g')
    la.rect('down', 0, 0, 4, 4, 'k'); la.rect('up', 0, 0, 4, 4, 'g')
    larm.add(la, (0, 11, 6))

    pad = sh.alloc(6, 2, 6)
    pad.fill('G', jitter=0.1)
    pad.rect('up', 0, 0, 6, 6, 'S'); pad.rect('up', 1, 1, 4, 4, 'g'); pad.put('up', 2, 2, 'c'); pad.put('up', 3, 3, 'c')
    for f in pad.sides():
        pad.rect(f, 0, 1, 6, 1, 'c')
    larm.add(pad, (-1, 23, 5))

    # ---- ноги
    rl = sh.alloc(4, 11, 4)
    rl.fill('S', jitter=0.08)                                                    # правая нога — протез
    for f in rl.sides():
        rl.rect(f, 0, 0, 4, 3, 'n')
        rl.rect(f, 0, 3, 4, 1, 'k'); rl.put(f, 1, 3, 'o')                       # колено
        rl.rect(f, 0, 4, 1, 4, 'c'); rl.rect(f, 3, 4, 1, 4, 'c')
        rl.rect(f, 1, 5, 2, 1, 'G')
        rl.rect(f, 0, 8, 4, 3, 'k'); rl.rect(f, 0, 10, 4, 1, 'O')               # ботинок
    rl.rect('down', 0, 0, 4, 4, 'k'); rl.rect('up', 0, 0, 4, 4, 'n')
    rleg.add(rl, (8, 0, 6))

    ll = sh.alloc(4, 11, 4)
    ll.fill('n', jitter=0.1)
    for f in ll.sides():
        ll.rect(f, 0, 3, 4, 1, 'g')
        ll.rect(f, 0, 8, 4, 3, 'k'); ll.rect(f, 0, 10, 4, 1, 'O')
    ll.rect('north', 1, 0, 1, 8, 'C'); ll.rect('east', 3, 0, 1, 8, 'm')         # неоновые лампасы
    ll.rect('down', 0, 0, 4, 4, 'k'); ll.rect('up', 0, 0, 4, 4, 'n')
    lleg.add(ll, (4, 0, 6))
    return m


# ----------------------------------------------------------------------------------------------
# Дрон-стрелок
# ----------------------------------------------------------------------------------------------

def drone():
    m = Mob('drone')
    sh = m.sheet
    body = m.part('body', 7401, (8, 8, 8))
    rotor = m.part('rotor', 7402, (15, 21, 8))

    core = sh.alloc(8, 8, 8)
    core.fill('g', jitter=0.08)
    for f in core.sides():
        core.rect(f, 0, 0, 8, 1, 'G'); core.rect(f, 0, 7, 8, 1, 'k')
        core.rect(f, 0, 3, 8, 1, 'k')                                           # линия разъёма корпуса
    core.rect('north', 1, 1, 6, 2, 'G'); core.rect('north', 1, 5, 6, 2, 'G')
    core.put('north', 1, 1, 'y'); core.put('north', 6, 1, 'l')                  # индикаторы
    core.rect('east', 2, 4, 4, 2, 'y'); core.rect('west', 2, 4, 4, 2, 'y')      # предупреждающие полосы
    for x in range(2, 6, 2):
        core.rect('east', x, 4, 1, 2, 'k'); core.rect('west', x, 4, 1, 2, 'k')
    core.rect('south', 2, 2, 4, 4, 'k'); core.rect('south', 3, 3, 2, 2, 'C'); core.put('south', 3, 3, 'c')
    core.rect('up', 0, 0, 8, 8, 'G'); core.rect('up', 1, 1, 6, 6, 'g'); core.rect('up', 3, 3, 2, 2, 'k')
    core.rect('down', 0, 0, 8, 8, 'k')
    body.add(core, (4, 12, 4))

    lens = sh.alloc(4, 4, 1)
    lens.fill('k', jitter=0.04)
    lens.rect('north', 0, 0, 4, 4, 'k')
    lens.rect('north', 1, 0, 2, 4, 'R'); lens.rect('north', 0, 1, 4, 2, 'R')
    lens.rect('north', 1, 1, 2, 2, 'r'); lens.put('north', 1, 1, 'w')
    body.add(lens, (6, 14, 3))

    barrel = sh.alloc(2, 2, 5)
    barrel.fill('k', jitter=0.05)
    for f in ('east', 'west', 'up', 'down'):
        barrel.rect(f, 0, 0, 2 if f in ('up', 'down') else 5, 1, 'G')
    barrel.rect('north', 0, 0, 2, 2, 'k'); barrel.rect('north', 0, 0, 2, 2, 'T'); barrel.put('north', 0, 0, 'k'); barrel.put('north', 1, 1, 'k')
    body.add(barrel, (7, 10, 0))

    thr = sh.alloc(4, 4, 4)
    thr.fill('G', jitter=0.08)
    for f in thr.sides():
        thr.rect(f, 0, 1, 4, 1, 'k'); thr.rect(f, 0, 2, 4, 1, 'C')
    thr.rect('down', 0, 0, 4, 4, 'k')
    body.add(thr, (6, 8, 6))

    noz = sh.alloc(2, 2, 2)
    noz.fill('c', jitter=0.1)
    noz.rect('down', 0, 0, 2, 2, 'w')
    body.add(noz, (7, 6, 7))

    flame = sh.alloc(2, 3, 2)
    for f in FACES:
        rx, ry, rw, rh = flame.region(f)
        for j in range(rh):
            for i in range(rw):
                a = int(150 * (1 - j / max(rh, 1)) + 20) if f not in ('up', 'down') else 50
                sh.px[ry + j, rx + i] = col('c' if j < rh // 2 else 'C', a)
    body.add(flame, (7, 3, 7))

    arm = sh.alloc(4, 2, 2)
    arm.fill('G', jitter=0.08)
    arm.rect('north', 0, 0, 4, 1, 'y'); arm.rect('south', 0, 0, 4, 1, 'y')
    for x in (1, 3):
        arm.put('north', x, 0, 'k'); arm.put('south', x, 0, 'k')
    body.add(arm, (12, 15, 7))
    body.add(arm, (0, 15, 7))

    pod = sh.alloc(4, 3, 4)
    pod.fill('g', jitter=0.08)
    for f in pod.sides():
        pod.rect(f, 0, 0, 4, 1, 'G'); pod.rect(f, 0, 2, 4, 1, 'k')
    pod.rect('up', 0, 0, 4, 4, 'k'); pod.rect('up', 1, 1, 2, 2, 'C')
    body.add(pod, (13, 17, 6))
    body.add(pod, (-1, 17, 6))

    ant = sh.alloc(1, 6, 1)
    ant.fill('G', jitter=0.05)
    ant.rect('north', 0, 0, 1, 1, 'r'); ant.rect('east', 0, 0, 1, 1, 'r'); ant.rect('west', 0, 0, 1, 1, 'r'); ant.rect('south', 0, 0, 1, 1, 'r')
    ant.rect('up', 0, 0, 1, 1, 'r')
    body.add(ant, (7.5, 20, 7.5))

    # винт: центр куба — центр винта
    hub = sh.alloc(3, 2, 3)
    hub.fill('Y', jitter=0.08)
    hub.rect('up', 0, 0, 3, 3, 'y')
    b1 = sh.alloc(11, 1, 2)
    b1.fill('k', jitter=0.05)
    b1.rect('up', 0, 0, 2, 2, 'c'); b1.rect('up', 9, 0, 2, 2, 'c')
    for f in ('north', 'south'):
        b1.rect(f, 0, 0, 1, 1, 'c'); b1.rect(f, 10, 0, 1, 1, 'c')
    b2 = sh.alloc(2, 1, 11)
    b2.fill('k', jitter=0.05)
    b2.rect('up', 0, 0, 2, 2, 'c'); b2.rect('up', 0, 9, 2, 2, 'c')
    for f in ('east', 'west'):
        b2.rect(f, 0, 0, 1, 1, 'c'); b2.rect(f, 10, 0, 1, 1, 'c')
    # винт лежит вокруг сустава (15, 21, 8)
    rotor.add(hub, (13.5, 20, 6.5))
    rotor.add(b1, (9.5, 20.5, 7))
    rotor.add(b2, (14, 20.6, 2.5), geo=(2, 0.8, 11))
    return m


MOBS = [psycho, drone]


def all_mobs():
    return [fn() for fn in MOBS]


# ----------------------------------------------------------------------------------------------
# Файлы пака
# ----------------------------------------------------------------------------------------------

def check_models(out):
    """Проверка готовых JSON так, как их читает игра: каждая грань — в долях 0–16, и по ним находится нужный кусок картинки."""
    n = 0
    for path, data in out.items():
        if not path.startswith('assets/kniga/models/cyber/mob/'):
            continue
        m = json.loads(data.decode('utf-8'))
        for e in m['elements']:
            for f, face in e['faces'].items():
                u = face['uv']
                assert len(u) == 4 and all(0.0 <= v <= 16.0 for v in u), '%s: грань %s вне 0–16: %s' % (path, f, u)
                px = [v * SIZE / 16.0 for v in u]
                assert all(abs(v - round(v)) < 1e-6 for v in px), '%s: грань %s не по пикселям: %s' % (path, f, u)
                n += 1
    return n


def files(png_bytes, mobs=None):
    """путь в архиве → байты; плюс список (имя части, CustomModelData, модель) для переопределений предмета."""
    out = {}
    models = []
    for m in (mobs if mobs is not None else all_mobs()):
        out['assets/kniga/textures/item/cyber/mob/%s.png' % m.name] = png_bytes(m.sheet.image())
        for p in m.parts:
            name = '%s_%s' % (m.name, p.name)
            out['assets/kniga/models/cyber/mob/%s.json' % name] = json.dumps(p.model(m.tex_ref()), indent=1).encode('utf-8')
            models.append((p.cmd, 'kniga:cyber/mob/%s' % name))
    check_models(out)
    return out, models


# ----------------------------------------------------------------------------------------------
# Предпросмотр: простой ортографический рендер кубиков с текстурой
# ----------------------------------------------------------------------------------------------

SHADE = {'up': 1.0, 'down': 0.5, 'north': 0.8, 'south': 0.8, 'east': 0.6, 'west': 0.6}


def face_frame(f, a, b):
    (x0, y0, z0), (x1, y1, z1) = a, b
    return {
        'north': ((x1, y1, z0), (-1, 0, 0), (0, -1, 0), x1 - x0, y1 - y0),
        'south': ((x0, y1, z1), (1, 0, 0), (0, -1, 0), x1 - x0, y1 - y0),
        'east': ((x1, y1, z1), (0, 0, -1), (0, -1, 0), z1 - z0, y1 - y0),
        'west': ((x0, y1, z0), (0, 0, 1), (0, -1, 0), z1 - z0, y1 - y0),
        'up': ((x0, y1, z0), (1, 0, 0), (0, 0, 1), x1 - x0, z1 - z0),
        'down': ((x0, y0, z0), (1, 0, 0), (0, 0, 1), x1 - x0, z1 - z0),
    }[f]


def render(mob, yaw_deg, scale=10, pose=None, h=None):
    """pose: {имя части: угол в градусах}, как в плагине: поворот вокруг сустава, положительный — назад, отрицательный — вперёд."""
    pose = pose or {}
    h = h or int(36 * scale)
    w = int(34 * scale)
    img = np.zeros((h, w, 3), np.float32) + np.array([24, 26, 40], np.float32)
    zb = np.full((h, w), 1e9, np.float32)
    tex = mob.sheet.px
    th = math.radians(yaw_deg)
    cs, sn = math.cos(th), math.sin(th)
    for p in mob.parts:
        ang = -math.radians(pose.get(p.name, 0))      # в плагине + это «назад», в модели (после разворота на 180°) это −x
        jy, jz = p.joint[1], p.joint[2]
        for box, frm, geo in p.items:
            a = frm
            b = (frm[0] + geo[0], frm[1] + geo[1], frm[2] + geo[2])
            for f in FACES:
                o, A, B, su, sv = face_frame(f, a, b)
                rx, ry, rw, rh = box.region(f)
                ns, nt = max(2, int(su * scale * 2)), max(2, int(sv * scale * 2))
                ss = (np.arange(ns) + 0.5) / ns
                tt = (np.arange(nt) + 0.5) / nt
                S, T = np.meshgrid(ss, tt)
                px = o[0] + A[0] * S * su + B[0] * T * sv
                py = o[1] + A[1] * S * su + B[1] * T * sv
                pz = o[2] + A[2] * S * su + B[2] * T * sv
                if ang:                                                 # поворот вокруг оси x через сустав
                    dy, dz = py - jy, pz - jz
                    py = jy + dy * math.cos(ang) - dz * math.sin(ang)
                    pz = jz + dy * math.sin(ang) + dz * math.cos(ang)
                x = px - 8
                z = pz - 8
                xr = x * cs + z * sn
                zr = -x * sn + z * cs
                sx = ((-xr) + 17) * scale
                sy = (36 - (py + 1)) * scale
                tx = np.clip((S * rw).astype(int), 0, rw - 1) + rx
                ty = np.clip((T * rh).astype(int), 0, rh - 1) + ry
                tc = tex[ty, tx].astype(np.float32)
                ix, iy = sx.astype(int), sy.astype(int)
                ok = (ix >= 0) & (ix < w) & (iy >= 0) & (iy < h) & (tc[..., 3] > 40)
                ix, iy, zz, tc = ix[ok], iy[ok], zr[ok], tc[ok]
                order = np.argsort(-zz)
                for k in order:
                    if zz[k] < zb[iy[k], ix[k]]:
                        zb[iy[k], ix[k]] = zz[k]
                        al = tc[k][3] / 255.0
                        img[iy[k], ix[k]] = img[iy[k], ix[k]] * (1 - al) + tc[k][:3] * SHADE[f] * al
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB')


def with_left_rotor(m):
    """В игре левый винт — второй дисплей с той же моделью; для предпросмотра добавляем его копией."""
    if m.name == 'drone':
        r = [p for p in m.parts if p.name == 'rotor'][0]
        q = Part('rotor_l', r.cmd, (1, 21, 8))
        q.items = [(b, (f[0] - 14, f[1], f[2]), g) for (b, f, g) in r.items]
        m.parts.append(q)
    return m


def preview(path):
    mobs = [with_left_rotor(m) for m in all_mobs()]
    sc = 8
    views = [0, 40, 90, 180]
    ims = []
    for m in mobs:
        pose = {}
        row = [render(m, v, sc, pose) for v in views]
        if m.name == 'psycho':
            row.append(render(m, 40, sc, {'arm_r': -75, 'arm_l': -75}))                  # руки вперёд
            row.append(render(m, 90, sc, {'leg_r': 35, 'leg_l': -35, 'arm_r': -35, 'arm_l': 35}))   # шаг
        else:
            row.append(render(m, 40, sc, {}))
        ims.append(row)
    W = max(sum(i.width for i in r) for r in ims)
    H = sum(r[0].height for r in ims)
    sheet = Image.new('RGB', (W, H), (24, 26, 40))
    y = 0
    for r in ims:
        x = 0
        for i in r:
            sheet.paste(i, (x, y))
            x += i.width
        y += r[0].height
    sheet.save(os.path.join(path, 'mobs.png'))
    for m in mobs:
        big = m.sheet.image().resize((SIZE * 8, SIZE * 8), Image.NEAREST)
        bg = Image.new('RGBA', big.size, (60, 60, 70, 255))
        bg.alpha_composite(big)
        bg.save(os.path.join(path, 'tex_%s.png' % m.name))


def table():
    """Положения суставов в блоках относительно мобa (локальная ось x направлена влево от персонажа) — для Java."""
    for m in all_mobs():
        for p in m.parts:
            jx = -(p.joint[0] - 8) / 16.0
            print('%s %-7s cmd=%d  jx=%+.5f jy=%.5f jz=%+.5f' % (m.name, p.name, p.cmd, jx, p.joint[1] / 16.0, -(p.joint[2] - 8) / 16.0))


if __name__ == '__main__':
    if len(sys.argv) > 1:
        os.makedirs(sys.argv[1], exist_ok=True)
        preview(sys.argv[1])
    table()
