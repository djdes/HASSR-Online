/**
 * Типовые пункты чек-листов для журналов, которые сфера предлагает
 * настроить при начальной настройке (`SphereRules.checklistJournals`).
 *
 * Зачем: пустой чек-лист у журнала уборки — это «помой кухню» без
 * подробностей, и новый сотрудник не понимает, что именно от него ждут.
 * Здесь готовый набор конкретных действий (UX-принцип 3: «1) возьми… →
 * 2) … → 3) …»), который менеджер вставляет одним нажатием и потом
 * правит под себя в `/settings/journal-checklists/<code>`.
 *
 * Как пункты ложатся в `JournalChecklistItem`:
 *   title     → label
 *   hint      → hint
 *   required  → required
 *   frequency → frequency ("daily" | "weekly" | "monthly")
 *   weekDays  → weekDays (ISO: 1 = Пн … 7 = Вс; только для weekly)
 *   monthDay  → monthDay (1–31; только для monthly)
 *   category  → НЕ пишется в `JournalChecklistItem.category`: там значения
 *               "current"/"general" зарезервированы под автосинхронизацию
 *               уборки помещений. Здесь это только группа для показа.
 *
 * Тексты — своими словами, по общим требованиям санитарных правил к
 * уборке, дезинфекции, хранению и эксплуатации бассейнов; номера пунктов
 * нормативов не приводим.
 */

export type DefaultChecklistFrequency = "daily" | "weekly" | "monthly";

export type DefaultChecklistItem = {
  title: string;
  frequency: DefaultChecklistFrequency;
  required: boolean;
  /** Группа для показа в интерфейсе («Кухня», «Зал»…). */
  category?: string;
  /** Уточнение под пунктом: чем, сколько, куда записать. */
  hint?: string;
  /** Для weekly: дни недели, ISO (1 = Пн … 7 = Вс). */
  weekDays?: number[];
  /** Для monthly: день месяца. */
  monthDay?: number;
};

