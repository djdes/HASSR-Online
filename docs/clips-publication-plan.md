# План публикации роликов «Журналы, которые заполняются сами»

Составлен 07.11.2026. Пять вертикальных роликов по 15 секунд (1080×1920, без звука) — архив
`wesetup-clips-2026-11.zip`: ролик `.mp4`, обложка `.jpg` и тексты к публикации для каждой площадки.

## Где и когда

- **VK Клипы** и **Telegram-канал** WeSetup — один и тот же ролик в один день.
  Канал MAX — по желанию, текстом для Telegram (ссылка с меткой `utm_source=max` — в файле `-max.txt`).
- По ролику в 2–3 дня: понедельник, среда, пятница, в 12:00 по Москве. Время одно и то же — так проще сравнить ролики
  между собой; если по статистике аудитория активнее в другое время, сдвиньте все публикации.
- Звука нет: при публикации можно добавить фоновую музыку из библиотеки площадки.

| Дата | Ролик | Файл |
| --- | --- | --- |
| пн, 9 ноября, 12:00 | 01 · Датчики: Температура пишется сама | `autofill-clip-01-sensors.mp4` |
| ср, 11 ноября, 12:00 | 02 · Накладные: Приёмка — из накладной | `autofill-clip-02-invoices.mp4` |
| пт, 13 ноября, 12:00 | 03 · «Меркурий»: ВСД заполняют входной контроль | `autofill-clip-03-mercury.mp4` |
| пн, 16 ноября, 12:00 | 04 · Фото табло: Снимок вместо переписывания | `autofill-clip-04-photo.mp4` |
| ср, 18 ноября, 12:00 | 05 · График смен: Выходные и отпуска — из графика | `autofill-clip-05-schedule.mp4` |

## Как поставить заранее

- **Telegram:** в канале прикрепите ролик, вставьте текст и удерживайте кнопку отправки → «Отправить позже» → дата и время.
- **VK:** если площадка даёт отложить публикацию — выберите дату и время при публикации; если нет — публикуйте в день
  по плану: напоминания — в файле календаря `clips-publication-plan.ics` (импортируйте в Google, Яндекс или iPhone-календарь).

## Как понять, что работает

- Ссылка в каждом тексте ведёт на wesetup.ru/avtozapolnenie с метками: площадка (`utm_source=vk` или `telegram`),
  ролик (`utm_medium=clip`, `utm_campaign=autofill-<сцена>`). Регистрации по ним видны в ROOT → «Воронка» в строках
  «ВКонтакте» и «Telegram» и в понедельничной сводке в Telegram.
- На площадках смотрите просмотры и досмотры: какой ролик держит внимание до конца.
- Через две недели повторите лучший ролик с другим первым кадром или текстом; новые ролики собираются командой
  `npm run video:render:clips` (см. `scripts/landing-video/render-clips.ts`).

## Тексты к публикации

### пн, 9 ноября — Температура пишется сама

Файл: `autofill-clip-01-sensors.mp4`, обложка `autofill-clip-01-sensors.jpg`.

**VK Клипы** (`autofill-clip-01-sensors-vk.txt`):

```text
Температура пишется сама. Wi-Fi датчики раз в час заносят показания в журнал. Вышла за норму — руководителю точки приходит тревога.

Как это устроено: https://wesetup.ru/avtozapolnenie?utm_source=vk&utm_medium=clip&utm_campaign=autofill-sensors

#ХАССП #СанПиН #общепит #WeSetup
```

**Telegram-канал** (`autofill-clip-01-sensors-telegram.txt`):

```text
Температура пишется сама

Wi-Fi датчики раз в час заносят показания в журнал. Вышла за норму — руководителю точки приходит тревога.

Как это устроено и ролик на минуту: https://wesetup.ru/avtozapolnenie?utm_source=telegram&utm_medium=clip&utm_campaign=autofill-sensors
```

