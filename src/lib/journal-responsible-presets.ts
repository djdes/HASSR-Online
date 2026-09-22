/**
 * Per-journal metadata + smart-preset rules. Каждый журнал ХАССП/СанПиН
 * имеет свой паттерн заполнения — некоторые ведутся всей бригадой
 * (уборка, гигиена сотрудников), некоторые — одним конкретным
 * человеком (бракераж готовой продукции, аудит). Этот файл описывает,
 * КТО на практике заполняет каждый журнал, и используется и на сервере
 * (apply-presets API), и в UI (подсказки на карточке журнала).
 *
 * Источники: реальная практика общепита по СанПиН 2.3/2.4.4282-26,
 * ТР ТС 021/2011, методические рекомендации Роспотребнадзора по ХАССП.
 *
 * Структура:
 *   - `who`: одна фраза «кто заполняет» — показываем юзеру.
 *   - `keywords`: подстроки, по которым матчим имена должностей в орге.
 *     Lowercase. Если ни одна не подошла — журнал останется без
 *     назначения (не дефолтим в «всем»).
 *   - `mode`: подсказка про fillMode шаблона (per-employee / shared /
 *     single). UI показывает label вверху карточки.
 *   - `category`: для группировки в UI и в списке пресетов.
 */

export type ResponsibilityMode =
  | "per-employee" // строка-на-сотрудника (гигиена, здоровье, медкнижки)
  | "shared" // одна запись на смену, может заполнять любой из набора (уборка, климат)
  | "single"; // конкретный «ответственный» (шеф-повар на бракераж, директор на аварии)

export type JournalCategory =
  | "cleaning"
  | "temperature"
  | "intake"
  | "health"
  | "equipment"
  | "training"
  | "incidents"
  | "audit"
  | "production"
  | "other";

export type JournalResponsibilityMeta = {
  code: string;
  who: string;
  keywords: readonly string[];
  mode: ResponsibilityMode;
  category: JournalCategory;
  /**
   * `true` если на практике это «один назначенный человек» (а не «любой
   * из должности»). UI подсказывает выбрать конкретного сотрудника как
   * defaultAssignee, а не просто положить должность.
   */
  preferNamedPerson?: boolean;
};

/**
 * Иерархия management-ключевых слов. РАЗДЕЛЕНА на 2 уровня:
 *
 *   • LEAD_KEYWORDS — обычные «руководители смены» (заведующая,
 *     управляющий, шеф, менеджер, директор, начальник, владелец,
 *     руководитель). На них fallback'ает любой журнал, у которого
 *     не нашлось специфичной должности (повар/уборщица/инженер).
 *
 *   • ADMIN_KEYWORDS — «главный админ» (админ, администратор).
 *     Умный пресет назначает его ТОЛЬКО на специальные журналы
 *     (медкнижки + аудиты). Для всех остальных он не появляется
 *     даже когда заведующей нет — вместо этого пресет оставит
 *     поле пустым, и менеджер сам выберет.
 *
 * Подстроки lowercase. Короткие корни покрывают словоформы:
 * «завед» → Заведующий/Заведующая/Заведующие/...
 *
 * 2026-04-30: пересмотр приоритетов по запросу пользователя —
 * заведующая/руководство первичны на оперативных журналах, а
 * админ светится только на медкнижках и аудите.
 */
const LEAD_KEYWORDS = [
  "завед",    // заведующая/заведующий — приоритетный руководитель смены
  "управляющ",
  "менеджер",
  "директор",
  "руководит",
  "началь",
  "владелец",
  "шеф",
] as const;

const ADMIN_KEYWORDS = ["админ"] as const;

/**
 * Back-compat: некоторые тесты и старые callers ожидают одну плоскую
 * MGMT_KEYWORDS с админом. Оставляем агрегатом, но используем только
 * как fallback в matchPositionsForJournal на самом дне приоритета.
 */
const MGMT_KEYWORDS = [...LEAD_KEYWORDS, ...ADMIN_KEYWORDS] as const;

