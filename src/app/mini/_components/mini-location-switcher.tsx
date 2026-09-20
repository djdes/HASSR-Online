"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { BuildingOption } from "@/lib/building-scope";

/** Блок `location` из /api/mini/home. */
export type MiniLocationPayload = {
  enabled: boolean;
  buildings: BuildingOption[];
  activeBuildingId: string | null;
  canSwitch: boolean;
};

/**
 * Точки (2026-09-05): переключение точки в Mini App — зеркало пилюли в
 * шапке сайта (П-3). Список тянем клиентом из /api/mini/home, как и
 * переключатель организации в этом же профиле.
 */
export function MiniLocationSwitcher() {
  const router = useRouter();
  const [location, setLocation] = useState<MiniLocationPayload | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mini/home")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.location && Array.isArray(data.location.buildings)) {
          setLocation(data.location as MiniLocationPayload);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!location?.canSwitch) return null;

  async function switchTo(building: BuildingOption) {
    if (!location || building.id === location.activeBuildingId || busyId) return;
    setBusyId(building.id);
    try {
      const response = await fetch("/api/me/active-building", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildingId: building.id }),
      });
      if (!response.ok) throw new Error();
      setLocation({ ...location, activeBuildingId: building.id });
      toast.success(`Точка: ${building.name}`);
      router.refresh();
    } catch {
      // Как и у организации: сбой должен быть виден, иначе человек решит,
      // что точка переключилась, а данные показываются от прежней.
      toast.error("Не удалось переключить точку. Попробуйте ещё раз.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mini-card p-4">
      <div className="mb-2 text-[13px]" style={{ color: "var(--mini-text-muted)" }}>
        Точка
      </div>
      <div className="space-y-1.5">
        {location.buildings.map((building) => {
          const active = building.id === location.activeBuildingId;
          return (
            <button
              key={building.id}
              type="button"
              onClick={() => switchTo(building)}
              className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium"
              style={{
                background: active
                  ? "var(--mini-accent-soft, rgba(85,102,246,0.12))"
                  : "transparent",
                color: "var(--mini-text)",
              }}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{building.name}</span>
                {building.address ? (
                  <span
                    className="block truncate text-[12px] font-normal"
                    style={{ color: "var(--mini-text-muted)" }}
                  >
                    {building.address}
                  </span>
                ) : null}
              </span>
              {busyId === building.id ? (
                <span style={{ color: "var(--mini-text-muted)" }}>…</span>
              ) : active ? (
                <span style={{ color: "var(--mini-accent, #5566f6)" }}>✓</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
