"""Подписи меню-дерева и заголовки новых страниц — ru/en/uz (однократный скрипт)."""
import json
import sys

ROOT = sys.argv[1]

T = {
    "sections": {
        "office": ("Офис", "Office", "Ofis"),
        "monitoring": ("Мониторинг", "Monitoring", "Monitoring"),
        "settings": ("Настройки и оформление", "Settings and appearance", "Sozlamalar va bezak"),
        "billing": ("Подписки", "Subscriptions", "Obunalar"),
    },
    "back": ("Назад", "Back", "Orqaga"),
    "tabs": {
        "office": ("Сотрудники офиса", "Office staff", "Ofis xodimlari"),
        "access": ("Права и доступ", "Rights and access", "Huquqlar va kirish"),
        "overview": ("Сводка", "Overview", "Umumiy ko‘rinish"),
        "points": ("Журналы точек", "Outlet journals", "Nuqtalar jurnallari"),
    },
    "points_staff": ("Сотрудники точек", "Outlet staff", "Nuqtalar xodimlari"),
    "points_ppk": (
        "Программа производственного контроля",
        "Production control program",
        "Ishlab chiqarish nazorati dasturi",
    ),
    "laws": ("Нормативные документы", "Regulatory documents", "Me’yoriy hujjatlar"),
    "norms": ("ППК и план ХАССП", "PCP and HACCP plan", "IChN va HACCP rejasi"),
    "experts": ("Консалтинг", "Consulting", "Konsalting"),
    "routes": {
        "home": ("Главная", "Home", "Bosh sahifa"),
        "monitoring": ("Мониторинг", "Monitoring", "Monitoring"),
        "journals_points": ("Журналы точек", "Outlet journals", "Nuqtalar jurnallari"),
        "inspection_laws": ("Нормативные документы", "Regulatory documents", "Me’yoriy hujjatlar"),
    },
}

for index, loc in enumerate(["ru", "en", "uz"]):
    path = f"{ROOT}/src/i18n/messages/{loc}.json"
    data = json.load(open(path, encoding="utf-8"))
    sh = data["navigation"]["shell"]
    menus = sh["menus"]
    old_company = dict(menus["company"]["items"])
    old_points = dict(menus["points"]["items"])
    pick = lambda triple: triple[index]

    for key, triple in T["sections"].items():
        sh["sections"][key] = pick(triple)
    sh["back"] = pick(T["back"])
    sh["badges"] = {"pro": "PRO"}
    for key, triple in T["tabs"].items():
        sh["tabs"][key] = pick(triple)

    menus["company"] = {
        "items": {
            "office": sh["sections"]["office"],
            "points": sh["sections"]["points"],
            "master": old_points["master"],
            "more": sh["sections"]["more"],
            "organization": old_company["organization"],
        },
        "tabs": {
            "organization": old_company["organization"],
            "documents": old_company["documents"],
            "contacts": old_company["contacts"],
        },
    }
    menus["office"] = {
        "items": {
            "office": sh["tabs"]["office"],
            "access": sh["tabs"]["access"],
        }
    }
    menus["points"] = {
        "groups": {"more": menus["points"]["groups"]["more"]},
        "items": {
            "staff": pick(T["points_staff"]),
            "journals": sh["sections"]["journals"],
            "productionControl": pick(T["points_ppk"]),
            "areas": old_points["areas"],
            "equipment": old_points["equipment"],
            "qr": old_points["qr"],
            "printer": old_points["printer"],
            "kiosk": old_points["kiosk"],
            "products": old_points["products"],
        },
    }
    menus["staff"]["items"].pop("access", None)
    menus["journals"]["items"] = {"points": sh["tabs"]["points"], **menus["journals"]["items"]}
    menus["monitoring"] = {
        "items": {
            "overview": sh["tabs"]["overview"],
            "checklists": sh["sections"]["checklists"],
        }
    }
    menus["settings"] = {
        "items": {key: old_company[key] for key in ["appearance", "branding", "names", "onboarding", "template"]}
    }
    insp = menus["inspection"]["items"]
    menus["inspection"] = {
        "groups": {"more": menus["points"]["groups"]["more"]},
        "items": {
            "laws": pick(T["laws"]),
            "norms": pick(T["norms"]),
            "portal": insp["portal"],
            "experts": pick(T["experts"]),
            "now": insp["now"],
            "visits": insp["visits"],
            "readiness": insp["readiness"],
            "special": insp["special"],
        },
    }

    routes = data["navigation"]["routes"]
    for key, triple in T["routes"].items():
        routes[key] = pick(triple)
    routes["inspection_norms"] = pick(T["norms"])
    routes["inspection_experts"] = pick(T["experts"])

    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(loc, "ok")
