"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { diagramBounds, diagramStats, flowchartTemplate, type FlowchartTemplate } from "@/lib/ppk/diagram";
import type { DiagramData } from "@/lib/ppk/records";
import { usePpkRecords, type PpkRecordRow } from "@/components/production-control/use-ppk-records";
import { DiagramSvg } from "@/components/production-control/diagram-svg";
import {
  PPK_BUTTON_OUTLINE_CLASS,
  PPK_BUTTON_PRIMARY_CLASS,
  PPK_FIELD_CLASS,
  PPK_ICON_BUTTON_CLASS,
  PPK_LABEL_CLASS,
  PpkBlockActionProvider,
  PpkEmptyState,
} from "@/components/production-control/ppk-ui";

type Kind = "flowchart" | "floor-plan";
type TemplateChoice = FlowchartTemplate | "blank";

const TEMPLATES: TemplateChoice[] = ["blank", "hot", "cold", "pastry"];

/**
 * Список схем блока: карточки с мини-превью, создание (для блок-схем — из шаблона
 * цеха) и удаление. Страница схемы открывается по адресу `${basePath}/${id}`.
 */
export function DiagramList({
  kind,
  basePath,
  initial,
  header,
}: {
  kind: Kind;
  basePath: string;
  initial: PpkRecordRow<DiagramData>[];
  header: ReactNode;
}) {
  const tFlow = useTranslations("productionControl.flowcharts");
  const tPlan = useTranslations("productionControl.floorPlans");
  const t = kind === "flowchart" ? tFlow : tPlan;
  const locale = useLocale();
  const router = useRouter();
  const { records, remove } = usePpkRecords<DiagramData>(kind, initial);

  const [creating, setCreating] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<PpkRecordRow<DiagramData> | null>(null);

  const openCreate = () => setCreating(true);
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });

  return (
    <PpkBlockActionProvider openCreate={openCreate}>
      {header}

      {records.length === 0 ? (
        <PpkEmptyState title={t("emptyTitle")} hint={t("emptyHint")}>
          <button type="button" onClick={openCreate} className={PPK_BUTTON_PRIMARY_CLASS}>
            <Plus className="size-4" />
            {t("new")}
          </button>
        </PpkEmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {records.map((row) => {
            const stats = diagramStats(row.data);
            const box = diagramBounds(row.data);
            return (
              <li
                key={row.id}
                className="group flex flex-col overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-shadow duration-200 hover:shadow-[0_20px_50px_-30px_rgba(85,102,246,0.45)]"
              >
                <Link
                  href={`${basePath}/${row.id}`}
                  aria-label={t("open")}
                  className="block bg-[#fafbff] p-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#5566f6]/15"
                >
                  <DiagramSvg
                    data={row.data}
                    kind={kind}
                    idPrefix={`pv-${row.id}`}
                    viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
                    className="pointer-events-none h-44 w-full"
                  />
                </Link>
                <div className="flex items-start justify-between gap-3 p-5">
                  <Link href={`${basePath}/${row.id}`} className="min-w-0 focus-visible:outline-none">
                    <div className="truncate text-[16px] font-semibold text-[#0b1024]">{row.data.title || "—"}</div>
                    <div className="mt-1 text-[13.5px] text-[#3c4053]">
                      {kind === "flowchart"
                        ? tFlow("stats", { steps: String(stats.steps) })
                        : tPlan("stats", { rooms: String(stats.rooms), flows: String(stats.flows) })}
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-[#9b9fb3]">{t("updated", { date: date(row.updatedAt) })}</div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setPendingRemove(row)}
                    aria-label={t("remove")}
                    title={t("remove")}
                    className={PPK_ICON_BUTTON_CLASS}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {creating ? (
        <CreateDialog
          kind={kind}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            window.dispatchEvent(new Event("ppk:changed"));
            router.push(`${basePath}/${id}`);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={async () => {
          if (pendingRemove) await remove(pendingRemove.id);
        }}
        title={pendingRemove ? t("removeTitle", { name: pendingRemove.data.title || "—" }) : ""}
        description={t("removeBody")}
        variant="danger"
        confirmLabel={t("remove")}
        cancelLabel={t("cancel")}
      />
    </PpkBlockActionProvider>
  );
}

/** Окно «Новая схема»: название и (для блок-схем) шаблон цеха. */
function CreateDialog({
  kind,
  onClose,
  onCreated,
}: {
  kind: Kind;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const tFlow = useTranslations("productionControl.flowcharts");
  const tPlan = useTranslations("productionControl.floorPlans");
  const t = kind === "flowchart" ? tFlow : tPlan;
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<TemplateChoice>(kind === "flowchart" ? "hot" : "blank");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (saving) return;
    setSaving(true);
    const label = template === "blank" ? "" : tFlow(`templates.${template}`);
    const title = (name.trim() || label || t("new")).slice(0, 120);
    const base: DiagramData =
      kind === "flowchart" && template !== "blank"
        ? flowchartTemplate(template)
        : { title: "", nodes: [], edges: [] };
    try {
      const response = await fetch("/api/production-control/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block: kind, data: { ...base, title } }),
      });
      const body = (await response.json().catch(() => null)) as { record?: { id: string }; error?: string } | null;
      if (!response.ok || !body?.record) {
        toast.error(body?.error || t("createFailed"));
        setSaving(false);
        return;
      }
      onCreated(body.record.id);
    } catch {
      toast.error(t("createFailed"));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-[520px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 gap-0 border-b border-[#ececf4] px-6 py-4 pr-14 text-left">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("new")}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {kind === "flowchart" ? (
            <div>
              <span className={PPK_LABEL_CLASS}>{t("pick")}</span>
              <div className="flex flex-wrap gap-2">
                {TEMPLATES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTemplate(item)}
                    aria-pressed={template === item}
                    className={cn(
                      "inline-flex h-9 items-center rounded-full border px-3 text-[13.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                      template === item
                        ? "border-[#5566f6]/40 bg-[#eef1ff] text-[#3848c7]"
                        : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
                    )}
                  >
                    {tFlow(`templates.${item}`)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <label className="block">
            <span className={PPK_LABEL_CLASS}>{t("name")}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void create();
              }}
              maxLength={120}
              placeholder={t("namePlaceholder")}
              autoFocus
              className={PPK_FIELD_CLASS}
            />
          </label>
        </div>
        <DialogFooter className="shrink-0 gap-2 border-t border-[#ececf4] px-6 py-4">
          <button type="button" onClick={onClose} className={PPK_BUTTON_OUTLINE_CLASS}>
            {t("cancel")}
          </button>
          <button type="button" onClick={() => void create()} disabled={saving} className={PPK_BUTTON_PRIMARY_CLASS}>
            {t("create")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
