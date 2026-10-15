import { TOUR, type TourAnchor } from "@/lib/tour-anchors";
import { FILLING_GUIDES } from "@/lib/journal-filling-guides";
import {
  FILLING_GUIDE_WALKTHROUGH_COPY_KEYS,
  GENERIC_WALKTHROUGH_COPY_KEYS,
  MANUAL_WALKTHROUGH_COPY_KEYS,
  type WalkthroughStepCopyKey,
  type WalkthroughTranslator,
} from "@/lib/journal-walkthrough-copy";

// Only registered built-in objects have catalog copy. Custom entries and steps
// supplied later retain their own text, even when they reuse a built-in code.
const BUILT_IN_GUIDES = new Map(Object.entries(FILLING_GUIDES).map(([code, guide]) => [
  code, { guide, steps: guide.steps.slice(0, 4) },
]));

/**
 * «Как заполнить?» — шаги по ИНТЕРФЕЙСУ журнала: куда нажать, что
 * произойдёт. Правила заполнения (кого осматривать, чем мерить) живут
 * отдельно — `journal-doc-guides.ts` и `/journals/<code>/guide`.
 *
 * Каждый шаг привязан к странице (`list` — список документов журнала,
 * `document` — сам документ) и, если возможно, к элементу через
 * `data-tour` (`anchor`). Спотлайт-тур подсвечивает элемент на экране;
 * если анкора на странице нет (например, в мобильных карточках), берётся
 * `fallbackAnchor`, иначе шаг пропускается.
 *
 * Тексты — императив, 1–2 предложения, без воды. Целевая аудитория —
 * новый сотрудник без обучения. Пилюля «Руководитель» (`forManager`) —
 * подсказка «кто это делает», а не гейт: шаг видят все.
 *
 * Мини-копии контролов (`preview`) рисует client-компонент
 * `walkthrough-previews.tsx` по ключу — JSX здесь нельзя (RSC не
 * сериализует функции).
 */

export type WalkthroughPage = "list" | "document";

export type WalkthroughPreviewKey =
  | "button-create"
  | "button-add"
  | "status-cycle"
  | "temp-toggle"
  | "button-add-room"
  | "button-add-row"
  | "measure-cells";

export type WalkthroughStep = {
  /** Стабильный id — используется в `?tour=<id>`. */
  id: string;
  page: WalkthroughPage;
  anchor?: TourAnchor;
  fallbackAnchor?: TourAnchor;
  title: string;
  body: string;
  forManager?: boolean;
  /** Только для узких экранов (< 640px): телефон, Mini App. */
  mobileOnly?: boolean;
  preview?: WalkthroughPreviewKey;
};

