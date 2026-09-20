"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Pre-set CAPA scenarios — частые случаи, чтобы менеджер не писал
 * с нуля. После выбора подставляются title/description/priority/
 * category/slaHours, можно редактировать.
 */
type CapaTemplate = {
  id: string;
  label: string;
  title: string;
  description: string;
  priority: string;
  category: string;
  slaHours: string;
};

const CAPA_TEMPLATES: CapaTemplate[] = [
  {
    id: "temp_high",
    label: "Превышение t° холодильника > 6 ч",
    title: "Превышение t° холодильника",
    description:
      "Холодильник [номер] показывал температуру выше нормы (+2..+6°C) более 6 часов подряд.\n\nДата: [дата]\nВремя: [время начала] — [время фиксации]\nЗафиксировано: [°C]\nДопуск: +2..+6°C",
    priority: "high",
    category: "temperature",
    slaHours: "24",
  },
  {
    id: "rejected_supply",
    label: "Бракованная партия от поставщика",
    title: "Бракованная партия — [продукт]",
    description:
      "Входной контроль выявил несоответствие принимаемой партии:\n\nПродукт: [название]\nПоставщик: [имя]\nПричина брака: [упаковка / срок / органолептика / маркировка]\nКол-во: [кг]\nДействия: партия возвращена / уничтожена / на складе под изоляцией",
    priority: "high",
    category: "quality",
    slaHours: "24",
  },
  {
    id: "hygiene_violation",
    label: "Нарушение гигиены сотрудником",
    title: "Нарушение санитарных правил — [имя]",
    description:
      "Сотрудник [имя] не допущен к работе из-за:\n\n— симптомов ОРВИ / ЖКТ\n— ран на руках\n— просроченной медкнижки\n— несоблюдения формы\n\nПринятые меры: [отстранение / медосмотр / замена]",
    priority: "high",
    category: "hygiene",
    slaHours: "24",
  },
  {
    id: "ccp_breach",
    label: "Выход за пределы ККТ",
    title: "ККТ за пределами критических лимитов",
    description:
      "Критическая контрольная точка [название] вышла за пределы:\n\nФакт: [значение]\nДопуск: [диапазон]\nПродукция за этот период: [партии]\nДействия: продукция изолирована / отбракована / переработана",
    priority: "critical",
    category: "process",
    slaHours: "2",
  },
  {
    id: "equipment_failure",
    label: "Поломка оборудования",
    title: "Поломка [оборудование]",
    description:
      "Оборудование [название] вышло из строя:\n\nДата: [дата]\nХарактер поломки: [описание]\nПричина: [предполагаемая]\nПринятые меры: ремонт / замена / временный обход\nИсполнитель: [подрядчик]",
    priority: "medium",
    category: "equipment",
    slaHours: "48",
  },
  {
    id: "pest_sighting",
    label: "Обнаружены вредители",
    title: "Обнаружены [тип] вредителей",
    description:
      "На территории кухни / склада обнаружены признаки наличия:\n\nГде: [помещение]\nЧто: [грызуны / насекомые / следы]\nДата: [дата]\nДействия: вызвана дез-станция [имя], проведена обработка, повторный осмотр через 7 дней",
    priority: "high",
    category: "process",
    slaHours: "24",
  },
  {
    id: "glass_breakage",
    label: "Разбитие стекла / хрупкого пластика",
    title: "Разбитие [предмет] на производстве",
    description:
      "На производстве разбито:\n\nЧто: [предмет]\nГде: [зона]\nДата/время: [дата]\nДействия: зона изолирована, продукция в радиусе 3 м проверена и [списана / допущена]; осколки собраны и утилизированы.",
    priority: "high",
    category: "quality",
    slaHours: "24",
  },
  {
    id: "training_overdue",
    label: "Просрочка обучения сотрудников",
    title: "Просрочено обучение по СанПиН",
    description:
      "Сотрудники с просроченным обучением:\n\n[ФИО, должность, дата истечения]\n\nЗапланировано обучение: [дата].\nДо обучения отстранены от работы с продуктом.",
    priority: "medium",
    category: "hygiene",
    slaHours: "48",
  },
];

