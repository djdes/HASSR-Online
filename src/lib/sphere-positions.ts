import type { OrgSphere } from "@/lib/org-profile";

/**
 * Подсказки должностей при заведении команды — свои для каждой сферы.
 *
 * Раньше чипы брались из онбординг-пресетов, а их шесть на четырнадцать сфер и
 * собирались они под производственный профиль, а не под язык заведения:
 * ресторану предлагались «Сотрудник» и «Технолог». Человек, который
 * первый раз заводит команду, должен узнавать свои должности с первого
 * взгляда и добавлять их в один клик, а не придумывать формулировки.
 *
 * Списки составлены по типовым штатным расписаниям отрасли (структура
 * «администрация / кухня / зал» у общепита, нормативы пищеблока у
 * школ и детсадов, цеховые должности у производства). Это подсказки, а
 * не справочник: название всегда можно поправить руками перед
 * сохранением.
 *
 * Деление на группы — по тому, кто проверяет работу, а кто её делает:
 * `management` попадает в «Руководство» и может подтверждать заполнение
 * журналов, `staff` — в «Сотрудников».
 */

export type PositionCategoryKey = "management" | "staff";

/**
 * Должность, которую анкета предлагает владельцу аккаунта. Она же —
 * категория, в которую он попадает: тот, кто завёл организацию,
 * подтверждает журналы, а не заполняет их.
 */
export const DEFAULT_OWNER_POSITION = "Директор";
export const OWNER_POSITION_CATEGORY: PositionCategoryKey = "management";

export type PositionSuggestion = { id: string; name: string };
type SpherePositions = Record<PositionCategoryKey, PositionSuggestion[]>;