const WALKTHROUGHS: Record<string, WalkthroughStep[]> = {
  hygiene: [
    {
      id: "create-document",
      page: "list",
      anchor: TOUR.createDocument,
      title: "Создайте документ",
      body: "Нажмите «Создать документ»: период на 15 дней и название подставятся сами, выберите, кто проводит осмотр. При включённом автосоздании документ уже в списке.",
      forManager: true,
      preview: "button-create",
    },
    {
      id: "open-document",
      page: "list",
      anchor: TOUR.documentCard,
      title: "Откройте документ",
      body: "Нажмите на карточку нужного периода — откроется таблица «сотрудники × дни».",
    },
    {
      id: "add-staff",
      page: "document",
      anchor: TOUR.addStaff,
      title: "Добавьте сотрудников",
      body: "«Добавить» → «Заполнить из списка сотрудников». У каждого две строки: осмотр и температура.",
      forManager: true,
      preview: "button-add",
    },
    {
      id: "staff-card",
      page: "document",
      anchor: TOUR.staffCard,
      title: "Раскройте карточку сотрудника",
      body: "Нажмите на имя — откроется список дней.",
      mobileOnly: true,
    },
    {
      id: "status-cell",
      page: "document",
      anchor: TOUR.statusCell,
      fallbackAnchor: TOUR.staffCard,
      title: "Отметьте осмотр за сегодня",
      body: "Нажмите на клетку сегодняшнего дня. Каждое нажатие меняет отметку по кругу: Зд. → В → Б/л → От → Отп. Правая кнопка мыши — выбрать сразу.",
      preview: "status-cycle",
    },
    {
      id: "temperature-cell",
      page: "document",
      anchor: TOUR.temperatureCell,
      fallbackAnchor: TOUR.staffCard,
      title: "Температура выше 37°?",
      body: "Во второй строке сотрудника: «нет» — всё в порядке, «да» — выше 37°.",
      preview: "temp-toggle",
    },
    {
      id: "autofill",
      page: "document",
      anchor: TOUR.autofill,
      title: "Включите автозаполнение",
      body: "Каждый день в 06:00 всем поставится «Зд.» и «температура ниже 37», выходные, отпуска и больничные отметятся сами. Температура или болезнь — исправьте в тот же день, прошлые дни закрыты.",
      forManager: true,
    },
    {
      id: "finish",
      page: "document",
      anchor: TOUR.moreActions,
      title: "Сохранять не нужно",
      body: "Каждая отметка сохраняется сразу. Когда период закончился: «⋯» → «Закончить журнал».",
    },
  ],

  climate_control: [
    {
      id: "create-document",
      page: "list",
      anchor: TOUR.createDocument,
      title: "Создайте документ",
      body: "Нажмите «Создать документ»: дата начала и ответственный. Название подставится само.",
      forManager: true,
      preview: "button-create",
    },
    {
      id: "open-document",
      page: "list",
      anchor: TOUR.documentCard,
      title: "Откройте документ",
      body: "Нажмите на карточку — откроется журнал с помещениями и замерами.",
    },
    {
      id: "add-room",
      page: "document",
      anchor: TOUR.addRoom,
      title: "Добавьте помещения",
      body: "«+ Добавить помещение» → выберите склад из справочника. Нормы температуры и влажности — из карточки помещения. Только склады с продуктами.",
      forManager: true,
      preview: "button-add-room",
    },
    {
      id: "journal-settings",
      page: "document",
      anchor: TOUR.journalSettings,
      title: "Задайте время контроля",
      body: "«Настройки журнала» → время замера (по умолчанию 10:00) и «не заполнять в выходные».",
      forManager: true,
    },
    {
      id: "autofill",
      page: "document",
      anchor: TOUR.autofill,
      title: "Автозаполнение",
      body: "Тумблер «Автоматически заполнять журнал»: строка на каждый день создаётся сама, замеры проставляются в пределах нормы, введённые вручную значения не трогаются.",
      forManager: true,
    },
    {
      id: "view-toggle",
      page: "document",
      anchor: TOUR.viewToggle,
      title: "Переключитесь на «Таблица»",
      body: "На телефоне карточки только для просмотра — значения вводятся в таблице.",
      mobileOnly: true,
    },
    {
      id: "add-row",
      page: "document",
      anchor: TOUR.addRow,
      title: "Добавьте строку за сегодня",
      body: "Если автозаполнение выключено: «Добавить строку» → дата и кто измерял.",
      preview: "button-add-row",
    },
    {
      id: "measure-input",
      page: "document",
      anchor: TOUR.measureInput,
      fallbackAnchor: TOUR.viewToggle,
      title: "Впишите показания",
      body: "Температура (°C) и влажность (%) по каждому помещению — сохраняется при выходе из клетки. Красная цифра — вне нормы: ниже появится поле «Корректирующие действия», напишите, что сделали.",
      preview: "measure-cells",
    },
    {
      id: "finish",
      page: "document",
      anchor: TOUR.moreActions,
      title: "Закончить журнал",
      body: "В конце месяца: «⋯» → «Закончить журнал». Сохранять не нужно — всё пишется сразу.",
    },
  ],
};

export const WALKTHROUGH_CODES: ReadonlySet<string> = new Set([
  ...Object.keys(WALKTHROUGHS),
  ...Object.keys(FILLING_GUIDES),
]);

/**
 * Общие шаги — для журналов без своего разбора.
 *
 * Раскладка страницы документа теперь одна на все журналы
 * (`journal-document-shell.tsx`), поэтому и путь один: создать документ,
 * открыть, добавить строку, заполнить, закончить. Свои шаги пишем только
 * там, где заполнение отличается по сути (гигиена, климат).
 */
const GENERIC_DOCUMENT_STEPS: WalkthroughStep[] = [
  {
    id: "create-document",
    page: "list",
    anchor: TOUR.createDocument,
    title: "Создайте документ",
    body: "Нажмите «Создать документ». Название и период подставятся сами — проверьте ответственного.",
    forManager: true,
    preview: "button-create",
  },
  {
    id: "document-card",
    page: "list",
    title: "Откройте документ",
    body: "Нажмите на карточку нужного периода — откроется журнал с таблицей.",
  },
  {
    id: "view-toggle",
    page: "document",
    anchor: TOUR.viewToggle,
    title: "На телефоне выберите вид",
    body: "«Карточки» — читать и заполнять по одной записи, «Таблица» — весь журнал как на бумаге.",
    mobileOnly: true,
  },
  {
    id: "add-row",
    page: "document",
    title: "Добавьте запись",
    body: "Кнопка «Добавить» над таблицей заводит новую строку: дата, кто делал, показатели.",
    preview: "button-add-row",
  },
  {
    id: "fill-cells",
    page: "document",
    title: "Заполняйте день в день",
    body: "Каждое значение сохраняется сразу — отдельной кнопки «Сохранить» нет.",
  },
  {
    id: "autofill",
    page: "document",
    anchor: TOUR.autofill,
    title: "Можно включить автозаполнение",
    body: "Тумблер «Автоматически заполнять журнал» проставит отметки за прошедшие дни и дальше будет вести журнал сам. Выключите — предложим убрать заполненное.",
    forManager: true,
  },
  {
    id: "more-actions",
    page: "document",
    anchor: TOUR.moreActions,
    title: "Закончите период",
    body: "Когда период закрыт: «⋯» → «Закончить журнал». Документ уйдёт во вкладку «Закрытые».",
    forManager: true,
  },
];

