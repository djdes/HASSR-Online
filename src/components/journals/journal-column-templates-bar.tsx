"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Download, FileSpreadsheet, LayoutTemplate, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  describeTemplateChange,
  JOURNAL_TEMPLATE_NAME_MAX,
  type ImportedColumnsPreview,
  type JournalColumnTemplate,
} from "@/lib/journal-column-templates";
import { resolveColumns, type JournalColumnsConfig, type ResolvedJournalColumn } from "@/lib/journal-columns";
import { useExportLanguageChoice } from "./export-language-choice";
import { downloadFile } from "@/lib/native-bridge";

type Pending =
  | { kind: "template"; template: JournalColumnTemplate }
  | { kind: "import"; preview: ImportedColumnsPreview; fileName: string };

/**
 * Шаблоны колонок в «Настройках документа» бракеражей: выбрать готовый
 * (колонки заменяются — предупреждение прямо в окне, со списком того, что
 * изменится), сохранить текущие колонки своим шаблоном, загрузить форму из
 * Excel. Подтверждение встроено в окно, а не отдельной модалкой: поверх
 * Radix-модалки второе окно не получает кликов.
 */
export function JournalColumnTemplatesBar({
  code,
  config,
  current,
  onApply,
  canManage,
  presentColumn,
}: {
  code: string;
  config: Record<string, unknown>;
  /** Текущий набор колонок документа — для «Сохранить как шаблон». */
  current: JournalColumnsConfig;
  onApply: (columns: JournalColumnsConfig) => void;
  canManage: boolean;
  presentColumn?: (column: ResolvedJournalColumn) => ResolvedJournalColumn;
}) {
  const t = useTranslations("journalControls.columnTemplates");
  const locale = useLocale();
  const chooseExportLanguage = useExportLanguageChoice();
  const [templates, setTemplates] = useState<JournalColumnTemplate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/settings/journal-column-templates?code=${encodeURIComponent(code)}`, {
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) return;
    const body = (await response.json().catch(() => null)) as { templates?: JournalColumnTemplate[] } | null;
    setTemplates(body?.templates ?? []);
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  // Режим «полуфабрикаты»: своя подпись колонки наименования зависит от
  // режима — шаблон её не перебивает.
  const forDocument = (columns: JournalColumnsConfig): JournalColumnsConfig => {
    if (config.fieldNameMode !== "semi" || !columns.labels.name) return columns;
    const labels = { ...columns.labels };
    delete labels.name;
    return { ...columns, labels };
  };

  const pendingColumns =
    pending?.kind === "template" ? forDocument(pending.template.columns) : pending ? forDocument(pending.preview.columns) : null;
  const change = pendingColumns ? describeTemplateChange(code, config, pendingColumns, presentColumn) : null;
  const selected = templates.find((item) => item.id === selectedId) ?? null;
  const displayTemplateName = (template: JournalColumnTemplate) => {
    if (!template.builtIn) return template.name;
    switch (template.id) {
      case "builtin:appendix4": return t("templateNames.appendix4");
      case "builtin:extended": return t("templateNames.extended");
      case "builtin:standard": return t("templateNames.standard");
      default: return template.name;
    }
  };
  const displayColumnLabel = (key: string, fallback: string) => {
    const column = resolveColumns(code, { ...config, columns: pendingColumns ?? current }).find((item) => item.key === key);
    return column ? presentColumn?.(column).label ?? column.label : fallback;
  };

  async function saveTemplate(name: string, columns: JournalColumnsConfig) {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/journal-column-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, columns }),
      });
      if (!response.ok) throw new Error();
      toast.success(t("saveSuccess", { name }));
      setSaveName(null);
      await load();
    } catch {
      toast.error(t("errors.save"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate(template: JournalColumnTemplate) {
    setBusy(true);
    try {
      const response = await fetch(`/api/settings/journal-column-templates/${encodeURIComponent(template.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error();
      toast.success(t("deleteSuccess", { name: template.name }));
      setSelectedId("");
      await load();
    } catch {
      toast.error(t("errors.delete"));
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("code", code);
      form.set("file", file);
      const response = await fetch("/api/settings/journal-column-templates/import", { method: "POST", body: form });
      const body = (await response.json().catch(() => null)) as ImportedColumnsPreview | null;
      if (!response.ok || !body) throw new Error();
      setPending({ kind: "import", preview: body, fileName: file.name });
    } catch {
      toast.error(t("errors.readFile"));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const buttonClass =
    "inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50";

  return (
    <div className="space-y-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3">
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
        <LayoutTemplate className="size-3.5 text-[#5566f6]" />
        {t("title")}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selectedId}
          onChange={(event) => {
            const id = event.target.value;
            setSelectedId(id);
            const template = templates.find((item) => item.id === id);
            setPending(template ? { kind: "template", template } : null);
          }}
          className="h-9 min-w-0 flex-1 rounded-xl border border-[#dcdfed] bg-white px-2 text-[13.5px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          aria-label={t("chooseAria")}
        >
          <option value="">{t("choosePlaceholder")}</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.builtIn ? "" : t("customPrefix")}
              {displayTemplateName(template)}
            </option>
          ))}
        </select>
        {selected && !selected.builtIn && canManage ? (
          <button
            type="button"
            onClick={() => void deleteTemplate(selected)}
            disabled={busy}
            className="rounded-xl p-2 text-[#a13a32] transition-colors duration-150 hover:bg-[#fff4f2] disabled:opacity-50"
            title={t("deleteTitle")}
            aria-label={t("deleteAria", { name: selected.name })}
          >
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </div>

      {pending && change ? (
        <div className="space-y-2 rounded-xl border border-[#ffe9b0] bg-[#fff8eb] p-3 text-[13px] text-[#7a4a00]" role="alert">
          <div className="flex items-start gap-2 font-semibold">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {pending.kind === "template"
              ? t("alertTemplate", { name: displayTemplateName(pending.template) })
              : t("alertFile", { fileName: pending.fileName })}
          </div>
          <ul className="list-disc space-y-0.5 pl-6 leading-snug">
            {pending.kind === "import" ? (
              <>
                <li>
                  {t("matched", {
                    count: pending.preview.matched.length,
                    labels: pending.preview.matched.length > 0
                      ? ` (${pending.preview.matched.map((item) => displayColumnLabel(item.key, item.standardLabel)).join(", ")})`
                      : "",
                  })}
                </li>
                {pending.preview.custom.length > 0 ? (
                  <li>{t("customAdded", { labels: pending.preview.custom.join(", ") })}</li>
                ) : null}
                {pending.preview.skipped.length > 0 ? (
                  <li>{t("skipped", { labels: pending.preview.skipped.join(", ") })}</li>
                ) : null}
              </>
            ) : null}
            {change.hide.length > 0 ? <li>{t("hidden", { labels: change.hide.join(", ") })}</li> : null}
            {change.show.length > 0 ? <li>{t("shown", { labels: change.show.join(", ") })}</li> : null}
            {change.renamed > 0 ? <li>{t("renamed", { count: change.renamed })}</li> : null}
            {change.customRemoved.length > 0 ? <li>{t("customRemoved", { labels: change.customRemoved.join(", ") })}</li> : null}
            <li>{t("recordsPreserved")}</li>
            <li>{t("applyToAllHint")}</li>
          </ul>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                if (pendingColumns) onApply(pendingColumns);
                toast.success(t("applySuccess"));
                setPending(null);
                setSelectedId("");
              }}
              className="inline-flex h-9 items-center rounded-xl bg-[#5566f6] px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0]"
            >
              {t("apply")}
            </button>
            {pending.kind === "import" && canManage ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveTemplate(pending.fileName.replace(/\.xlsx$/i, "").slice(0, JOURNAL_TEMPLATE_NAME_MAX), pending.preview.columns)}
                className={buttonClass}
              >
                <Save className="size-4" /> {t("saveAs")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setPending(null);
                setSelectedId("");
              }}
              className="inline-flex h-9 items-center rounded-xl px-3 text-[13px] font-medium text-[#6f7282] transition-colors duration-150 hover:bg-white"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {saveName !== null ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={saveName}
            onChange={(event) => setSaveName(event.target.value)}
            maxLength={JOURNAL_TEMPLATE_NAME_MAX}
            placeholder={t("namePlaceholder")}
            autoFocus
            className="h-9 min-w-0 flex-1 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13.5px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            aria-label={t("nameAria")}
          />
          <button
            type="button"
            disabled={busy || !saveName.trim()}
            onClick={() => void saveTemplate(saveName.trim(), current)}
            className="inline-flex h-9 items-center rounded-xl bg-[#5566f6] px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-50"
          >
            {t("save")}
          </button>
          <button
            type="button"
            onClick={() => setSaveName(null)}
            className="inline-flex h-9 items-center rounded-xl px-3 text-[13px] text-[#6f7282] hover:bg-white"
          >
              {t("cancel")}
          </button>
        </div>
      ) : null}

      {canManage ? (
        <div className="flex flex-wrap gap-2">
          {saveName === null ? (
            <button type="button" onClick={() => setSaveName("")} className={buttonClass}>
              <Save className="size-4" /> {t("saveAs")}
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={buttonClass}>
            <FileSpreadsheet className="size-4" /> {t("upload")}
          </button>
          <a
            href={`/api/settings/journal-column-templates/import?code=${encodeURIComponent(code)}&locale=${locale}`}
            className={buttonClass}
            onClick={(event) => {
              if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              chooseExportLanguage(selectedLocale => {
                void downloadFile(`/api/settings/journal-column-templates/import?code=${encodeURIComponent(code)}&locale=${selectedLocale}`);
              }, t("downloadSample"));
            }}
          >
            <Download className="size-4" /> {t("downloadSample")}
          </a>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
            }}
          />
        </div>
      ) : null}
      <p className="text-[12px] leading-snug text-[#6f7282]">
        {t("hint")}
      </p>
    </div>
  );
}
