"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Settings, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { splitCabinetMenu } from "@/lib/cabinet-menu";
import type { AccessibleOrganization } from "@/lib/organization-access";
import { switchOrganizationAndOpen } from "@/lib/switch-organization";

/**
 * Список организаций аккаунта в меню профиля + создание новой точки.
 *
 * Страницы остаются одно-организационными: мы не сводим данные разных
 * точек в один экран, а переключаем активную. Так проще и честнее —
 * журнал, задача и сотрудник всегда принадлежат одному объекту.
 *
 * Строка — две кнопки (владелец, 2026-09-30): слева индикатор выбранной
 * (заполненный круг с галочкой и жирное название; у остальных пустой
 * круг — колонка ровная), нажатие по строке переключает; справа
 * шестерёнка «Настройки <название>» — одним нажатием переключает, если
 * нужно, и открывает настройки этой организации. Цели не меньше 40 px.
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

export const ORGANIZATION_SETTINGS_HREF = "/settings/organization";

export function OrganizationSwitcher({
  organizations: allOrganizations,
  activeId,
  canCreate,
  onOpenCreate,
  showSettings = false,
  onNavigate,
  label = "Организации",
}: {
  organizations: AccessibleOrganization[];
  activeId: string;
  canCreate: boolean;
  /** Открыть модалку создания; без callback'а кнопки создания не показываются. */
  onOpenCreate?: (kind: CreateDialogKind) => void;
  /** Шестерёнка настроек у каждой строки — тем, кому доступны настройки организации. */
  showSettings?: boolean;
  /** Переход внутри приложения (шестерёнка активной организации) — закрыть меню. */
  onNavigate?: () => void;
  /** Заголовок группы: в меню профиля «Организации», в nav-пилюле — «Сменить организацию». */
  label?: string;
}) {
  const router = useRouter();
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const canOpenCreate = canCreate && Boolean(onOpenCreate);
  const { organizations } = splitCabinetMenu(allOrganizations);

  // Одна организация и создавать нельзя — показывать нечего.
  if (organizations.length < 2 && !canOpenCreate) return null;

  const hasDemo = organizations.some((organization) => organization.isDemo);

  async function switchTo(organization: AccessibleOrganization) {
    if (organization.id === activeId || switchingId || settingsId) return;
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

  /** Настройки организации одним нажатием: переключиться (если нужно) и открыть. */
  async function openSettings(organization: AccessibleOrganization) {
    if (switchingId || settingsId) return;
    if (organization.id === activeId) {
      onNavigate?.();
      router.push(ORGANIZATION_SETTINGS_HREF);
      return;
    }
    setSettingsId(organization.id);
    try {
      // Полная загрузка: смена организации перевыпускает куку сессии.
      await switchOrganizationAndOpen(organization.id, ORGANIZATION_SETTINGS_HREF);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось открыть настройки");
      setSettingsId(null);
    }
  }

  return (
    <>
      <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">
        {label}
      </div>
      {organizations.map((organization) => {
        const active = organization.id === activeId;
        const busy = switchingId === organization.id;
        return (
          <div
            key={organization.id}
            className="flex items-center gap-1"
            data-testid="org-switcher-row"
            data-org-id={organization.id}
            data-active={active ? "true" : "false"}
          >
            <button
              type="button"
              onClick={() => void switchTo(organization)}
              aria-current={active ? "true" : undefined}
              className={`flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[14px] transition-colors ${
                active ? "bg-[#f5f6ff] text-[#0b1024]" : "text-[#3c4053] hover:bg-[#f5f6ff]"
              }`}
            >
              {/* Индикатор выбранной — слева, ровной колонкой у всех строк. */}
              <span
                aria-hidden
                data-testid="org-switcher-indicator"
                className={`flex size-5 shrink-0 items-center justify-center rounded-full ${
                  active ? "bg-[#5566f6] text-white" : "border-2 border-[#dcdfed]"
                }`}
              >
                {busy ? (
                  <Loader2 className="size-3 animate-spin text-[#5566f6]" />
                ) : active ? (
                  <Check className="size-3" strokeWidth={3} />
                ) : null}
              </span>
              <span className={`min-w-0 flex-1 truncate ${active ? "font-semibold" : ""}`}>
                {organization.name}
              </span>
              {organization.isDemo ? (
                <span className="shrink-0 rounded-full bg-[#eef1ff] px-2 py-0.5 text-[11px] font-medium text-[#3848c7]">
                  Демо
                </span>
              ) : null}
            </button>
            {showSettings ? (
              <button
                type="button"
                onClick={(event) => {
                  // Лист на телефоне закрывается по любому нажатию внутри —
                  // здесь держим его открытым, пока идёт переключение
                  // (виден спиннер); закроет `onNavigate` или переход.
                  event.stopPropagation();
                  void openSettings(organization);
                }}
                aria-label={`Настройки ${organization.name}`}
                title="Настройки организации"
                data-testid="org-switcher-settings"
                className="flex size-10 shrink-0 items-center justify-center rounded-xl text-[#6f7282] transition-colors hover:bg-[#f5f6ff] hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              >
                {settingsId === organization.id ? (
                  <Loader2 className="size-4 animate-spin text-[#5566f6]" />
                ) : (
                  <Settings className="size-4" />
                )}
              </button>
            ) : null}
          </div>
        );
      })}

      {canOpenCreate ? (
        <button
          type="button"
          onClick={() => onOpenCreate?.("organization")}
          className="flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[14px] text-[#5566f6] transition-colors hover:bg-[#f5f6ff]"
        >
          <Plus className="size-5 shrink-0" />
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
          className="flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[14px] text-[#5566f6] transition-colors hover:bg-[#f5f6ff]"
        >
          <Sparkles className="size-5 shrink-0" />
          Создать демо-организацию
        </button>
      ) : null}
    </>
  );
}
