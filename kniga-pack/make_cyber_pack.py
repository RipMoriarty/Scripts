#!/usr/bin/env python3
"""Собирает ресурспак «Книга Судеб» с киберпанком.

Берёт готовый пак с пластинками героев (базовый zip) и добавляет к нему:
  * 10 иконок предметов (6 имплантов и 4 детали) с моделями по CustomModelData,
  * модели киберпсихов и дронов-стрелков (детали-«дисплеи», см. cyber_mobs.py; они же подключаются через CustomModelData),
  * свои звуки: установка импланта, Сандевистан, сдача деталей, фоновая музыка города (всё синтезируется кодом).

Запуск:  python3 make_cyber_pack.py <базовый.zip> <выход.zip> [каталог-для-предпросмотра]
Нужны только Pillow, numpy и ffmpeg (libvorbis). Результат от запуска к запуску одинаковый.
Рядом должен лежать cyber_mobs.py.
"""
import json
import math
import os
import subprocess
import sys
import tempfile
import zipfile

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cyber_mobs  # noqa: E402
import realm_mobs  # noqa: E402
import realm_pack  # noqa: E402

SR = 44100

# ----------------------------------------------------------------------------------------------
# Иконки 16×16
# ----------------------------------------------------------------------------------------------

PAL = {
    'k': (0x0d, 0x0e, 0x1c), 'g': (0x2b, 0x2f, 0x45), 'G': (0x5c, 0x62, 0x7d), 'w': (0xee, 0xf0, 0xff),
    'c': (0x19, 0xe3, 0xff), 'C': (0x0b, 0x8a, 0xa8), 'm': (0xff, 0x2b, 0xd6), 'M': (0x9b, 0x13, 0x7f),
    'y': (0xff, 0xd2, 0x3f), 'Y': (0xb8, 0x86, 0x1c), 'l': (0x7d, 0xff, 0x4f), 'L': (0x2f, 0x9e, 0x2a),
    'o': (0xff, 0x7a, 0x1a), 'O': (0xb3, 0x45, 0x0a), 'r': (0xff, 0x33, 0x55), 'p': (0x8a, 0x4d, 0xff),
    'P': (0xc9, 0xa2, 0xff), 'T': (0x0a, 0x3d, 0x4c), 'b': (0x2d, 0x6b, 0xff), 's': (0xc9, 0xd2, 0xe6),
}


class Icon:
    def __init__(self):
        self.p = [[None] * 16 for _ in range(16)]

    def px(self, x, y, c):
        if 0 <= x < 16 and 0 <= y < 16:
            self.p[y][x] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.px(x, y, c)

    def line(self, x0, y0, x1, y1, c):
        n = max(abs(x1 - x0), abs(y1 - y0), 1)
        for i in range(n + 1):
            self.px(round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n), c)

    def disc(self, cx, cy, r0, r1, c):
        for y in range(16):
            for x in range(16):
                d = math.hypot(x - cx, y - cy)
                if r0 <= d <= r1:
                    self.px(x, y, c)

    def rows(self, y0, spans, c):
        """spans: список (x0, x1) для строк, начиная с y0."""
        for i, (a, b) in enumerate(spans):
            self.rect(a, y0 + i, b, y0 + i, c)

    def outline(self, c='k'):
        src = [row[:] for row in self.p]
        for y in range(16):
            for x in range(16):
                if src[y][x] is not None:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < 16 and 0 <= ny < 16 and src[ny][nx] is not None:
                        self.p[y][x] = c
                        break

    def image(self):
        im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
        for y in range(16):
            for x in range(16):
                c = self.p[y][x]
                if c is not None:
                    im.putpixel((x, y), PAL[c] + (255,))
        return im


def icon_sandevistan():
    i = Icon()
    i.rect(3, 2, 12, 13, 'g')
    i.rect(3, 2, 12, 2, 'G')
    i.rect(3, 2, 3, 13, 'G')
    for y in (4, 7, 10):                                     # контакты по бокам
        i.rect(1, y, 2, y, 'c')
        i.rect(13, y, 14, y, 'c')
    for pts in (((8, 3), (9, 3)), ((7, 4), (8, 4)), ((6, 5), (7, 5)), ((5, 6), (6, 6), (7, 6), (8, 6), (9, 6)),
                ((7, 7), (8, 7)), ((6, 8), (7, 8)), ((5, 9), (6, 9)), ((5, 10),)):
        for x, y in pts:
            i.px(x, y, 'y')
    i.px(8, 3, 'w')
    i.px(9, 3, 'w')
    i.rect(4, 12, 11, 12, 'M')                               # неоновая полоска снизу
    i.rect(5, 12, 7, 12, 'm')
    i.outline()
    return i


