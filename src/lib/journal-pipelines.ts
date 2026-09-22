import { db } from "@/lib/db";

/**
 * Journal pipelines — пошаговые инструкции для каждого журнала.
 *
 * Зачем нужно: новая уборщица / повар / продавец впервые открывает
 * задачу — должно быть АБСОЛЮТНО ПОНЯТНО, что и как делать. Не общие
 * слова «помой холодный цех», а конкретные шаги:
 *   1. Возьми тряпку и моющее средство «Profimax 2%» (раствор уже
 *      разведён в синем ведре)
 *   2. Иди в холодный цех — это дверь напротив раздачи
 *   3. Протри столы, подоконники, ручки холодильников
 *   4. Сфотографируй результат
 *   5. Подпись смены ✓
 *
 * Хранится в `Organization.journalPipelinesJson` как:
 *   { "<journalCode>": { steps: [{ id, title, instruction?,
 *     checklist?: [...], requirePhoto?: boolean }] } }
 *
 * Если pipeline для journalCode не задан — Mini App падает обратно
 * на старую simplified-форму JOURNAL_FORMS.
 */

export type PipelineStep = {
  id: string;
  title: string;
  instruction?: string;
  /** Чек-лист пунктов внутри шага. Каждый требует тыка ✓. */
  checklist?: string[];
  /** Требовать фото-подтверждение шага. */
  requirePhoto?: boolean;
};

export type JournalPipeline = {
  steps: PipelineStep[];
  /** Опц. подсказка наверху pipeline'а — общий контекст. */
  intro?: string;
};

/**
 * Default pipelines — fallback если у org нет custom для journalCode.
 * Cleaning — самый детальный, подходит для демо. Остальные — общие.
 */
