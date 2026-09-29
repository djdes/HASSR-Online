"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, History, Mail, PenSquare, Users } from "lucide-react";
import { toast } from "sonner";

import {
  DEFAULT_CONTACT_FILTERS,
  DEFAULT_USER_FILTERS,
  normalizeContactFilters,
  normalizeUserFilters,
  type ContactFilters,
  type UserAudienceFilters,
} from "@/lib/mailing/audience";
import type { CampaignListRow, DraftDto } from "@/lib/mailing/campaigns.server";
import { NO_CHANNELS, type MailingChannels } from "@/lib/mailing/labels";
import type { MailingSettings } from "@/lib/mailing/rate-limit";
import { cn } from "@/lib/utils";

import { ComposeTab } from "./compose-tab";
import { ContactsTab } from "./contacts-tab";
import { HistoryTab } from "./history-tab";
import { StopListTab } from "./stoplist-tab";
import type { MailingPageData, MailingTab } from "./types";
import { api } from "./ui";
import { UsersTab } from "./users-tab";

type ComposeState = {
  draftId: string | null;
  title: string;
  kind: string;
  channels: MailingChannels;
  /** Данные по типам: переключение типа не стирает набранное. */
  payloads: Record<string, unknown>;
};

function composeFrom(data: MailingPageData, draft: DraftDto | null): ComposeState {
  const defaults = Object.fromEntries(data.kinds.map((k) => [k.kind, k.defaultPayload]));
  if (!draft) {
    return {
      draftId: null,
      title: "",
      kind: data.kinds[0]?.kind ?? "message",
      channels: { ...NO_CHANNELS, email: true },
      payloads: defaults,
    };
  }
  return {
    draftId: draft.id,
    title: draft.title,
    kind: draft.kind,
    channels: draft.channels,
    payloads: { ...defaults, [draft.kind]: draft.payload },
  };
}