def icon_blades():
    i = Icon()
    i.rect(1, 12, 9, 15, 'g')                                # наручь
    i.rect(1, 12, 9, 12, 'G')
    i.rect(2, 14, 8, 14, 'm')
    for x0, y0, x1, y1 in ((3, 11, 11, 3), (8, 12, 15, 5)):  # два клинка рядом
        i.line(x0, y0, x1, y1, 's')
        i.line(x0 + 1, y0, x1 + 1, y1, 'w')
        i.line(x0, y0 + 1, x1, y1 + 1, 'c')
        i.px(x1 + 1, y1, 'w')
    i.outline()
    return i


def icon_fist():
    i = Icon()
    i.rect(3, 7, 13, 12, 'g')                                 # ладонь
    for x in (3, 6, 9, 12):                                   # четыре пальца-костяшки с зазорами
        i.rect(x, 4, x + 1, 8, 'G')
        i.px(x, 4, 'o')
        i.px(x + 1, 4, 'o')
        i.px(x, 5, 'O')
        i.px(x + 1, 5, 'O')
    i.rect(2, 10, 7, 12, 'G')                                 # большой палец поперёк
    i.rect(2, 10, 3, 11, 'o')
    i.rect(5, 13, 11, 15, 'g')                                # запястье
    i.rect(5, 13, 11, 13, 'G')
    i.px(9, 9, 'y')
    i.px(10, 10, 'o')
    i.px(11, 9, 'o')
    i.outline()
    return i


def icon_optics():
    i = Icon()
    spans = [(5, 10), (3, 12), (2, 13), (1, 14), (1, 14), (2, 13), (3, 12), (5, 10)]
    i.rows(4, spans, 'w')
    i.disc(7.5, 7.5, 0, 3.4, 'c')
    i.disc(7.5, 7.5, 2.4, 3.4, 'C')
    i.rect(7, 7, 8, 8, 'k')
    i.px(6, 6, 'w')
    for x, y in ((0, 7), (0, 8), (15, 7), (15, 8), (7, 0), (8, 0), (7, 15), (8, 15)):   # прицельные риски
        i.px(x, y, 'm')
    i.outline()
    return i


def icon_armor():
    i = Icon()
    spans = [(5, 10), (3, 12), (2, 13), (2, 13), (2, 13), (2, 13), (2, 13), (2, 13), (3, 12), (4, 11), (5, 10), (6, 9), (7, 8)]
    i.rows(1, spans, 'G')
    inner = [(6, 9), (4, 11), (3, 12), (3, 12), (3, 12), (3, 12), (3, 12), (3, 12), (4, 11), (5, 10), (6, 9), (7, 8)]
    i.rows(2, inner[:11], 'g')
    for y in range(4, 12):
        i.px(7, y, 'c')
        i.px(8, y, 'c')
    i.rect(4, 6, 11, 6, 'C')
    i.rect(5, 9, 10, 9, 'C')
    i.px(7, 6, 'c')
    i.px(8, 6, 'c')
    for x, y in ((3, 3), (12, 3), (3, 10), (12, 10)):
        i.px(x, y, 'w')
    i.outline()
    return i


def icon_legs():
    i = Icon()
    i.rect(4, 1, 11, 2, 'G')                                  # верхняя плита
    i.rect(4, 13, 11, 14, 'G')                                # нижняя плита
    for y in (4, 7, 10):                                      # витки пружины
        i.rect(3, y, 12, y, 'l')
        i.rect(3, y + 1, 12, y + 1, 'L')
    for x, y in ((3, 6), (12, 3), (3, 9), (12, 6), (12, 9), (3, 12)):
        i.px(x, y, 'L')
    i.px(12, 12, 'L')
    i.px(7, 3, 'c')
    i.px(8, 3, 'c')
    i.px(6, 12, 'c')
    i.px(9, 12, 'c')
    i.outline()
    return i


