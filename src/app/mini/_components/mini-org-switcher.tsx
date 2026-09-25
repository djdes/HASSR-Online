"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
 */
export function MiniOrgSwitcher() {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<AccessibleOrganization[]>(
    [],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/organizations")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data?.organizations) return;
        setOrganizations(data.organizations);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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

  if (organizations.length < 2) return null;

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
    <section className="mini-card p-4">
      <div className="mini-label mb-2.5">Организация</div>
      <div className="space-y-2">
        {organizations.map((organization) => {
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
  );
}