export const SPHERE_POSITION_SUGGESTIONS: Record<OrgSphere, SpherePositions> = {
  restaurant: {
    management: [
      { id: "position_001", name: "Управляющий" },
      { id: "position_002", name: "Шеф-повар" },
      { id: "position_003", name: "Су-шеф" },
      { id: "position_004", name: "Менеджер смены" },
      { id: "position_005", name: "Метрдотель" },
      { id: "position_006", name: "Заведующий производством" },
      { id: "position_007", name: "Бухгалтер-калькулятор" },
    ],
    staff: [
      { id: "position_008", name: "Повар горячего цеха" },
      { id: "position_009", name: "Повар холодного цеха" },
      { id: "position_010", name: "Повар-универсал" },
      { id: "position_011", name: "Заготовщик" },
      { id: "position_012", name: "Кондитер" },
      { id: "position_013", name: "Официант" },
      { id: "position_014", name: "Бармен" },
      { id: "position_015", name: "Бариста" },
      { id: "position_016", name: "Хостес" },
      { id: "position_017", name: "Мойщик посуды" },
      { id: "position_018", name: "Кладовщик" },
      { id: "position_019", name: "Уборщик" },
    ],
  },
  cafe: {
    management: [
      { id: "position_001", name: "Управляющий" },
      { id: "position_020", name: "Администратор" },
      { id: "position_002", name: "Шеф-повар" },
      { id: "position_021", name: "Старший смены" },
    ],
    staff: [
      { id: "position_022", name: "Повар" },
      { id: "position_010", name: "Повар-универсал" },
      { id: "position_015", name: "Бариста" },
      { id: "position_013", name: "Официант" },
      { id: "position_023", name: "Кассир" },
      { id: "position_012", name: "Кондитер" },
      { id: "position_017", name: "Мойщик посуды" },
      { id: "position_018", name: "Кладовщик" },
      { id: "position_019", name: "Уборщик" },
    ],
  },
  fastfood: {
    management: [{ id: "position_001", name: "Управляющий" }, { id: "position_004", name: "Менеджер смены" }, { id: "position_021", name: "Старший смены" }],
    staff: [
      { id: "position_023", name: "Кассир" },
      { id: "position_024", name: "Сборщик заказов" },
      { id: "position_025", name: "Работник кухни" },
      { id: "position_026", name: "Оператор автораздачи" },
      { id: "position_027", name: "Работник зала" },
      { id: "position_017", name: "Мойщик посуды" },
      { id: "position_028", name: "Курьер" },
      { id: "position_019", name: "Уборщик" },
    ],
  },
  education: {
    management: [
      { id: "position_006", name: "Заведующий производством" },
      { id: "position_002", name: "Шеф-повар" },
      { id: "position_029", name: "Медицинская сестра" },
      { id: "position_030", name: "Ответственный за питание" },
    ],
    staff: [
      { id: "position_022", name: "Повар" },
      { id: "position_031", name: "Повар детского питания" },
      { id: "position_032", name: "Кухонный рабочий" },
      { id: "position_033", name: "Буфетчик" },
      { id: "position_017", name: "Мойщик посуды" },
      { id: "position_018", name: "Кладовщик" },
      { id: "position_034", name: "Подсобный рабочий" },
      { id: "position_035", name: "Уборщик служебных помещений" },
    ],
  },
  bakery: {
    management: [
      { id: "position_001", name: "Управляющий" },
      { id: "position_036", name: "Технолог" },
      { id: "position_006", name: "Заведующий производством" },
      { id: "position_037", name: "Начальник смены" },
    ],
    staff: [
      { id: "position_038", name: "Пекарь" },
      { id: "position_039", name: "Тестовод" },
      { id: "position_040", name: "Формовщик теста" },
      { id: "position_012", name: "Кондитер" },
      { id: "position_041", name: "Упаковщик" },
      { id: "position_042", name: "Продавец-кассир" },
      { id: "position_018", name: "Кладовщик" },
      { id: "position_019", name: "Уборщик" },
    ],
  },
  production: {
    management: [
      { id: "position_043", name: "Директор производства" },
      { id: "position_036", name: "Технолог" },
      { id: "position_044", name: "Начальник цеха" },
      { id: "position_045", name: "Мастер смены" },
      { id: "position_046", name: "Специалист по качеству" },
      { id: "position_047", name: "Заведующий складом" },
    ],
    staff: [
      { id: "position_048", name: "Оператор производственной линии" },
      { id: "position_049", name: "Аппаратчик" },
      { id: "position_050", name: "Фасовщик" },
      { id: "position_051", name: "Укладчик-упаковщик" },
      { id: "position_052", name: "Лаборант" },
      { id: "position_053", name: "Слесарь-наладчик" },
      { id: "position_018", name: "Кладовщик" },
      { id: "position_054", name: "Грузчик" },
      { id: "position_055", name: "Уборщик производственных помещений" },
    ],
  },
  bar: {
    management: [{ id: "position_001", name: "Управляющий" }, { id: "position_020", name: "Администратор" }, { id: "position_056", name: "Старший бармен" }],
    staff: [
      { id: "position_014", name: "Бармен" },
      { id: "position_057", name: "Барбэк (помощник бармена)" },
      { id: "position_013", name: "Официант" },
      { id: "position_023", name: "Кассир" },
      { id: "position_058", name: "Кальянщик" },
      { id: "position_017", name: "Мойщик посуды" },
      { id: "position_019", name: "Уборщик" },
    ],
  },
  canteen: {
    management: [
      { id: "position_006", name: "Заведующий производством" },
      { id: "position_059", name: "Директор столовой" },
      { id: "position_002", name: "Шеф-повар" },
      { id: "position_007", name: "Бухгалтер-калькулятор" },
    ],
    staff: [
      { id: "position_022", name: "Повар" },
      { id: "position_038", name: "Пекарь" },
      { id: "position_060", name: "Раздатчик" },
      { id: "position_032", name: "Кухонный рабочий" },
      { id: "position_023", name: "Кассир" },
      { id: "position_017", name: "Мойщик посуды" },
      { id: "position_018", name: "Кладовщик" },
      { id: "position_019", name: "Уборщик" },
    ],
  },
  catering: {
    management: [
      { id: "position_001", name: "Управляющий" },
      { id: "position_002", name: "Шеф-повар" },
      { id: "position_061", name: "Менеджер по кейтерингу" },
      { id: "position_062", name: "Логист" },
    ],
    staff: [
      { id: "position_022", name: "Повар" },
      { id: "position_010", name: "Повар-универсал" },
      { id: "position_024", name: "Сборщик заказов" },
      { id: "position_028", name: "Курьер" },
      { id: "position_063", name: "Водитель-экспедитор" },
      { id: "position_017", name: "Мойщик посуды" },
      { id: "position_018", name: "Кладовщик" },
      { id: "position_019", name: "Уборщик" },
    ],
  },
  hotel: {
    management: [
      { id: "position_064", name: "Управляющий отелем" },
      { id: "position_065", name: "Менеджер ресторана" },
      { id: "position_002", name: "Шеф-повар" },
      { id: "position_006", name: "Заведующий производством" },
      { id: "position_066", name: "Менеджер хаускипинга" },
    ],
    staff: [
      { id: "position_022", name: "Повар" },
      { id: "position_067", name: "Повар завтраков" },
      { id: "position_013", name: "Официант" },
      { id: "position_014", name: "Бармен" },
      { id: "position_068", name: "Горничная" },
      { id: "position_017", name: "Мойщик посуды" },
      { id: "position_018", name: "Кладовщик" },
      { id: "position_019", name: "Уборщик" },
    ],
  },
  retail: {
    management: [
      { id: "position_069", name: "Директор магазина" },
      { id: "position_070", name: "Администратор торгового зала" },
      { id: "position_071", name: "Товаровед" },
    ],
    staff: [
      { id: "position_042", name: "Продавец-кассир" },
      { id: "position_072", name: "Продавец кулинарии" },
      { id: "position_073", name: "Повар кулинарии" },
      { id: "position_050", name: "Фасовщик" },
      { id: "position_054", name: "Грузчик" },
      { id: "position_018", name: "Кладовщик" },
      { id: "position_019", name: "Уборщик" },
    ],
  },
  gas_station: {
    management: [{ id: "position_074", name: "Управляющий АЗС" }, { id: "position_021", name: "Старший смены" }],
    staff: [
      { id: "position_075", name: "Оператор-кассир" },
      { id: "position_042", name: "Продавец-кассир" },
      { id: "position_010", name: "Повар-универсал" },
      { id: "position_076", name: "Работник кафе" },
      { id: "position_077", name: "Заправщик" },
      { id: "position_019", name: "Уборщик" },
    ],
  },
  medical: {
    management: [
      { id: "position_078", name: "Заведующий пищеблоком" },
      { id: "position_079", name: "Врач-диетолог" },
      { id: "position_080", name: "Медицинская сестра диетическая" },
      { id: "position_002", name: "Шеф-повар" },
    ],
    staff: [
      { id: "position_022", name: "Повар" },
      { id: "position_032", name: "Кухонный рабочий" },
      { id: "position_033", name: "Буфетчик" },
      { id: "position_017", name: "Мойщик посуды" },
      { id: "position_018", name: "Кладовщик" },
      { id: "position_019", name: "Уборщик" },
    ],
  },
  fitness: {
    management: [
      { id: "position_001", name: "Управляющий" },
      { id: "position_020", name: "Администратор" },
      { id: "position_081", name: "Старший тренер" },
      { id: "position_082", name: "Главный инженер" },
    ],
    staff: [
      { id: "position_083", name: "Тренер" },
      { id: "position_084", name: "Инструктор бассейна" },
      { id: "position_085", name: "Техник бассейна" },
      { id: "position_086", name: "Уборщица" },
      { id: "position_087", name: "Бармен фитнес-бара" },
      { id: "position_029", name: "Медицинская сестра" },
    ],
  },
  beauty: {
    management: [{ id: "position_001", name: "Управляющий" }, { id: "position_020", name: "Администратор" }],
    staff: [
      { id: "position_088", name: "Парикмахер" },
      { id: "position_089", name: "Мастер маникюра" },
      { id: "position_090", name: "Косметолог" },
      { id: "position_086", name: "Уборщица" },
    ],
  },
  other: {
    management: [{ id: "position_001", name: "Управляющий" }, { id: "position_020", name: "Администратор" }, { id: "position_006", name: "Заведующий производством" }],
    staff: [
      { id: "position_022", name: "Повар" },
      { id: "position_042", name: "Продавец-кассир" },
      { id: "position_018", name: "Кладовщик" },
      { id: "position_019", name: "Уборщик" },
      { id: "position_091", name: "Сотрудник" },
    ],
  },
};