function nowTime(): string {
  return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function MailingClient({ data }: { data: MailingPageData }) {
  const router = useRouter();
  const [tab, setTab] = useState<MailingTab>(data.initialTab);
  const [compose, setCompose] = useState<ComposeState>(() => composeFrom(data, data.draft));
  const [userIds, setUserIds] = useState<Set<string>>(() => new Set(data.draft?.audience.userIds ?? []));
  const [contactIds, setContactIds] = useState<Set<string>>(() => new Set(data.draft?.audience.contactIds ?? []));
  const draftFilters = data.draft?.audience.filters as { users?: unknown; contacts?: unknown } | undefined;
  const [userFilters, setUserFilters] = useState<UserAudienceFilters>(() =>
    draftFilters?.users ? normalizeUserFilters(draftFilters.users) : DEFAULT_USER_FILTERS
  );
  const [contactFilters, setContactFilters] = useState<ContactFilters>(() =>
    draftFilters?.contacts ? normalizeContactFilters(draftFilters.contacts) : DEFAULT_CONTACT_FILTERS
  );
  const [campaigns, setCampaigns] = useState<CampaignListRow[]>(data.campaigns);
  const [refreshing, setRefreshing] = useState(false);
  const [settings, setSettings] = useState<MailingSettings>(data.settings);
  const [sentToday, setSentToday] = useState(data.sentToday);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const labelsRef = useRef(new Map<string, string>(data.draft?.labels ?? []));
  const [labelsVersion, setLabelsVersion] = useState(0);

  const rememberLabels = useCallback((entries: Array<[string, string]>) => {
    let changed = false;
    for (const [key, label] of entries) {
      if (labelsRef.current.get(key) !== label) {
        labelsRef.current.set(key, label);
        changed = true;
      }
    }
    if (changed) setLabelsVersion((v) => v + 1);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const labels = useMemo(() => new Map(labelsRef.current), [labelsVersion]);

  // Вкладка — в адресе: обновление страницы не теряет место.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    if (compose.draftId) url.searchParams.set("draft", compose.draftId);
    else url.searchParams.delete("draft");
    window.history.replaceState(null, "", url.toString());
  }, [tab, compose.draftId]);

  const toggle = (setter: typeof setUserIds) => (ids: string[], on: boolean) =>
    setter((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const onUserFilters = useCallback((f: UserAudienceFilters) => setUserFilters(f), []);
  const onContactFilters = useCallback((f: ContactFilters) => setContactFilters(f), []);

  /** Сохранить черновик; вернуть его id (для теста и запуска). */
  const saveDraft = useCallback(async (): Promise<string | null> => {
    setSaving(true);
    try {
      const body = {
        title: compose.title,
        kind: compose.kind,
        channels: compose.channels,
        payload: compose.payloads[compose.kind] ?? {},
        audience: {
          userIds: [...userIds],
          contactIds: [...contactIds],
          filters: { users: userFilters, contacts: contactFilters },
        },
      };
      const r = compose.draftId
        ? await api<{ campaign: CampaignListRow }>(`/api/root/mailing/campaigns/${compose.draftId}`, {
            method: "PATCH",
            json: body,
          })
        : await api<{ campaign: CampaignListRow }>("/api/root/mailing/campaigns", { method: "POST", json: body });
      setCompose((prev) => ({ ...prev, draftId: r.campaign.id, title: r.campaign.title }));
      setCampaigns((prev) => [r.campaign, ...prev.filter((c) => c.id !== r.campaign.id)]);
      setSavedAt(nowTime());
      return r.campaign.id;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить черновик");
      return null;
    } finally {
      setSaving(false);
    }
  }, [compose, userIds, contactIds, userFilters, contactFilters]);

  async function refreshCampaigns() {
    setRefreshing(true);
    try {
      const r = await api<{ campaigns: CampaignListRow[] }>("/api/root/mailing/campaigns");
      setCampaigns(r.campaigns);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить");
    } finally {
      setRefreshing(false);
    }
  }

  async function openDraft(id: string) {
    try {
      const { draft } = await api<{ draft: DraftDto }>(`/api/root/mailing/campaigns/${id}?draft=1`);
      setCompose(composeFrom(data, draft));
      setUserIds(new Set(draft.audience.userIds));
      setContactIds(new Set(draft.audience.contactIds));
      rememberLabels(draft.labels ?? []);
      const f = draft.audience.filters as { users?: unknown; contacts?: unknown } | undefined;
      if (f?.users) setUserFilters(normalizeUserFilters(f.users));
      if (f?.contacts) setContactFilters(normalizeContactFilters(f.contacts));
      setSavedAt(null);
      setTab("compose");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось открыть черновик");
    }
  }

  function onLaunched(id: string) {
    // Сразу в карточку. Форму не сбрасываем: смена состояния запустила бы
    // синхронизацию адреса (replaceState) и перебила бы переход роутера.
    router.push(`/root/mailing/${id}`);
  }

  const tabs: Array<{ key: MailingTab; label: string; icon: typeof Mail; count?: number }> = [
    { key: "compose", label: "Составление", icon: PenSquare },
    { key: "users", label: "Пользователи", icon: Users, count: userIds.size },
    { key: "contacts", label: "Контакты", icon: Mail, count: contactIds.size },
    { key: "history", label: "История", icon: History },
    { key: "stoplist", label: "Стоп-лист", icon: Ban },
  ];

  return (
    <div className="space-y-5">
      <nav
        aria-label="Разделы рассылки"
        className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
        data-testid="mailing-tabs"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            data-testid={`mailing-tab-${t.key}`}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-2xl px-3.5 text-[14px] font-medium transition-colors duration-150",
              tab === t.key
                ? "bg-[#5566f6] text-white shadow-[0_10px_30px_-14px_rgba(85,102,246,0.6)]"
                : "border border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            )}
          >
            <t.icon className="size-4" />
            {t.label}
            {t.count ? (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[12px] tabular-nums",
                  tab === t.key ? "bg-white/20 text-white" : "bg-[#eef1ff] text-[#3848c7]"
                )}
              >
                {t.count}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      {/* Вкладки не размонтируются: выбор и набранный текст живут, пока открыта страница. */}
      <div hidden={tab !== "compose"}>
        <ComposeTab
          data={{ ...data, settings, sentToday }}
          draftId={compose.draftId}
          title={compose.title}
          onTitle={(title) => setCompose((p) => ({ ...p, title }))}
          kind={compose.kind}
          onKind={(kind) => setCompose((p) => ({ ...p, kind }))}
          channels={compose.channels}
          onChannels={(channels) => setCompose((p) => ({ ...p, channels }))}
          payload={compose.payloads[compose.kind]}
          onPayload={(payload) => setCompose((p) => ({ ...p, payloads: { ...p.payloads, [p.kind]: payload } }))}
          userIds={userIds}
          contactIds={contactIds}
          labels={labels}
          saving={saving}
          savedAt={savedAt}
          onSave={saveDraft}
          onLaunched={onLaunched}
          goTo={setTab}
        />
      </div>
      <div hidden={tab !== "users"}>
        <UsersTab
          filters={userFilters}
          onFilters={onUserFilters}
          selected={userIds}
          onSelect={toggle(setUserIds)}
          rememberLabels={rememberLabels}
        />
      </div>
      <div hidden={tab !== "contacts"}>
        <ContactsTab
          filters={contactFilters}
          onFilters={onContactFilters}
          selected={contactIds}
          onSelect={toggle(setContactIds)}
          rememberLabels={rememberLabels}
        />
      </div>
      <div hidden={tab !== "history"}>
        <HistoryTab
          campaigns={campaigns}
          onRefresh={() => void refreshCampaigns()}
          refreshing={refreshing}
          onOpenDraft={(id) => void openDraft(id)}
          onDeleted={(id) => {
            setCampaigns((prev) => prev.filter((c) => c.id !== id));
            if (compose.draftId === id) setCompose(composeFrom(data, null));
          }}
          settings={settings}
          sentToday={sentToday}
          onSettings={(s, today) => {
            setSettings(s);
            setSentToday(today);
          }}
        />
      </div>
      <div hidden={tab !== "stoplist"}>{tab === "stoplist" ? <StopListTab /> : null}</div>
    </div>
  );
}