/**
 * Per-journal exhaustive map. Если код добавлен в ACTIVE_JOURNAL_CATALOG,
 * добавляйте его и сюда — иначе UI «Умный пресет» для него не сработает.
 */
export const JOURNAL_RESPONSIBILITY_META: readonly JournalResponsibilityMeta[] = [
  // ═══ HEALTH & HYGIENE ═══
  {
    code: "hygiene",
    who: "Заведующий производством или шеф-повар перед сменой осматривает каждого сотрудника (чистая форма, отсутствие порезов, маникюр в норме) и ставит «допущен/не допущен» одним документом-списком на всех. По СанПиН — обязанность руководителя смены, не каждого работника.",
    keywords: ["завед", "шеф", "управляющ", "менеджер", ...LEAD_KEYWORDS],
    mode: "single",
    category: "health",
    preferNamedPerson: true,
  },
  {
    code: "health_check",
    who: "То же что гигиенический журнал — ХАССП на практике объединяет «здоровье» и «гигиену» в одну ежедневную проверку. Заполняет заведующий производством утром.",
    keywords: ["завед", "шеф", "управляющ", "менеджер", ...LEAD_KEYWORDS],
    mode: "single",
    category: "health",
    preferNamedPerson: true,
  },
  {
    code: "med_books",
    // Админ-исключение: медкнижки традиционно ведёт админ/HR (вместе
    // с заведующей/менеджером). Поэтому ADMIN_KEYWORDS включены.
    who: "Менеджер / отдел кадров ведёт реестр сроков годности медкнижек всех сотрудников.",
    keywords: ["кадр", ...LEAD_KEYWORDS, ...ADMIN_KEYWORDS],
    mode: "single",
    category: "health",
    preferNamedPerson: true,
  },

  // ═══ TEMPERATURE / CLIMATE ═══
  {
    code: "climate_control",
    who: "Дежурный повар или товаровед измеряет температуру и влажность в производственных и складских помещениях 2–3 раза в смену.",
    keywords: ["повар", "технолог", "товаровед", "кладов", ...LEAD_KEYWORDS],
    mode: "shared",
    category: "temperature",
  },
  {
    code: "cold_equipment_control",
    who: "Дежурный повар утром и вечером записывает температуру каждой холодильной/морозильной камеры. На крупных кухнях — отдельный сотрудник на цех.",
    keywords: ["повар", "су-шеф", ...LEAD_KEYWORDS],
    mode: "shared",
    category: "temperature",
  },
  {
    code: "intensive_cooling",
    who: "Повар, который готовит горячее блюдо, фиксирует время и температуру при охлаждении (CCP по ХАССП — критическая контрольная точка).",
    keywords: ["повар", "су-шеф", "технолог", ...LEAD_KEYWORDS],
    mode: "shared",
    category: "temperature",
  },
  {
    code: "fryer_oil",
    who: "Повар горячего цеха ежедневно проверяет качество фритюрного жира (цвет, запах, тестер на полярные соединения) и записывает замену.",
    keywords: ["повар", ...LEAD_KEYWORDS],
    mode: "shared",
    category: "temperature",
  },

  // ═══ CLEANING ═══
  {
    code: "cleaning",
    who: "Уборщица или клинер по итогам уборки помещения ставит подпись + указывает использованное средство.",
    keywords: ["уборщ", "клинер", "клининг", "санитар", "технич", ...LEAD_KEYWORDS],
    mode: "shared",
    category: "cleaning",
  },
  {
    code: "general_cleaning",
    who: "Бригада уборки + менеджер. Раз в месяц генеральная уборка по графику, акт подписывают уборщицы и контролирует управляющий.",
    keywords: ["уборщ", "клинер", "клининг", "санитар", ...LEAD_KEYWORDS],
    mode: "shared",
    category: "cleaning",
  },
  {
    code: "cleaning_ventilation_checklist",
    who: "Дежурный по смене (уборщица или повар) перед открытием/закрытием помещения проветривает и проверяет санитарное состояние по чек-листу.",
    keywords: ["уборщ", "клинер", "повар", "технич", ...LEAD_KEYWORDS],
    mode: "shared",
    category: "cleaning",
  },
  {
    code: "uv_lamp_runtime",
    who: "Тот, кто включает/выключает бактерицидную лампу (обычно уборщица или дежурный повар) — фиксирует время старта и стопа.",
    keywords: ["уборщ", "клинер", "повар", "технич", ...LEAD_KEYWORDS],
    mode: "shared",
    category: "cleaning",
  },
  {
    code: "disinfectant_usage",
    who: "Старшая уборщица или клининг-менеджер записывает приход/расход дезсредств и концентрации рабочих растворов.",
    keywords: ["уборщ", "клинер", "клининг", "технолог", ...LEAD_KEYWORDS],
    mode: "shared",
    category: "cleaning",
  },
  {
    code: "sanitary_day_control",
    who: "Бригада уборки делает санитарный день раз в месяц по чек-листу, контролирует менеджер.",
    keywords: ["уборщ", "клинер", "санитар", ...LEAD_KEYWORDS],
    mode: "shared",
    category: "cleaning",
  },
  {
    code: "equipment_cleaning",
    who: "Повар или уборщица после смены моет оборудование (миксер, слайсер, мясорубку), записывает дату и средство.",
    keywords: ["уборщ", "клинер", "повар", ...LEAD_KEYWORDS],
    mode: "shared",
    category: "cleaning",
  },

  // ═══ INTAKE / RECEIVING ═══
  {
    code: "incoming_control",
    who: "Товаровед или зав.складом принимает поставку, сверяет с накладной, проверяет температурный режим, целостность упаковки.",
    keywords: ["товаровед", "кладов", "снабж", "приём", ...LEAD_KEYWORDS],
    mode: "shared",
    category: "intake",
  },
  {
    code: "incoming_raw_materials_control",
    who: "То же что «приёмка» — слитый журнал входного контроля.",
    keywords: ["товаровед", "кладов", "снабж", "приём", ...LEAD_KEYWORDS],
    mode: "shared",
    category: "intake",
  },
  {
    code: "perishable_rejection",
    who: "Шеф-повар или товаровед при приёмке отбраковывает скоропорт (мясо, рыбу, молочку) с истекшим сроком или признаками порчи.",
    keywords: ["повар", "товаровед", "технолог", ...LEAD_KEYWORDS],
    mode: "shared",
    category: "intake",
  },
  {
    code: "metal_impurity",
    who: "Технолог / товаровед пропускает сырьё через металлодетектор или магнит-ловушку и записывает результат.",
    keywords: ["технолог", "товаровед", ...LEAD_KEYWORDS],
    mode: "shared",
    category: "intake",
  },
  {
    code: "traceability_test",
    who: "Технолог или менеджер качества раз в квартал проводит учения по прослеживаемости — отслеживает партию по цепочке от поставщика до тарелки.",
    keywords: ["технолог", ...LEAD_KEYWORDS],
    mode: "single",
    category: "intake",
    preferNamedPerson: true,
  },

  // ═══ PRODUCTION ═══
  {
    code: "finished_product",
    who: "Бракеражная комиссия (минимум 3 человека, обычно шеф-повар + су-шеф + менеджер) пробует и оценивает каждое блюдо перед выдачей. CCP по ХАССП.",
    keywords: ["повар", "технолог", ...LEAD_KEYWORDS],
    mode: "single",
    category: "production",
    preferNamedPerson: true,
  },
  {
    code: "product_writeoff",
    who: "Акт забраковки: подписывают шеф-повар, товаровед и управляющий — комиссия из 3 человек.",
    keywords: ["повар", "товаровед", ...LEAD_KEYWORDS],
    mode: "single",
    category: "production",
    preferNamedPerson: true,
  },

  // ═══ EQUIPMENT ═══
  {
    code: "equipment_calibration",
    who: "Технолог или назначенный инженер ведёт график поверки термометров, весов, психрометров (раз в год обычно).",
    keywords: ["технолог", "инженер", "техник", "механик", ...LEAD_KEYWORDS],
    mode: "single",
    category: "equipment",
    preferNamedPerson: true,
  },
  {
    code: "equipment_maintenance",
    who: "Инженер или техник по графику делает ТО оборудования (печи, холодильники, посудомойки).",
    keywords: ["инженер", "техник", "механик", "слесар", ...LEAD_KEYWORDS],
    mode: "single",
    category: "equipment",
    preferNamedPerson: true,
  },
  {
    code: "breakdown_history",
    who: "Тот же инженер фиксирует поломки и проведённый ремонт по карточке оборудования.",
    keywords: ["инженер", "техник", "механик", "слесар", ...LEAD_KEYWORDS],
    mode: "single",
    category: "equipment",
    preferNamedPerson: true,
  },
  {
    code: "glass_items_list",
    who: "Менеджер один раз заводит перечень стеклянных и хрупких предметов (лампы, бокалы, графины).",
    keywords: ["технолог", ...LEAD_KEYWORDS],
    mode: "single",
    category: "equipment",
    preferNamedPerson: true,
  },
  {
    code: "glass_control",
    who: "Дежурный по смене (повар или уборщица) проверяет целостность стеклянных предметов из перечня и фиксирует «всё цело» / «бой».",
    keywords: ["повар", "уборщ", "клинер", ...LEAD_KEYWORDS],
    mode: "shared",
    category: "equipment",
  },

  // ═══ TRAINING ═══
  {
    code: "training_plan",
    who: "Менеджер или технолог раз в год составляет план обучения и инструктажей для всех сотрудников.",
    keywords: ["технолог", ...LEAD_KEYWORDS],
    mode: "single",
    category: "training",
    preferNamedPerson: true,
  },
  {
    code: "staff_training",
    who: "Менеджер по обучению или заведующий производством проводит инструктажи (вводный, первичный, повторный, внеплановый) и заполняет журнал на всех сотрудников. Один документ.",
    keywords: ["технолог", "кадр", "завед", ...LEAD_KEYWORDS],
    mode: "single",
    category: "training",
    preferNamedPerson: true,
  },
  {
    code: "ppe_issuance",
    who: "Товаровед, заведующий производством или менеджер фиксирует выдачу СИЗ (перчатки, фартуки, маски) под подпись сотрудника. Один документ-реестр на всех.",
    keywords: ["товаровед", "кладов", "завед", "менеджер", ...LEAD_KEYWORDS],
    mode: "single",
    category: "training",
    preferNamedPerson: true,
  },

  // ═══ INCIDENTS ═══
  {
    code: "accident_journal",
    who: "Управляющий или директор регистрирует ЧП — пожар, травма, отравление, отключение электричества — и принятые меры.",
    keywords: [...LEAD_KEYWORDS],
    mode: "single",
    category: "incidents",
    preferNamedPerson: true,
  },
  {
    code: "complaint_register",
    who: "Менеджер зала или администратор записывает жалобы гостей и предпринятые действия.",
    keywords: [...LEAD_KEYWORDS],
    mode: "single",
    category: "incidents",
    preferNamedPerson: true,
  },
  {
    code: "pest_control",
    who: "Менеджер или директор отмечает визиты подрядчика (СЭС/договор на дезинсекцию) и собственные осмотры на наличие следов грызунов/насекомых.",
    keywords: ["технолог", ...LEAD_KEYWORDS],
    mode: "single",
    category: "incidents",
    preferNamedPerson: true,
  },

  // ═══ AUDIT ═══
  // Аудит: ADMIN_KEYWORDS включены умышленно — главный админ
  // традиционно курирует внутренний контроль/аудит, наряду с
  // технологом и заведующей.
  {
    code: "audit_plan",
    who: "Технолог или менеджер качества составляет годовой план внутренних аудитов.",
    keywords: ["технолог", ...LEAD_KEYWORDS, ...ADMIN_KEYWORDS],
    mode: "single",
    category: "audit",
    preferNamedPerson: true,
  },
  {
    code: "audit_protocol",
    who: "Аудитор (обычно технолог или внешний эксперт) фиксирует результаты проверок по чек-листу.",
    keywords: ["технолог", ...LEAD_KEYWORDS, ...ADMIN_KEYWORDS],
    mode: "single",
    category: "audit",
    preferNamedPerson: true,
  },
  {
    code: "audit_report",
    who: "Тот же аудитор пишет отчёт по итогам аудита с CAPA (корректирующими действиями).",
    keywords: ["технолог", ...LEAD_KEYWORDS, ...ADMIN_KEYWORDS],
    mode: "single",
    category: "audit",
    preferNamedPerson: true,
  },
];