/**
 * Шаги, собранные из подробной инструкции журнала.
 *
 * Ручных разборов было два на тридцать пять журналов (гигиена и климат),
 * остальные получали общий скелет «создайте документ → откройте →
 * добавьте строку». При этом содержательные шаги «что именно делать»
 * уже написаны для тридцати пяти журналов в `journal-filling-guides.ts` —
 * они просто нигде не встречались с интерфейсными.
 *
 * Здесь общий скелет дополняется шагами из инструкции: интерфейсная
 * часть остаётся одна на всех (раскладка документа единая), а «что
 * заполнять» приходит из журнала. Ручной разбор, если он есть, всегда
 * в приоритете.
 */
function translateStep(
  step: WalkthroughStep,
  copyKey: WalkthroughStepCopyKey | undefined,
  t?: WalkthroughTranslator,
): WalkthroughStep {
  if (!t || !copyKey) return step;
  return { ...step, title: t(`${copyKey}.title`), body: t(`${copyKey}.body`) };
}

function translateSteps(
  steps: WalkthroughStep[],
  keys: Readonly<Record<string, WalkthroughStepCopyKey>>,
  t?: WalkthroughTranslator,
): WalkthroughStep[] {
  if (!t) return steps;
  return steps.map(step => translateStep(step, Object.hasOwn(keys, step.id) ? keys[step.id] : undefined, t));
}

function buildStepsFromFillingGuide(code: string, t?: WalkthroughTranslator): WalkthroughStep[] | null {
  const guide = Object.hasOwn(FILLING_GUIDES, code) ? FILLING_GUIDES[code] : undefined;
  if (!guide || guide.steps.length === 0) return null;
  const builtIn = BUILT_IN_GUIDES.get(code);
  const copyKeys = Object.hasOwn(FILLING_GUIDE_WALKTHROUGH_COPY_KEYS, code)
    ? FILLING_GUIDE_WALKTHROUGH_COPY_KEYS[code as keyof typeof FILLING_GUIDE_WALKTHROUGH_COPY_KEYS]
    : undefined;

  const guideSteps: WalkthroughStep[] = guide.steps
    // Больше четырёх шагов подряд на телефоне никто не дочитывает;
    // полная инструкция открывается ссылкой из того же окна.
    .slice(0, 4)
    .map((step, index) => translateStep({
      id: `guide-${index + 1}`,
      page: "document" as const,
      title: step.title,
      body: step.detail,
    }, builtIn?.guide === guide && builtIn.steps[index] === step ? copyKeys?.[index] : undefined, t));

  // Интерфейсные шаги «как открыть и куда нажать» + содержательные из
  // инструкции + завершение периода.
  const genericSteps = translateSteps(GENERIC_DOCUMENT_STEPS, GENERIC_WALKTHROUGH_COPY_KEYS, t);
  const opening = genericSteps.filter((step) =>
    ["create-document", "document-card", "view-toggle"].includes(step.id)
  );
  const closing = genericSteps.filter((step) =>
    ["autofill", "more-actions"].includes(step.id)
  );

  return [...opening, ...guideSteps, ...closing];
}

/** Runtime callers supply request-local copy; omitted copy retains the legacy RU API. */
export function getJournalWalkthrough(code: string, t?: WalkthroughTranslator): WalkthroughStep[] | null {
  if (Object.hasOwn(WALKTHROUGHS, code)) {
    const keys = MANUAL_WALKTHROUGH_COPY_KEYS[code as keyof typeof MANUAL_WALKTHROUGH_COPY_KEYS];
    return translateSteps(WALKTHROUGHS[code], keys, t);
  }
  return buildStepsFromFillingGuide(code, t);
}

/**
 * Шаги для окна «Инструкция»: свои, если есть, иначе общие. Пустым не
 * бывает — окно с двумя вкладками открывается у любого журнала.
 */
export function getJournalWalkthroughOrGeneric(code: string, t?: WalkthroughTranslator): WalkthroughStep[] {
  return getJournalWalkthrough(code, t)
    ?? translateSteps(GENERIC_DOCUMENT_STEPS, GENERIC_WALKTHROUGH_COPY_KEYS, t);
}

export function hasJournalWalkthrough(code: string): boolean {
  return Object.hasOwn(WALKTHROUGHS, code)
    || (Object.hasOwn(FILLING_GUIDES, code) && FILLING_GUIDES[code].steps.length > 0);
}

/** Шаги, которые имеет смысл показывать на этом устройстве. */
export function visibleWalkthroughSteps(
  steps: readonly WalkthroughStep[],
  { isMobile }: { isMobile: boolean },
): WalkthroughStep[] {
  return steps.filter((step) => !step.mobileOnly || isMobile);
}