export const CHECKLIST_DEFAULTS: Record<string, DefaultChecklistItem[]> = {
  cleaning: [
    {
      title: "1) Наденьте фартук и перчатки для уборки → 2) возьмите промаркированный инвентарь «Для столов» → 3) протрите рабочие столы и полки моющим раствором",
      frequency: "daily",
      required: true,
      category: "Кухня",
      hint: "Инвентарь для столов и для пола — разный, по цвету маркировки.",
    },
    {
      title: "Протрите ручки дверей, холодильников и выключатели дезинфицирующим раствором",
      frequency: "daily",
      required: true,
      category: "Кухня",
    },
    {
      title: "1) Вынесите мусор из всех баков → 2) вымойте баки → 3) вставьте новые пакеты",
      frequency: "daily",
      required: true,
      category: "Кухня",
    },
    {
      title: "1) Уберите со стола посуду и крошки → 2) протрите столы и стулья в зале → 3) проверьте солонки и салфетницы",
      frequency: "daily",
      required: true,
      category: "Зал",
    },
    {
      title: "Вымойте полы: сначала зал, затем кухня; инвентарь «Для пола» после работы промойте и просушите",
      frequency: "daily",
      required: true,
      hint: "Пол моют от дальней стены к выходу, чтобы не ходить по вымытому.",
    },
    {
      title: "1) Вымойте раковины и смесители → 2) протрите зеркала → 3) пополните мыло, антисептик и бумажные полотенца в санузле",
      frequency: "daily",
      required: true,
      category: "Санузел",
    },
    {
      title: "Разведите рабочий раствор дезсредства по инструкции и запишите это в журнал учёта дезсредств",
      frequency: "daily",
      required: false,
      hint: "Концентрация и время выдержки — на этикетке средства.",
    },
  ],
  general_cleaning: [
    {
      title: "1) Выключите и обесточьте оборудование → 2) уберите продукты и посуду с полок и столов в чистую зону",
      frequency: "monthly",
      monthDay: 1,
      required: true,
    },
    {
      title: "Вымойте стены, двери и подоконники на всю высоту, затем обработайте их дезинфицирующим раствором",
      frequency: "monthly",
      monthDay: 1,
      required: true,
    },
    {
      title: "Вымойте осветительные приборы, решётки вентиляции и радиаторы",
      frequency: "monthly",
      monthDay: 1,
      required: true,
    },
    {
      title: "1) Разморозьте и вымойте холодильники → 2) обработайте полки и уплотнители дезсредством → 3) промойте водой и просушите",
      frequency: "monthly",
      monthDay: 1,
      required: true,
    },
    {
      title: "Сдвиньте передвижное оборудование и вымойте пол под ним и за ним",
      frequency: "monthly",
      monthDay: 1,
      required: true,
    },
    {
      title: "После уборки проветрите помещение и включите бактерицидную установку, если она есть",
      frequency: "monthly",
      monthDay: 1,
      required: false,
    },
  ],
  disinfectant_usage: [
    {
      title: "Проверьте срок годности дезсредства и целостность упаковки перед приготовлением раствора",
      frequency: "daily",
      required: true,
    },
    {
      title: "1) Наденьте перчатки и защитные очки → 2) отмерьте средство мерной ёмкостью → 3) разведите водой по инструкции",
      frequency: "daily",
      required: true,
      hint: "Никогда не «на глаз»: слабый раствор не работает, крепкий опасен.",
    },
    {
      title: "Подпишите ёмкость с раствором: название средства, концентрация, дата и время приготовления",
      frequency: "daily",
      required: true,
    },
    {
      title: "Запишите в журнал, сколько средства израсходовано и на какую площадь или инвентарь",
      frequency: "daily",
      required: true,
    },
    {
      title: "Храните дезсредства в закрытом шкафу отдельно от продуктов, ключ — у ответственного",
      frequency: "daily",
      required: true,
    },
    {
      title: "Сверьте остаток дезсредств на складе с записями журнала",
      frequency: "weekly",
      weekDays: [5],
      required: false,
    },
  ],
  cold_equipment_control: [
    {
      title: "1) Откройте холодильник → 2) посмотрите термометр → 3) запишите показания в журнал",
      frequency: "daily",
      required: true,
      hint: "Утром до начала работы и вечером перед уходом.",
    },
    {
      title: "Если температура вне нормы — переложите продукты в исправный холодильник и сообщите руководителю",
      frequency: "daily",
      required: true,
    },
    {
      title: "Проверьте, что двери плотно закрываются, а уплотнители целые",
      frequency: "daily",
      required: true,
    },
    {
      title: "Проверьте товарное соседство: сырое отдельно от готового, всё накрыто и промаркировано",
      frequency: "daily",
      required: true,
    },
    {
      title: "Уберите продукты с истёкшим сроком годности и отметьте их списание",
      frequency: "daily",
      required: true,
    },
    {
      title: "Удалите наледь в морозильных камерах, если её толщина больше 5 мм",
      frequency: "weekly",
      weekDays: [1],
      required: false,
    },
  ],
  uv_lamp_runtime: [
    {
      title: "1) Убедитесь, что в помещении нет людей → 2) закройте дверь → 3) включите бактерицидную установку",
      frequency: "daily",
      required: true,
      hint: "Открытые облучатели включают только в пустом помещении.",
    },
    {
      title: "Запишите время включения и выключения установки в журнал",
      frequency: "daily",
      required: true,
    },
    {
      title: "После выключения проветрите помещение не менее 15 минут, затем пускайте людей",
      frequency: "daily",
      required: true,
    },
    {
      title: "Протрите лампы и корпус облучателя сухой салфеткой при выключенной установке",
      frequency: "weekly",
      weekDays: [1],
      required: true,
    },
    {
      title: "Сверьте наработку ламп с ресурсом из паспорта; если ресурс выработан — заявка на замену",
      frequency: "monthly",
      monthDay: 1,
      required: true,
    },
  ],
  pool_water_control: [
    {
      title: "1) До открытия возьмите пробу воды в чистую колбу → 2) измерьте свободный и связанный хлор и pH тестером → 3) запишите в журнал",
      frequency: "daily",
      required: true,
      hint: "Повторяйте замеры по графику производственного контроля в течение дня.",
    },
    {
      title: "Измерьте температуру воды и воздуха в зале бассейна",
      frequency: "daily",
      required: true,
    },
    {
      title: "Проверьте прозрачность: разметка и дно бассейна должны быть хорошо видны",
      frequency: "daily",
      required: true,
    },
    {
      title: "Если показатели вне нормы — закройте бассейн для посетителей и сообщите руководителю",
      frequency: "daily",
      required: true,
    },
    {
      title: "Очистите переливные решётки и скиммеры, удалите мусор с поверхности воды",
      frequency: "daily",
      required: true,
    },
    {
      title: "Вымойте и продезинфицируйте обходные дорожки, душевые и ножные ванны",
      frequency: "daily",
      required: true,
    },
    {
      title: "Запишите число посетителей за сеанс",
      frequency: "daily",
      required: false,
    },
  ],
};

/** Типовые пункты чек-листа журнала; `[]`, если набора для журнала нет. */
export function defaultChecklistFor(code: string): DefaultChecklistItem[] {
  return CHECKLIST_DEFAULTS[code] ?? [];
}
