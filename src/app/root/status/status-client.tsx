"use client";

import { CheckCircle2, Loader2, Plus } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { AnnouncementBanner } from "@/components/layout/announcement-banner";
import { presentStatusTimestamp } from "./status-presentation";
import type { Announcement, Incident, PlatformStatusSettings } from "@/lib/platform-status";
import { cn } from "@/lib/utils";

const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const CARD = "rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]";
const EYEBROW = "mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]";
const BTN_PRIMARY =
  "inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60";
const BTN_OUTLINE =
  "inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50";

const toLocal = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");
const fromLocal = (local: string) => (local ? new Date(local).toISOString() : null);
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function StatusClient({ initial }: { initial: PlatformStatusSettings }) {
  const locale = useLocale();
  const t = useTranslations("rootStatus");
  const tCommon = useTranslations("common.announcementBanner");
  const translatorRef = useRef(t);
  useLayoutEffect(() => {
    translatorRef.current = t;
  }, [t]);

  const [announcement, setAnnouncement] = useState<Announcement>(
    initial.announcement ?? {
      id: newId(),
      kind: "maintenance",
      text: "",
      link: null,
      startsAt: null,
      endsAt: null,
      active: false,
      updatedAt: new Date().toISOString(),
    }
  );
  const [incidents, setIncidents] = useState<Incident[]>(initial.incidents);
  const [draft, setDraft] = useState({ title: "", kind: "incident" as Incident["kind"], note: "" });
  const [busy, setBusy] = useState(false);
  const [previewSeed] = useState(() => newId());

  async function save(next: { announcement: Announcement; incidents: Incident[] }) {
    setBusy(true);
    try {
      const response = await fetch("/api/root/status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = (await response.json().catch(() => null)) as PlatformStatusSettings | { error?: string } | null;
      if (!response.ok || !data || !("incidents" in data)) throw new Error("save-failed");
      if (data.announcement) setAnnouncement(data.announcement);
      setIncidents(data.incidents);
      toast.success(translatorRef.current("feedback.saved"));
    } catch {
      // API diagnostics are not trusted user-facing copy. Read the translator
      // only after the response body has settled, in the committed locale.
      toast.error(translatorRef.current("feedback.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof Announcement>(key: K, value: Announcement[K]) =>
    setAnnouncement((prev) => ({ ...prev, [key]: value }));

  // New text creates a new persisted announcement ID, as before.
  const saveAnnouncement = () =>
    save({
      announcement: {
        ...announcement,
        id: initial.announcement && initial.announcement.text === announcement.text ? announcement.id : newId(),
      },
      incidents,
    });

  const addIncident = () => {
    if (!draft.title.trim()) return;
    const next: Incident = {
      id: newId(),
      kind: draft.kind,
      title: draft.title.trim(),
      note: draft.note.trim() || null,
      startedAt: new Date().toISOString(),
      resolvedAt: null,
    };
    setDraft({ title: "", kind: "incident", note: "" });
    void save({ announcement, incidents: [next, ...incidents] });
  };

  const resolve = (id: string) =>
    void save({
      announcement,
      incidents: incidents.map((i) => (i.id === id ? { ...i, resolvedAt: new Date().toISOString() } : i)),
    });

  const previewId = useMemo(
    () => `preview:${previewSeed}:${JSON.stringify([announcement.kind, announcement.text])}`,
    [previewSeed, announcement.kind, announcement.text]
  );

  const displayTimestamp = (value: string) => {
    const result = presentStatusTimestamp(value, locale);
    if (result.kind === "native") return result.text;
    if (result.kind === "invalid") return t("incidents.invalidTimestamp");
    return t("incidents.timestamp", { date: result.date, time: result.time });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className={CARD}>
        <div className={EYEBROW}>{t("announcement.section")}</div>
        <div className="space-y-3">
          <div className="grid grid-cols-[140px_1fr] gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("announcement.kind")}</span>
              <select value={announcement.kind} onChange={(e) => set("kind", e.target.value as Announcement["kind"])} className={INPUT}>
                <option value="maintenance">{t("announcement.kindMaintenance")}</option>
                <option value="incident">{t("announcement.kindIncident")}</option>
                <option value="info">{t("announcement.kindInfo")}</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("announcement.linkLabel", { moreLabel: tCommon("more") })}</span>
              <input value={announcement.link ?? ""} onChange={(e) => set("link", e.target.value || null)} placeholder="/status" className={INPUT} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("announcement.text")}</span>
            <textarea
              value={announcement.text}
              onChange={(e) => set("text", e.target.value)}
              rows={2}
              maxLength={300}
              placeholder={t("announcement.textPlaceholder")}
              className={cn(INPUT, "h-auto resize-none py-2.5 leading-relaxed")}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("announcement.startsAt")}</span>
              <input type="datetime-local" value={toLocal(announcement.startsAt)} onChange={(e) => set("startsAt", fromLocal(e.target.value))} className={INPUT} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("announcement.endsAt")}</span>
              <input type="datetime-local" value={toLocal(announcement.endsAt)} onChange={(e) => set("endsAt", fromLocal(e.target.value))} className={INPUT} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-[13.5px] text-[#3c4053]">
            <input type="checkbox" checked={announcement.active} onChange={(e) => set("active", e.target.checked)} className="size-4 rounded border-[#dcdfed]" />
            {t("announcement.active")}
          </label>
          <div className="rounded-2xl bg-[#fafbff] p-3">
            <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-[#9b9fb3]">{t("announcement.previewHeading")}</div>
            {announcement.text.trim() ? (
              <AnnouncementBanner
                key={announcement.kind + announcement.text}
                announcement={{ ...announcement, id: previewId, active: true }}
                moreLabel={tCommon("more")}
                dismissLabel={tCommon("dismiss")}
              />
            ) : (
              <p className="text-[13px] text-[#9b9fb3]">{t("announcement.previewEmpty")}</p>
            )}
          </div>
          <button type="button" onClick={saveAnnouncement} disabled={busy} className={BTN_PRIMARY}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("announcement.save")}
          </button>
        </div>
      </section>

      <section className={CARD}>
        <div className={EYEBROW}>{t("incidents.section")}</div>
        <div className="space-y-3">
          <div className="grid grid-cols-[140px_1fr] gap-3">
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Incident["kind"] })} className={INPUT}>
              <option value="incident">{t("incidents.kindIncident")}</option>
              <option value="maintenance">{t("incidents.kindMaintenance")}</option>
            </select>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={t("incidents.titlePlaceholder")} className={INPUT} maxLength={200} />
          </div>
          <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder={t("incidents.notePlaceholder")} className={INPUT} maxLength={1000} />
          <button type="button" onClick={addIncident} disabled={busy || !draft.title.trim()} className={BTN_OUTLINE}>
            <Plus className="size-4 text-[#5566f6]" />
            {t("incidents.open")}
          </button>
        </div>
        <ul className="mt-5 space-y-2">
          {incidents.length === 0 ? <li className="text-[13.5px] text-[#9b9fb3]">{t("incidents.empty")}</li> : null}
          {incidents.map((incident) => {
            const start = displayTimestamp(incident.startedAt);
            const timestamp = incident.resolvedAt
              ? t("incidents.timestampRange", { start, end: displayTimestamp(incident.resolvedAt) })
              : start;
            return (
              <li key={incident.id} className="flex items-start justify-between gap-3 rounded-2xl border border-[#ececf4] px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-[#0b1024]">
                    {incident.title}
                    <span className={cn("ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium", incident.resolvedAt ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#fff4f2] text-[#a13a32]")}
                    >
                      {incident.resolvedAt ? t("incidents.resolved") : incident.kind === "maintenance" ? t("incidents.maintenance") : t("incidents.openStatus")}
                    </span>
                  </div>
                  <div className="text-[12px] text-[#6f7282]">{timestamp}</div>
                </div>
                {!incident.resolvedAt ? (
                  <button type="button" onClick={() => resolve(incident.id)} disabled={busy} className={cn(BTN_OUTLINE, "h-9 shrink-0")}>
                    <CheckCircle2 className="size-4 text-[#116b2a]" />
                    {t("incidents.resolve")}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
