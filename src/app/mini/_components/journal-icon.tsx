"use client";

import {
  ClipboardList,
  Droplets,
  HeartPulse,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Utensils,
  type LucideProps,
} from "lucide-react";

import { journalIconName } from "@/lib/journal-label";

/**
 * Иконка задачи по виду журнала.
 *
 * Имя иконки считает общий помощник (`lib/journal-label.ts`) — его же
 * зовёт серверный маршрут списка задач. Сами компоненты lucide живут
 * здесь: функции через границу RSC не передаются.
 */
const ICONS: Record<string, React.ComponentType<LucideProps>> = {
  Sparkles,
  HeartPulse,
  Thermometer,
  Droplets,
  Utensils,
  ShieldCheck,
  ClipboardList,
};

export function JournalIcon({
  name,
  journalCode,
  className,
}: {
  /** Готовое имя иконки с сервера. */
  name?: string | null;
  /** Либо код журнала — имя подберём сами. */
  journalCode?: string | null;
  className?: string;
}) {
  const key = name ?? journalIconName(journalCode ?? "");
  const Icon = ICONS[key] ?? ClipboardList;
  return <Icon className={className} />;
}
