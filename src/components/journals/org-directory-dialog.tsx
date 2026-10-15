"use client";

import { useLocale, useTranslations } from "next-intl";
import { readLocalizedApiError } from "@/lib/localized-api-error";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { Database, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  missingFromList,
  type OrgDirectoryKind,
} from "@/lib/org-directory";

/**
 * «Из справочника организации» — общий выбор позиций для списка любого
 * журнала. Один компонент на все журналы: раньше каждый заводил свой
 * список и свою загрузку из Excel, и загруженное в настройках до журнала
 * не доезжало.
 *
 * Показываем только то, чего в списке журнала ещё нет, — чтобы нажатие
 * «Добавить» всегда что-то меняло и не плодило повторы.
 */
export function OrgDirectoryDialog({
  open,
  onClose,
  kind,
  existing,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  kind: OrgDirectoryKind;
  /** Что уже есть в списке журнала — эти позиции не предлагаем. */
  existing: string[];
  onAdd: (items: string[]) => void;
}) {
  const t = useTranslations("journalControls");
  const locale = useLocale();
  const [items, setItems] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  const load = useEffectEvent(() => {
    fetch(`/api/org-directory?kind=${kind}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readLocalizedApiError(response, locale, t("orgDirectory.failed")));
        const data = (await response.json()) as { items?: string[]; error?: string };
        setItems(data.items ?? []);
      })
      .catch((error) => {
        toast.error(humanizeFetchError(error, t("orgDirectory.error"), t("commissionDialog.network")));
        setItems([]);
      });
  });
  useEffect(() => {
    if (!open) return;
    // A locale change must not clear an unfinished selection or search.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(null);
    setSelected([]);
    setQuery("");
    load();
  }, [open, kind]);

  const available = useMemo(() => missingFromList(items ?? [], existing), [items, existing]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? available.filter((item) => item.toLowerCase().includes(needle)) : available;
  }, [available, query]);

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="size-5 text-[#5566f6]" />
            {t("orgDirectory.title", { label: t(`orgDirectory.labels.${kind}`) })}
          </DialogTitle>
        </DialogHeader>

        <p className="text-[12.5px] leading-[1.45] text-[#6f7282]">
          {t("orgDirectory.description", { source: t(`orgDirectory.sources.${kind}`) })}
        </p>

        {items === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-[#9b9fb3]" />
          </div>
        ) : available.length === 0 ? (
          <p className="py-8 text-center text-[13.5px] text-[#6f7282]">
            {(items ?? []).length === 0
              ? t("orgDirectory.empty")
              : t("orgDirectory.allAdded")}
          </p>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("orgDirectory.search")}
                className="h-10 w-full rounded-xl border border-[#dcdfed] bg-white pl-9 pr-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
              />
            </div>
            <div className="max-h-[320px] space-y-1 overflow-y-auto">
              {filtered.map((item) => (
                <label
                  key={item}
                  className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-[#f5f6ff]"
                >
                  <Checkbox
                    checked={selected.includes(item)}
                    onCheckedChange={(value) =>
                      setSelected((prev) => (value === true ? [...prev, item] : prev.filter((x) => x !== item)))
                    }
                  />
                  <span className="text-[14px] text-[#0b1024]">{item}</span>
                </label>
              ))}
              {filtered.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-[#9b9fb3]">{t("orgDirectory.noResults")}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSelected(selected.length === filtered.length ? [] : filtered)}
                className="text-[13px] font-medium text-[#3848c7] hover:underline"
              >
                {selected.length === filtered.length ? t("orgDirectory.clear") : t("orgDirectory.selectAll", { count: filtered.length })}
              </button>
              <Button
                type="button"
                disabled={selected.length === 0}
                onClick={() => {
                  onAdd(selected);
                  onClose();
                }}
                className="h-10 rounded-xl bg-[#5566f6] px-4 text-[14px] text-white hover:bg-[#4a5bf0]"
              >
                {t("orgDirectory.add", { count: selected.length })}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