/**
 * Срок устранения, который подразумевает сам приоритет — ровно те
 * часы, что написаны в его подписи («Критический (2ч)»). Раньше выбор
 * «Критический» оставлял в поле срока прежние 24 часа, и подпись
 * приоритета противоречила сроку прямо в одной форме.
 */
export const PRIORITY_SLA_HOURS: Record<string, string> = {
  critical: "2",
  high: "24",
  medium: "48",
  low: "72",
};

interface Props {
  users: { id: string; name: string }[];
}

export function CapaForm({ users }: Props) {
  const router = useRouter();
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [priority, setPriority] = useState("medium");
  const [category, setCategory] = useState("other");
  const [slaHours, setSlaHours] = useState("24");
  const [assignedToId, setAssignedToId] = useState("");
  const [templateId, setTemplateId] = useState("");
  // Человек сам выставил срок — больше его не трогаем.
  const [slaTouched, setSlaTouched] = useState(false);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const tpl = CAPA_TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    if (titleRef.current) titleRef.current.value = tpl.title;
    if (descRef.current) descRef.current.value = tpl.description;
    setPriority(tpl.priority);
    setCategory(tpl.category);
    setSlaHours(tpl.slaHours);
    setSlaTouched(false);
  }

  function handlePriorityChange(next: string) {
    setPriority(next);
    if (slaTouched) return;
    const hours = PRIORITY_SLA_HOURS[next];
    if (hours) setSlaHours(hours);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/capa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description") || null,
          priority,
          category,
          slaHours: Number(slaHours),
          assignedToId: assignedToId || null,
          dueDate: form.get("dueDate") || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Ошибка");
      }
      const ticket = await res.json();
      router.push(`/capa/${ticket.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-2">
        <Label>Шаблон (опционально)</Label>
        <Select value={templateId} onValueChange={applyTemplate}>
          <SelectTrigger>
            <SelectValue placeholder="Выберите типовой сценарий..." />
          </SelectTrigger>
          <SelectContent>
            {CAPA_TEMPLATES.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[12px] text-[#6f7282]">
          После выбора шаблона поля ниже заполнятся — отредактируйте под
          конкретный инцидент.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="title">Название проблемы *</Label>
        <Input
          id="title"
          name="title"
          required
          ref={titleRef}
          placeholder="Кратко опишите отклонение"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Описание</Label>
        <Textarea
          id="description"
          name="description"
          ref={descRef}
          rows={6}
          placeholder="Подробное описание: что произошло, где, когда"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <div className="space-y-2">
          <Label>Приоритет</Label>
          <Select value={priority} onValueChange={handlePriorityChange}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="critical">Критический (2ч)</SelectItem>
              <SelectItem value="high">Высокий (24ч)</SelectItem>
              <SelectItem value="medium">Средний (48ч)</SelectItem>
              <SelectItem value="low">Низкий (72ч)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Категория</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="temperature">Температура</SelectItem>
              <SelectItem value="hygiene">Гигиена</SelectItem>
              <SelectItem value="packaging">Упаковка</SelectItem>
              <SelectItem value="quality">Качество</SelectItem>
              <SelectItem value="process">Процесс</SelectItem>
              <SelectItem value="equipment">Оборудование</SelectItem>
              <SelectItem value="other">Другое</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <div className="space-y-2">
          <Label>Срок устранения, часов</Label>
          <Select
            value={slaHours}
            onValueChange={(next) => {
              setSlaTouched(true);
              setSlaHours(next);
            }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2 часа</SelectItem>
              <SelectItem value="24">24 часа</SelectItem>
              <SelectItem value="48">48 часов</SelectItem>
              <SelectItem value="72">72 часа</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Ответственный</Label>
          <Select value={assignedToId} onValueChange={setAssignedToId}>
            <SelectTrigger><SelectValue placeholder="Выберите..." /></SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Создание..." : "Создать нарушение"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/capa")}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
