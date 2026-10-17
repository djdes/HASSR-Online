"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, ChevronDown, History } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StaffPicker, type StaffPickerOption } from "@/components/shared/staff-picker";
import type { DocVersion } from "@/lib/ppk/records";
import { latestDocVersion, shortName, sortedVersions } from "@/lib/ppk/review";
import { usePpkRecords, type PpkRecordRow } from "@/components/production-control/use-ppk-records";
import {
  PPK_BUTTON_OUTLINE_CLASS,
  PPK_BUTTON_PRIMARY_CLASS,
  PPK_FIELD_CLASS,
  PPK_LABEL_CLASS,
  PPK_TEXTAREA_CLASS,
} from "@/components/production-control/ppk-ui";

/** ГГГГ-ММ-ДД → ДД.ММ.ГГГГ. */
function ruDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

/**
 * Версия документа над печатным листом (на печать не идёт): «Версия 3 · утверждена
 * 12.10.2026 · Иванова А.», кнопка «Утвердить новую версию» и раскрывающаяся история.
 * `initial` — версии всех документов; показываются только версии `doc`.
 */
export function PpkDocVersions({
  doc,
  initial,
  staff,
  today,
}: {
  doc: DocVersion["doc"];
  initial: PpkRecordRow<DocVersion>[];
  staff: StaffPickerOption[];
  /** Сегодняшняя дата YYYY-MM-DD (по Москве) — подставляется в окно. */
  today: string;
}) {
  const t = useTranslations("productionControl.versions");
  const router = useRouter();
  const { records, create } = usePpkRecords<DocVersion>("doc-versions", initial);
  const [dialog, setDialog] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const names = new Map(staff.map((person) => [person.id, person.name]));
  const versions = sortedVersions(
    records.map((row) => row.data),
    doc,
  );
  const latest = latestDocVersion(versions, doc);
  const nextNumber = (latest?.version ?? 0) + 1;
  const approver = (version: DocVersion) => (version.approvedById ? names.get(version.approvedById) : undefined);

  return (
    <section className="space-y-3 rounded-3xl border border-[#ececf4] bg-white p-4 print:hidden sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
          <CheckCircle2 className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 text-[14.5px] font-medium text-[#0b1024]">
          {latest ? (
            <>
              {t("current", { version: String(latest.version), date: ruDate(latest.approvedAt) })}
              {approver(latest) ? ` · ${shortName(approver(latest)!)}` : ""}
            </>
          ) : (
            <span className="text-[#6f7282]">{t("none")}</span>
          )}
        </div>
        <button type="button" onClick={() => setDialog(true)} className={PPK_BUTTON_PRIMARY_CLASS}>
          {t("approve")}
        </button>
      </div>

      {versions.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setHistoryOpen((open) => !open)}
            aria-expanded={historyOpen}
            className="inline-flex items-center gap-1.5 rounded-xl px-1 py-1 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            <History className="size-4" aria-hidden />
            {t("history")}
            <ChevronDown
              className={`size-4 transition-transform duration-150 ${historyOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          {historyOpen ? (
            <ul className="mt-2 divide-y divide-[#ececf4] rounded-2xl border border-[#ececf4]">
              {versions.map((version) => (
                <li key={version.version} className="px-4 py-2.5 text-[13.5px]">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[#0b1024]">
                    <span className="font-semibold">{t("versionLabel", { version: String(version.version) })}</span>
                    <span className="text-[#6f7282]">{ruDate(version.approvedAt)}</span>
                    <span className="text-[#6f7282]">
                      {approver(version) ? shortName(approver(version)!) : t("noApprover")}
                    </span>
                  </div>
                  {version.note ? <p className="mt-0.5 text-[#3c4053]">{version.note}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {dialog ? (
        <ApproveDialog
          nextNumber={nextNumber}
          staff={staff}
          today={today}
          onClose={() => setDialog(false)}
          onSave={async (data) => {
            const saved = await create({ ...data, doc, version: nextNumber });
            // Лист ниже собирается на сервере: перечитываем страницу, чтобы на нём появилась новая версия.
            if (saved) router.refresh();
            return saved;
          }}
        />
      ) : null}
    </section>
  );
}

/** Окно «Утвердить версию N»: кто, когда и что изменилось. */
function ApproveDialog({
  nextNumber,
  staff,
  today,
  onClose,
  onSave,
}: {
  nextNumber: number;
  staff: StaffPickerOption[];
  today: string;
  onClose: () => void;
  onSave: (data: Pick<DocVersion, "approvedAt" | "approvedById" | "note">) => Promise<boolean>;
}) {
  const t = useTranslations("productionControl.versions");
  const [approvedById, setApprovedById] = useState<string | null>(null);
  const [approvedAt, setApprovedAt] = useState(today);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!approvedAt || saving) return;
    setSaving(true);
    const saved = await onSave({ approvedAt, approvedById, note: note.trim() });
    setSaving(false);
    if (saved) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-[520px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 gap-0 border-b border-[#ececf4] px-6 py-4 pr-14 text-left">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
            {t("dialogTitle", { version: String(nextNumber) })}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <p className="text-[13.5px] text-[#6f7282]">{t("dialogHint")}</p>
          <div>
            <span className={PPK_LABEL_CLASS}>{t("who")}</span>
            <StaffPicker
              value={approvedById}
              onChange={setApprovedById}
              staff={staff}
              recommendedIds={staff.filter((person) => person.isManager).map((person) => person.id)}
              placeholder={t("who")}
            />
          </div>
          <label className="block">
            <span className={PPK_LABEL_CLASS}>{t("date")}</span>
            <input
              type="date"
              value={approvedAt}
              onChange={(event) => setApprovedAt(event.target.value)}
              className={PPK_FIELD_CLASS}
            />
          </label>
          <label className="block">
            <span className={PPK_LABEL_CLASS}>{t("note")}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder={t("notePlaceholder")}
              className={PPK_TEXTAREA_CLASS}
            />
          </label>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-[#ececf4] px-6 py-4">
          <button type="button" onClick={onClose} className={PPK_BUTTON_OUTLINE_CLASS}>
            {t("cancel")}
          </button>
          <button type="button" onClick={submit} disabled={!approvedAt || saving} className={PPK_BUTTON_PRIMARY_CLASS}>
            {t("save")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