def icon_chip():
    i = Icon()
    i.rect(1, 1, 14, 14, 'T')
    i.rect(1, 1, 14, 1, 'C')
    i.rect(1, 1, 1, 14, 'C')
    for y in (3, 12):
        i.rect(2, y, 4, y, 'c')
        i.rect(11, y, 13, y, 'c')
    i.line(4, 3, 4, 5, 'c')
    i.line(11, 3, 11, 5, 'c')
    i.line(4, 12, 4, 10, 'c')
    i.line(11, 12, 11, 10, 'c')
    i.rect(5, 5, 10, 10, 'k')
    i.rect(6, 6, 9, 9, 'g')
    i.px(6, 6, 'w')
    for k in (6, 8):                                          # ножки микросхемы
        i.px(4, k, 'y')
        i.px(11, k, 'y')
        i.px(k, 4, 'y')
        i.px(k, 11, 'y')
    i.px(2, 7, 'm')
    i.px(13, 7, 'm')
    i.outline()
    return i


def icon_wire():
    i = Icon()
    i.rect(2, 4, 13, 12, 'o')                                 # намотка
    for x in range(3, 13, 2):
        i.rect(x, 4, x, 12, 'O')
    i.rect(2, 4, 13, 5, 'o')
    for x in range(2, 14, 2):
        i.px(x, 4, 'y')
        i.px(x, 5, 'y')
    i.rect(1, 3, 2, 13, 'G')                                  # щёчки катушки
    i.rect(13, 3, 14, 13, 'G')
    i.rect(1, 3, 14, 3, 'G')
    i.rect(1, 13, 14, 13, 'g')
    i.line(14, 12, 15, 14, 'o')
    i.px(15, 14, 'y')
    i.outline()
    return i


def icon_gel():
    i = Icon()
    i.disc(7.5, 10, 0, 5.4, 'C')                               # стекло
    i.disc(7.5, 10, 0, 4.4, 'm')                               # гель
    i.rect(6, 3, 9, 6, 'C')
    i.rect(7, 4, 8, 6, 'm')
    i.rect(5, 2, 10, 3, 'G')
    for x, y in ((5, 8), (6, 8), (5, 9)):
        i.px(x, y, 'w')
    i.px(9, 12, 'M')
    i.px(10, 11, 'M')
    i.px(7, 12, 'P')
    i.rect(5, 14, 10, 14, 'M')
    i.outline()
    return i


def icon_battery():
    i = Icon()
    spans = [(7, 8), (6, 9), (5, 10), (5, 10), (5, 10), (5, 10), (5, 10), (5, 10), (5, 10), (5, 10), (6, 9), (7, 8)]
    i.rows(2, spans, 'p')
    for y in range(3, 12):                                    # светлая грань справа
        i.rect(8, y, 10 if 4 <= y <= 11 else 9, y, 'P')
    i.rect(6, 0, 9, 1, 'G')                                   # контакт
    i.rect(7, 0, 8, 0, 'y')
    for x, y in ((9, 4), (8, 5), (7, 6), (6, 7), (9, 7), (8, 8), (7, 9)):
        i.px(x, y, 'c')
    i.px(6, 4, 'w')
    i.px(6, 5, 'w')
    i.outline()
    return i


ICONS = {
    'sandevistan': icon_sandevistan, 'klinki': icon_blades, 'gorilly': icon_fist, 'optika': icon_optics,
    'bronya': icon_armor, 'nogi': icon_legs,
    'mikroskhema': icon_chip, 'provod': icon_wire, 'neirogel': icon_gel, 'akkumulyator': icon_battery,
}

# какой ванильный предмет заменяем и под каким CustomModelData (должно совпадать с Implants.java и Cyber.java)
MODELS = [
    ('sandevistan', 'glow_ink_sac', 7101), ('klinki', 'prismarine_crystals', 7102), ('gorilly', 'netherite_scrap', 7103),
    ('optika', 'ender_eye', 7104), ('bronya', 'iron_nugget', 7105), ('nogi', 'echo_shard', 7106),
    ('mikroskhema', 'repeater', 7201), ('provod', 'copper_ingot', 7202), ('neirogel', 'slime_ball', 7203),
    ('akkumulyator', 'amethyst_shard', 7204),
]


# ----------------------------------------------------------------------------------------------
# Звуки
# ----------------------------------------------------------------------------------------------

