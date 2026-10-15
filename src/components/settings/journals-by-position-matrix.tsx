"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check,
  Loader2,
  Save,
  Search,
  Sparkles,
  Network as NetworkIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { changedMatrixRows, matrixRowCodes, positionPresetMatches, setMatrixRow, toggleMatrixGrant, type AccessMatrix } from "@/lib/access-matrix-state";

type PositionRow = {
  id: string;
  name: string;
  categoryKey: string;
  activeUsers: number;
  initialCodes: string[];
};

type CatalogItem = { code: string; name: string };

type Props = {
  positions: PositionRow[];
  catalog: CatalogItem[];
};

type Matrix = AccessMatrix;

const PRESETS: Array<{
  id: "cleaning" | "temperature" | "health" | "receiving";
  templateCodes: string[];
}> = [
  {
    id: "cleaning",
    templateCodes: [
      "cleaning",
      "general_cleaning",
      "cleaning_ventilation_checklist",
      "sanitary_day_checklist",
      "sanitation_day",
      "uv_lamp_runtime",
      "disinfectant_usage",
    ],
  },
  {
    id: "temperature",
    templateCodes: [
      "climate_control",
      "cold_equipment_control",
      "intensive_cooling",
      "fryer_oil",
      "finished_product",
    ],
  },
  {
    id: "health",
    templateCodes: ["hygiene", "health_check", "med_books"],
  },
  {
    id: "receiving",
    templateCodes: [
      "incoming_control",
      "incoming_raw_materials_control",
      "perishable_rejection",
      "metal_impurity",
      "traceability_test",
    ],
  },
];

function toMatrix(positions: PositionRow[]): Matrix {
  const m: Matrix = new Map();
  for (const p of positions) m.set(p.id, new Set(p.initialCodes));
  return m;
}

