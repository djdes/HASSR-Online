"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Loader2,
  Save,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { changedMatrixRows, matrixRowCodes, positionPresetMatches, setMatrixRow, toggleMatrixGrant, type AccessMatrix } from "@/lib/access-matrix-state";

type AclRow = {
  templateCode: string;
  canRead: boolean;
  canWrite: boolean;
  canFinalize: boolean;
};

type UserRow = {
  id: string;
  name: string;
  role: string;
  positionName: string | null;
  positionCategory: string | null;
  journalAccessMigrated: boolean;
  initialAccess: AclRow[];
};

type CatalogItem = { code: string; name: string };

type Props = {
  users: UserRow[];
  catalog: CatalogItem[];
};

type Matrix = AccessMatrix;

/**
 * Р”Р»СЏ Р±С‹СЃС‚СЂРѕРіРѕ РЅР°Р·РЅР°С‡РµРЅРёСЏ РїР°РєРµС‚РѕРІ РїСЂР°РІ: РЅР°Р¶Р°Р» В«РЈР±РѕСЂРєР° в†’ СѓР±РѕСЂС‰РёРєР°РјВ» вЂ”
 * РІСЃРµРј СЃРѕС‚СЂСѓРґРЅРёРєР°Рј СЃ РґРѕР»Р¶РЅРѕСЃС‚СЊСЋ, СЃРѕРІРїР°РґР°СЋС‰РµР№ РїРѕ keyword, РЅР°Р·РЅР°С‡РёР»РёСЃСЊ
 * РІСЃРµ СѓРєР°Р·Р°РЅРЅС‹Рµ Р¶СѓСЂРЅР°Р»С‹ РІ РѕРґРЅРѕРј РєР»РёРєРµ. РЎРїРёСЃРѕРє РїРѕРґРѕР±СЂР°РЅ РїРѕ РЅР°РёР±РѕР»РµРµ
 * С‡Р°СЃС‚С‹Рј СЂРµР°Р»СЊРЅС‹Рј СЃРІСЏР·РєР°Рј РєСѓС…РЅРё/РѕР±С‰РµРїРёС‚Р°. Matching РїРѕ `positionName`
 * РїРѕРґСЃС‚СЂРѕРєРѕР№ (lower-case).
 */
const PRESETS: Array<{
  id: "cleaning" | "temperature" | "health" | "receiving";
  icon?: string;
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

function toMatrix(users: UserRow[]): Matrix {
  const m: Matrix = new Map();
  for (const u of users) {
    const row = new Set<string>();
    for (const acl of u.initialAccess) {
      if (acl.canRead) row.add(acl.templateCode);
    }
    m.set(u.id, row);
  }
  return m;
}

export function JournalAccessMatrix({ users, catalog }: Props) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("settingsManagement.accessMatrices");
  const tJournals = useTranslations("journals.names");
  const tRoles = useTranslations("staffManagement.roleLabels");
  type JournalNameKey = Parameters<typeof tJournals>[0];
  type RoleKey = Parameters<typeof tRoles>[0];
  const journalName = useCallback((item: CatalogItem) => locale !== "ru" && tJournals.has(item.code as JournalNameKey)
    ? tJournals(item.code as JournalNameKey)
    : item.name, [locale, tJournals]);
  const [base] = useState<Matrix>(() => toMatrix(users));
  const [curr, setCurr] = useState<Matrix>(() => toMatrix(users));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [posFilter, setPosFilter] = useState<"all" | "staff" | "management">(
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

  const filteredUsers = useMemo(
    () =>
      users.filter((u) => {
        if (posFilter === "staff" && u.positionCategory !== "staff") return false;
        if (posFilter === "management" && u.positionCategory !== "management")
          return false;
        return true;
      }),
    [users, posFilter]
  );

  const dirty = changedMatrixRows(base, curr);

  function toggleCell(userId: string, code: string) {
    setCurr((prev) => toggleMatrixGrant(prev, userId, code));
  }

  function setRowAll(userId: string, value: boolean) {
    setCurr((prev) => setMatrixRow(prev, userId, catalog.map((j) => j.code), value));
  }

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setCurr((prev) => {
      const copy = new Map(prev);
      for (const u of users) {
        if (!positionPresetMatches(preset.id, u.positionName || "")) continue;
        const row = new Set(copy.get(u.id) ?? []);
        for (const code of preset.templateCodes) row.add(code);
        copy.set(u.id, row);
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
      for (const userId of dirty) {
        const access = matrixRowCodes(curr, userId).map((code) => ({
          templateCode: code,
          canRead: true,
          canWrite: true,
          canFinalize: false,
        }));
        const res = await fetch(`/api/users/${userId}/access`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access }),
        });
        if (res.ok) ok += 1;
        else failed += 1;
      }
      if (failed > 0) {
        toast.error(t("save.partial", { saved: ok, failed }));
      } else {
        toast.success(t("save.peopleSuccess", { count: ok }));
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
          {t("presets.employeesDescription")}
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
              onClick={() => setPosFilter(k)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                posFilter === k
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
          <Users className="size-4 text-[#5566f6]" />
          <h2 className="text-[15px] font-semibold text-[#0b1024]">{t("summary.peopleAndJournals", { count: filteredUsers.length, journalCount: filteredCatalog.length })}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[#ececf4]">
                <th className="sticky left-0 z-[1] bg-white px-3 py-2 text-left font-medium text-[#6f7282]">
                  {t("table.employee")}
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
              {filteredUsers.map((u) => {
                const row = curr.get(u.id) ?? new Set<string>();
                const rowAllOn = filteredCatalog.every((j) => row.has(j.code));
                return (
                  <tr
                    key={u.id}
                    className={cn(
                      "border-b border-[#ececf4] last:border-b-0",
                      dirty.has(u.id) && "bg-[#fff8eb]"
                    )}
                  >
                    <td className="sticky left-0 z-[1] min-w-[180px] bg-inherit px-3 py-2">
                      <div className="font-medium text-[#0b1024]">{u.name}</div>
                      <div className="text-[11px] text-[#6f7282]">
                        {u.positionName ?? (tRoles.has(u.role as RoleKey) ? tRoles(u.role as RoleKey) : u.role)}
                      </div>
                      {!u.journalAccessMigrated ? (
                        <div className="mt-0.5 text-[10px] text-[#b25f00]">
                          {t("table.legacyUserAccess")}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setRowAll(u.id, !rowAllOn)}
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
                      const granted = row.has(j.code);
                      return (
                        <td key={j.code} className="px-1 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => toggleCell(u.id, j.code)}
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
              {filteredUsers.length === 0 ? (
                <tr>
                  <td
                    colSpan={filteredCatalog.length + 2}
                    className="px-4 py-10 text-center text-[13px] text-[#9b9fb3]"
                  >
                    {t("table.emptyUsers")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* Save bar */}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-3xl border border-[#ececf4] bg-white/95 px-5 py-3 shadow-[0_12px_32px_-16px_rgba(11,16,36,0.18)] backdrop-blur">
        <div className="text-[13px] text-[#3c4053]">
          {dirty.size === 0 ? t("summary.unchanged") : t("summary.changedPeople", { count: dirty.size })}
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