def t_of(sec):
    return np.arange(int(sec * SR)) / SR


def env_ad(n, a, d):
    """Быстрая атака и спад по экспоненте."""
    t = np.arange(n) / SR
    e = np.exp(-t / max(d, 1e-4))
    att = np.minimum(1.0, t / max(a, 1e-4))
    return e * att


def saw(f, t, partials=14):
    s = np.zeros_like(t)
    f = np.broadcast_to(f, t.shape)
    for k in range(1, partials + 1):
        s += np.sin(2 * math.pi * np.cumsum(f * k) / SR) / k * (1 if k % 2 else 1)
    return s * (2 / math.pi)


def sine_sweep(f0, f1, sec, expo=True):
    t = t_of(sec)
    frac = t / sec
    f = f0 * (f1 / f0) ** frac if expo else f0 + (f1 - f0) * frac
    return np.sin(2 * math.pi * np.cumsum(f) / SR), f


def lowpass(x, cutoff, order=2):
    """Простой фильтр через БПФ: плавный спад выше частоты среза."""
    n = len(x)
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(n, 1 / SR)
    H = 1.0 / (1.0 + (fr / cutoff) ** (2 * order))
    return np.fft.irfft(X * H, n)


def highpass(x, cutoff, order=2):
    return x - lowpass(x, cutoff, order)


def bandpass(x, lo, hi):
    return lowpass(highpass(x, lo), hi)


def noise(n, seed):
    return np.random.RandomState(seed).uniform(-1, 1, n)


def put(dst, src, at):
    i = int(at * SR)
    n = min(len(src), len(dst) - i)
    if n > 0:
        dst[i:i + n] += src[:n]


def bitcrush(x, step):
    out = np.repeat(x[::step], step)[:len(x)]
    return out


def echo(x, delay, fb, taps):
    out = x.copy()
    d = int(delay * SR)
    for k in range(1, taps + 1):
        sh = np.zeros_like(x)
        sh[d * k:] = x[:len(x) - d * k] * (fb ** k) if d * k < len(x) else 0
        out += sh
    return out


def norm(x, peak=0.85):
    m = np.max(np.abs(x))
    return x * (peak / m) if m > 0 else x


def fade_out(x, sec):
    n = int(sec * SR)
    x[-n:] *= np.linspace(1, 0, n)
    return x


def snd_install():
    out = np.zeros(int(1.5 * SR))
    # серво: короткие рывки
    for k in range(5):
        at = 0.04 + k * 0.095
        t = t_of(0.07)
        f = 70 + k * 18
        s = saw(np.full_like(t, f), t, 10) * env_ad(len(t), 0.004, 0.03)
        put(out, lowpass(s, 900) * 0.7, at)
        put(out, bandpass(noise(len(t), 10 + k), 1500, 5000) * env_ad(len(t), 0.002, 0.02) * 0.25, at)
    # разряд
    t = t_of(0.18)
    zap, _ = sine_sweep(3200, 380, 0.18)
    put(out, zap * env_ad(len(t), 0.001, 0.05) * 0.5, 0.55)
    put(out, highpass(noise(len(t), 77), 3000) * env_ad(len(t), 0.001, 0.04) * 0.55, 0.55)
    # подтверждение с цифровым дребезгом
    for j, (f, at) in enumerate(((880, 0.78), (1320, 0.92), (1760, 1.06))):
        t = t_of(0.38)
        s = (np.sin(2 * math.pi * f * t) + 0.35 * np.sin(2 * math.pi * f * 2.01 * t)) * env_ad(len(t), 0.003, 0.09)
        s = bitcrush(s, 3 if j < 2 else 1)
        put(out, s * 0.33, at)
    return norm(echo(out, 0.11, 0.3, 3))