const META_BY_CODE = new Map<string, JournalResponsibilityMeta>(
  JOURNAL_RESPONSIBILITY_META.map((m) => [m.code, m])
);

export function getJournalResponsibilityMeta(
  code: string
): JournalResponsibilityMeta | null {
  return META_BY_CODE.get(code) ?? null;
}

export const CATEGORY_LABELS: Record<JournalCategory, string> = {
  cleaning: "Уборка и санитария",
  temperature: "Температура и холод",
  intake: "Приёмка и сырьё",
  health: "Гигиена сотрудников",
  equipment: "Оборудование",
  training: "Обучение и СИЗ",
  incidents: "Инциденты и ЧП",
  audit: "Аудиты и контроль",
  production: "Бракераж и выпуск",
  other: "Прочее",
};

export const MODE_LABELS: Record<ResponsibilityMode, string> = {
  "per-employee": "На каждого сотрудника",
  shared: "Общая запись на смену",
  single: "Один ответственный",
};

/**
 * Подобрать должности из орги под keywords конкретного журнала.
 * Возвращает ids подходящих должностей. Если ни одна не подошла —
 * пустой массив (на клиенте показываем подсказку «нет подходящих
 * должностей, заведите/переименуйте»).
 *
 * Защитный fallback: если матчей нет, но журнал имеет mode "single"
 * или включает management-keywords — берём любую management-должность
 * из org по MGMT_KEYWORDS. Это покрывает реальный случай: маленькая
 * компания с одной должностью «Админ»/«Заведующая», которая делает
 * всю управленческую работу. Раньше пресет ругался «нет подходящих
 * должностей», хотя «Админ» — это и есть «менеджер» в этой компании.
 */
