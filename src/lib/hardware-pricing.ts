/**
 * Прайс оборудования для тарифа «Подписка + оборудование».
 *
 * Единственный источник правды: калькулятор на лендинге импортирует его
 * для отображения, а сервер — чтобы пересчитать сумму заказа. Сумме,
 * пришедшей с клиента, не доверяем: в `POST /api/payments/robokassa/create`
 * состав корзины приходит как `{ deviceId: qty }`, а рубли считаются здесь.
 *
 * Иконок тут нет намеренно — это модуль данных, который тянет и сервер.
 * Маппинг id → lucide-иконка живёт в самом калькуляторе.
 */

export type HardwareDevice = {
  id: string;
  title: string;
  price: number;
  /// "per-unit" — количество выбирает клиент; "flat" — одна галочка
  /// (разовый выезд, настройка).
  mode: "per-unit" | "flat";
  hint?: string;
  defaultQty?: number;
};

export const HARDWARE_DEVICES: HardwareDevice[] = [
  {
    id: "install",
    title: "Выездной монтаж и настройка",
    price: 9900,
    mode: "flat",
    hint: "Инженер приезжает на кухню, устанавливает датчики, настраивает профили и проводит обучение смены.",
    defaultQty: 1,
  },
  {
    id: "temp",
    title: "Датчик температуры",
    price: 3490,
    mode: "per-unit",
    hint: "Для холодильной или морозильной камеры — одна штука на одно оборудование.",
    defaultQty: 2,
  },
  {
    id: "thermo",
    title: "Термогигрометр",
    price: 2890,
    mode: "per-unit",
    hint: "Для контроля температуры и влажности в зале / цеху.",
    defaultQty: 1,
  },
  {
    id: "tablet",
    title: "Планшет для кухни",
    price: 12900,
    mode: "per-unit",
    hint: "10 дюймов, защитный чехол, предустановленный профиль. Клеится к стене в цехе.",
    defaultQty: 1,
  },
  {
    id: "nfc",
    title: "NFC-брелоки",
    price: 490,
    mode: "per-unit",
    hint: "Вход в журналы одним тапом — по одному на активную смену.",
    defaultQty: 5,
  },
];

export type HardwareBundleId = "solo" | "standard" | "network";

export type HardwareBundle = {
  id: HardwareBundleId;
  name: string;
  forWhom: string;
  /// Маркетинговый «крючок» — что выдыхают на месте.
  hook: string;
  popular?: boolean;
  /// Итоговое железо: device-id → qty.
  composition: Record<string, number>;
};

export const HARDWARE_BUNDLES: HardwareBundle[] = [
  {
    id: "solo",
    name: "Соло",
    forWhom: "1 точка, маленькая смена",
    hook: "Один датчик в основной холодильник, термогигрометр в цехе, NFC-вход для смены.",
    composition: { install: 1, temp: 1, thermo: 1, tablet: 0, nfc: 3 },
  },
  {
    id: "standard",
    name: "Кухня",
    forWhom: "Активная кухня, регулярные проверки",
    hook: "Все ключевые холодильники под датчиком, планшет на кухне, брелоки на всю смену.",
    popular: true,
    composition: { install: 1, temp: 2, thermo: 1, tablet: 1, nfc: 5 },
  },
  {
    id: "network",
    name: "Сетевой",
    forWhom: "Сеть из 2–3 точек или большое производство",
    hook: "Двойной выезд для разных адресов, расширенный набор датчиков и техники.",
    composition: { install: 2, temp: 5, thermo: 2, tablet: 2, nfc: 10 },
  },
];

/** Максимум единиц одной позиции — страховка от «999999 датчиков» в заказе. */
const MAX_QTY_PER_DEVICE = 99;

/**
 * Нормализует пришедший от клиента состав корзины: выкидывает неизвестные
 * id, отрицательные и нецелые количества, режет по потолку.
 */
export function normalizeHardwareConfig(
  raw: unknown,
): Record<string, number> {
  const result: Record<string, number> = {};
  if (typeof raw !== "object" || raw === null) return result;
  const source = raw as Record<string, unknown>;
  for (const device of HARDWARE_DEVICES) {
    const value = Number(source[device.id]);
    if (!Number.isFinite(value)) continue;
    const qty = Math.min(Math.max(0, Math.floor(value)), MAX_QTY_PER_DEVICE);
    if (qty > 0) result[device.id] = qty;
  }
  return result;
}

/** Стоимость железа по составу корзины, в рублях. */
export function hardwareTotal(config: Record<string, number>): number {
  return HARDWARE_DEVICES.reduce(
    (sum, device) => sum + device.price * (config[device.id] ?? 0),
    0,
  );
}

/** Стоимость готового пакета. */
export function bundleTotal(bundle: HardwareBundle): number {
  return hardwareTotal(bundle.composition);
}

/** Человекочитаемый состав заказа — для письма и Telegram-уведомления. */
export function describeHardwareConfig(
  config: Record<string, number>,
): string[] {
  return HARDWARE_DEVICES.filter((d) => (config[d.id] ?? 0) > 0).map(
    (d) => `${d.title} × ${config[d.id]} — ${d.price * config[d.id]} ₽`,
  );
}
