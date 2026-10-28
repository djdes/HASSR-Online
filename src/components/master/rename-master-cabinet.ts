"use client";

import type { useTranslations } from "next-intl";
import { toast } from "sonner";

import { promptAsync } from "@/components/ui/prompt-async";

const NAME_MIN = 2;
const NAME_MAX = 120;

/** `useTranslations("masterUi.renameMasterCabinet")` of the calling component. */
export type RenameMasterCabinetTranslator = ReturnType<typeof useTranslations<"masterUi.renameMasterCabinet">>;

/**
 * Окно «Переименовать мастер-кабинет» (шапка `/master` и
 * `/settings/master-cabinet`). Возвращает новое название или null
 * (отмена, без изменений, ошибка — тост уже показан).
 */
export async function renameMasterCabinetDialog(params: {
  currentName: string;
  endpoint: "/api/master/cabinet" | "/api/settings/master-cabinet";
  t: RenameMasterCabinetTranslator;
  /** Какой кабинет (`/api/settings/master-cabinet`: у организации их может быть несколько). */
  cabinetId?: string;
}): Promise<{ name: string; body: Record<string, unknown> } | null> {
  const { t } = params;
  const raw = await promptAsync({
    title: t("title"),
    description: t("description"),
    label: t("label"),
    placeholder: t("placeholder"),
    defaultValue: params.currentName,
    confirmLabel: t("save"),
    validate: (value) => {
      const name = value.replace(/\s+/g, " ").trim();
      if (name.length < NAME_MIN) return t("nameRequired");
      if (name.length > NAME_MAX) return t("nameTooLong", { max: NAME_MAX });
      return null;
    },
  });
  if (raw === null) return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (name === params.currentName) return null;
  const response = await fetch(params.endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params.cabinetId ? { name, cabinetId: params.cabinetId } : { name }),
  }).catch(() => null);
  const body = ((await response?.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (!response?.ok) {
    toast.error(typeof body.error === "string" ? body.error : t("renameFailed"));
    return null;
  }
  toast.success(t("renamed", { name }));
  return { name: typeof body.name === "string" ? body.name : name, body };
}
