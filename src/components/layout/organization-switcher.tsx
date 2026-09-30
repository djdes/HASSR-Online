"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  FlaskConical,
  Loader2,
  Plus,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { splitCabinetMenu } from "@/lib/cabinet-menu";
import type { AccessibleOrganization } from "@/lib/organization-access";

/**
 * Список организаций аккаунта в меню профиля + создание новой точки.
 *
 * Страницы остаются одно-организационными: мы не сводим данные разных
 * точек в один экран, а переключаем активную. Так проще и честнее —
 * журнал, задача и сотрудник всегда принадлежат одному объекту.
 *
 * Мастер-кабинеты справочников сюда не попадают: у них своя оболочка
 * `/master`, и в меню профиля они стоят в разделе «Кабинет»
 * (`lib/cabinet-menu.ts`).
 *
 * Модалки создания (организации и демо) живут у родителя: этот список
 * рендерится внутри Radix-меню с transform/overflow, и `fixed`-оверлей
 * из него не выберется — его бы обрезало по ширине меню.
 */

/** Модалки создания из меню профиля; "master-cabinet" — пункт раздела «Кабинет». */
export type CreateDialogKind = "organization" | "demo" | "master-cabinet";

export function OrganizationSwitcher({
  organizations: allOrganizations,
  activeId,
  canCreate,
  onOpenCreate,
  label = "Организации",
}: {
  organizations: AccessibleOrganization[];
  activeId: string;
  canCreate: boolean;
  /** Открыть модалку создания; без callback'а кнопки создания не показываются. */
  onOpenCreate?: (kind: CreateDialogKind) => void;
  /** Заголовок группы: в меню профиля «Организации», в nav-пилюле — «Сменить организацию». */
  label?: string;
}) {
  const router = useRouter();
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const canOpenCreate = canCreate && Boolean(onOpenCreate);
  const { organizations } = splitCabinetMenu(allOrganizations);

  // Одна организация и создавать нельзя — показывать нечего.
  if (organizations.length < 2 && !canOpenCreate) return null;

  const hasDemo = organizations.some((organization) => organization.isDemo);

  async function switchTo(organization: AccessibleOrganization) {
    if (organization.id === activeId) return;
    setSwitchingId(organization.id);
    try {
      const response = await fetch("/api/me/active-organization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: organization.id }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? "Не удалось переключиться");
      toast.success(`Переключено: ${organization.name}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setSwitchingId(null);
    }
  }

  return (
    <>
      <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">
        {label}
      </div>
      {organizations.map((organization) => {
        const active = organization.id === activeId;
        const Icon = organization.isDemo ? FlaskConical : Building2;
        return (
          <button
            key={organization.id}
            type="button"
            onClick={() => switchTo(organization)}
            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[14px] transition-colors ${
              active
                ? "bg-[#f5f6ff] text-[#0b1024]"
                : "text-[#3c4053] hover:bg-[#f5f6ff]"
            }`}
          >
            <Icon
              className={`size-4 shrink-0 ${
                organization.isDemo ? "text-[#5566f6]" : "text-[#9b9fb3]"
              }`}
            />
            <span className="min-w-0 flex-1 truncate">{organization.name}</span>
            {organization.isDemo ? (
              <span className="shrink-0 rounded-full bg-[#eef1ff] px-2 py-0.5 text-[11px] font-medium text-[#3848c7]">
                Демо
              </span>
            ) : null}
            {switchingId === organization.id ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-[#5566f6]" />
            ) : active ? (
              <Check className="size-4 shrink-0 text-[#5566f6]" />
            ) : null}
          </button>
        );
      })}

      {canOpenCreate ? (
        <button
          type="button"
          onClick={() => onOpenCreate?.("organization")}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[14px] text-[#5566f6] transition-colors hover:bg-[#f5f6ff]"
        >
          <Plus className="size-4 shrink-0" />
          Добавить организацию
        </button>
      ) : null}

      {/* Второй вход в демо — для тех, кто в анкете нажал просто «Готово».
          Сфера и последствия подтверждаются в модалке, а не создаются молча. */}
      {canOpenCreate && !hasDemo ? (
        <button
          type="button"
          onClick={() => onOpenCreate?.("demo")}
          title="Отдельная тестовая организация с сотрудниками и заполненными журналами. Удалится через 7 дней или по кнопке."
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[14px] text-[#5566f6] transition-colors hover:bg-[#f5f6ff]"
        >
          <Sparkles className="size-4 shrink-0" />
          Создать демо-организацию
        </button>
      ) : null}
    </>
  );
}
