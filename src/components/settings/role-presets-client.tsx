"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Preset = {
  value: string;
  label: string;
  description: string;
  defaults: string[];
};

type Props = {
  presets: Preset[];
  capabilityKeys: string[];
  capabilityLabels: Record<string, string>;
  initialOverrides: Record<string, string[]> | null;
};

export function RolePresetsClient({
  presets,
  capabilityKeys,
  capabilityLabels,
  initialOverrides,
}: Props) {
  const t = useTranslations("settingsUi.rolePresetsClient");
  const router = useRouter();
  // Внутренняя модель: для каждого preset — массив capabilities, которые
  // у него ВКЛЮЧЕНЫ. Если override отсутствовал — берём дефолты пресета.
  const initialMatrix = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const p of presets) {
      const fromOverride = initialOverrides?.[p.value];
      m[p.value] = new Set(fromOverride ?? p.defaults);
    }
    return m;
  }, [presets, initialOverrides]);

  const [matrix, setMatrix] = useState<Record<string, Set<string>>>(
    () => Object.fromEntries(
      Object.entries(initialMatrix).map(([k, v]) => [k, new Set(v)]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  // Дефолтное состояние пресета для сравнения «изменено ли».
  const defaultsByPreset = useMemo(() => {
    const d: Record<string, Set<string>> = {};
    for (const p of presets) d[p.value] = new Set(p.defaults);
    return d;
  }, [presets]);

  const dirty = useMemo(() => {
    for (const p of presets) {
      const cur = matrix[p.value];
      const init = initialMatrix[p.value];
      if (cur.size !== init.size) return true;
      for (const c of cur) if (!init.has(c)) return true;
    }
    return false;
  }, [matrix, initialMatrix, presets]);

  function toggle(preset: string, capability: string) {
    if (preset === "admin") return; // admin row locked
    setMatrix((prev) => {
      const next = new Set(prev[preset]);
      if (next.has(capability)) next.delete(capability);
      else next.add(capability);
      return { ...prev, [preset]: next };
    });
  }

  function isModified(preset: string) {
    const cur = matrix[preset];
    const def = defaultsByPreset[preset];
    if (cur.size !== def.size) return true;
    for (const c of cur) if (!def.has(c)) return true;
    return false;
  }

  function resetPreset(preset: string) {
    if (preset === "admin") return;
    setMatrix((prev) => ({
      ...prev,
      [preset]: new Set(defaultsByPreset[preset]),
    }));
  }

  async function save() {
    setSaving(true);
    try {
      // Шлём только пресеты, отличающиеся от дефолтов — экономим storage,
      // upgrade-friendly (если дефолт расширили, орга получит новые
      // capabilities автоматически для нетронутых пресетов).
      const overrides: Record<string, string[]> = {};
      for (const p of presets) {
        if (p.value === "admin") continue;
        if (isModified(p.value)) {
          overrides[p.value] = [...matrix[p.value]].sort();
        }
      }
      const r = await fetch("/api/settings/role-presets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      toast.success(t("saved"));
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function resetAll() {
    setSaving(true);
    try {
      const r = await fetch("/api/settings/role-presets", { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // Локально сбрасываем матрицу к дефолтам.
      const fresh: Record<string, Set<string>> = {};
      for (const p of presets) fresh[p.value] = new Set(p.defaults);
      setMatrix(fresh);
      toast.success(t("resetDone"));
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? t("resetFailed"));
    } finally {
      setSaving(false);
      setResetOpen(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-14 z-20 -mx-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ececf4] bg-white/95 px-3 py-2 shadow-[0_4px_18px_-12px_rgba(11,16,36,0.18)] backdrop-blur">
        <div className="flex items-center gap-2 text-[13px] text-[#3c4053]">
          <ShieldCheck className="size-4 text-[#5566f6]" />
          <span>
            {t("hint")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setResetOpen(true)}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#3c4053] transition-colors hover:border-[#5566f6]/50 hover:bg-[#fafbff] disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" />
            {t("resetToDefaults")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5566f6] px-4 text-[13px] font-semibold text-white shadow-[0_8px_24px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            {dirty ? t("save") : t("noChanges")}
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-[#ececf4] bg-white p-2 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border-b border-[#ececf4] bg-white px-3 py-3 text-left text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
                  {t("capability")}
                </th>
                {presets.map((p) => {
                  const modified = isModified(p.value);
                  return (
                    <th
                      key={p.value}
                      className="border-b border-[#ececf4] px-2 py-3 text-center"
                      title={p.description}
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="text-[12px] font-semibold text-[#0b1024]">
                          {p.label}
                        </div>
                        <div className="font-mono text-[10px] text-[#9b9fb3]">
                          {p.value}
                        </div>
                        {p.value === "admin" ? (
                          <span className="mt-1 rounded-full bg-[#fff8eb] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#a13a32]">
                            {t("locked")}
                          </span>
                        ) : modified ? (
                          <button
                            type="button"
                            onClick={() => resetPreset(p.value)}
                            className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#eef1ff] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#3848c7] transition-colors hover:bg-[#dde1ff]"
                          >
                            <RotateCcw className="size-2.5" />
                            {t("toDefault")}
                          </button>
                        ) : (
                          <span className="mt-1 rounded-full bg-[#fafbff] px-1.5 py-0.5 text-[9px] font-medium text-[#9b9fb3]">
                            {t("default")}
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {capabilityKeys.map((cap) => (
                <tr key={cap}>
                  <td className="sticky left-0 z-10 border-b border-[#ececf4] bg-white px-3 py-2 align-middle">
                    <div className="text-[12px] font-medium text-[#0b1024]">
                      {capabilityLabels[cap]}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-[#9b9fb3]">
                      {cap}
                    </div>
                  </td>
                  {presets.map((p) => {
                    const has = matrix[p.value].has(cap);
                    const isAdmin = p.value === "admin";
                    return (
                      <td
                        key={p.value + cap}
                        className="border-b border-[#ececf4] px-2 py-2 text-center"
                      >
                        <button
                          type="button"
                          onClick={() => toggle(p.value, cap)}
                          disabled={isAdmin}
                          aria-label={
                            has
                              ? t("removeCapability", { capability: capabilityLabels[cap], preset: p.label })
                              : t("grantCapability", { capability: capabilityLabels[cap], preset: p.label })
                          }
                          className={`inline-flex size-7 items-center justify-center rounded-lg text-[12px] font-semibold transition-all ${
                            isAdmin
                              ? has
                                ? "cursor-not-allowed bg-[#ecfdf5] text-[#136b2a] opacity-80"
                                : "cursor-not-allowed bg-[#fafbff] text-[#dcdfed]"
                              : has
                                ? "bg-[#ecfdf5] text-[#136b2a] hover:bg-[#d9f4e1] hover:scale-105"
                                : "bg-[#fafbff] text-[#dcdfed] hover:bg-[#fff4f2] hover:text-[#a13a32] hover:scale-105"
                          }`}
                        >
                          {has ? "✓" : "—"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title={t("confirmTitle")}
        description={t("confirmDescription")}
        variant="warn"
        bullets={[
          { label: t("bullet1"), tone: "warn" },
          { label: t("bullet2") },
          { label: t("bullet3") },
        ]}
        confirmLabel={t("confirmLabel")}
        onConfirm={resetAll}
      />
    </div>
  );
}
