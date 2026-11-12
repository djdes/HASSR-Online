// Сгенерировано D:/presentations/wesetup-demo/source/tools/kb-export.py — снимки демо-базы
// «Столовая «Берёзка»» (03.11.2026) и метки из презентации. Руками не править.

export type KbShotMark = { n: number; title: string; text: string; warn: boolean; x: number; y: number; w: number; h: number };
export type KbShot = { id: string; src: string; w: number; h: number; phone: boolean; url: string | null; caption: string | null; sub: string | null; marks: KbShotMark[] };

export const KB_SHOTS: Record<string, KbShot> = {
  "access": {
    "id": "access",
    "src": "/kb/access.webp",
    "w": 1600,
    "h": 1119,
    "phone": false,
    "url": "/settings/access",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "Администратор",
        "text": "Полный доступ: журналы, сотрудники, настройки, отчёты",
        "warn": false,
        "x": 8.28,
        "y": 14.22,
        "w": 9.87,
        "h": 2.72
      },
      {
        "n": 2,
        "title": "Заведующий / Шеф",
        "text": "Видит сотрудников, проверяет выполненные задачи",
        "warn": false,
        "x": 53.97,
        "y": 14.22,
        "w": 11.92,
        "h": 2.72
      },
      {
        "n": 3,
        "title": "Повар",
        "text": "Только задачи своей смены в приложении",
        "warn": false,
        "x": 53.97,
        "y": 52.48,
        "w": 3.87,
        "h": 2.72
      },
      {
        "n": 4,
        "title": "Настроить наборы",
        "text": "Свои наборы — без участия разработчиков",
        "warn": false,
        "x": 79.63,
        "y": 4.56,
        "w": 15.56,
        "h": 4.83
      }
    ]
  },
  "buildings": {
    "id": "buildings",
    "src": "/kb/buildings.webp",
    "w": 1600,
    "h": 1216,
    "phone": false,
    "url": "/settings/buildings",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "Журналы отдельно по точкам",
        "text": "Один тумблер: у каждой точки свои документы",
        "warn": false,
        "x": 4.48,
        "y": 35.72,
        "w": 85.17,
        "h": 2.33
      },
      {
        "n": 2,
        "title": "Карточка точки",
        "text": "Адрес и помещения — по ним раздаются задачи уборки",
        "warn": false,
        "x": 4.48,
        "y": 47.62,
        "w": 14.58,
        "h": 5.39
      }
    ]
  },
  "ck-assign": {
    "id": "ck-assign",
    "src": "/kb/ck-assign.webp",
    "w": 1600,
    "h": 2153,
    "phone": false,
    "url": "/checklists/assignments",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "Шаблон",
        "text": "Какой чек-лист проводить",
        "warn": false,
        "x": 11.06,
        "y": 14.22,
        "w": 24.14,
        "h": 2.11
      },
      {
        "n": 2,
        "title": "Кому",
        "text": "Точка, должность или один сотрудник",
        "warn": false,
        "x": 11.06,
        "y": 25.8,
        "w": 82.64,
        "h": 2.11
      },
      {
        "n": 3,
        "title": "Как часто и до скольки",
        "text": "Один раз, каждый день, раз в неделю или месяц",
        "warn": false,
        "x": 11.06,
        "y": 39.75,
        "w": 37.36,
        "h": 2.11
      },
      {
        "n": 4,
        "title": "Кто получит и когда",
        "text": "Прогноз до сохранения — без сюрпризов",
        "warn": false,
        "x": 8.94,
        "y": 74.52,
        "w": 22.06,
        "h": 2.03
      }
    ]
  },
  "ck-inspection-q": {
    "id": "ck-inspection-q",
    "src": "/kb/ck-inspection-q.webp",
    "w": 1600,
    "h": 1119,
    "phone": false,
    "url": "/checklists/inspections/cmw0o8fhs002hc09mtte56lz2",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "«Да» — пункт выполнен",
        "text": "Под вопросом — что именно проверить",
        "warn": false,
        "x": 5.91,
        "y": 5.4,
        "w": 4.26,
        "h": 4.83
      },
      {
        "n": 2,
        "title": "«Нет» — нарушение",
        "text": "Попадает в отчёт: баллы и число нарушений считаются сами",
        "warn": true,
        "x": 10.85,
        "y": 42.0,
        "w": 4.85,
        "h": 4.83
      }
    ]
  },
  "ck-inspection-top": {
    "id": "ck-inspection-top",
    "src": "/kb/ck-inspection-top.webp",
    "w": 1600,
    "h": 1119,
    "phone": false,
    "url": "/checklists/inspections/cmw0ny8iq001fc09m0l70yhez",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "Результат проверки",
        "text": "78 из 81 балла (96%), 2 нарушения",
        "warn": false,
        "x": 4.14,
        "y": 34.1,
        "w": 91.72,
        "h": 2.42
      },
      {
        "n": 2,
        "title": "Печать и PDF",
        "text": "Отчёт для управляющего или собственника",
        "warn": false,
        "x": 78.18,
        "y": 16.88,
        "w": 19.12,
        "h": 4.83
      }
    ]
  },
  "ck-inspection": {
    "id": "ck-inspection",
    "src": "/kb/ck-inspection.webp",
    "w": 1600,
    "h": 1000,
    "phone": false,
    "url": "/checklists/inspections/cmw0ny8iq001fc09m0l70yhez",
    "caption": null,
    "sub": null,
    "marks": []
  },
  "ck-results": {
    "id": "ck-results",
    "src": "/kb/ck-results.webp",
    "w": 1600,
    "h": 1119,
    "phone": false,
    "url": "/checklists/results",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "Фильтры",
        "text": "Шаблон, период: 7, 30, 90 дней или всё время",
        "warn": false,
        "x": 8.53,
        "y": 24.28,
        "w": 86.66,
        "h": 2.99
      },
      {
        "n": 2,
        "title": "Только с нарушениями",
        "text": "Что нужно исправить — одним переключателем",
        "warn": false,
        "x": 75.56,
        "y": 34.73,
        "w": 19.62,
        "h": 5.31
      }
    ]
  },
  "ck-templates": {
    "id": "ck-templates",
    "src": "/kb/ck-templates.webp",
    "w": 1600,
    "h": 1119,
    "phone": false,
    "url": "/checklists/templates",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "Типовые чек-листы",
        "text": "Добавьте в организацию и правьте под себя",
        "warn": false,
        "x": 8.53,
        "y": 24.28,
        "w": 86.66,
        "h": 2.99
      },
      {
        "n": 2,
        "title": "Начать проверку",
        "text": "Сразу с телефона или компьютера",
        "warn": false,
        "x": 6.25,
        "y": 48.83,
        "w": 14.43,
        "h": 4.83
      }
    ]
  },
  "cold-grid": {
    "id": "cold-grid",
    "src": "/kb/cold-grid.webp",
    "w": 1600,
    "h": 1000,
    "phone": false,
    "url": "/journals/cold_equipment_control/documents/cmvbgym7u0090f89mj6zcrt7w",
    "caption": null,
    "sub": null,
    "marks": []
  },
  "cold": {
    "id": "cold",
    "src": "/kb/cold.webp",
    "w": 1600,
    "h": 1119,
    "phone": false,
    "url": "/journals/cold_equipment_control/documents/cmvbgym7u0090f89mj6zcrt7w",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "Сегодня осталось",
        "text": "Сколько единиц оборудования ещё ждут замера",
        "warn": false,
        "x": 6.25,
        "y": 22.08,
        "w": 81.85,
        "h": 2.45
      },
      {
        "n": 2,
        "title": "Сегодня · по оборудованию · таблица",
        "text": "Три вида одного журнала",
        "warn": false,
        "x": 17.4,
        "y": 31.96,
        "w": 67.0,
        "h": 2.36
      }
    ]
  },
  "cook-1-start": {
    "id": "cook-1-start",
    "src": "/kb/cook-1-start.webp",
    "w": 600,
    "h": 1231,
    "phone": true,
    "url": null,
    "caption": "Сканирует наклейку",
    "sub": "Открылся «Холодильник Polair 2»",
    "marks": []
  },
  "cook-2-pick": {
    "id": "cook-2-pick",
    "src": "/kb/cook-2-pick.webp",
    "w": 600,
    "h": 1231,
    "phone": true,
    "url": null,
    "caption": null,
    "sub": null,
    "marks": []
  },
  "cook-3-pin": {
    "id": "cook-3-pin",
    "src": "/kb/cook-3-pin.webp",
    "w": 600,
    "h": 1231,
    "phone": true,
    "url": null,
    "caption": "Выбирает себя и вводит PIN",
    "sub": "4 цифры — личность подтверждена",
    "marks": []
  },
  "cook-4-form": {
    "id": "cook-4-form",
    "src": "/kb/cook-4-form.webp",
    "w": 600,
    "h": 1231,
    "phone": true,
    "url": null,
    "caption": "Вводит температуру",
    "sub": "Норма 2…4 °C — «В норме»",
    "marks": []
  },
  "cook-5-done": {
    "id": "cook-5-done",
    "src": "/kb/cook-5-done.webp",
    "w": 600,
    "h": 1231,
    "phone": true,
    "url": null,
    "caption": "Записано",
    "sub": "Значение в журнале на его имя",
    "marks": []
  },
  "cook-warn": {
    "id": "cook-warn",
    "src": "/kb/cook-warn.webp",
    "w": 600,
    "h": 1231,
    "phone": true,
    "url": null,
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "Значение вне нормы",
        "text": "«Выше нормы 2…4 °C» — видно сразу при вводе",
        "warn": true,
        "x": 4.36,
        "y": 18.03,
        "w": 91.54,
        "h": 14.98
      },
      {
        "n": 2,
        "title": "Что вы сделали",
        "text": "Готовые варианты: повторю замер, вызвал мастера, переложил продукты",
        "warn": false,
        "x": 8.46,
        "y": 68.87,
        "w": 79.09,
        "h": 16.06
      },
      {
        "n": 3,
        "title": "Уведомление руководителю",
        "text": "Отклонение не потеряется в бумагах",
        "warn": false,
        "x": 16.15,
        "y": 56.33,
        "w": 75.38,
        "h": 11.05
      }
    ]
  },
  "equipment": {
    "id": "equipment",
    "src": "/kb/equipment.webp",
    "w": 1600,
    "h": 1119,
    "phone": false,
    "url": "/settings/equipment",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "Диапазон температуры",
        "text": "Значение вне нормы подсветится при вводе",
        "warn": false,
        "x": 61.8,
        "y": 28.27,
        "w": 14.62,
        "h": 5.31
      },
      {
        "n": 2,
        "title": "Помещение",
        "text": "Цех или склад, где стоит оборудование",
        "warn": false,
        "x": 48.29,
        "y": 28.27,
        "w": 13.5,
        "h": 5.31
      },
      {
        "n": 3,
        "title": "QR-наклейки",
        "text": "Печать наклеек на всё оборудование одним листом",
        "warn": false,
        "x": 42.59,
        "y": 11.9,
        "w": 35.41,
        "h": 4.83
      }
    ]
  },
  "home": {
    "id": "home",
    "src": "/kb/home.webp",
    "w": 1600,
    "h": 1000,
    "phone": false,
    "url": "/home",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "Главное меню",
        "text": "Моя компания, Мониторинг, Подписки, Настройки и оформление",
        "warn": false,
        "x": 4.17,
        "y": 19.39,
        "w": 10.21,
        "h": 19.26
      },
      {
        "n": 2,
        "title": "Начальная настройка",
        "text": "Компания, точки, сотрудники и журналы — по шагам",
        "warn": false,
        "x": 21.39,
        "y": 59.77,
        "w": 10.49,
        "h": 4.44
      },
      {
        "n": 3,
        "title": "Избранное",
        "text": "Закрепите до трёх страниц, которые открываете чаще всего",
        "warn": false,
        "x": 35.62,
        "y": 60.42,
        "w": 38.4,
        "h": 4.03
      },
      {
        "n": 4,
        "title": "«К Вам пришла проверка»",
        "text": "Всегда внизу меню — на случай визита проверяющего",
        "warn": false,
        "x": 4.24,
        "y": 93.42,
        "w": 10.07,
        "h": 4.03
      }
    ]
  },
  "hygiene": {
    "id": "hygiene",
    "src": "/kb/hygiene.webp",
    "w": 1600,
    "h": 811,
    "phone": false,
    "url": "/journals/hygiene/documents/cmvbgy9v70003f89mmcxnxvwc",
    "caption": null,
    "sub": null,
    "marks": []
  },
  "inspection": {
    "id": "inspection",
    "src": "/kb/inspection.webp",
    "w": 1600,
    "h": 1119,
    "phone": false,
    "url": "/inspection",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 2,
        "title": "Покажите QR",
        "text": "Проверяющий сам открывает журналы со своего телефона",
        "warn": false,
        "x": 24.27,
        "y": 40.19,
        "w": 14.9,
        "h": 2.41
      }
    ]
  },
  "journals": {
    "id": "journals",
    "src": "/kb/journals.webp",
    "w": 1600,
    "h": 1119,
    "phone": false,
    "url": "/journals",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "Всего 45 журналов",
        "text": "СанПиН и ХАССП — поиск по названию и коду",
        "warn": false,
        "x": 39.19,
        "y": 37.12,
        "w": 10.24,
        "h": 2.36
      },
      {
        "n": 2,
        "title": "Превью печатной формы",
        "text": "Журнал выглядит так же, как бумажный",
        "warn": false,
        "x": 3.97,
        "y": 69.06,
        "w": 18.07,
        "h": 4.65
      },
      {
        "n": 3,
        "title": "Создать выбранные",
        "text": "Документы на период — без ручного заполнения шапок",
        "warn": false,
        "x": 71.14,
        "y": 36.12,
        "w": 24.39,
        "h": 4.35
      }
    ]
  },
  "m-inspector-list": {
    "id": "m-inspector-list",
    "src": "/kb/m-inspector-list.webp",
    "w": 600,
    "h": 1231,
    "phone": true,
    "url": "/inspector/eGesjPp9lC2r5fTyc8bxYsnorW6UsnqBuVsW_3hjdDc",
    "caption": "Опись журналов",
    "sub": null,
    "marks": []
  },
  "m-inspector": {
    "id": "m-inspector",
    "src": "/kb/m-inspector.webp",
    "w": 600,
    "h": 1231,
    "phone": true,
    "url": "/inspector/eGesjPp9lC2r5fTyc8bxYsnorW6UsnqBuVsW_3hjdDc",
    "caption": "Титульный лист",
    "sub": null,
    "marks": []
  },
  "m-mini-today": {
    "id": "m-mini-today",
    "src": "/kb/m-mini-today.webp",
    "w": 600,
    "h": 1231,
    "phone": true,
    "url": "/mini/today",
    "caption": "Telegram: задачи на сегодня",
    "sub": null,
    "marks": []
  },
  "m-qr-all": {
    "id": "m-qr-all",
    "src": "/kb/m-qr-all.webp",
    "w": 600,
    "h": 1231,
    "phone": true,
    "url": "/journal-fill/cmvbfyemt0000uw9mywdjiurr/all?token=journal%3Acmvbfyemt0000uw9mywdjiurr%3Aall.1793709927373.oOOhIw6XafFYPIrf87N206KUWyHQSZUzYVpmn5vHJJU",
    "caption": "Плакат «Все журналы»",
    "sub": null,
    "marks": []
  },
  "m-qr-hyg": {
    "id": "m-qr-hyg",
    "src": "/kb/m-qr-hyg.webp",
    "w": 600,
    "h": 1231,
    "phone": true,
    "url": "/journal-fill/cmvbfyemt0000uw9mywdjiurr/hygiene?token=journal%3Acmvbfyemt0000uw9mywdjiurr%3Ahygiene.1793709927505.UZFo1-vd77aaxbc4njImOJJCpIp1kOVDpzJ7neTzO7o",
    "caption": null,
    "sub": null,
    "marks": []
  },
  "monitoring": {
    "id": "monitoring",
    "src": "/kb/monitoring.webp",
    "w": 1600,
    "h": 1119,
    "phone": false,
    "url": "/monitoring",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "Все точки или одна",
        "text": "«Кафе на Садовой», «Столовая на Лесной»",
        "warn": false,
        "x": 2.7,
        "y": 21.27,
        "w": 37.04,
        "h": 4.83
      },
      {
        "n": 2,
        "title": "Журналы за сегодня",
        "text": "Процент заполнения и сколько осталось",
        "warn": false,
        "x": 4.81,
        "y": 58.58,
        "w": 26.41,
        "h": 2.54
      },
      {
        "n": 3,
        "title": "Подробнее",
        "text": "Переход к списку журналов дня",
        "warn": false,
        "x": 13.85,
        "y": 65.8,
        "w": 8.34,
        "h": 2.54
      }
    ]
  },
  "portal": {
    "id": "portal",
    "src": "/kb/portal.webp",
    "w": 1600,
    "h": 1119,
    "phone": false,
    "url": "/settings/inspector-portal",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "QR для проверяющих",
        "text": "Срок действия и число просмотров",
        "warn": false,
        "x": 22.8,
        "y": 40.93,
        "w": 70.27,
        "h": 2.72
      },
      {
        "n": 2,
        "title": "Печать, ссылка, отзыв",
        "text": "Лист А4, «Как видит проверяющий», отзыв в один клик",
        "warn": false,
        "x": 22.8,
        "y": 54.21,
        "w": 14.1,
        "h": 4.83
      },
      {
        "n": 3,
        "title": "Последние просмотры",
        "text": "Когда и что открывал проверяющий",
        "warn": false,
        "x": 5.15,
        "y": 82.96,
        "w": 89.7,
        "h": 2.9
      }
    ]
  },
  "ppk": {
    "id": "ppk",
    "src": "/kb/ppk.webp",
    "w": 1600,
    "h": 1119,
    "phone": false,
    "url": "/production-control",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "Готовность программы",
        "text": "Сколько блоков из 14 уже заполнено",
        "warn": false,
        "x": 33.07,
        "y": 19.15,
        "w": 13.55,
        "h": 2.36
      },
      {
        "n": 2,
        "title": "ППК и ХАССП-план",
        "text": "Файл, сборка из разделов или заказ разработки",
        "warn": false,
        "x": 9.88,
        "y": 34.63,
        "w": 64.88,
        "h": 11.59
      },
      {
        "n": 3,
        "title": "Типовыми за 10 минут",
        "text": "Кафе, школьная столовая, пекарня, магазин с кулинарией",
        "warn": false,
        "x": 9.54,
        "y": 57.33,
        "w": 67.82,
        "h": 2.9
      }
    ]
  },
  "qr": {
    "id": "qr",
    "src": "/kb/qr.webp",
    "w": 1600,
    "h": 1119,
    "phone": false,
    "url": "/settings/qr-posters",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "«Все журналы»",
        "text": "Один плакат на стену: сотрудник выбирает журнал и себя",
        "warn": false,
        "x": 7.18,
        "y": 46.99,
        "w": 40.37,
        "h": 2.66
      },
      {
        "n": 2,
        "title": "Допуск к смене",
        "text": "Ответственный отмечает каждого: «Допущен» или «Отстранён»",
        "warn": false,
        "x": 55.15,
        "y": 46.99,
        "w": 40.37,
        "h": 2.66
      },
      {
        "n": 3,
        "title": "А4, А5 или наклейка",
        "text": "Код бессрочный — перепечатывать не нужно",
        "warn": false,
        "x": 4.73,
        "y": 70.0,
        "w": 16.72,
        "h": 5.31
      },
      {
        "n": 4,
        "title": "Распечатать выбранное",
        "text": "Несколько кодов — на одном листе",
        "warn": false,
        "x": 83.18,
        "y": 91.67,
        "w": 12.68,
        "h": 5.31
      }
    ]
  },
  "resp": {
    "id": "resp",
    "src": "/kb/resp.webp",
    "w": 1600,
    "h": 1119,
    "phone": false,
    "url": "/settings/journal-responsibles",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "Умные пресеты",
        "text": "Одна кнопка — назначения для всех журналов",
        "warn": false,
        "x": 4.14,
        "y": 30.97,
        "w": 24.77,
        "h": 5.31
      },
      {
        "n": 2,
        "title": "Кто заполняет",
        "text": "Должность и конкретный сотрудник в шапке документа",
        "warn": false,
        "x": 5.32,
        "y": 76.81,
        "w": 29.02,
        "h": 2.42
      },
      {
        "n": 3,
        "title": "Кто проверяет",
        "text": "Получает запись на подтверждение",
        "warn": false,
        "x": 4.22,
        "y": 84.11,
        "w": 91.55,
        "h": 1.81
      }
    ]
  },
  "set": {
    "id": "set",
    "src": "/kb/set.webp",
    "w": 1600,
    "h": 1119,
    "phone": false,
    "url": "/journals/sets/standard",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "Включено и заполнено",
        "text": "Сводка по набору на сегодня",
        "warn": false,
        "x": 68.97,
        "y": 3.02,
        "w": 11.95,
        "h": 3.8
      },
      {
        "n": 2,
        "title": "«Не заполнен»",
        "text": "Сразу видно, что осталось на сегодня",
        "warn": true,
        "x": 18.68,
        "y": 36.28,
        "w": 9.42,
        "h": 3.14
      },
      {
        "n": 3,
        "title": "«Заполнен сегодня»",
        "text": "Журнал закрыт — можно не проверять",
        "warn": false,
        "x": 81.59,
        "y": 3.02,
        "w": 15.71,
        "h": 3.8
      },
      {
        "n": 4,
        "title": "Открыть журнал",
        "text": "Один клик — и вы в документе",
        "warn": false,
        "x": 79.49,
        "y": 33.83,
        "w": 14.26,
        "h": 4.83
      }
    ]
  },
  "today": {
    "id": "today",
    "src": "/kb/today.webp",
    "w": 1600,
    "h": 1119,
    "phone": false,
    "url": "/dashboard",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "Обязательные журналы",
        "text": "Счётчик: сколько закрыто из положенных на сегодня",
        "warn": false,
        "x": 2.7,
        "y": 13.63,
        "w": 83.11,
        "h": 3.32
      },
      {
        "n": 2,
        "title": "QR-коды",
        "text": "Плакаты для журналов — прямо отсюда",
        "warn": false,
        "x": 87.53,
        "y": 20.6,
        "w": 9.77,
        "h": 4.83
      }
    ]
  },
  "users": {
    "id": "users",
    "src": "/kb/users.webp",
    "w": 1600,
    "h": 1119,
    "phone": false,
    "url": "/settings/users",
    "caption": null,
    "sub": null,
    "marks": [
      {
        "n": 1,
        "title": "Руководство",
        "text": "Управляющий, шеф-повар, технолог",
        "warn": false,
        "x": 7.85,
        "y": 40.62,
        "w": 17.32,
        "h": 15.1
      },
      {
        "n": 2,
        "title": "Сотрудники",
        "text": "Повара, кладовщики, уборщики — по должностям",
        "warn": false,
        "x": 52.79,
        "y": 47.35,
        "w": 18.93,
        "h": 8.36
      },
      {
        "n": 3,
        "title": "Из Excel или несколько сразу",
        "text": "Шаблон таблицы — и весь штат за минуту",
        "warn": false,
        "x": 34.04,
        "y": 11.42,
        "w": 47.62,
        "h": 4.83
      },
      {
        "n": 4,
        "title": "Пригласить по QR",
        "text": "Сотрудник сканирует код и регистрируется сам",
        "warn": false,
        "x": 82.34,
        "y": 11.42,
        "w": 14.96,
        "h": 4.83
      }
    ]
  }
};