### ср, 11 ноября — Приёмка — из накладной

Файл: `autofill-clip-02-invoices.mp4`, обложка `autofill-clip-02-invoices.jpg`.

**VK Клипы** (`autofill-clip-02-invoices-vk.txt`):

```text
Приёмка — из накладной. Накладная iiko, Диадока или СБИС становится строками журнала приёмки. Температуру и решение вносит сотрудник.

Как это устроено: https://wesetup.ru/avtozapolnenie?utm_source=vk&utm_medium=clip&utm_campaign=autofill-invoices

#ХАССП #СанПиН #общепит #WeSetup
```

**Telegram-канал** (`autofill-clip-02-invoices-telegram.txt`):

```text
Приёмка — из накладной

Накладная iiko, Диадока или СБИС становится строками журнала приёмки. Температуру и решение вносит сотрудник.

Как это устроено и ролик на минуту: https://wesetup.ru/avtozapolnenie?utm_source=telegram&utm_medium=clip&utm_campaign=autofill-invoices
```

### пт, 13 ноября — ВСД заполняют входной контроль

Файл: `autofill-clip-03-mercury.mp4`, обложка `autofill-clip-03-mercury.jpg`.

**VK Клипы** (`autofill-clip-03-mercury-vk.txt`):

```text
ВСД заполняют входной контроль. Ветдокументы приходят сами. Гасит документ человек — после настоящей приёмки.

Как это устроено: https://wesetup.ru/avtozapolnenie?utm_source=vk&utm_medium=clip&utm_campaign=autofill-mercury

#ХАССП #СанПиН #общепит #WeSetup
```

**Telegram-канал** (`autofill-clip-03-mercury-telegram.txt`):

```text
ВСД заполняют входной контроль

Ветдокументы приходят сами. Гасит документ человек — после настоящей приёмки.

Как это устроено и ролик на минуту: https://wesetup.ru/avtozapolnenie?utm_source=telegram&utm_medium=clip&utm_campaign=autofill-mercury
```

### пн, 16 ноября — Снимок вместо переписывания

Файл: `autofill-clip-04-photo.mp4`, обложка `autofill-clip-04-photo.jpg`.

**VK Клипы** (`autofill-clip-04-photo-vk.txt`):

```text
Снимок вместо переписывания. Сфотографировали дисплей термометра — показание встало в журнал.

Как это устроено: https://wesetup.ru/avtozapolnenie?utm_source=vk&utm_medium=clip&utm_campaign=autofill-photo

#ХАССП #СанПиН #общепит #WeSetup
```

**Telegram-канал** (`autofill-clip-04-photo-telegram.txt`):

```text
Снимок вместо переписывания

Сфотографировали дисплей термометра — показание встало в журнал.

Как это устроено и ролик на минуту: https://wesetup.ru/avtozapolnenie?utm_source=telegram&utm_medium=clip&utm_campaign=autofill-photo
```

### ср, 18 ноября — Выходные и отпуска — из графика

Файл: `autofill-clip-05-schedule.mp4`, обложка `autofill-clip-05-schedule.jpg`.

**VK Клипы** (`autofill-clip-05-schedule-vk.txt`):

```text
Выходные и отпуска — из графика. Отметки «выходной», «отпуск», «больничный» сами проставляются в гигиеническом журнале.

Как это устроено: https://wesetup.ru/avtozapolnenie?utm_source=vk&utm_medium=clip&utm_campaign=autofill-schedule

#ХАССП #СанПиН #общепит #WeSetup
```

**Telegram-канал** (`autofill-clip-05-schedule-telegram.txt`):

```text
Выходные и отпуска — из графика

Отметки «выходной», «отпуск», «больничный» сами проставляются в гигиеническом журнале.

Как это устроено и ролик на минуту: https://wesetup.ru/avtozapolnenie?utm_source=telegram&utm_medium=clip&utm_campaign=autofill-schedule
```
