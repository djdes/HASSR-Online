"use client";

import type { ReactElement } from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  CheckCircle2,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { sortJournalsByName } from "@/lib/journal-sort";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_FILTER_OPTIONS,
  auditActionLabel,
  auditDetailLabel,
  auditDetailPairs,
  auditEntityLabel,
} from "@/lib/audit-labels";

type AuditTranslator = ReturnType<typeof useTranslations<"settingsUi.auditLogViewer">>;

interface AuditEntry {
  id: string;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

const JOURNAL_LABEL_BY_CODE: Record<string, string> =
  ACTIVE_JOURNAL_CATALOG.reduce<Record<string, string>>((acc, item) => {
    acc[item.code] = item.name;
    return acc;
  }, {});

/** Журналы в фильтре — по алфавиту. */
const JOURNALS_BY_NAME = sortJournalsByName(ACTIVE_JOURNAL_CATALOG, (item) => item.name);

function formatDuration(
  ms: number | null | undefined,
  t: AuditTranslator
): string | null {
  if (typeof ms !== "number" || ms <= 0) return null;
  if (ms < 1000) return t("durMs", { ms });
  const sec = Math.round(ms / 1000);
  if (sec < 60) return t("durSec", { sec });
  const min = Math.floor(sec / 60);
  const restSec = sec % 60;
  return restSec > 0 ? t("durMinSec", { min, sec: restSec }) : t("durMin", { min });
}

function renderDetails(entry: AuditEntry, t: AuditTranslator): ReactElement {
  const d = entry.details ?? {};

  // Pipeline step — самый важный case: показываем шаг с длительностью
  if (entry.action === "journal.fill.step") {
    const idx = (d as { stepIndex?: number }).stepIndex;
    const total = (d as { totalSteps?: number }).totalSteps;
    const title = (d as { stepTitle?: string }).stepTitle;
    const journalLabel =
      (d as { journalLabel?: string }).journalLabel ??
      JOURNAL_LABEL_BY_CODE[(d as { journalCode?: string }).journalCode ?? ""] ??
      (d as { journalCode?: string }).journalCode ??
      "—";
    const dur = formatDuration(
      (d as { msSinceFormOpen?: number }).msSinceFormOpen,
      t
    );
    const photoUrl = (d as { photoUrl?: string }).photoUrl;
    return (
      <div className="flex items-start gap-3">
        {photoUrl ? (
          <a
            href={photoUrl}
            target="_blank"
            rel="noreferrer"
            className="block size-12 shrink-0 overflow-hidden rounded-xl border border-[#dcdfed]"
          >
            <img
              src={photoUrl}
              alt={t("photoAlt")}
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          </a>
        ) : null}
        <div className="min-w-0 space-y-1">
          <div className="font-medium text-[#0b1024]">
            {typeof idx === "number" && typeof total === "number" ? (
              <span className="mr-2 inline-flex items-center gap-1 rounded-md bg-[#eef1ff] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[#3848c7]">
                {idx + 1}/{total}
              </span>
            ) : null}
            {title ?? "—"}
          </div>
          <div className="text-[12px] text-[#6f7282]">
            {journalLabel}
            {dur ? <span>{t("afterFormOpen", { dur })}</span> : null}
            {photoUrl ? <span className="ml-1 text-emerald-700">{t("withPhoto")}</span> : null}
          </div>
        </div>
      </div>
    );
  }

  // Photo upload event — показываем thumbnail
  if (entry.action === "journal.fill.photo") {
    const photoUrl = (d as { url?: string }).url;
    const stepIdx = (d as { stepIndex?: number }).stepIndex;
    const journalLabel =
      JOURNAL_LABEL_BY_CODE[(d as { journalCode?: string }).journalCode ?? ""] ??
      (d as { journalCode?: string }).journalCode ??
      "—";
    return (
      <div className="flex items-start gap-3">
        {photoUrl ? (
          <a
            href={photoUrl}
            target="_blank"
            rel="noreferrer"
            className="block size-14 shrink-0 overflow-hidden rounded-xl border border-[#dcdfed]"
          >
            <img
              src={photoUrl}
              alt={t("photoAlt")}
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          </a>
        ) : null}
        <div className="min-w-0 space-y-1">
          <div className="font-medium text-[#0b1024]">
            {t("photoEvidence", {
              step: typeof stepIdx === "number" ? String(stepIdx + 1) : "?",
            })}
          </div>
          <div className="text-[12px] text-[#6f7282]">{journalLabel}</div>
        </div>
      </div>
    );
  }

  if (entry.action === "journal.fill.completed") {
    const stepsCount = (d as { stepsConfirmed?: number }).stepsConfirmed;
    const journalLabel =
      (d as { journalLabel?: string }).journalLabel ??
      JOURNAL_LABEL_BY_CODE[(d as { journalCode?: string }).journalCode ?? ""] ??
      (d as { journalCode?: string }).journalCode ??
      "—";
    const dur = formatDuration(
      (d as { totalDurationMs?: number }).totalDurationMs,
      t
    );
    return (
      <div className="space-y-1">
        <div className="font-medium text-emerald-700">
          ✓ {journalLabel}
        </div>
        <div className="text-[12px] text-[#6f7282]">
          {stepsCount ? t("stepsCount", { count: stepsCount }) : ""}
          {dur ? t("totalDuration", { dur }) : ""}
        </div>
      </div>
    );
  }

  // P1.10 — Pipeline editor / Guide editor мутации.
  if (
    entry.action.startsWith("settings.journal-pipelines.") ||
    entry.action.startsWith("settings.journal-guides.")
  ) {
    const code = (d as { templateCode?: string }).templateCode;
    const journalLabel =
      JOURNAL_LABEL_BY_CODE[code ?? ""] ?? code ?? "";
    const title = (d as { title?: string }).title;
    const isPipeline = entry.action.startsWith(
      "settings.journal-pipelines."
    );

    let primary = "";
    if (entry.action === "settings.journal-pipelines.seed") {
      const count = (d as { createdCount?: number }).createdCount ?? 0;
      primary = t("pipelineSeed", { count });
    } else if (entry.action === "settings.journal-pipelines.seed-all") {
      const created = (d as { created?: number }).created ?? 0;
      const skippedExisting =
        (d as { skippedExisting?: number }).skippedExisting ?? 0;
      const skippedNoFields =
        (d as { skippedNoFields?: number }).skippedNoFields ?? 0;
      primary = t("pipelineSeedAll", {
        created,
        skippedExisting,
        skippedNoFields,
      });
    } else if (entry.action === "settings.journal-pipelines.clear-custom") {
      const removed = (d as { removed?: number }).removed ?? 0;
      primary = t("pipelineClearCustom", { removed });
    } else if (entry.action === "settings.journal-pipelines.clear-all") {
      const removed = (d as { removed?: number }).removed ?? 0;
      primary = t("pipelineClearAll", { removed });
    } else if (entry.action.endsWith(".node.create")) {
      primary = title ? `«${title}»` : t("nodeNew");
    } else if (entry.action.endsWith(".node.delete")) {
      primary = title ? `«${title}»` : t("nodeStep");
    } else if (entry.action.endsWith(".node.update")) {
      // Подсветим какие поля поменялись
      const changed = Object.keys(d).filter(
        (k) => k !== "templateCode" && k !== "title"
      );
      const titlePart = title ? `«${title}»` : "";
      const fieldsPart =
        changed.length > 0
          ? t("changedFields", {
              fields: changed.map((key) => auditDetailLabel(key)).join(", "),
            })
          : "";
      primary = `${titlePart}${fieldsPart}`.trim() || t("nodeChanged");
    } else if (entry.action.endsWith(".node.move")) {
      const parent = (d as { parentId?: string | null }).parentId;
      primary = parent
        ? t("movedInside")
        : t("movedTop");
    } else if (entry.action === "settings.journal-pipelines.node.split") {
      const partNum = (d as { newPartNumber?: number }).newPartNumber;
      primary = partNum ? t("splitWithPart", { part: partNum }) : t("split");
    }

    return (
      <div className="space-y-1">
        <div className="font-medium text-[#0b1024]">{primary || "—"}</div>
        <div className="text-[12px] text-[#6f7282]">
          <span
            className={`mr-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
              isPipeline
                ? "bg-[#eef1ff] text-[#3848c7]"
                : "bg-[#f5f0ff] text-[#7a5cff]"
            }`}
          >
            {isPipeline ? t("badgeInstruction") : t("badgeHint")}
          </span>
          {journalLabel}
        </div>
      </div>
    );
  }

  // Остальное — парами «Подпись: значение». Раньше здесь стоял
  // JSON.stringify: руководитель видел строку со скобками и кавычками
  // и всё равно не понимал, что произошло.
  const pairs = auditDetailPairs(d);
  if (pairs.length === 0) {
    return <div className="text-[12px] text-[#9b9fb3]">—</div>;
  }
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-[#6f7282]">
      {pairs.map((pair) => (
        <span key={pair.key}>
          {pair.label}:{" "}
          <span className="font-medium text-[#0b1024]">{pair.value}</span>
        </span>
      ))}
    </div>
  );
}

export function AuditLogViewer() {
  const t = useTranslations("settingsUi.auditLogViewer");
  const locale = useLocale();
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [journalFilter, setJournalFilter] = useState<string>("all");
  const [userQuery, setUserQuery] = useState("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "30" });
      if (entityFilter !== "all") params.set("entity", entityFilter);
      if (actionFilter !== "all") params.set("action", actionFilter);
      if (journalFilter !== "all") params.set("journalCode", journalFilter);

      const res = await fetch(`/api/audit?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
        setTotalPages(data.totalPages);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, entityFilter, actionFilter, journalFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Группируем подряд идущие записи одного пользователя в «сессии»
  // (split при разрыве > 10 минут или смене пользователя). Это
  // ровно то что нужно манагеру — увидеть полный trail одного
  // прохода workflow'а а не разрозненные строки.
  const groupedLogs = useMemo(() => {
    const filtered = userQuery
      ? logs.filter((l) =>
          (l.userName ?? "")
            .toLowerCase()
            .includes(userQuery.toLowerCase())
        )
      : logs;
    const groups: { sessionKey: string; entries: AuditEntry[] }[] = [];
    for (const log of filtered) {
      const last = groups[groups.length - 1];
      const sameUser = last && last.entries[0].userName === log.userName;
      const lastTime = last
        ? new Date(last.entries[last.entries.length - 1].createdAt).getTime()
        : 0;
      const currTime = new Date(log.createdAt).getTime();
      const gapMs = lastTime - currTime; // logs DESC, so previous is later
      if (sameUser && gapMs >= 0 && gapMs < 10 * 60 * 1000) {
        last.entries.push(log);
      } else {
        groups.push({
          sessionKey: `${log.userName ?? "anon"}-${log.createdAt}`,
          entries: [log],
        });
      }
    }
    return groups;
  }, [logs, userQuery]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Select
          value={entityFilter}
          onValueChange={(v) => {
            setEntityFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder={t("allEntities")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allEntities")}</SelectItem>
            {AUDIT_ENTITY_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={actionFilter}
          onValueChange={(v) => {
            setActionFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder={t("allActions")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allActions")}</SelectItem>
            {Object.entries(AUDIT_ACTION_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={journalFilter}
          onValueChange={(v) => {
            setJournalFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-[260px]">
            <SelectValue placeholder={t("allJournals")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allJournals")}</SelectItem>
            {JOURNALS_BY_NAME.map((j) => (
              <SelectItem key={j.code} value={j.code}>
                {j.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative w-full sm:w-[220px]">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
          <Input
            placeholder={t("employeePlaceholder")}
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            className="h-10 rounded-2xl border-[#dcdfed] pl-9 text-[14px]"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-8 animate-spin text-[#9b9fb3]" />
        </div>
      ) : groupedLogs.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] py-12 text-center text-[#6f7282]">
          {t("noRecords")}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {groupedLogs.map((group) => {
              const first = group.entries[0];
              const last = group.entries[group.entries.length - 1];
              const sessionMs =
                new Date(first.createdAt).getTime() -
                new Date(last.createdAt).getTime();
              const isPipelineSession = group.entries.some(
                (e) =>
                  e.action === "journal.fill.step" ||
                  e.action === "journal.fill.completed"
              );
              return (
                <div
                  key={group.sessionKey}
                  className="overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ececf4] bg-[#fafbff] px-5 py-3">
                    <div className="flex items-center gap-2">
                      {isPipelineSession ? (
                        <ClipboardCheck className="size-4 text-[#5566f6]" />
                      ) : (
                        <CheckCircle2 className="size-4 text-[#9b9fb3]" />
                      )}
                      <div className="text-[14px] font-semibold text-[#0b1024]">
                        {first.userName ?? "—"}
                      </div>
                      <div className="text-[12px] text-[#6f7282]">
                        {t("eventsCount", { count: group.entries.length })}
                      </div>
                    </div>
                    <div className="text-[12px] text-[#6f7282] tabular-nums">
                      {new Date(last.createdAt).toLocaleString(locale)}
                      {sessionMs > 1000 ? (
                        <span className="ml-2 text-[#9b9fb3]">
                          {t("sessionDuration", {
                            dur: formatDuration(sessionMs, t) ?? "",
                          })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="divide-y divide-[#ececf4]">
                    {[...group.entries].reverse().map((log) => {
                      const actionInfo = auditActionLabel(log.action);
                      return (
                        <div
                          key={log.id}
                          className="flex flex-wrap items-start gap-3 px-5 py-3"
                        >
                          <div className="w-[80px] shrink-0 text-[12px] tabular-nums text-[#6f7282]">
                            {new Date(log.createdAt).toLocaleTimeString(
                              locale,
                              { hour: "2-digit", minute: "2-digit", second: "2-digit" }
                            )}
                          </div>
                          <div className="w-[160px] shrink-0">
                            <Badge variant={actionInfo.variant}>
                              {actionInfo.label}
                            </Badge>
                          </div>
                          <div className="min-w-0 flex-1">
                            {renderDetails(log, t)}
                          </div>
                          <div className="shrink-0 text-[11px] text-[#9b9fb3]">
                            {auditEntityLabel(log.entity)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[#6f7282]">
              {t("pageOf", { page, total: totalPages })}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