const DEFAULT_PIPELINES: Record<string, JournalPipeline> = {
  cleaning: {
    intro:
      "Уборка помещения. Следуй шагам по порядку — каждый отмечай ✓ как только сделал.",
    steps: [
      {
        id: "supplies",
        title: "Возьми инвентарь",
        instruction:
          "На стенде в раздевалке должны быть: тряпки (зелёная для пола, белая для поверхностей), ведро с тёплой водой, моющее средство «Profimax 2%», перчатки.",
        checklist: ["Тряпки взяты", "Ведро с водой готово", "Моющее средство", "Перчатки"],
      },
      {
        id: "navigate",
        title: "Иди в зону уборки",
        instruction:
          "Уточни у заведующего производством сегодняшнюю зону. Если в задаче указано «Холодный цех» — это дверь налево от раздачи.",
      },
      {
        id: "surfaces",
        title: "Протри поверхности",
        instruction:
          "Белой тряпкой с моющим. Сверху вниз — сначала подоконники, затем столы, шкафы, потом ручки холодильников.",
        checklist: ["Подоконники", "Столы", "Полки/шкафы", "Ручки холодильников"],
      },
      {
        id: "floor",
        title: "Помой пол",
        instruction:
          "Зелёной тряпкой с водой. От дальнего угла к выходу. Под столами и плитой обязательно.",
        checklist: ["Под столами", "У плиты", "Вдоль стен", "У выхода"],
      },
      {
        id: "photo",
        title: "Сфотографируй результат",
        instruction: "1 фото общего вида + 1 фото пола. Это для отчётности перед инспектором.",
        requirePhoto: true,
      },
      {
        id: "wrap",
        title: "Уберись после себя",
        instruction:
          "Отжми тряпки, ополосни ведро, поставь всё на место в раздевалку. Перчатки в мусор если порвались.",
      },
    ],
  },
  hygiene: {
    intro: "Утренний осмотр сотрудников — кто допущен, кто нет.",
    steps: [
      {
        id: "list",
        title: "Собери всех в гардеробной",
        instruction: "Линейный персонал — повара, продавцы, уборщики, официанты.",
      },
      {
        id: "check",
        title: "Проверь каждого",
        instruction:
          "Признаки ОРВИ (кашель, насморк, температура), повреждения рук (порезы, ожоги), опрятность формы. Если что-то не так — сними отметку «Все сотрудники допущены» и запиши в поле «Примечания», кого и почему не допустил.",
        checklist: ["Нет признаков ОРВИ", "Руки чистые без порезов", "Форма чистая"],
      },
      {
        id: "submit",
        title: "Сохрани результат",
        instruction:
          "Если всё в порядке — поставь отметку «Все сотрудники допущены». Если кого-то отстранил — опиши кого и почему в поле «Примечания».",
      },
    ],
  },
  cold_equipment_control: {
    intro: "Замер температуры холодильника. ВАЖНО — это критическая контрольная точка ХАССП.",
    steps: [
      {
        id: "thermometer",
        title: "Возьми термометр",
        instruction:
          "Калиброванный. На стенде у диспетчера. Должна быть отметка о поверке (раз в год).",
      },
      {
        id: "measure",
        title: "Замерь температуру",
        instruction:
          "Положи зонд внутрь между продуктами на 2 минуты. Не у двери, не у потока воздуха. Норма для холодильника: -5°C…+8°C, для морозильника: -30°C…-15°C.",
      },
      {
        id: "record",
        title: "Запиши значение",
        instruction:
          "В поле «Температура». Если вне нормы — ОБЯЗАТЕЛЬНО опиши в «Корректирующее действие» что сделал (отрегулировал термостат, перенёс продукты, вызвал ремонт).",
      },
      {
        id: "alarm",
        title: "Если красная зона",
        instruction:
          "Темп вне нормы → утилизировать скоропорт, ремонтник, уведомить заведующего производством (он получит уведомление автоматически после твоего «Завершить»).",
      },
    ],
  },
  finished_product: {
    intro: "Бракераж готовой пищевой продукции — комиссия проверяет органолептику.",
    steps: [
      {
        id: "gather",
        title: "Собери комиссию",
        instruction: "Минимум 2 человека: шеф + один из поваров (или администратор).",
      },
      {
        id: "appearance",
        title: "Внешний вид",
        instruction:
          "Цвет соответствует рецептуре, нет посторонних включений, форма правильная, порция выдержана.",
      },
      {
        id: "smell_taste",
        title: "Запах и вкус",
        instruction:
          "Запах свежий, без посторонних. Вкус соответствует. Температура подачи: горячее >+65°C, холодное <+14°C.",
      },
      {
        id: "decision",
        title: "Решение",
        instruction:
          "Если всё ок — отметь все чек-боксы и запиши блюдо. Если что-то не соответствует — сними отметку «Вкус соответствует» и опиши корректирующее действие (переделать / снять с раздачи).",
      },
    ],
  },
};

export async function getPipelineForJournal(
  organizationId: string,
  journalCode: string
): Promise<JournalPipeline | null> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { journalPipelinesJson: true },
  });
  const orgPipelines = (org?.journalPipelinesJson ?? {}) as Record<
    string,
    JournalPipeline
  >;
  // Org override берёт приоритет.
  if (orgPipelines[journalCode]?.steps?.length) {
    return orgPipelines[journalCode];
  }
  // Default fallback.
  return DEFAULT_PIPELINES[journalCode] ?? null;
}

export async function setPipelineForJournal(
  organizationId: string,
  journalCode: string,
  pipeline: JournalPipeline
): Promise<void> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { journalPipelinesJson: true },
  });
  const current = (org?.journalPipelinesJson ?? {}) as Record<string, JournalPipeline>;
  current[journalCode] = pipeline;
  await db.organization.update({
    where: { id: organizationId },
    data: { journalPipelinesJson: current as never },
  });
}

export async function deletePipelineForJournal(
  organizationId: string,
  journalCode: string
): Promise<void> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { journalPipelinesJson: true },
  });
  const current = (org?.journalPipelinesJson ?? {}) as Record<string, JournalPipeline>;
  delete current[journalCode];
  await db.organization.update({
    where: { id: organizationId },
    data: { journalPipelinesJson: current as never },
  });
}

export function getDefaultPipeline(journalCode: string): JournalPipeline | null {
  return DEFAULT_PIPELINES[journalCode] ?? null;
}
