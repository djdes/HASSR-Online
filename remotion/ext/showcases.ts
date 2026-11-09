import { BarChart3, PackageCheck, ShieldAlert, ShieldCheck, Store, UtensilsCrossed, type LucideIcon } from "lucide-react";

/**
 * Новые главы расширенного ролика (09.11.2026): настоящие экраны сетапа,
 * снятые с демо-базы `wesetup_showcase` (организация «Столовая «Берёзка»»,
 * три точки, накладная ЭДО и блюда раздачи — демо-данные). Скрипт съёмки —
 * `D:/wt/fab-shots/capture-ext.cjs`, `serving2.cjs`.
 *
 * Координаты подсветки и прокрутка — в пикселях снимка (`width` × `height`),
 * время — номер слова в озвучке главы (`public/landing/video/voice/ru/*.json`).
 */

export type ShowcaseHighlight = { word: number; x: number; y: number; w: number; h: number; radius?: number; color?: string };

export type ShowcaseShot = {
  src: string;
  width: number;
  height: number;
  /** Слово, на котором экран появляется (у первого — с начала главы). */
  fromWord?: number;
  /** Прокрутка: [слово, доля 0…1 от высоты снимка за пределами экрана]. */
  scroll?: Array<[number, number]>;
  highlights?: ShowcaseHighlight[];
  /** Наезд камеры: с этого слова — крупнее вокруг точки (x, y) снимка. */
  focus?: Array<{ word: number; x: number; y: number; scale: number }>;
};

export type ShowcaseStep = { label: string; word: number; value?: string; tone?: "ok" | "bad" };

export type Showcase = {
  chip: string;
  place: string;
  icon: LucideIcon;
  accent: string;
  accentSoft: string;
  device: "phone" | "laptop";
  /** Фото места; без него — фон «кабинет руководителя». */
  photo?: string;
  shots: ShowcaseShot[];
  steps: ShowcaseStep[];
  note?: { word: number; left: number; top: number; from: string; channel: string; time: string; lines: string[] };
};

const RED = "#e5484d";
const DESK = { width: 2160, height: 1350 } as const;

