"use client";

import { toast } from "sonner";

import { promptAsync } from "@/components/ui/prompt-async";

const NAME_MIN = 2;
const NAME_MAX = 120;

/**
 * Окно «Переименовать мастер-кабинет» (шапка `/master` и
 * `/settings/master-cabinet`). Возвращает новое название или null
 * (отмена, без изменений, ошибка — тост уже показан).
 */
export async function renameMasterCabinetDialog(params: {
  currentName: string;
  endpoint: "/api/master/cabinet" | "/api/settings/master-cabinet";
}): Promise<{ name: string; body: Record<string, unknown> } | null> {
  const raw = await promptAsync({
    title: "Название мастер-кабинета",
    description:
      "Так кабинет называется в шапке, в списке организаций и в письмах сотрудникам. На журналы пищеблоков название не влияет.",
    label: "Название",
    placeholder: "Например: Мастер-кабинет Школы",
    defaultValue: params.currentName,
    confirmLabel: "Сохранить",
    validate: (value) => {
      const name = value.replace(/\s+/g, " ").trim();
      if (name.length < NAME_MIN) return "Введите название";
      if (name.length > NAME_MAX) return `Не длиннее ${NAME_MAX} символов`;
      return null;
    },
  });
  if (raw === null) return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (name === params.currentName) return null;
  const response = await fetch(params.endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).catch(() => null);
  const body = ((await response?.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (!response?.ok) {
    toast.error(typeof body.error === "string" ? body.error : "Не удалось переименовать кабинет");
    return null;
  }
  toast.success(`Кабинет переименован: «${name}»`);
  return { name: typeof body.name === "string" ? body.name : name, body };
}
