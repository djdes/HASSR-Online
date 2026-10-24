"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Deadline = { tone: "ok" | "soon" | "overdue"; hoursLeft: number | null; daysOverdue: number };

export type VsdRow = {
  id: string;
  uuid: string;
  number: string | null;
  remoteStatus: string;
  localStatus: string;
  deliveryDate: string | null;
  processingDueAt: string | null;
  productName: string | null;
  volume: number | null;
  unit: string | null;
  batchNumber: string | null;
  expiryDate: string | null;
  consignorName: string | null;
  manufacturerName: string | null;
  accompanyingDocs: string | null;
  transportInfo: string | null;
  processError: string | null;
  journalDocumentId: string | null;
  deadline: Deadline;
};

const TAB_KEYS = ["pending", "overdue", "processed", "all"] as const;

function formatDate(iso: string | null, dateLocale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(dateLocale);
}

function useDateLocale(): string {
  const locale = useLocale();
  return locale === "en" ? "en-GB" : locale === "uz" ? "uz-UZ" : "ru-RU";
}

function DeadlineBadge({ deadline, status }: { deadline: Deadline; status: string }) {
  const t = useTranslations("mercuryUi.incomingVsdClient");
  if (status === "processed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfdf5] px-2.5 py-1 text-[12px] font-medium text-[#116b2a]">
        <CheckCircle2 className="size-3.5" /> {t("badgeProcessed")}
      </span>
    );
  }
  if (status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium text-[#3848c7]">
        <Loader2 className="size-3.5 animate-spin" /> {t("badgeProcessing")}
      </span>
    );
  }
  if (deadline.tone === "overdue") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#fff4f2] px-2.5 py-1 text-[12px] font-medium text-[#a13a32]">
        <AlertTriangle className="size-3.5" />
        {deadline.daysOverdue > 0 ? t("badgeOverdueDays", { days: deadline.daysOverdue }) : t("badgeOverdue")}
      </span>
    );
  }
  if (deadline.tone === "soon") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#fff8e6] px-2.5 py-1 text-[12px] font-medium text-[#a1740a]">
        <Clock className="size-3.5" /> {t("badgeToday")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#f1f2f6] px-2.5 py-1 text-[12px] text-[#6f7282]">
      <Clock className="size-3.5" /> {t("badgeOnTime")}
    </span>
  );
}

