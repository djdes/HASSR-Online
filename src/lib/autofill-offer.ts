/**
 * Ролик «Журналы, которые заполняются сами» для /avtozapolnenie (2026-11-01).
 *
 * Собирается Remotion (`remotion/autofill-tour.tsx`) командой
 * `npm run video:render:autofill`. Тексты сцен — здесь, в одном месте: из
 * них же собираются субтитры VTT, а тест сверяет обещания ролика и страницы
 * с кодом. Голоса нет (нет ключа озвучки) — текст на экране и в субтитрах.
 */

export const AUTOFILL_VIDEO = {
  basename: "autofill-ru",
  src: "/landing/video/autofill-ru.mp4",
  poster: "/landing/video/autofill-ru.jpg",
  captions: "/landing/video/autofill-ru.vtt",
  durationSeconds: 60,
  durationIso: "PT1M",
  uploadDate: "2026-11-01",
  /** Лимит веса: ролик грузится по нажатию, но держим его лёгким. */
  maxBytes: 8 * 1024 * 1024,
} as const;

export const AUTOFILL_FPS = 30;
export const AUTOFILL_SIZE = { width: 1920, height: 1080 } as const;

export type AutofillSceneId =
  | "intro"
  | "sensors"
  | "invoices"
  | "mercury"
  | "photo"
  | "schedule"
  | "human"
  | "outro";

export type AutofillScene = {
  id: AutofillSceneId;
  /** Длина сцены в кадрах (30 к/с). */
  frames: number;
  /** «01 · Датчики» над заголовком; null — без подписи. */
  chapter: string | null;
  title: string;
  /** Слово заголовка с акцентным градиентом. */
  accent: string | null;
  sub: string;
};

export const AUTOFILL_SCENES: readonly AutofillScene[] = [
  {
    id: "intro",
    frames: 150,
    chapter: null,
    title: "Журналы, которые заполняются сами",
    accent: "сами",
    sub: "Данные приходят из приборов, учёта и документов — сотрудник подтверждает факт.",
  },
  {
    id: "sensors",
    frames: 300,
    chapter: "01 · Датчики",
    title: "Температура пишется сама",
    accent: "сама",
    sub: "Wi-Fi датчики раз в час заносят показания в журнал. Вышла за норму — руководителю точки приходит тревога.",
  },
  {
    id: "invoices",
    frames: 330,
    chapter: "02 · Накладные",
    title: "Приёмка — из накладной",
    accent: "из накладной",
    sub: "Накладная iiko, Диадока или СБИС становится строками журнала приёмки. Температуру и решение вносит сотрудник.",
  },
  {
    id: "mercury",
    frames: 240,
    chapter: "03 · «Меркурий»",
    title: "ВСД заполняют входной контроль",
    accent: "ВСД",
    sub: "Ветдокументы приходят сами. Гасит документ человек — после настоящей приёмки.",
  },
  {
    id: "photo",
    frames: 270,
    chapter: "04 · Фото табло",
    title: "Снимок вместо переписывания",
    accent: "Снимок",
    sub: "Сфотографировали дисплей термометра — показание встало в журнал.",
  },
  {
    id: "schedule",
    frames: 210,
    chapter: "05 · График смен",
    title: "Выходные и отпуска — из графика",
    accent: "из графика",
    sub: "Отметки «выходной», «отпуск», «больничный» сами проставляются в гигиеническом журнале.",
  },
  {
    id: "human",
    frames: 150,
    chapter: null,
    title: "Человеку — то, что видит только человек",
    accent: "только человек",
    sub: "Температура продукта, органолептика, допуск к работе и подпись остаются за сотрудником.",
  },
  {
    id: "outro",
    frames: 150,
    chapter: null,
    title: "Журналы, которые заполняются сами",
    accent: "сами",
    sub: "wesetup.ru/avtozapolnenie",
  },
];

/** Начало каждой сцены в кадрах. */
export function autofillTimeline(): Array<AutofillScene & { from: number }> {
  let from = 0;
  return AUTOFILL_SCENES.map((scene) => {
    const placed = { ...scene, from };
    from += scene.frames;
    return placed;
  });
}

export const AUTOFILL_TOTAL_FRAMES = AUTOFILL_SCENES.reduce((sum, scene) => sum + scene.frames, 0);

function vttTime(frame: number): string {
  const ms = Math.round((frame / AUTOFILL_FPS) * 1000);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(rest, 3)}`;
}

/** Субтитры ролика: на каждую сцену — заголовок и пояснение. */
export function autofillVtt(): string {
  const cues = autofillTimeline().map(
    (scene, index) =>
      `${index + 1}\n${vttTime(scene.from)} --> ${vttTime(scene.from + scene.frames)}\n${scene.title}\n${scene.sub}`,
  );
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

/* ---------------------------------------------------------------------
 * Вертикальные ролики для соцсетей (VK Клипы, Reels, Shorts), 2026-11-01:
 * по сцене на источник данных. Та же сцена большого ролика в раскладке
 * 1080×1920 (`AutofillClip` в `remotion/autofill-tour.tsx`), затем концовка
 * с адресом. Рендер — `npm run video:render:clips`; файлы отдаются
 * владельцу, в репозиторий и на сайт не кладутся.
 * ------------------------------------------------------------------- */

export const AUTOFILL_CLIP = {
  width: 1080,
  height: 1920,
  /** Сцена (самая длинная в большом ролике — 11 с) с запасом, чтобы дочитать. */
  sceneFrames: 330,
  /** Концовка с адресом: 4 с. */
  outroFrames: 120,
  durationInFrames: 450,
  durationSeconds: 15,
} as const;

export const AUTOFILL_CLIP_SCENES = ["sensors", "invoices", "mercury", "photo", "schedule"] as const satisfies readonly AutofillSceneId[];
export type AutofillClipSceneId = (typeof AUTOFILL_CLIP_SCENES)[number];

export function autofillScene(id: AutofillSceneId): AutofillScene {
  const scene = AUTOFILL_SCENES.find((item) => item.id === id);
  if (!scene) throw new Error(`Нет сцены ${id}`);
  return scene;
}

/** Имя файла ролика: `autofill-clip-01-sensors`. */
export function autofillClipBasename(id: AutofillClipSceneId): string {
  return `autofill-clip-${String(AUTOFILL_CLIP_SCENES.indexOf(id) + 1).padStart(2, "0")}-${id}`;
}

/** Текст к публикации ролика — из текстов той же сцены и концовки. */
export function autofillClipCaption(id: AutofillClipSceneId): string {
  const scene = autofillScene(id);
  return `${scene.title}. ${scene.sub}\n\nКак это устроено: https://${autofillScene("outro").sub}\n\n#ХАССП #СанПиН #общепит #WeSetup`;
}

