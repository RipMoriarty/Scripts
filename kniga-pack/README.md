# Книга Судеб — ресурспак пластинок

Ресурспак для Minecraft 1.20.1 (`pack_format` 15). Заменяет звуки ванильных музыкальных дисков темами героев сервера и переименовывает диски.

| Диск (ванильный) | Название | Герой |
|---|---|---|
| `music_disc_far` | Тема ослепшего воина | Артист |
| `music_disc_blocks` | Пока горю | Лиза |
| `music_disc_stal` | Вымарано | Даша |
| `music_disc_chirp` | Вяленая баллада | Баблик |
| `music_disc_ward` | Корни в багрянце | Вазелин |
| `music_disc_strad` | Рассвет без красок | Вран |
| `music_disc_mall` | Дом встаёт | Пельмешек |

## Подключение к серверу

В `server.properties`:

```properties
resource-pack=https://raw.githubusercontent.com/RipMoriarty/Scripts/kniga-pack/kniga-pack/KnigaPack.zip
resource-pack-sha1=f6a06c4b716f4b2ecdb9baacafc0517b0f85fd9a
```

Ссылка должна вести прямо на файл (формат `raw.githubusercontent.com`), а не на страницу GitHub. После правки перезапустите сервер.

## Если вы заменили zip

SHA-1 меняется с каждым новым файлом. Посчитайте его заново и обновите `resource-pack-sha1`:

```bash
sha1sum KnigaPack.zip
```

Клиенты кэшируют пак по SHA-1. Если не обновить хеш, игроки получат старую версию.

## Состав

- `pack.mcmeta`, `pack.png`
- `assets/minecraft/sounds/records/*.ogg` — моно, Vorbis, 44,1 кГц
- `assets/minecraft/lang/{ru_ru,en_us,uk_ua,be_by}.json` — названия дисков