export function matchPositionsForJournal(
  code: string,
  positions: ReadonlyArray<{ id: string; name: string }>
): string[] {
  const meta = getJournalResponsibilityMeta(code);
  if (!meta) return [];
  if (meta.keywords.length === 0) return positions.map((p) => p.id);
  const matched: string[] = [];
  for (const p of positions) {
    const lower = p.name.toLowerCase();
    if (meta.keywords.some((kw) => lower.includes(kw))) {
      matched.push(p.id);
    }
  }
  if (matched.length > 0) {
    // Дополнительная фильтрация: если matched включает И «админа»,
    // И других руководителей (заведующая, шеф, менеджер), то админа
    // выкидываем — пресет старается не вешать оперативные журналы
    // на главного админа. Исключение — журналы где `keywords`
    // ЯВНО содержат "админ" (медкнижки/аудит); в их meta мы добавили
    // ADMIN_KEYWORDS специально, и ниже return оставит admin'а.
    const metaIncludesAdmin = ADMIN_KEYWORDS.some((kw) =>
      meta.keywords.includes(kw),
    );
    if (!metaIncludesAdmin) {
      const nonAdmin = matched.filter((id) => {
        const p = positions.find((pos) => pos.id === id);
        if (!p) return true;
        const lower = p.name.toLowerCase();
        return !ADMIN_KEYWORDS.some((kw) => lower.includes(kw));
      });
      if (nonAdmin.length > 0) return nonAdmin;
    }
    return matched;
  }
  // Fallback: руководители смены (БЕЗ админа). Админ светится только
  // на тех журналах где keywords его явно содержат — т.е. медкнижки
  // и аудит. Иначе пресет оставит поле пустым, и менеджер выберет
  // вручную (это лучше, чем по умолчанию повесить операционный
  // журнал на главного админа).
  const leadFallback: string[] = [];
  for (const p of positions) {
    const lower = p.name.toLowerCase();
    if (LEAD_KEYWORDS.some((kw) => lower.includes(kw))) {
      leadFallback.push(p.id);
    }
  }
  return leadFallback;
}