/**
 * Ключ сравнения названий должностей, нечувствительный к роду.
 *
 * «Заведующая производством» и «Заведующий производством» — одна и та
 * же должность, и предлагать вторую, когда первая уже заведена, —
 * значит плодить дубли. Обрезаем родовые окончания каждого слова:
 * этого достаточно для «заведующая/заведующий», «старшая/старший»,
 * «уборщица/уборщик». Полноценной морфологии здесь не нужно.
 */
export function positionMatchKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/\s+/)
    .map((word) =>
      // Порядок важен: длинные окончания проверяем раньше коротких,
      // иначе «уборщица» обрежется до «уборщиц», а «уборщик» — до
      // «уборщ», и пара снова разъедется.
      word.length > 5 ? word.replace(/(ица|ий|ый|ая|ой|ик)$/u, "") : word
    )
    .join(" ");
}

/**
 * Подсказки для конкретной рубрики минус то, что уже заведено.
 *
 * Сравниваем по ключу, нечувствительному к регистру и роду: «повар»,
 * «Повар » и «Заведующий» при заведённой «Заведующей» — не новые
 * должности, предлагать их второй раз бессмысленно.
 */
export function positionSuggestionsFor(
  sphere: OrgSphere,
  category: PositionCategoryKey,
  existingNames: Iterable<string>,
): string[] {
  const taken = new Set(Array.from(existingNames, positionMatchKey));
  const list =
    SPHERE_POSITION_SUGGESTIONS[sphere]?.[category] ??
    SPHERE_POSITION_SUGGESTIONS.other[category];
  return list.filter(({ name }) => !taken.has(positionMatchKey(name))).map(({ name }) => name);
}

export function positionSuggestionOptionsFor(
  sphere: OrgSphere,
  category: PositionCategoryKey,
  existingNames: Iterable<string>,
): PositionSuggestion[] {
  const taken = new Set(Array.from(existingNames, positionMatchKey));
  const list = SPHERE_POSITION_SUGGESTIONS[sphere]?.[category] ?? SPHERE_POSITION_SUGGESTIONS.other[category];
  return list.filter(({ name }) => !taken.has(positionMatchKey(name)));
}
