"use client";

import { useTranslations } from "next-intl";
import { taskFillErrorMessage } from "@/lib/task-fill-messages";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ClipboardCheck, MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";

/**
 * Verifier flow для TasksFlow supervisor-task.
 *
 * Когда проверяющий открывает задачу в TasksFlow → попадает сюда (а не
 * на форму заполнения). Видит read-only-сводку по тому, что заполнил
 * сотрудник, и принимает решение:
 *   • «Принять журнал» → все entries → verificationStatus = approved.
 *   • «Вернуть на доработку» с причиной → entries → rejected + reason.
 *     Сотрудник получит push в TasksFlow с возможностью исправить.
 *
 * Если сотрудник ещё не закончил заполнение — показывается banner
 * «Подождите, журнал не закрыт». Verifier может зайти позже.
 */

type EntryView = {
  id: string;
  date: string; // ISO date-only
  employeeName: string;
  employeePosition: string | null;
  verificationStatus: string | null;
  /** Краткая запись содержания (key-value pairs). */
  fields: Array<{ label: string; value: string }>;
};

export type TaskVerifyClientProps = {
  taskId: number;
  token: string;
  journalLabel: string;
  documentTitle: string;
  documentClosed: boolean;
  /** Текущий статус документа: "submitted" | "approved" | "rejected" | null. */
  documentVerificationStatus: string | null;
  /** Если документ был отклонён ранее — старая причина (для контекста). */
  previousRejectReason: string | null;
  entries: EntryView[];
  /** Имя verifier'а из TF — для шапки страницы. */
  verifierName: string;
  returnUrl: string | null;
  /**
   * Сколько filler-задач связано с этим документом, и сколько уже
   * выполнено. Нужно показать verifier'у явный прогресс — без этого
   * непонятно, ждать ли заполнителя или уже можно проверять.
   */
  totalFillers: number;
  completedFillers: number;
};