/**
 * Применить умные пресеты для всех журналов из meta-каталога.
 * Возвращает Map<code, Set<positionId>> — что класть в БД.
 */
export function computePresetAssignments(
  positions: ReadonlyArray<{ id: string; name: string }>
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const meta of JOURNAL_RESPONSIBILITY_META) {
    const ids = matchPositionsForJournal(meta.code, positions);
    if (ids.length === 0) continue;
    result.set(meta.code, new Set(ids));
  }
  return result;
}

// Back-compat: старый API экспортировал RESPONSIBLE_PRESETS как массив.
// Оставляем алиас, генерируя группы из category — для UI который
// показывает «Применить уборку», «Применить температуру» и т.д.
export type ResponsiblePreset = {
  id: string;
  label: string;
  description: string;
  journalCodes: readonly string[];
  positionKeywords: readonly string[];
};

/* ------------------------------------------------------------------ *
 * Пресеты доступа к журналам
 * ------------------------------------------------------------------ */

/**
 * Готовые наборы журналов для окна выдачи доступа.
 *
 * Матчим по ключевым словам ЖУРНАЛА, а не по должностям организации:
 * доступ выдают конкретному человеку, и кнопка «как у уборщицы» обязана
 * работать даже там, где должности «Уборщица» в штатке нет.
 *
 * `keywords: null` — «все журналы набора»: управляющий по смыслу видит
 * всё, и перечислять за него список бессмысленно.
 */