def snd_sandevistan_on():
    sec = 2.2
    out = np.zeros(int(sec * SR))
    rise = 1.25
    t = t_of(rise)
    sw, f = sine_sweep(90, 1500, rise)
    trem = 0.6 + 0.4 * np.sin(2 * math.pi * np.cumsum(6 + 22 * (t / rise)) / SR)
    amp = (t / rise) ** 1.6
    body = (sw * 0.6 + saw(f * 0.5, t, 8) * 0.35) * trem * amp
    put(out, body, 0.0)
    wh = bandpass(noise(len(t), 3), 400, 6000)
    wh = np.abs(wh) * 0 + wh
    put(out, wh * (t / rise) ** 2.2 * 0.45, 0.0)
    # удар и «замедление»
    n = int(0.9 * SR)
    t2 = np.arange(n) / SR
    f0 = 110 * np.exp(-t2 * 6) + 45
    thump = np.sin(2 * math.pi * np.cumsum(f0) / SR) * np.exp(-t2 / 0.22)
    put(out, thump * 0.9, rise)
    put(out, highpass(noise(int(0.12 * SR), 5), 2500) * env_ad(int(0.12 * SR), 0.001, 0.025) * 0.5, rise)
    t3 = t_of(0.95)
    pad = np.zeros_like(t3)
    for fz, det in ((220, 0.4), (329.6, -0.3), (440, 0.2), (523.3, -0.5)):
        vib = 1 + 0.004 * np.sin(2 * math.pi * 5 * t3)
        pad += np.sin(2 * math.pi * np.cumsum((fz + det) * vib) / SR) * 0.25
    pad = lowpass(pad, 1800) * np.exp(-t3 / 0.35) * np.minimum(1, t3 / 0.02)
    put(out, pad * 0.5, rise)
    return norm(out)


def snd_sandevistan_off():
    sec = 1.9
    out = np.zeros(int(sec * SR))
    fall = 1.0
    t = t_of(fall)
    sw, f = sine_sweep(1000, 48, fall)
    body = (sw * 0.55 + lowpass(saw(f, t, 12), 1200) * 0.4) * np.exp(-t / 0.55) * np.minimum(1, t / 0.01)
    put(out, body, 0.0)
    # пар
    tn = t_of(0.9)
    hiss = bandpass(noise(len(tn), 21), 3000, 9000) * np.exp(-tn / 0.28)
    put(out, hiss * 0.5, 0.12)
    # остывание: щелчки
    for k, at in enumerate((1.05, 1.28, 1.52, 1.72)):
        n = int(0.025 * SR)
        click = np.sin(2 * math.pi * (1900 - k * 120) * np.arange(n) / SR) * np.exp(-np.arange(n) / SR / 0.006)
        put(out, click * 0.4, at)
    return norm(out)


def snd_deposit():
    out = np.zeros(int(0.7 * SR))
    for f, at, dur in ((1046.5, 0.0, 0.12), (1568.0, 0.1, 0.22)):
        t = t_of(dur + 0.2)
        s = np.sign(np.sin(2 * math.pi * f * t)) * 0.4 + np.sin(2 * math.pi * f * t) * 0.6
        s = lowpass(s, 4200) * env_ad(len(t), 0.002, dur * 0.5)
        put(out, bitcrush(s, 2), at)
    return norm(echo(out, 0.09, 0.35, 2), 0.8)


def snd_complete():
    sec = 3.0
    out = np.zeros(int(sec * SR))
    notes = (220.0, 261.63, 329.63, 440.0, 523.25, 659.25)
    for k, f in enumerate(notes):
        t = t_of(0.7)
        s = lowpass(saw(np.full_like(t, f), t, 14), 3000) * env_ad(len(t), 0.004, 0.16)
        put(out, s * 0.35, 0.02 + k * 0.1)
    t = t_of(2.2)
    pad = np.zeros_like(t)
    for f in (220.0, 329.63, 440.0, 523.25):
        for d in (-0.6, 0.6):
            pad += saw(np.full_like(t, f + d), t, 10) * 0.1
    pad = lowpass(pad, 2200) * np.minimum(1, t / 0.15) * np.exp(-t / 0.9)
    put(out, pad, 0.65)
    return norm(echo(out, 0.17, 0.35, 5), 0.85)


# фоновая музыка города: 24 такта по 90 ударов в минуту = ровно 64 секунды
BPM = 90
BEAT = 60.0 / BPM
BARS = 24
AMBIENT_SECONDS = int(round(BARS * 4 * BEAT))        # 64
CHORDS = [  # (название, басовая нота, ноты аккорда) по 2 такта: Am – F – C – G
    ('Am', 55.0, (220.0, 261.63, 329.63, 440.0)),
    ('F', 43.65, (174.61, 220.0, 261.63, 349.23)),
    ('C', 65.41, (196.0, 261.63, 329.63, 392.0)),
    ('G', 49.0, (196.0, 246.94, 293.66, 392.0)),
]


