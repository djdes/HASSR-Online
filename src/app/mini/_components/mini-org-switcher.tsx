"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Library, Plus } from "lucide-react";
import { toast } from "sonner";
import { CreateMasterCabinetDialog } from "@/components/master/create-master-cabinet-dialog";
import { useOpenMasterCabinet } from "@/components/master/use-open-master-cabinet";
import { splitCabinetMenu } from "@/lib/cabinet-menu";
import type { AccessibleOrganization } from "@/lib/organization-access";

/**
 * Переключение организации в Mini App.
 *
 * П-3: если фича есть на сайте, она должна быть и в Telegram. Управляющая
 * сети открывает бота с телефона — и должна попасть в ту же точку, что и
 * на сайте, а не в ту, где её однажды завели.
 *
 * Список тянем клиентом: серверный `/mini/me` рендерится из сессии и
 * ничего не знает про членство, а лишний запрос на каждом заходе в
 * профиль дешевле, чем тянуть его в общий layout.
 *
 * Мастер-кабинеты справочников — не в списке организаций, а отдельной
 * карточкой «Кабинет», как в меню профиля сайта: нажатие переключает на
 * кабинет и открывает `/master` (`lib/cabinet-menu.ts`). Владельцу
 * аккаунта под кабинетами — «Создать мастер-кабинет» (сколько угодно).
 */
export function MiniOrgSwitcher() {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<AccessibleOrganization[]>(
    [],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [canCreateMaster, setCanCreateMaster] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const openMaster = useOpenMasterCabinet();

  const loadOrganizations = useCallback(async (isCancelled: () => boolean = () => false) => {
    try {
      const response = await fetch("/api/organizations", { cache: "no-store" });
      const data = response.ok ? await response.json() : null;
      if (isCancelled() || !data?.organizations) return;
      setOrganizations(data.organizations);
      setCanCreateMaster(data.canCreateMasterCabinet === true);
    } catch {
      // Список останется прежним — переключатель просто не обновится.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadOrganizations(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadOrganizations]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mini/home")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        const id = data?.user?.organizationId;
        if (typeof id === "string") setActiveId(id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const { organizations: regular, masterCabinets } = splitCabinetMenu(organizations);
  const showOrganizations = regular.length >= 2;
  const showCabinets = masterCabinets.length > 0 || canCreateMaster;
  if (!showOrganizations && !showCabinets) return null;

  async function switchTo(organization: AccessibleOrganization) {
    if (organization.id === activeId || busyId) return;
    setBusyId(organization.id);
    try {
      const response = await fetch("/api/me/active-organization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: organization.id }),
      });
      if (!response.ok) throw new Error();
      setActiveId(organization.id);
      toast.success(`Вы работаете в «${organization.name}»`);
      router.refresh();
    } catch {
      // Раньше сбой проходил молча, и человек не понимал, почему данные
      // остались от прежней организации. Тосты в Mini App уже есть.
      toast.error("Не удалось переключить организацию. Попробуйте ещё раз.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {showOrganizations ? (
        <section className="mini-card p-4">
          <div className="mini-label mb-2.5">Организация</div>
          <div className="space-y-2">
            {regular.map((organization) => {
              const active = organization.id === activeId;
              return (
                <button
                  key={organization.id}
                  type="button"
                  onClick={() => switchTo(organization)}
                  aria-pressed={active}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-[14px] border px-3.5 py-2.5 text-left text-[16px] font-semibold"
                  style={{
                    background: active ? "var(--mini-accent-soft)" : "var(--mini-surface-1)",
                    borderColor: active ? "var(--mini-accent)" : "var(--mini-divider-strong)",
                    color: "var(--mini-text)",
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{organization.name}</span>
                  {busyId === organization.id ? (
                    <span style={{ color: "var(--mini-text-muted)" }}>…</span>
                  ) : active ? (
                    <span style={{ color: "var(--mini-accent-ink)" }}>✓</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
      {showCabinets ? (
        <section className="mini-card p-4">
          <div className="mini-label mb-2.5">Кабинет</div>
          <div className="space-y-2">
            {masterCabinets.map((cabinet) => (
              <button
                key={cabinet.id}
                type="button"
                onClick={() => void openMaster.open(cabinet)}
                data-testid="mini-master-cabinet"
                className="flex min-h-12 w-full items-center gap-3 rounded-[14px] border px-3.5 py-2.5 text-left text-[16px] font-semibold"
                style={{
                  background: "var(--mini-surface-1)",
                  borderColor: "var(--mini-divider-strong)",
                  color: "var(--mini-text)",
                }}
              >
                <Library className="size-5 shrink-0" style={{ color: "var(--mini-accent-ink)" }} />
                <span className="min-w-0 flex-1 truncate">{cabinet.name}</span>
                {openMaster.openingId === cabinet.id ? (
                  <span style={{ color: "var(--mini-text-muted)" }}>…</span>
                ) : null}
              </button>
            ))}
            {canCreateMaster ? (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                data-testid="mini-create-master-cabinet"
                className="flex min-h-12 w-full items-center gap-3 rounded-[14px] border border-dashed px-3.5 py-2.5 text-left text-[16px] font-semibold"
                style={{
                  background: "var(--mini-surface-1)",
                  borderColor: "var(--mini-divider-strong)",
                  color: "var(--mini-accent-ink)",
                }}
              >
                <Plus className="size-5 shrink-0" />
                <span className="min-w-0 flex-1">Создать мастер-кабинет</span>
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      {createOpen ? (
        <CreateMasterCabinetDialog
          onClose={() => setCreateOpen(false)}
          onCreated={() => void loadOrganizations()}
        />
      ) : null}
    </>
  );
}