export type StaffAccessPreset = {
  id: string;
  label: string;
  keywords: readonly string[] | null;
};

export const STAFF_ACCESS_PRESETS: readonly StaffAccessPreset[] = [
  { id: "manager", label: "Как у управляющего", keywords: null },
  {
    id: "cook",
    label: "Как у повара",
    keywords: ["повар", "су-шеф", "шеф", "технолог", "кондитер"],
  },
  {
    id: "cleaner",
    label: "Как у уборщицы",
    keywords: ["уборщ", "клинер", "клининг", "санитар", "технич", "мойщи"],
  },
  {
    id: "intake",
    label: "Приёмка и склад",
    keywords: ["товаровед", "кладов", "снабж", "приём", "склад"],
  },
  {
    id: "tech",
    label: "Техник и оборудование",
    keywords: ["инженер", "техник", "механик", "слесар", "электрик"],
  },
] as const;

/**
 * Коды журналов пресета, суженные до активного набора организации.
 *
 * Выключенные журналы организация не ведёт, и предлагать доступ к ним —
 * значит спрашивать про то, чего в кабинете нет.
 */
export function presetJournalCodes(
  preset: StaffAccessPreset,
  activeCodes: readonly string[]
): string[] {
  const active = new Set(activeCodes);
  if (!preset.keywords) {
    return activeCodes.filter((code) => active.has(code));
  }
  const wanted = preset.keywords.map((word) => word.toLowerCase());
  return JOURNAL_RESPONSIBILITY_META.filter((meta) => {
    if (!active.has(meta.code)) return false;
    const haystack = [meta.who, ...meta.keywords].join(" ").toLowerCase();
    return wanted.some((word) => haystack.includes(word));
  }).map((meta) => meta.code);
}