# громкость слоёв фона относительно друг друга (подобрано по уровню в частотных полосах)
AMBIENT_GAIN = {'pad': 1.0, 'bass': 0.15, 'arp': 3.0, 'kick': 0.2, 'hat': 0.6, 'rain': 2.0}


def snd_ambient(debug=None):
    n = AMBIENT_SECONDS * SR
    lay = {k: [np.zeros(n), np.zeros(n)] for k in AMBIENT_GAIN}
    t_all = np.arange(n) / SR
    chord_len = 2 * 4 * BEAT                              # такта на аккорд
    steps = BARS * 4 * 4                                  # шестнадцатые
    sixt = BEAT / 4

    def add(name, i0, left, right):
        idx = (np.arange(len(left)) + i0) % n             # по кругу: хвосты уходят в начало, петля не рвётся
        np.add.at(lay[name][0], idx, left)
        np.add.at(lay[name][1], idx, right)

    # пэд: каждый аккорд плывёт и перетекает в следующий
    for ci in range(BARS // 2):
        name, bass, notes = CHORDS[ci % 4]
        seg = int((chord_len + 1.2) * SR)
        t = np.arange(seg) / SR
        env = np.minimum(1, t / 1.1) * np.minimum(1, np.maximum(0, (chord_len + 1.2 - t)) / 1.2)
        padL = np.zeros(seg)
        padR = np.zeros(seg)
        for f in notes:
            for d, pan in ((-0.7, 0.3), (0.0, 0.5), (0.7, 0.7)):
                v = saw(np.full(seg, f + d), t, 6) * 0.045
                padL += v * (1 - pan)
                padR += v * pan
        add('pad', int(ci * chord_len * SR), lowpass(padL, 1100) * env, lowpass(padR, 1100) * env)

    # бас: пульс, мягкая атака
    pat = (1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0)
    for st in range(steps):
        if not pat[st % 16]:
            continue
        name, bass, notes = CHORDS[int((st * sixt) // chord_len) % 4]
        seg = int(0.55 * SR)
        t = np.arange(seg) / SR
        v = (np.sin(2 * math.pi * bass * t) + 0.5 * saw(np.full(seg, bass), t, 5)) * np.exp(-t / 0.2) * np.minimum(1, t / 0.004)
        v = lowpass(v, 380) * 0.5
        add('bass', int(st * sixt * SR), v, v)

    # арпеджио шестнадцатыми с эхом «в ритме с точкой»
    arp_order = (0, 2, 1, 3, 2, 1, 3, 2)
    for st in range(steps):
        if st % 2 == 1 and (st % 8) not in (3, 7):
            continue
        notes = CHORDS[int((st * sixt) // chord_len) % 4][2]
        f = notes[arp_order[(st // 2) % 8] % len(notes)] * 2
        seg = int(0.5 * SR)
        t = np.arange(seg) / SR
        v = lowpass(saw(np.full(seg, f), t, 9), 2600) * np.exp(-t / 0.09) * np.minimum(1, t / 0.003) * 0.075
        pan = 0.35 + 0.3 * ((st // 2) % 2)
        i0 = int(st * sixt * SR)
        for k, g in enumerate((1.0, 0.45, 0.2)):
            add('arp', i0 + int(k * BEAT * 0.75 * SR), v * g * (1 - pan), v * g * pan)

    # бочка на 1 и 3 долях и тихий хэт на «и»
    for beat in range(BARS * 4):
        i0 = int(beat * BEAT * SR)
        if beat % 2 == 0:
            seg = int(0.35 * SR)
            t = np.arange(seg) / SR
            f = 38 + 90 * np.exp(-t * 28)
            v = np.sin(2 * math.pi * np.cumsum(f) / SR) * np.exp(-t / 0.11) * 0.33
            add('kick', i0, v, v)
        seg = int(0.06 * SR)
        h = highpass(noise(seg, 1000 + beat), 6500) * np.exp(-np.arange(seg) / SR / 0.012) * np.minimum(1, np.arange(seg) / SR / 0.0015) * 0.05
        add('hat', i0 + int(BEAT / 2 * SR), h, h * 0.8)

    # дождь
    sway = 0.7 + 0.3 * np.sin(2 * math.pi * t_all / AMBIENT_SECONDS * 3)
    lay['rain'][0] += bandpass(noise(n, 4242), 2500, 9000) * 0.028 * sway
    lay['rain'][1] += bandpass(noise(n, 4243), 2500, 9000) * 0.028 * sway

    if debug is not None:
        for k, (l, r) in lay.items():
            debug[k] = float(np.sqrt((l ** 2).mean()))
    L = sum(lay[k][0] * AMBIENT_GAIN[k] for k in lay)
    R = sum(lay[k][1] * AMBIENT_GAIN[k] for k in lay)

    # «зал» вокруг: несколько долгих эхо по кругу
    for dly, g in ((0.173, 0.28), (0.287, 0.22), (0.419, 0.16)):
        sh = int(dly * SR)
        L = L + np.roll(R, sh) * g
        R = R + np.roll(L, sh + 37) * g

    m = max(np.max(np.abs(L)), np.max(np.abs(R)))
    L, R = L * (0.8 / m), R * (0.8 / m)
    return np.stack([L, R], axis=1)


def write_ogg(path, data, channels):
    pcm = (np.clip(data, -1, 1) * 32767).astype('<i2')
    with tempfile.TemporaryDirectory() as d:
        raw = os.path.join(d, 'a.raw')
        with open(raw, 'wb') as f:
            f.write(pcm.tobytes())
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', str(channels),
                        '-i', raw, '-c:a', 'libvorbis', '-q:a', '4', '-ar', str(SR), '-map_metadata', '-1', '-fflags', '+bitexact',
                        '-flags:a', '+bitexact', path], check=True)


SOUNDS = [  # событие, файл, функция, каналов, стрим
    ('cyber.install', 'cyber/install', snd_install, 1, False),
    ('cyber.sandevistan_on', 'cyber/sandevistan_on', snd_sandevistan_on, 1, False),
    ('cyber.sandevistan_off', 'cyber/sandevistan_off', snd_sandevistan_off, 1, False),
    ('cyber.deposit', 'cyber/deposit', snd_deposit, 1, False),
    ('cyber.complete', 'cyber/complete', snd_complete, 1, False),
    ('cyber.ambient', 'cyber/ambient', snd_ambient, 2, True),
]

# миры-походы (средневековье, мир богов смерти): иконки, номера моделей и звуки живут в realm_pack.py
_SELF = sys.modules[__name__]
ICONS.update(realm_pack.icons(_SELF))
MODELS.extend(realm_pack.MODELS)
SOUNDS.extend(realm_pack.sounds(_SELF))


# ----------------------------------------------------------------------------------------------
# Сборка
# ----------------------------------------------------------------------------------------------

def png_bytes(im):
    import io
    b = io.BytesIO()
    im.save(b, 'PNG', optimize=True)
    return b.getvalue()


def check_pack(files):
    """Ссылки между файлами так, как их читает игра (1.20.1): модели найдены, текстуры лежат в папках атласа, номера не повторяются."""
    for path, data in files.items():
        if not (path.startswith('assets/') and '/models/' in path and path.endswith('.json')):
            continue
        m = json.loads(data.decode('utf-8'))
        for tex in m.get('textures', {}).values():
            ns, _, rel = tex.partition(':') if ':' in tex else ('minecraft', '', tex)
            if ns == 'minecraft':
                continue                                       # ванильные текстуры есть в самой игре
            assert rel.startswith(('item/', 'block/')), '%s: текстура %s вне папок атласа block/ и item/ (игра покажет «пропавшую»)' % (path, tex)
            assert 'assets/%s/textures/%s.png' % (ns, rel) in files, '%s: нет текстуры %s' % (path, tex)
        for e in m.get('elements', []):
            for f, face in e['faces'].items():
                assert all(0.0 <= v <= 16.0 for v in face['uv']), '%s: грань %s вне 0–16' % (path, f)
        if path.startswith('assets/minecraft/models/item/'):
            cmds = [o['predicate']['custom_model_data'] for o in m.get('overrides', [])]
            assert cmds == sorted(cmds) and len(set(cmds)) == len(cmds), '%s: номера моделей' % path
            for o in m.get('overrides', []):
                ns, _, rel = o['model'].partition(':')
                assert 'assets/%s/models/%s.json' % (ns, rel) in files, '%s: нет модели %s' % (path, o['model'])


def build(base, out, preview=None):
    files = {}                                              # путь в архиве -> байты
    with zipfile.ZipFile(base) as z:
        for n in z.namelist():
            if not n.endswith('/'):
                files[n] = z.read(n)

    mc = json.loads(files['pack.mcmeta'].decode('utf-8'))
    mc['pack']['description'] = '§6Книга Судеб §7— пластинки героев, ночной город, королевство и мир богов смерти'
    files['pack.mcmeta'] = json.dumps(mc, ensure_ascii=False, indent=2).encode('utf-8')

    imgs = {}
    def ipath(name):                                        # иконки города лежат в item/cyber, миров — в item/medieval и item/shinigami
        return name if '/' in name else 'cyber/' + name

    for name, fn in ICONS.items():
        im = fn().image()
        imgs[name] = im
        files['assets/kniga/textures/item/%s.png' % ipath(name)] = png_bytes(im)
        files['assets/kniga/models/item/%s.json' % ipath(name)] = json.dumps(
            {'parent': 'minecraft:item/generated', 'textures': {'layer0': 'kniga:item/%s' % ipath(name)}}, indent=2).encode('utf-8')

    by_base = {}
    for name, base_item, cmd in MODELS:
        by_base.setdefault(base_item, []).append((cmd, 'kniga:item/%s' % ipath(name)))

    for mobs in (cyber_mobs, realm_mobs):
        mob_files, mob_models = mobs.files(png_bytes)
        files.update(mob_files)
        for cmd, model in mob_models:                      # детали моделей мобов — предметы на основе светящегося мешочка
            by_base.setdefault('glow_ink_sac', []).append((cmd, model))

    for base_item, lst in by_base.items():
        # предикат custom_model_data срабатывает «от и выше», побеждает последний подходящий, поэтому — по возрастанию
        lst.sort()
        model = {'parent': realm_pack.PARENT.get(base_item, 'minecraft:item/generated'), 'textures': {'layer0': 'minecraft:item/%s' % base_item},
                 'overrides': [{'predicate': {'custom_model_data': cmd}, 'model': path} for cmd, path in lst]}
        files['assets/minecraft/models/item/%s.json' % base_item] = json.dumps(model, indent=2).encode('utf-8')

    events = {}
    with tempfile.TemporaryDirectory() as d:
        for ev, rel, fn, ch, stream in SOUNDS:
            p = os.path.join(d, os.path.basename(rel) + '.ogg')
            write_ogg(p, fn(), ch)
            files['assets/kniga/sounds/%s.ogg' % rel] = open(p, 'rb').read()
            events[ev] = {'sounds': [{'name': 'kniga:%s' % rel, 'stream': stream}]}
    files['assets/kniga/sounds.json'] = json.dumps(events, indent=2).encode('utf-8')

    check_pack(files)
    order = sorted(files)
    with zipfile.ZipFile(out, 'w') as z:
        for n in order:
            zi = zipfile.ZipInfo(n, (2026, 11, 8, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_STORED if n.endswith('.ogg') else zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, files[n])

    if preview:
        os.makedirs(preview, exist_ok=True)
        names = list(ICONS)
        scale, cols = 8, 10
        rowsn = (len(names) + cols - 1) // cols
        sheet = Image.new('RGBA', (cols * 16 * scale + (cols + 1) * 8, rowsn * 16 * scale + (rowsn + 1) * 8), (30, 32, 48, 255))
        for k, name in enumerate(names):
            big = imgs[name].resize((16 * scale, 16 * scale), Image.NEAREST)
            x = 8 + (k % cols) * (16 * scale + 8)
            y = 8 + (k // cols) * (16 * scale + 8)
            sheet.alpha_composite(big, (x, y))
        sheet.save(os.path.join(preview, 'icons.png'))
        # настоящий размер в инвентаре (3×) для проверки читаемости
        small = Image.new('RGBA', (cols * 52 + 4, rowsn * 52 + 4), (60, 60, 70, 255))
        for k, name in enumerate(names):
            small.alpha_composite(imgs[name].resize((48, 48), Image.NEAREST), (4 + (k % cols) * 52, 4 + (k // cols) * 52))
        small.save(os.path.join(preview, 'icons_small.png'))
        realm_mobs.preview(preview)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    build(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
    print('OK', AMBIENT_SECONDS, 'с фон')
