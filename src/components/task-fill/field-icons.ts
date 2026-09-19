import {
  AlignLeft,
  Beaker,
  CalendarDays,
  CheckSquare,
  Clock,
  Droplets,
  FlaskConical,
  Hash,
  ListChecks,
  Package,
  PenLine,
  PencilLine,
  Percent,
  Ruler,
  Scale,
  Snowflake,
  Sparkles,
  Tag,
  Thermometer,
  Type,
  User as UserIcon,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TaskFormField } from "@/lib/tasksflow-adapters/task-form";

/**
 * Подбор иконки lucide для поля формы. По приоритету:
 *   1. По смысловым ключевым словам в `field.key` или `field.label`
 *      (термометр для температуры, часы для времени, флакон для
 *      моющих/дез-средств и т.п.).
 *   2. По типу поля (number → Hash, boolean → CheckSquare, date →
 *      CalendarDays, select → ListChecks, multiline → AlignLeft,
 *      обычный text → Type).
 *
 * Все иконки — outlined, без фона (фон рисует обёртка карточки).
 */
export function fieldIcon(field: TaskFormField): LucideIcon {
  const haystack = `${field.key ?? ""} ${field.label ?? ""}`.toLowerCase();

  // Температура / охлаждение
  if (
    /темпера|temp|°с|°c|нагрев|холод|охлажд|жар/i.test(haystack)
  ) {
    return Thermometer;
  }
  if (/морозильн|заморозк|frozen/i.test(haystack)) return Snowflake;

  // Время / часы / мин
  if (/время|чч:мм|hh:mm|часов|минут|таймер/i.test(haystack)) return Clock;

  // Дата
  if (/дата|date|число|месяц/i.test(haystack)) return CalendarDays;

  // Концентрация / процент
  if (/концентр|процент|%|содержани/i.test(haystack)) return Percent;

  // Моющие средства / химия
  if (
    /моющ|дез|дезинфек|раствор|хлор|щелочь|кислота|chemicals?/i.test(
      haystack,
    )
  ) {
    return FlaskConical;
  }
  if (/жидкост|вода|ополаскив/i.test(haystack)) return Droplets;
  if (/проба|анализ|посев|labtest|тест/i.test(haystack)) return Beaker;

  // Оборудование / поверка
  if (/оборудован|агрегат|холодильн|шкаф|плита|фритюр|machine/i.test(haystack)) {
    return Wrench;
  }

  // Меры / вес / объём
  if (/масса|вес|кг|г|грамм/i.test(haystack)) return Scale;
  if (/размер|длин|шир|высот/i.test(haystack)) return Ruler;

  // Сотрудник / подпись / фио
  if (/фио|сотрудник|работник|подпись|имя|user|name/i.test(haystack)) {
    return UserIcon;
  }

  // Партия / сырьё / продукт
  if (/партия|серия|lot|номер прод|сырьё|поставщик/i.test(haystack)) {
    return Package;
  }

  // Категория / тип / код
  if (/категори|тип|вид|код|марка|номер/i.test(haystack)) return Tag;

  // Подпись / комментарий / примечание
  if (/коммент|примеч|описан|note|comment/i.test(haystack)) return PencilLine;

  // По типу поля (fallback)
  switch (field.type) {
    case "time":
      return Clock;
    case "number":
      return Hash;
    case "boolean":
      return CheckSquare;
    case "date":
      return CalendarDays;
    case "select":
      return ListChecks;
    case "text":
      return field.multiline ? AlignLeft : Type;
    default:
      return PenLine;
  }
}

/**
 * Цвет иконки-tile background и foreground — по типу поля. Тёплые для
 * физических измерений, прохладные для текстовых, нейтральные для
 * чек-боксов.
 */
export function fieldIconTone(field: TaskFormField): {
  bg: string;
  fg: string;
} {
  const haystack = `${field.key ?? ""} ${field.label ?? ""}`.toLowerCase();

  // Температура — тёплый красный
  if (/темпера|temp|°с|°c|нагрев|жар/i.test(haystack)) {
    return { bg: "bg-rose-100", fg: "text-rose-600" };
  }
  if (/холод|охлажд|морозильн|заморозк/i.test(haystack)) {
    return { bg: "bg-sky-100", fg: "text-sky-600" };
  }

  // Время / дата — индиго
  if (/время|чч:мм|дата|date|число/i.test(haystack)) {
    return { bg: "bg-[#eef1ff]", fg: "text-[#3848c7]" };
  }

  // Химия / дезинфекция — фиолетовый
  if (
    /моющ|дез|дезинфек|раствор|хлор|концентр|процент|жидкост|раствор/i.test(
      haystack,
    )
  ) {
    return { bg: "bg-violet-100", fg: "text-violet-600" };
  }

  // Эффект «успех / контроль» — зелёный
  if (/проба|тест|анализ|готов|контрол/i.test(haystack)) {
    return { bg: "bg-emerald-100", fg: "text-emerald-700" };
  }

  // По типу
  switch (field.type) {
    case "boolean":
      return { bg: "bg-emerald-100", fg: "text-emerald-700" };
    case "number":
      return { bg: "bg-amber-100", fg: "text-amber-700" };
    case "time":
    case "date":
      return { bg: "bg-[#eef1ff]", fg: "text-[#3848c7]" };
    case "select":
      return { bg: "bg-[#f5f6ff]", fg: "text-[#5566f6]" };
    default:
      return { bg: "bg-[#eef1ff]", fg: "text-[#3848c7]" };
  }
}

/** Re-export для удобного использования (избегаем «неиспользованный импорт»). */
export const _icons = {
  Sparkles,
  PenLine,
};
