"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, MapPin, RefreshCw, Warehouse } from "lucide-react";
import { toast } from "sonner";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IIKO_STORE_SKIP, type IikoStoreView } from "@/lib/supply/supply-points";

/** Значение «без точки» в выпадающем списке (в сопоставлении его нет). */
const NO_POINT = "__none__";

/**
 * Склады iiko → торговые точки (2026-11-01). Накладные и акты списания склада
 * ложатся на его точку; «Не загружать» пропускает склад; без точки — точку
 * выберут при приёмке. Список складов берётся с сервера iiko по кнопке.
 */
export function IikoStoresCard({
  initialStores,
  initialMap,
  points,
}: {
  initialStores: IikoStoreView[];
  initialMap: Record<string, string>;
  points: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations("supplyEdo.iiko.stores");
  const [stores, setStores] = useState(initialStores);
  const [saved, setSaved] = useState(initialMap);
  const [map, setMap] = useState(initialMap);
  const [busy, setBusy] = useState<"load" | "save" | null>(null);
  const dirty = useMemo(() => JSON.stringify(map) !== JSON.stringify(saved), [map, saved]);

  async function load() {
    setBusy("load");
    try {
      const res = await fetch("/api/settings/supply/iiko/stores").catch(() => null);
      if (!res) {
        toast.error(t("failed"));
        return;
      }
      const body = (await res.json().catch(() => null)) as { stores?: IikoStoreView[]; map?: Record<string, string>; error?: string } | null;
      if (!res.ok || !body?.stores) {
        toast.error(body?.error ?? t("failed"));
        return;
      }
      setStores(body.stores);
      // Несохранённый выбор не теряем; новое — из ответа сервера.
      setMap((current) => ({ ...(body.map ?? {}), ...current }));
      setSaved(body.map ?? {});
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      const res = await fetch("/api/settings/supply/iiko/stores", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ map }),
      }).catch(() => null);
      if (!res) {
        toast.error(t("failed"));
        return;
      }
      const body = (await res.json().catch(() => null)) as { map?: Record<string, string>; error?: string } | null;
      if (!res.ok || !body?.map) {
        toast.error(body?.error ?? t("failed"));
        return;
      }
      setSaved(body.map);
      toast.success(t("saved"));
    } finally {
      setBusy(null);
    }
  }

  const choose = (storeId: string, value: string) =>
    setMap((current) => {
      const next = { ...current };
      if (value === NO_POINT) delete next[storeId];
      else next[storeId] = value;
      return next;
    });

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6" data-iiko-stores>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
            <Warehouse className="size-5 text-[#5566f6]" aria-hidden />
            {t("title")}
          </h2>
          <p className="mt-1 max-w-[640px] text-[14px] leading-relaxed text-[#6f7282]">{t("hint")}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy !== null}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
          data-iiko-stores-load
        >
          {busy === "load" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4 text-[#5566f6]" aria-hidden />}
          {busy === "load" ? t("loading") : stores.length > 0 ? t("reload") : t("load")}
        </button>
      </div>

      {stores.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-6 text-center text-[13.5px] text-[#6f7282]">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-[#f0f1f7]">
          {stores.map((store) => {
            const value = map[store.id] ?? NO_POINT;
            return (
              <li key={store.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-iiko-store={store.id}>
                <div className="min-w-0">
                  <div className="text-[14.5px] font-medium text-[#0b1024] [overflow-wrap:anywhere]">{store.name}</div>
                  {store.department ? <div className="text-[12.5px] text-[#6f7282]">{store.department}</div> : null}
                </div>
                <Select value={value} onValueChange={(next) => choose(store.id, next)}>
                  <SelectTrigger className="h-10 w-full rounded-2xl border-[#dcdfed] bg-white text-[14px] sm:w-[280px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {points.map((point) => (
                      <SelectItem key={point.id} value={point.id}>
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="size-3.5 text-[#5566f6]" aria-hidden />
                          {point.name}
                        </span>
                      </SelectItem>
                    ))}
                    <SelectItem value={NO_POINT}>{t("none")}</SelectItem>
                    <SelectItem value={IIKO_STORE_SKIP}>{t("skip")}</SelectItem>
                  </SelectContent>
                </Select>
              </li>
            );
          })}
        </ul>
      )}

      {stores.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {dirty ? <span className="text-[13px] text-[#7a4a00]">{t("unsaved")}</span> : null}
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy !== null || !dirty}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14.5px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-60"
            data-iiko-stores-save
          >
            {busy === "save" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {busy === "save" ? t("saving") : t("save")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
