import { JournalDocGuideOverlay } from "@/components/journals/journal-doc-guide";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import type { MessageNamespace } from "@/i18n/messages";

const JOURNAL_MESSAGES: Record<string, readonly MessageNamespace[]> = {
  daily_samples: ["genericRegister"],
  vitaminization: ["genericRegister"],
  ration_control: ["genericRegister"],
  transport_temperature: ["genericRegister"],
  tableware_breakage: ["genericRegister"],
  pool_water_control: ["genericRegister"],
  inventory_condition: ["genericRegister"],
  instrument_sterilization: ["genericRegister"],
  medical_waste_b: ["genericRegister"],
  batch_release: ["genericRegister"],
  glass_items_list: ["glassInventory"],
  cold_equipment_control: ["coldEquipment"],
  uv_lamp_runtime: ["uvLampRuntime"],
  climate_control: ["climate"],
  fryer_oil: ["fryerOil"],
  cleaning: ["cleaningGrid"],
  general_cleaning: ["cleaningGrid"],
  sanitary_day_control: ["cleaningGrid"],
  equipment_calibration: ["equipmentCalibration"],
  finished_product: ["finishedProduct"],
  perishable_rejection: ["perishableRejection"],
  accident_journal: ["accidentJournal"],
  breakdown_history: ["breakdownHistory"],
  breakdownhistoryjournal: ["breakdownHistory"],
  complaint_register: ["complaintRegister"],
  complaintjournal: ["complaintRegister"],
};

/**
 * Shared layout for the `/journals/<code>` subtree.
 *
 * Фон раздела — белый, во всю ширину `<main>` (эталон lk.haccp-online.ru:
 * страница и документ одного цвета, без «серой рамки» вокруг бумаги).
 * `-m-4 p-4` / `md:-m-6 md:p-6` компенсируют padding `<main>` из
 * `(dashboard)/layout.tsx`. `bg-white` намеренно — в тёмной теме он
 * автоматически мапится в `--app-surface` (см. `app-theme.css`).
 *
 * Навигация вверх — хлебные крошки (`JournalBreadcrumbs`), которые
 * рендерятся серверно на самих страницах; кнопка «назад» встроена в них
 * первой в строке. Раньше кнопка жила здесь отдельной строкой над
 * крошками — одинаковый серый текст в 6px друг над другом читался как
 * две строки одного текста. Глобальный `PageNav` в этом поддереве
 * отключён: его место снаружи белой подложки, на сером фоне, а навигация
 * должна стоять внутри неё.
 *
 * `JournalDocGuideOverlay` рендерит floating-кнопку «Как заполнять» —
 * сама компонента детектит по URL, что мы на странице документа, и
 * скрывается на других URL'ах. Контент гайда — из journal-doc-guides.ts.
 */
export default async function JournalCodeLayout({ children, params }: { children: React.ReactNode; params: Promise<{ code: string }> }) {
  const { code } = await params;
  const journalMessages = Object.hasOwn(JOURNAL_MESSAGES, code) ? JOURNAL_MESSAGES[code] : [];
  return (
    // Full-bleed белая подложка: `<main>` в (dashboard)/layout ограничен
    // 1800px, поэтому выходим из контейнера на ширину колонки (экран минус
    // сайдбар, `--app-sidebar-w`) + центрирование —
    // белый фон тянется от края до края, как на эталоне (body имеет
    // overflow-x-clip, поэтому скроллбар не появляется).
    // `min-h-[calc(100vh-140px)]` — белая подложка раздела доходит до низа
    // экрана даже на коротких списках. Без этого белая зона обрывалась
    // ровно под последней карточкой и ниже проступала серая полоса
    // `bg-gray-50` из (dashboard)/layout — видимая граница, которой нет
    // на эталоне. 140px ≈ шапка кабинета (72px) + футер дашборда.
    /* R5-5: `print:min-h-0 print:py-0` — та же история, что и с pb ниже.
       `min-h-[calc(100vh-140px)]` в печати считается от ВЫСОТЫ ЛИСТА, то
       есть подложка растягивалась минимум на страницу независимо от
       объёма бланка и вместе с вертикальными паддингами выдавливала
       лишний пустой лист. Белая подложка нужна только экрану. */
    <DomainMessagesBoundary namespaces={["journalFields", "journalForm", "journalWidgets", "hygiene", "reports", "journalDocGuides", "journalFillingGuides", "journalUi", ...journalMessages]}>
    <div className="relative left-1/2 -my-4 min-h-[calc(100vh-140px)] w-[calc(100vw-var(--app-sidebar-w,0px))] -translate-x-1/2 bg-white py-4 md:-my-6 md:py-6 print:min-h-0 print:py-0 md:print:py-0">
      {/* 1800px — раздел журналов идёт во всю ширину экрана (R1).
          Широкие таблицы журналов скроллятся внутри собственного
          viewport-контейнера (JOURNAL_TABLE_VIEWPORT_CLASS). */}
      {/* space-y-3 — шаг «хлебные крошки → H1» эталона (12px). Дальше
          ритм страницы задают токены DOC_* из journal-responsive.ts. */}
      {/* px-4 md:px-8 — ВНУТРИ коробки 1800px, один в один как в <Header>
          и в контейнере (dashboard)/layout.tsx. Раньше padding стоял на
          full-bleed обёртке (снаружи коробки) и сдвигал весь раздел
          журналов на 24px влево относительно шапки. */}
      {/* pb-28 — запас под СТОПКУ плавающих кнопок в правом нижнем углу
          (поддержка + AI-помощник на `bottom-5`, «Как заполнять» на
          `bottom-[72px]`, все 44px). Раньше стояло pb-24 = 96px, а стопка
          занимает 72 + 44 = 116px, поэтому последняя строка таблицы
          документа не выскроллировалась выше кнопок. 112px + внешний
          `py-4/6` обёртки перекрывают стопку с запасом. */}
      {/* R5-5: `print:pb-0` — запас под FAB'ы ПУСТОЙ, и на бумаге эти
          112px превращались в лишний лист. У климата и фритюра печать
          давала третью страницу, полностью пустую: контент кончался в
          середине второй, а хвостовой padding дотягивал высоту до
          следующего листа. Кнопок в печати нет — запас под них не нужен. */}
      <div className="mx-auto w-full max-w-[1800px] space-y-3 px-4 pb-28 md:px-8 print:pb-0">
        {children}
        <JournalDocGuideOverlay />
      </div>
    </div>
    </DomainMessagesBoundary>
  );
}
