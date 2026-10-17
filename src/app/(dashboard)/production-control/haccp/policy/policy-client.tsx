"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ExternalLink, Printer, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StaffPicker, type StaffPickerOption } from "@/components/shared/staff-picker";
import type { PolicyData } from "@/lib/ppk/records";
import { usePpkRecords } from "@/components/production-control/use-ppk-records";
import {
  PPK_BUTTON_OUTLINE_CLASS,
  PPK_BUTTON_PRIMARY_CLASS,
  PPK_FIELD_CLASS,
  PPK_LABEL_CLASS,
  PPK_TEXTAREA_CLASS,
} from "@/components/production-control/ppk-ui";

type PolicyRecord = { id: string; text: string; approvedById: string | null; approvedAt: string | null };

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Политика качества: редактор текста с утверждением и карточка «Лист с QR».
 * Запись одна на организацию; QR и токен приходят с сервера, после сохранения
 * страница перечитывается.
 */
export function PolicyClient({
  header,
  record,
  defaultText,
  staff,
  token,
  qrSvg,
  ack,
}: {
  header: ReactNode;
  record: PolicyRecord | null;
  defaultText: string;
  staff: StaffPickerOption[];
  token: string | null;
  qrSvg: string | null;
  /** Сводка ознакомления сотрудников (только когда политика сохранена). */
  ack?: ReactNode;
}) {
  const t = useTranslations("productionControl.policy");
  const router = useRouter();
  const initial = record ? [{ id: record.id, data: record as unknown as PolicyData, sortOrder: 0, updatedAt: "" }] : [];
  const { records, create, update } = usePpkRecords<PolicyData>("policy", initial);
  const current = records[0] ?? null;

  const [text, setText] = useState(record?.text ?? defaultText);
  const [approvedById, setApprovedById] = useState<string | null>(record?.approvedById ?? null);
  const [approvedAt, setApprovedAt] = useState(record?.approvedAt ?? "");
  const [saving, setSaving] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);

  const approved = Boolean(approvedById && approvedAt);

  function pickApprover(id: string | null) {
    setApprovedById(id);
    if (id && !approvedAt) setApprovedAt(todayIso());
  }

  async function save() {
    if (saving || !text.trim()) return;
    setSaving(true);
    const data = { text, approvedById, approvedAt: approvedAt || null } as PolicyData;
    const ok = current ? await update(current.id, data) : await create(data);
    setSaving(false);
    if (ok) {
      toast.success(t("saved"));
      router.refresh();
    }
  }

  async function rotate() {
    const response = await fetch("/api/production-control/policy/rotate", { method: "POST" });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      toast.error(body?.error ?? t("rotateFailed"));
      return;
    }
    toast.success(t("rotated"));
    setRotateOpen(false);
    router.refresh();
  }

  return (
    <>
      {header}

      <section className="space-y-4 rounded-3xl border border-[#ececf4] bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("text")}</h2>
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium ${
              approved ? "bg-[#e9f8ef] text-[#1f7a45]" : "bg-[#f5f6ff] text-[#6f7282]"
            }`}
          >
            {approved ? t("approved") : t("draft")}
          </span>
        </div>

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label={t("text")}
          className={`${PPK_TEXTAREA_CLASS} min-h-[340px]`}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className={PPK_LABEL_CLASS}>{t("approvedBy")}</span>
            <StaffPicker
              value={approvedById}
              onChange={pickApprover}
              staff={staff}
              recommendedIds={staff.filter((person) => person.isManager).map((person) => person.id)}
              placeholder={t("approvedBy")}
            />
          </div>
          <label>
            <span className={PPK_LABEL_CLASS}>{t("approvedAt")}</span>
            <input
              type="date"
              value={approvedAt}
              onChange={(event) => setApprovedAt(event.target.value)}
              className={PPK_FIELD_CLASS}
            />
          </label>
        </div>

        <div className="flex justify-end">
          <button type="button" onClick={save} disabled={saving || !text.trim()} className={PPK_BUTTON_PRIMARY_CLASS}>
            {t("save")}
          </button>
        </div>
      </section>

      {ack}

      {token && qrSvg ? (
        <section className="flex flex-col gap-5 rounded-3xl border border-[#ececf4] bg-white p-5 sm:flex-row sm:items-center">
          <div
            className="size-[132px] shrink-0 [&>svg]:size-full"
            aria-hidden
            // SVG целиком собран brandQrSvg на сервере из адреса страницы, пользовательского ввода в нём нет.
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <div className="min-w-0 flex-1 space-y-3">
            <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("qrTitle")}</h2>
            <p className="text-[13.5px] text-[#6f7282]">{t("qrHint")}</p>
            <div className="flex flex-wrap gap-2">
              <Link href="/production-control/haccp/policy/print" className={PPK_BUTTON_PRIMARY_CLASS}>
                <Printer className="size-4" />
                {t("print")}
              </Link>
              <Link href={`/policy/${token}`} className={PPK_BUTTON_OUTLINE_CLASS}>
                <ExternalLink className="size-4" />
                {t("publicPage")}
              </Link>
              <button type="button" onClick={() => setRotateOpen(true)} className={PPK_BUTTON_OUTLINE_CLASS}>
                <RefreshCw className="size-4" />
                {t("rotate")}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={rotateOpen}
        onClose={() => setRotateOpen(false)}
        onConfirm={rotate}
        title={t("rotateTitle")}
        description={t("rotateBody")}
        variant="warn"
        confirmLabel={t("rotate")}
      />
    </>
  );
}