export const SHOWCASES: Record<string, Showcase> = {
  serving: {
    chip: "Раздача",
    place: "Чек-лист на линии раздачи",
    icon: UtensilsCrossed,
    accent: "#f59e0b",
    accentSoft: "#fff4dc",
    device: "phone",
    photo: "landing/video/ext/serving.webp",
    shots: [
      {
        src: "landing/video/ext/serving-1.png",
        width: 780,
        height: 13546,
        scroll: [
          [3, 0.129],
          [7, 0.339],
          [12, 0.417],
          [14, 0.5],
        ],
        highlights: [
          { word: 3, x: 34, y: 1810, w: 712, h: 460, radius: 32 },
          { word: 8, x: 105, y: 5170, w: 520, h: 120, radius: 24 },
          { word: 12, x: 105, y: 5665, w: 520, h: 120, radius: 24 },
          { word: 14, x: 75, y: 6425, w: 630, h: 750, radius: 40, color: RED },
        ],
      },
    ],
    steps: [
      { label: "Чек-лист раздачи открыт", word: 0 },
      { label: "Блюда подставились сами", word: 3, value: "5 блюд: бракераж и справочник" },
      { label: "Замер в начале раздачи", word: 7, value: "Борщ +82 °C" },
      { label: "Через час — второй замер", word: 12, value: "Борщ +79 °C" },
      { label: "Отклонение видно сразу", word: 14, value: "Гуляш +58 °C — ниже +65 °C", tone: "bad" },
    ],
  },
  acceptance: {
    chip: "Приёмка",
    place: "Накладная пришла по ЭДО",
    icon: PackageCheck,
    accent: "#0ea5e9",
    accentSoft: "#e0f4fd",
    device: "laptop",
    photo: "landing/video/ext/acceptance.webp",
    shots: [
      { src: "landing/video/ext/acceptance-1.png", ...DESK, focus: [{ word: 0, x: 880, y: 390, scale: 1.35 }], highlights: [{ word: 0, x: 420, y: 330, w: 920, h: 110 }] },
      { src: "landing/video/ext/acceptance-2.png", ...DESK, fromWord: 7, focus: [{ word: 8, x: 613, y: 1189, scale: 1.5 }], highlights: [{ word: 8, x: 432, y: 1153, w: 362, h: 72, radius: 24 }] },
      { src: "landing/video/ext/acceptance-1b.png", ...DESK, fromWord: 11, focus: [{ word: 11, x: 1272, y: 720, scale: 1.4 }], highlights: [{ word: 11, x: 432, y: 615, w: 1680, h: 210, radius: 36 }] },
    ],
    steps: [
      { label: "УПД из ЭДО или iiko", word: 0, value: "№ МД-1109 · «Молочный двор»" },
      { label: "Строки — в журнал приёмки", word: 7, value: "5 позиций, сроки годности" },
      { label: "Точка приёмки — сама", word: 11, value: "Столовая на Лесной (по КПП)" },
    ],
  },
  points: {
    chip: "Сеть точек",
    place: "Кабинет руководителя",
    icon: Store,
    accent: "#5566f6",
    accentSoft: "#eef1ff",
    device: "laptop",
    shots: [
      { src: "landing/video/ext/points-1.png", ...DESK, focus: [{ word: 1, x: 1270, y: 290, scale: 1.5 }], highlights: [{ word: 1, x: 1050, y: 105, w: 441, h: 369, radius: 24 }] },
      { src: "landing/video/ext/points-3.png", ...DESK, fromWord: 5, focus: [{ word: 6, x: 1265, y: 57, scale: 1.6 }], highlights: [{ word: 6, x: 1110, y: 22, w: 310, h: 70, radius: 20 }] },
      { src: "landing/video/ext/points-1b.png", ...DESK, fromWord: 10, focus: [{ word: 10, x: 1272, y: 133, scale: 1.6 }], highlights: [{ word: 10, x: 1062, y: 110, w: 420, h: 46, radius: 14 }] },
    ],
    steps: [
      { label: "Одна компания — три точки", word: 0, value: "Лесная · Тверская · БЦ «Север»" },
      { label: "Точка видит только своё", word: 5, value: "«Сегодня» — журналы Лесной" },
      { label: "Офис видит всю сеть", word: 10, value: "Режим «Вся организация»" },
    ],
  },
  ppk: {
    chip: "ППК и ХАССП",
    place: "Производственный контроль",
    icon: ShieldCheck,
    accent: "#14b8a6",
    accentSoft: "#e4f9f5",
    device: "laptop",
    shots: [
      {
        src: "landing/video/ext/ppk-1.png",
        ...DESK,
        focus: [
          { word: 0, x: 848, y: 578, scale: 1.3 },
          { word: 4, x: 1700, y: 578, scale: 1.3 },
          { word: 10, x: 1265, y: 57, scale: 1.5 },
        ],
        highlights: [
          { word: 0, x: 435, y: 405, w: 825, h: 345, radius: 36 },
          { word: 4, x: 1290, y: 405, w: 819, h: 345, radius: 36 },
          { word: 10, x: 1110, y: 22, w: 310, h: 70, radius: 20 },
        ],
      },
    ],
    steps: [
      { label: "Программа производственного контроля", word: 0 },
      { label: "ХАССП-план", word: 4, value: "группа, анализ опасностей, ККТ" },
      { label: "Своя у каждой точки", word: 10, value: "Столовая на Лесной" },
    ],
  },
  inspection: {
    chip: "Проверка",
    place: "Раздел «Пришла проверка»",
    icon: ShieldAlert,
    accent: "#f43f5e",
    accentSoft: "#ffe9ee",
    device: "laptop",
    shots: [
      { src: "landing/video/ext/inspection-1.png", ...DESK },
      {
        src: "landing/video/ext/inspection-3.png",
        ...DESK,
        fromWord: 2,
        focus: [
          { word: 3, x: 1860, y: 1035, scale: 1.5 },
          { word: 12, x: 1290, y: 296, scale: 1.4 },
        ],
        highlights: [
          { word: 3, x: 1650, y: 1002, w: 225, h: 66, radius: 22 },
          { word: 9, x: 1887, y: 1002, w: 188, h: 66, radius: 22 },
          { word: 12, x: 470, y: 262, w: 1640, h: 68, radius: 20 },
        ],
      },
    ],
    steps: [
      { label: "Что делать — по шагам", word: 0 },
      { label: "Все журналы одной кнопкой", word: 2, value: "архив или один PDF" },
      { label: "QR для проверяющего", word: 12, value: "только журналы этой точки" },
    ],
  },
  reports: {
    chip: "Отчёты",
    place: "Сводка и отчёты",
    icon: BarChart3,
    accent: "#8b5cf6",
    accentSoft: "#f1ecff",
    device: "laptop",
    shots: [
      {
        src: "landing/video/ext/reports-1.png",
        ...DESK,
        focus: [
          { word: 7, x: 890, y: 285, scale: 1.4 },
          { word: 12, x: 1827, y: 614, scale: 1.4 },
        ],
        highlights: [
          { word: 7, x: 420, y: 215, w: 940, h: 140, radius: 24 },
          { word: 12, x: 1580, y: 584, w: 495, h: 60, radius: 22 },
        ],
      },
    ],
    note: {
      word: 0,
      left: 700,
      top: 560,
      from: "WeSetup",
      channel: "Telegram и MAX",
      time: "08:00",
      lines: ["Доброе утро, Анна!", "Сегодня (9 ноября):", "• Заполнено: 18 / 24 (75 %)", "• Осталось: 6", "• Сотрудников с открытыми задачами: 3"],
    },
    steps: [
      { label: "Сводка дня утром", word: 0, value: "в Telegram и MAX" },
      { label: "Отчёты PDF и Excel", word: 7, value: "за любой период" },
      { label: "ИИ-отчёт — в пару кликов", word: 12 },
    ],
  },
};

export const SHOWCASE_IDS = Object.keys(SHOWCASES);