export function JournalsByPositionMatrix({ positions, catalog }: Props) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("settingsManagement.accessMatrices");
  const tJournals = useTranslations("journals.names");
  type JournalNameKey = Parameters<typeof tJournals>[0];
  const journalName = useCallback((item: CatalogItem) => locale !== "ru" && tJournals.has(item.code as JournalNameKey)
    ? tJournals(item.code as JournalNameKey)
    : item.name, [locale, tJournals]);
  const [base] = useState<Matrix>(() => toMatrix(positions));
  const [curr, setCurr] = useState<Matrix>(() => toMatrix(positions));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [catFilter, setCatFilter] = useState<"all" | "staff" | "management">(
    "all"
  );

  const q = query.trim().toLowerCase();
  const filteredCatalog = useMemo(
    () =>
      catalog.filter(
        (j) =>
          !q ||
          journalName(j).toLowerCase().includes(q) ||
          j.code.toLowerCase().includes(q)
      ),
    [catalog, q, journalName]
  );

  const filteredPositions = useMemo(
    () =>
      positions.filter((p) => {
        if (catFilter === "staff" && p.categoryKey !== "staff") return false;
        if (catFilter === "management" && p.categoryKey !== "management")
          return false;
        return true;
      }),
    [positions, catFilter]
  );

  const dirty = changedMatrixRows(base, curr);

  function toggleCell(positionId: string, code: string) {
    setCurr((prev) => toggleMatrixGrant(prev, positionId, code));
  }

  function setRowAll(positionId: string, value: boolean) {
    setCurr((prev) => setMatrixRow(prev, positionId, catalog.map((j) => j.code), value));
  }

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setCurr((prev) => {
      const copy = new Map(prev);
      for (const p of positions) {
        if (!positionPresetMatches(preset.id, p.name)) continue;
        const set = new Set(copy.get(p.id) ?? []);
        for (const code of preset.templateCodes) set.add(code);
        copy.set(p.id, set);
      }
      return copy;
    });
    toast.success(t("toast.presetApplied", { preset: t(`presets.${preset.id}`) }));
  }

  async function save() {
    if (saving || dirty.size === 0) return;
    setSaving(true);
    try {
      let ok = 0;
      let failed = 0;
      for (const positionId of dirty) {
        const templateCodes = matrixRowCodes(curr, positionId);
        const res = await fetch(
          `/api/settings/positions/${positionId}/journals`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ templateCodes }),
          }
        );
        if (res.ok) ok += 1;
        else failed += 1;
      }
      if (failed > 0) {
        toast.error(t("save.partial", { saved: ok, failed }));
      } else {
        toast.success(t("save.positionsSuccess", { count: ok }));
      }
      router.refresh();
    } catch {
      toast.error(t("save.networkError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Presets */}
      <section className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-5">
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          <Sparkles className="size-3.5 text-[#5566f6]" />
          {t("presets.title")}
        </div>
        <p className="mt-1 text-[12px] text-[#6f7282]">
          {t("presets.positionsDescription")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#dcdfed] bg-white px-3 py-1.5 text-[12px] font-medium text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              {t(`presets.${p.id}`)}
            </button>
          ))}
        </div>
      </section>

      {/* Filters */}
      <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="relative w-full flex-1 sm:w-auto sm:min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("filters.journalsPlaceholder")}
            className="h-10 rounded-2xl border-[#dcdfed] pl-9"
          />
        </div>
        <div className="flex gap-2">
          {([["all", t("filters.all")], ["management", t("filters.management")], ["staff", t("filters.staff")]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setCatFilter(k)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                catFilter === k
                  ? "border-[#5566f6] bg-[#5566f6] text-white"
                  : "border-[#dcdfed] bg-white text-[#3c4053] hover:bg-[#f5f6ff]"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Matrix */}
      <section className="rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex items-center gap-2 border-b border-[#ececf4] p-4">
          <NetworkIcon className="size-4 text-[#5566f6]" />
          <h2 className="text-[15px] font-semibold text-[#0b1024]">{t("summary.positionsAndJournals", { count: filteredPositions.length, journalCount: filteredCatalog.length })}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[#ececf4]">
                <th className="sticky left-0 z-[1] bg-white px-3 py-2 text-left font-medium text-[#6f7282]">
                  {t("table.position")}
                </th>
                <th className="px-2 py-2 text-center font-medium text-[#6f7282]">
                  <span className="text-[11px]">{t("table.selectAll")}</span>
                </th>
                {filteredCatalog.map((j) => (
                  <th
                    key={j.code}
                    className="px-1 py-2 text-center font-medium text-[#6f7282]"
                  >
                    <div
                      className="mx-auto max-w-[80px] truncate text-[11px] leading-tight"
                      title={journalName(j)}
                    >
                      {journalName(j)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPositions.map((p) => {
                const set = curr.get(p.id) ?? new Set<string>();
                const isEmpty = set.size === 0;
                const rowAllOn = filteredCatalog.every((j) => set.has(j.code));
                return (
                  <tr
                    key={p.id}
                    className={cn(
                      "border-b border-[#ececf4] last:border-b-0",
                      dirty.has(p.id) && "bg-[#fff8eb]"
                    )}
                  >
                    <td className="sticky left-0 z-[1] min-w-[200px] bg-inherit px-3 py-2">
                      <div className="font-medium text-[#0b1024]">{p.name}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#6f7282]">
                        <span>{t("table.activeUsers", { count: p.activeUsers })}</span>
                        <span className="text-[#c7ccea]">·</span>
                        <span>
                          {t(p.categoryKey === "management" ? "table.managementCategory" : "table.staffCategory")}
                        </span>
                      </div>
                      {isEmpty ? (
                        <div className="mt-0.5 text-[10px] text-[#b25f00]">
                          {t("table.legacyPositionAccess")}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setRowAll(p.id, !rowAllOn)}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                          rowAllOn
                            ? "border-[#5566f6] bg-[#5566f6] text-white"
                            : "border-[#dcdfed] bg-white text-[#3c4053] hover:bg-[#f5f6ff]"
                        )}
                      >
                        {rowAllOn ? t("table.clear") : t("table.all")}
                      </button>
                    </td>
                    {filteredCatalog.map((j) => {
                      const granted = set.has(j.code);
                      return (
                        <td key={j.code} className="px-1 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => toggleCell(p.id, j.code)}
                            title={journalName(j)}
                            className={cn(
                              "inline-flex size-7 items-center justify-center rounded-md border transition-colors",
                              granted
                                ? "border-[#7cf5c0] bg-[#ecfdf5] text-[#136b2a]"
                                : "border-[#dcdfed] bg-white text-[#c7ccea] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                            )}
                          >
                            {granted ? <Check className="size-3.5" /> : ""}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {filteredPositions.length === 0 ? (
                <tr>
                  <td
                    colSpan={filteredCatalog.length + 2}
                    className="px-4 py-10 text-center text-[13px] text-[#9b9fb3]"
                  >{t.rich("table.emptyPositions", { hierarchy: (chunks) => <Link href="/settings/staff-hierarchy" className="text-[#3848c7] underline-offset-2 hover:underline">{chunks}</Link> })}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* Save bar */}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-3xl border border-[#ececf4] bg-white/95 px-5 py-3 shadow-[0_12px_32px_-16px_rgba(11,16,36,0.18)] backdrop-blur">
        <div className="text-[13px] text-[#3c4053]">
          {dirty.size === 0 ? t("summary.unchanged") : t("summary.changedPositions", { count: dirty.size })}
        </div>
        <Button
          type="button"
          onClick={save}
          disabled={saving || dirty.size === 0}
          className="ml-auto h-11 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] disabled:bg-[#c8cbe0]"
        >
          {saving ? (
            <><Loader2 className="size-4 animate-spin" />{t("save.saving")}</>
          ) : (
            <Save className="size-4" />
          )}
          {t("save.button")}
        </Button>
      </div>
    </div>
  );
}

