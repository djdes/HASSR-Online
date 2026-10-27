"""Тексты страниц /home, /monitoring, /journals/points — ru/en/uz (однократный скрипт)."""
import json
import sys

ROOT = sys.argv[1]

# Значения — кортежи (ru, en, uz); вложенные словари — пространства имён.
PAGES = {
    "homePage": {
        "tagline": ("Ваш электронный ХАССП", "Your electronic HACCP", "Sizning elektron HACCP tizimingiz"),
        "contactsTitle": ("Мы на связи", "We are here to help", "Biz aloqadamiz"),
        "contacts": {
            "support": ("Поддержка", "Support", "Qo‘llab-quvvatlash"),
            "sales": ("Отдел продаж", "Sales", "Sotuv bo‘limi"),
            "consulting": ("Консалтинг", "Consulting", "Konsalting"),
        },
        "via": {
            "telegram": ("в Telegram", "on Telegram", "Telegram’da"),
            "support": ("чат на сайте", "chat on the site", "saytdagi chat"),
            "sales": ("тарифы и оплата", "plans and payment", "tariflar va to‘lov"),
            "consulting": ("подготовка с экспертом", "preparation with an expert", "ekspert bilan tayyorgarlik"),
        },
        "phone": ("Телефон", "Phone", "Telefon"),
        "setupTitle": ("Начальная настройка", "Initial setup", "Boshlang‘ich sozlash"),
        "setupBody": (
            "Компания, точки, сотрудники и журналы — по шагам",
            "Company, outlets, staff and journals — step by step",
            "Kompaniya, nuqtalar, xodimlar va jurnallar — bosqichma-bosqich",
        ),
        "favorites": {
            "title": ("Избранное", "Favorites", "Sevimlilar"),
            "add": ("Добавить в избранное", "Add to favorites", "Sevimlilarga qo‘shish"),
            "addHint": (
                "Закрепите страницу, которую открываете чаще всего",
                "Pin the page you open most often",
                "Eng ko‘p ochadigan sahifangizni mahkamlang",
            ),
            "remove": ("Убрать из избранного", "Remove from favorites", "Sevimlilardan olib tashlash"),
            "pickDescription": (
                "Страница появится на главной — открывайте её в один клик.",
                "The page will appear on the home screen — open it in one click.",
                "Sahifa bosh sahifada paydo bo‘ladi — uni bir bosishda oching.",
            ),
            "search": ("Найти страницу", "Find a page", "Sahifani topish"),
            "nothing": ("Ничего не нашлось", "Nothing found", "Hech narsa topilmadi"),
            "saved": ("Избранное сохранено", "Favorites saved", "Sevimlilar saqlandi"),
            "failed": ("Не удалось сохранить избранное", "Could not save favorites", "Sevimlilarni saqlab bo‘lmadi"),
        },
    },
    "monitoringPage": {
        "lead": (
            "Как идут дела на точках: журналы за сегодня, чек-листы и программа производственного контроля.",
            "How your outlets are doing: today's journals, checklists and the production control program.",
            "Nuqtalardagi ishlar: bugungi jurnallar, chek-listlar va ishlab chiqarish nazorati dasturi.",
        ),
        "allPoints": ("Все точки", "All outlets", "Barcha nuqtalar"),
        "pointsAria": ("Выбор точки", "Choose an outlet", "Nuqtani tanlash"),
        "open": ("Подробнее", "Details", "Batafsil"),
        "setUp": ("Настроить", "Set up", "Sozlash"),
        "journals": {
            "title": ("Журналы", "Journals", "Jurnallar"),
            "count": ("Заполнено сегодня: {done} из {total}", "Filled today: {done} of {total}", "Bugun to‘ldirildi: {done} / {total}"),
            "empty": (
                "Журналы не выбраны — добавьте их точке",
                "No journals selected — add them to an outlet",
                "Jurnallar tanlanmagan — ularni nuqtaga qo‘shing",
            ),
            "shared": (
                "Набор журналов общий для всех точек",
                "The journal set is shared by all outlets",
                "Jurnallar to‘plami barcha nuqtalar uchun umumiy",
            ),
        },
        "checklists": {
            "title": ("Чек-листы", "Checklists", "Chek-listlar"),
            "count": ("Выполнено: {done} из {total}", "Completed: {done} of {total}", "Bajarildi: {done} / {total}"),
            "empty": (
                "Сейчас нет назначенных чек-листов",
                "No checklists are assigned right now",
                "Hozir tayinlangan chek-listlar yo‘q",
            ),
            "hint": (
                "Назначения на сегодня и текущий период",
                "Assignments for today and the current period",
                "Bugungi va joriy davr tayinlovlari",
            ),
        },
        "ppk": {
            "title": ("Программа производственного контроля", "Production control program", "Ishlab chiqarish nazorati dasturi"),
            "count": ("Готово разделов: {done} из {total}", "Sections ready: {done} of {total}", "Tayyor bo‘limlar: {done} / {total}"),
            "hint": ("Одна программа на всю компанию", "One program for the whole company", "Butun kompaniya uchun bitta dastur"),
        },
        "guide": {
            "title": ("Как читать мониторинг", "How to read monitoring", "Monitoringni qanday o‘qish kerak"),
            "journals": (
                "Журналы — сколько журналов набора точки уже заполнено сегодня.",
                "Journals — how many of the outlet's journals are already filled today.",
                "Jurnallar — nuqta to‘plamidagi qancha jurnal bugun to‘ldirilgan.",
            ),
            "checklists": (
                "Чек-листы — сколько назначенных проверок выполнено в текущем периоде.",
                "Checklists — how many assigned checks are done in the current period.",
                "Chek-listlar — joriy davrda tayinlangan tekshiruvlardan qanchasi bajarilgan.",
            ),
            "ppk": (
                "ППК — сколько разделов программы производственного контроля готово.",
                "PCP — how many sections of the production control program are ready.",
                "IChN — ishlab chiqarish nazorati dasturining qancha bo‘limi tayyor.",
            ),
        },
    },
    "pointJournals": {
        "lead": (
            "Какие журналы ведутся на каждой точке. Добавьте или уберите журнал — изменится только эта точка.",
            "Which journals each outlet keeps. Add or remove a journal — only that outlet changes.",
            "Har bir nuqtada qaysi jurnallar yuritiladi. Jurnal qo‘shing yoki olib tashlang — faqat shu nuqta o‘zgaradi.",
        ),
        "leadShared": (
            "Набор журналов общий для всех точек. Добавьте или уберите журнал — изменится набор всей компании.",
            "The journal set is shared by all outlets. Add or remove a journal — the whole company's set changes.",
            "Jurnallar to‘plami barcha nuqtalar uchun umumiy. Jurnal qo‘shing yoki olib tashlang — butun kompaniya to‘plami o‘zgaradi.",
        ),
        "allPoints": ("Все точки", "All outlets", "Barcha nuqtalar"),
        "inWork": (
            "{count, plural, one {# журнал в работе} few {# журнала в работе} many {# журналов в работе} other {# журнала в работе}}",
            "{count, plural, one {# journal in use} other {# journals in use}}",
            "{count, plural, other {# ta jurnal yuritilmoqda}}",
        ),
        "add": ("Добавить журнал", "Add journal", "Jurnal qo‘shish"),
        "removeAria": ("Убрать «{name}» с точки «{point}»", "Remove “{name}” from “{point}”", "«{name}»ni «{point}» nuqtasidan olib tashlash"),
        "empty": ("На точке пока нет журналов", "No journals at this outlet yet", "Bu nuqtada hozircha jurnal yo‘q"),
        "pickTitle": ("Добавить журнал: {point}", "Add a journal: {point}", "Jurnal qo‘shish: {point}"),
        "pickDescription": (
            "Журнал появится в «Сегодня» и в списке журналов только этой точки.",
            "The journal will appear in Today and in the journal list of this outlet only.",
            "Jurnal faqat shu nuqtaning «Bugun» va jurnallar ro‘yxatida paydo bo‘ladi.",
        ),
        "pickDescriptionShared": (
            "Журнал появится в «Сегодня» и в списке журналов.",
            "The journal will appear in Today and in the journal list.",
            "Jurnal «Bugun» va jurnallar ro‘yxatida paydo bo‘ladi.",
        ),
        "search": ("Найти журнал", "Find a journal", "Jurnalni topish"),
        "nothing": ("Все журналы уже добавлены", "All journals are already added", "Barcha jurnallar allaqachon qo‘shilgan"),
        "notFound": ("Ничего не нашлось", "Nothing found", "Hech narsa topilmadi"),
        "added": ("Журнал добавлен: {name}", "Journal added: {name}", "Jurnal qo‘shildi: {name}"),
        "removed": ("Журнал убран: {name}", "Journal removed: {name}", "Jurnal olib tashlandi: {name}"),
        "undo": ("Вернуть", "Undo", "Qaytarish"),
        "failed": (
            "Не удалось сохранить — попробуйте ещё раз",
            "Could not save — please try again",
            "Saqlab bo‘lmadi — qayta urinib ko‘ring",
        ),
        "settings": ("Настройка журналов", "Journal settings", "Jurnal sozlamalari"),
        "guide": {
            "title": ("Как это работает", "How it works", "Bu qanday ishlaydi"),
            "list": (
                "Здесь все торговые точки и журналы, которые на них ведутся.",
                "Here are all outlets and the journals they keep.",
                "Bu yerda barcha savdo nuqtalari va ularda yuritiladigan jurnallar.",
            ),
            "add": (
                "«Добавить журнал» — журнал появится у сотрудников этой точки в «Сегодня».",
                "“Add journal” — the journal appears in Today for this outlet's staff.",
                "«Jurnal qo‘shish» — jurnal shu nuqta xodimlarining «Bugun» bo‘limida paydo bo‘ladi.",
            ),
            "remove": (
                "«×» у журнала — он перестанет напоминать о себе; записи не удаляются.",
                "“×” next to a journal — it stops reminding; entries are not deleted.",
                "Jurnal yonidagi «×» — u eslatmaydi; yozuvlar o‘chirilmaydi.",
            ),
        },
    },
}


def build(tree, index):
    if isinstance(tree, tuple):
        return tree[index]
    return {key: build(value, index) for key, value in tree.items()}


for index, loc in enumerate(["ru", "en", "uz"]):
    path = f"{ROOT}/src/i18n/messages/{loc}.json"
    data = json.load(open(path, encoding="utf-8"))
    for namespace, tree in PAGES.items():
        assert namespace not in data or loc != "ru" or True
        data[namespace] = build(tree, index)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(loc, "ok")