export function TaskVerifyClient(props: TaskVerifyClientProps) {
  const t = useTranslations("taskFill");
  const currentTranslations = useRef(t);
  useEffect(() => { currentTranslations.current = t; }, [t]);
  const [submitting, setSubmitting] = useState(false);
  const [decided, setDecided] = useState<null | "approved" | "rejected">(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const empty = props.entries.length === 0;
  // Готов ли документ к проверке: все filler-задачи завершены.
  const allFillersDone =
    props.totalFillers > 0 &&
    props.completedFillers >= props.totalFillers;
  const someFillersPending =
    props.totalFillers > 0 && props.completedFillers < props.totalFillers;

  async function submitDecision(
    decision: "approved" | "rejected",
    reason: string
  ) {
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/task-fill/${props.taskId}/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: props.token, decision, reason }),
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(
          taskFillErrorMessage(data, currentTranslations.current, currentTranslations.current("verify.error"))
        );
        return;
      }
      setDecided(decision);
      toast.success(
        decision === "approved"
          ? currentTranslations.current("verify.approvedToast")
          : currentTranslations.current("verify.rejectedToast")
      );
      setConfirmApprove(false);
      setConfirmReject(false);
      // Закрываем webview если в TF (есть returnUrl)
      if (props.returnUrl && typeof window !== "undefined") {
        setTimeout(() => {
          window.location.href = props.returnUrl!;
        }, 1500);
      }
    } catch {
      toast.error(currentTranslations.current("verify.error"));
    } finally {
      setSubmitting(false);
    }
  }

  // Если уже решено — показываем итог и блокируем actions
  const isReadOnly = decided !== null;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4">
      <div className="rounded-3xl border border-[#ececf4] bg-[#0b1024] p-5 text-white shadow-[0_20px_60px_-30px_rgba(11,16,36,0.55)] sm:p-7">
        <div className="flex items-start gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
            <ClipboardCheck className="size-6" />
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/60">
              {t("verify.title")}</div>
            <h1 className="mt-1 text-[clamp(1.25rem,2vw+0.75rem,1.75rem)] font-semibold leading-tight tracking-[-0.02em]">
              {props.documentTitle}
            </h1>
            <p className="mt-1 text-[14px] text-white/70">
              {t("verify.reviewer", { journal: props.journalLabel, name: props.verifierName })}
            </p>
          </div>
        </div>
      </div>

      {decided ? (
        <div
          className={`rounded-3xl border p-5 ${
            decided === "approved"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          <div className="text-[15px] font-semibold">
            {decided === "approved"
              ? t("verify.approvedResult")
              : t("verify.rejectedResult")}
          </div>
        </div>
      ) : null}

      {/* Прогресс fillers'ов — главный сигнал «можно проверять или ждать» */}
      {props.totalFillers > 0 ? (
        <div
          className={`rounded-3xl border p-4 sm:p-5 ${
            allFillersDone
              ? "border-emerald-200 bg-emerald-50/60"
              : "border-amber-200 bg-amber-50/60"
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`flex size-10 shrink-0 items-center justify-center rounded-2xl text-[15px] font-semibold ${
                allFillersDone
                  ? "bg-emerald-500 text-white"
                  : "bg-amber-500 text-white"
              }`}
            >
              {props.completedFillers}/{props.totalFillers}
            </div>
            <div className="min-w-0 flex-1">
              <div
                className={`text-[15px] font-semibold ${
                  allFillersDone ? "text-emerald-900" : "text-amber-900"
                }`}
              >
                {allFillersDone
                  ? t("verify.ready")
                  : t("verify.waiting")}
              </div>
              <p
                className={`mt-0.5 text-[13px] ${
                  allFillersDone ? "text-emerald-800/80" : "text-amber-900/80"
                }`}
              >
                {allFillersDone
                  ? t("verify.readyHint")
                  : t("verify.progressHint", { completed: props.completedFillers, total: props.totalFillers })}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {empty ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-8 text-center text-[#6f7282]">
          <div className="text-[15px] font-medium text-[#0b1024]">
            {t("verify.emptyTitle")}</div>
          <p className="mt-1 text-[13px]">
            {t("verify.emptyHint")}</p>
        </div>
      ) : (
        <>
          <div className="rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
            <div className="border-b border-[#ececf4] px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
              {t("verify.entries", { count: props.entries.length })}
            </div>
            <ul className="divide-y divide-[#ececf4]">
              {props.entries.map((entry, idx) => (
                <li key={entry.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                    <div className="font-medium text-[#0b1024]">
                      {idx + 1}. {entry.employeeName}
                    </div>
                    <div className="text-[12px] text-[#9b9fb3]">
                      {entry.date}
                      {entry.employeePosition
                        ? ` · ${entry.employeePosition}`
                        : ""}
                    </div>
                  </div>
                  {entry.fields.length > 0 ? (
                    <dl className="mt-2 grid grid-cols-1 gap-1 text-[13px] sm:grid-cols-2">
                      {entry.fields.map((f, i) => (
                        <div
                          key={i}
                          className="flex items-baseline justify-between gap-2 rounded-xl bg-[#fafbff] px-3 py-1.5"
                        >
                          <dt className="text-[12px] uppercase tracking-[0.12em] text-[#9b9fb3]">
                            {f.label}
                          </dt>
                          <dd className="text-right text-[13px] text-[#0b1024]">
                            {f.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="mt-1.5 text-[12px] italic text-[#9b9fb3]">
                      {t("verify.noEntryData")}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="sticky bottom-2 z-10 flex flex-col gap-2 rounded-3xl border border-[#ececf4] bg-white/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] leading-snug text-[#6f7282]">
              {someFillersPending
                ? t("verify.waitingDecisionHint")
                : t("verify.decisionHint")}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                disabled={submitting || isReadOnly}
                onClick={() => setConfirmReject(true)}
                className="h-11 rounded-2xl border-[#fed4ce] bg-[#fff4f2] px-4 text-[14px] font-medium text-[#a13a32] hover:border-[#a13a32]/30 hover:bg-[#ffe5e1]"
              >
                <MessageSquareWarning className="size-4" />
                {t("verify.reject")}</Button>
              <Button
                type="button"
                disabled={submitting || isReadOnly}
                onClick={() => setConfirmApprove(true)}
                className="h-11 rounded-2xl bg-emerald-600 px-5 text-[14px] font-medium text-white hover:bg-emerald-700"
              >
                <CheckCircle2 className="size-4" />
                {t("verify.approveJournal")}</Button>
            </div>
          </div>
        </>
      )}

      {props.documentVerificationStatus === "rejected" &&
      props.previousRejectReason ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900">
          <div className="font-semibold">
            {t("verify.previousRejection")}</div>
          <div className="mt-0.5">{props.previousRejectReason}</div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmApprove}
        onClose={() => setConfirmApprove(false)}
        variant="info"
        title={t("verify.approveTitle")}
        description={
          <span>
            {t("verify.approveHint", { count: props.entries.length })}
          </span>
        }
        confirmLabel={submitting ? t("actions.saving") : t("verify.approve")}
        onConfirm={() => submitDecision("approved", "")}
      />

      <ConfirmDialog
        open={confirmReject}
        onClose={() => setConfirmReject(false)}
        variant="warn"
        title={t("verify.rejectTitle")}
        description={
          <div className="space-y-2">
            <p>{t("verify.rejectHint")}</p>
            <textarea
              aria-label={t("verify.rejectHint")}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t("verify.rejectPlaceholder")}
              className="min-h-[80px] w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-2 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
        }
        confirmLabel={submitting ? t("verify.sending") : t("verify.reject")}
        onConfirm={() => {
          if (!rejectReason.trim()) {
            toast.error(t("verify.reasonRequired"));
            return;
          }
          return submitDecision("rejected", rejectReason.trim());
        }}
      />
    </div>
  );
}