export function IncomingVsdClient({
  documents,
  enabled,
  demoMode,
}: {
  documents: VsdRow[];
  enabled: boolean;
  demoMode: boolean;
}) {
  const t = useTranslations("mercuryUi.incomingVsdClient");
  const dateLocale = useDateLocale();
  const router = useRouter();
  const tabLabels: Record<(typeof TAB_KEYS)[number], string> = {
    pending: t("tabPending"),
    overdue: t("tabOverdue"),
    processed: t("tabProcessed"),
    all: t("tabAll"),
  };
  const [tab, setTab] = useState<(typeof TAB_KEYS)[number]>("pending");
  const [active, setActive] = useState<VsdRow | null>(null);

  const filtered = useMemo(() => {
    switch (tab) {
      case "pending":
        return documents.filter((d) => ["new", "acknowledged"].includes(d.localStatus));
      case "overdue":
        return documents.filter(
          (d) =>
            ["new", "acknowledged"].includes(d.localStatus) &&
            d.deadline.tone === "overdue",
        );
      case "processed":
        return documents.filter((d) => d.localStatus === "processed");
      default:
        return documents;
    }
  }, [documents, tab]);

  const counts = useMemo(
    () => ({
      pending: documents.filter((d) => ["new", "acknowledged"].includes(d.localStatus)).length,
      overdue: documents.filter(
        (d) => ["new", "acknowledged"].includes(d.localStatus) && d.deadline.tone === "overdue",
      ).length,
      processed: documents.filter((d) => d.localStatus === "processed").length,
      all: documents.length,
    }),
    [documents],
  );

  return (
    <div className="space-y-4">
      {demoMode ? (
        <div className="flex items-start gap-3 rounded-2xl border border-[#f0c674] bg-[#fff8e6] p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#a1740a]" />
          <div className="text-[13px] leading-[1.6] text-[#7a5a08]">
            <div className="font-semibold">{t("demoTitle")}</div>
            {t("demoText")}
          </div>
        </div>
      ) : null}

      {!enabled ? (
        <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[13px] leading-[1.6] text-[#6f7282]">
          {t("syncOff")}{" "}
          <Link href="/settings/integrations/mercury" className="text-[#3848c7] underline">
            {t("syncEnable")}
          </Link>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {TAB_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium transition-colors duration-150 ${
              tab === key
                ? "bg-[#5566f6] text-white"
                : "bg-[#f5f6ff] text-[#3848c7] hover:bg-[#eef1ff]"
            }`}
          >
            {tabLabels[key]}
            <span className="tabular-nums opacity-70">{counts[key]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          <div className="text-[15px] font-medium text-[#0b1024]">
            {tab === "pending" ? t("emptyAllClear") : t("emptyHere")}
          </div>
          <p className="mx-auto mt-1.5 max-w-[380px] text-[13px] text-[#6f7282]">
            {tab === "pending"
              ? t("emptyPendingText")
              : t("emptyOtherTab")}
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((doc) => (
            <li
              key={doc.id}
              className="rounded-2xl border border-[#ececf4] bg-white p-4 transition-colors hover:border-[#5566f6]/30"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-[#0b1024]">
                      {doc.productName || t("untitled")}
                    </span>
                    <DeadlineBadge deadline={doc.deadline} status={doc.localStatus} />
                  </div>
                  <div className="mt-1 text-[13px] text-[#6f7282]">
                    {doc.consignorName || t("noSupplier")}
                    {doc.volume ? ` · ${doc.volume} ${doc.unit ?? ""}` : ""}
                    {doc.batchNumber ? t("batch", { value: doc.batchNumber }) : ""}
                  </div>
                  <div className="mt-1 text-[12px] text-[#9b9fb3]">
                    {t("vsdLine", { number: doc.number ?? doc.uuid.slice(0, 8), delivery: formatDate(doc.deliveryDate, dateLocale), expiry: formatDate(doc.expiryDate, dateLocale) })}
                  </div>
                  {doc.processError ? (
                    <div className="mt-2 rounded-xl bg-[#fff4f2] px-3 py-2 text-[12px] text-[#a13a32]">
                      {doc.processError}
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {doc.journalDocumentId ? (
                    <Link
                      href={`/journals/incoming_control/documents/${doc.journalDocumentId}`}
                      className="inline-flex h-10 items-center rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[13px] font-medium text-[#0b1024] hover:bg-[#f5f6ff]"
                    >
                      {t("inJournal")}
                    </Link>
                  ) : null}
                  {["new", "acknowledged", "process_failed"].includes(doc.localStatus) ? (
                    <Button
                      onClick={() => setActive(doc)}
                      className="h-10 rounded-2xl bg-[#5566f6] px-4 text-[13px] font-medium text-white hover:bg-[#4a5bf0]"
                    >
                      {t("accept")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AcceptDialog
        doc={active}
        onClose={() => setActive(null)}
        onDone={() => {
          setActive(null);
          router.refresh();
        }}
      />
    </div>
  );
}

/**
 * Окно приёмки: слева — что сказал Меркурий, справа — что увидел человек.
 *
 * Поля физического контроля намеренно без «правильных» умолчаний: их
 * ставит приёмщик, и в этом весь смысл журнала входного контроля.
 */
function AcceptDialog({
  doc,
  onClose,
  onDone,
}: {
  doc: VsdRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("mercuryUi.incomingVsdClient");
  const dateLocale = useDateLocale();
  const [saving, setSaving] = useState(false);
  const [temp, setTemp] = useState("");
  const [transportOk, setTransportOk] = useState(true);
  const [packagingOk, setPackagingOk] = useState(true);
  const [organolepticOk, setOrganolepticOk] = useState(true);
  const [documentsOk, setDocumentsOk] = useState(true);
  const [decision, setDecision] = useState<"ACCEPT" | "REJECT">("ACCEPT");
  const [reason, setReason] = useState("");
  const [withdraw, setWithdraw] = useState(true);

  async function submit() {
    if (!doc) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/mercury/documents/${doc.id}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transportConditionOk: transportOk,
          packagingOk,
          organolepticOk,
          documentsOk,
          decision,
          productTemperature: temp || undefined,
          discrepancyReason: decision === "ACCEPT" ? undefined : reason,
          correctiveActions: decision === "ACCEPT" ? undefined : reason,
          withdraw,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t("saveFailed"));
      toast.success(
        withdraw ? t("savedWithdraw") : t("saved"),
      );
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(doc)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-[720px] overflow-y-auto rounded-[24px]">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
        </DialogHeader>

        {doc ? (
          <div className="space-y-5">
            <section className="rounded-2xl bg-[#fafbff] p-4 text-[13px] leading-[1.6] text-[#3c4053]">
              <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
                {t("fromMercury")}
              </div>
              <div className="font-medium text-[#0b1024]">{doc.productName}</div>
              <div>
                {doc.consignorName}
                {doc.manufacturerName && doc.manufacturerName !== doc.consignorName
                  ? t("manufacturer", { name: doc.manufacturerName })
                  : ""}
              </div>
              <div>
                {doc.volume ? `${doc.volume} ${doc.unit ?? ""}` : t("volumeNotSet")}
                {doc.batchNumber ? t("batch", { value: doc.batchNumber }) : ""}
                {t("bestBefore", { date: formatDate(doc.expiryDate, dateLocale) })}
              </div>
              <div className="text-[#6f7282]">
                {t("vsdNumber", { number: doc.number ?? doc.uuid.slice(0, 8) })}
                {doc.accompanyingDocs ? ` · ${doc.accompanyingDocs}` : ""}
              </div>
            </section>

            <section className="space-y-3">
              <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
                {t("physicalControl")}
              </div>
              <p className="text-[13px] leading-[1.55] text-[#6f7282]">
                {t("physicalNote")}
              </p>

              <div>
                <Label htmlFor="temp" className="text-[13px]">
                  {t("temperature")}
                </Label>
                <Input
                  id="temp"
                  value={temp}
                  onChange={(e) => setTemp(e.target.value)}
                  placeholder={t("temperaturePlaceholder")}
                  className="mt-1.5 h-11 rounded-2xl border-[#dcdfed] px-3.5 text-[14px] sm:w-[200px]"
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { label: t("transportOk"), value: transportOk, set: setTransportOk },
                  { label: t("packagingOk"), value: packagingOk, set: setPackagingOk },
                  { label: t("organolepticOk"), value: organolepticOk, set: setOrganolepticOk },
                  { label: t("documentsOk"), value: documentsOk, set: setDocumentsOk },
                ].map((item) => (
                  <label
                    key={item.label}
                    className="flex cursor-pointer items-center gap-2.5 rounded-2xl border border-[#ececf4] px-3.5 py-3 text-[13px] hover:bg-[#fafbff]"
                  >
                    <input
                      type="checkbox"
                      checked={item.value}
                      onChange={(e) => item.set(e.target.checked)}
                      className="size-4 accent-[#5566f6]"
                    />
                    {item.label}
                  </label>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                {(["ACCEPT", "REJECT"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDecision(value)}
                    className={`rounded-2xl px-4 py-2.5 text-[14px] font-medium transition-colors duration-150 ${
                      decision === value
                        ? value === "ACCEPT"
                          ? "bg-[#ecfdf5] text-[#116b2a]"
                          : "bg-[#fff4f2] text-[#a13a32]"
                        : "bg-[#f5f6ff] text-[#6f7282] hover:bg-[#eef1ff]"
                    }`}
                  >
                    {value === "ACCEPT" ? t("decisionAccept") : t("decisionReject")}
                  </button>
                ))}
              </div>

              {decision !== "ACCEPT" ? (
                <div>
                  <Label htmlFor="reason" className="text-[13px]">
                    {t("reasonLabel")}
                  </Label>
                  <Input
                    id="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t("reasonPlaceholder")}
                    className="mt-1.5 h-11 rounded-2xl border-[#dcdfed] px-3.5 text-[14px]"
                  />
                </div>
              ) : null}

              <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl bg-[#f5f6ff] px-3.5 py-3 text-[13px]">
                <input
                  type="checkbox"
                  checked={withdraw}
                  onChange={(e) => setWithdraw(e.target.checked)}
                  className="mt-0.5 size-4 accent-[#5566f6]"
                />
                <span>
                  {t("withdrawLabel")}
                  <span className="mt-0.5 block text-[12px] text-[#6f7282]">
                    {t("withdrawHint")}
                  </span>
                </span>
              </label>
            </section>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={submit}
                disabled={saving || (decision !== "ACCEPT" && !reason)}
                className="h-11 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0]"
              >
                {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {withdraw ? t("submitWithdraw") : t("submitJournal")}
              </Button>
              <Button
                variant="outline"
                onClick={onClose}
                className="h-11 rounded-2xl border-[#dcdfed] px-5 text-[14px]"
              >
                {t("cancel")}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
