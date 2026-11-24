"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  Code2,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  Send,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  GglApplication,
  GglApplicationsView,
  GglSiteCardResult,
} from "@/lib/seo/gogetlinks-applications";
import {
  formatRub,
  generateClientIdempotencyKey,
  sanitizeArticleHtmlForPreview,
} from "@/lib/seo/gogetlinks-ui-format";
import {
  type GeneratedDraft,
  resolvePlacementFormat,
  TARGET_PRESETS,
  UNIFIED_BRIEF_TEXT,
} from "./ApplicationsTab";
import {
  getCachedApplicationsView,
  invalidateApplicationsCache,
  invalidateOverviewCache,
  setCachedApplicationsView,
} from "./tab-cache";
import {
  formatRuShortDate,
  type GglCampaignDto,
  type GglPlannedSlotDto,
  type GglThreadDto,
} from "./types";
import {
  extractThreadDonorIdentity,
  findMatchingSlotForDonor,
  findWebmasterMatchingApplications,
} from "./webmaster-placement-lookup";

const applicationsEndpoint = "/api/root/gogetlinks/applications";
const ordersEndpoint = "/api/root/gogetlinks/orders";
const buttonClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13px] font-medium text-[#0b1024] hover:bg-[#f5f6ff] disabled:opacity-50";
const inputClass =
  "h-10 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none";
const metric = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("ru-RU");

function normalizeTargetUrl(rawUrl: string | null | undefined): string {
  if (!rawUrl) return TARGET_PRESETS[0].url;
  const trimmed = rawUrl.trim();
  if (!trimmed) return TARGET_PRESETS[0].url;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://wesetup.ru${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

export interface ChatWebmasterPlacementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  thread: GglThreadDto;
  campaigns: GglCampaignDto[];
  defaultCampaignId: number | null;
  slots: GglPlannedSlotDto[];
  accountSyncedAt?: string | null;
  expectedApplicationsCount?: number | null;
  onOrderCreated?: () => void;
}

export function ChatWebmasterPlacementDialog({
  open,
  onOpenChange,
  thread,
  campaigns,
  defaultCampaignId,
  slots,
  accountSyncedAt,
  expectedApplicationsCount,
  onOrderCreated,
}: ChatWebmasterPlacementDialogProps) {
  const identity = useMemo(
    () => extractThreadDonorIdentity(thread, slots),
    [thread, slots],
  );
  const effectiveGglCampaignId =
    identity.gglCampaignId ??
    defaultCampaignId ??
    campaigns.find((c) => c.isWesetup)?.gglCampaignId ??
    undefined;

  const matchingSlot = useMemo(
    () =>
      findMatchingSlotForDonor({
        slots,
        donorSiteId: identity.donorSiteId,
        donorDomain: identity.donorDomain,
      }),
    [slots, identity.donorSiteId, identity.donorDomain],
  );

  const [view, setView] = useState<GglApplicationsView | null>(() =>
    getCachedApplicationsView(effectiveGglCampaignId, {
      expectedCount: expectedApplicationsCount,
      accountSyncedAt,
    }),
  );
  const [loadingApps, setLoadingApps] = useState(false);
  const [loadingCard, setLoadingCard] = useState(false);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [targetUrl, setTargetUrl] = useState(TARGET_PRESETS[0].url);
  const [anchor, setAnchor] = useState(TARGET_PRESETS[0].defaultAnchor);
  const [draft, setDraft] = useState<GeneratedDraft | null>(null);
  const [editorMode, setEditorMode] = useState<"html" | "preview">("html");
  const [drafting, setDrafting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approvingSlot, setApprovingSlot] = useState(false);

  const matchingApplications = useMemo(
    () =>
      findWebmasterMatchingApplications({
        applications: view?.snapshot.applications ?? [],
        thread,
        slots,
        campaignId: effectiveGglCampaignId ?? 0,
      }),
    [view?.snapshot.applications, thread, slots, effectiveGglCampaignId],
  );

  const selectedApp: GglApplication | null = useMemo(() => {
    if (selectedAppId) {
      const found = matchingApplications.find((a) => a.id === selectedAppId);
      if (found) return found;
    }
    return matchingApplications[0] ?? null;
  }, [matchingApplications, selectedAppId]);

  const applyInitialDefaultsFromSlot = useCallback(
    (slot: GglPlannedSlotDto | null) => {
      if (slot?.targetUrl) {
        const fullUrl = normalizeTargetUrl(slot.targetUrl);
        setTargetUrl(fullUrl);
        setAnchor(
          slot.anchor?.trim() ||
            TARGET_PRESETS.find((p) => p.url === fullUrl)?.defaultAnchor ||
            TARGET_PRESETS[0].defaultAnchor,
        );
      } else {
        setTargetUrl(TARGET_PRESETS[0].url);
        setAnchor(TARGET_PRESETS[0].defaultAnchor);
      }

      if (slot?.article?.title && slot?.article?.bodyHtml) {
        setDraft({
          title: slot.article.title,
          announcement: slot.article.announcement ?? "",
          bodyHtml: slot.article.bodyHtml,
          metaTitle: slot.article.title,
          metaDescription: slot.article.announcement ?? "",
          metaKeywords: slot.anchor ?? "",
          briefText: slot.briefText ?? UNIFIED_BRIEF_TEXT,
        });
      } else {
        setDraft(null);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    applyInitialDefaultsFromSlot(matchingSlot);
  }, [open, thread.id, matchingSlot, applyInitialDefaultsFromSlot]);

  useEffect(() => {
    if (!open) return;
    const cached = getCachedApplicationsView(effectiveGglCampaignId, {
      expectedCount: expectedApplicationsCount,
      accountSyncedAt,
    });
    if (cached) {
      setView(cached);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoadingApps(true);
      try {
        const url = effectiveGglCampaignId
          ? `${applicationsEndpoint}?campaignId=${effectiveGglCampaignId}`
          : applicationsEndpoint;
        const response = await fetch(url, { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as
          | (GglApplicationsView & { error?: string })
          | null;
        if (!cancelled && response.ok && data?.snapshot) {
          setCachedApplicationsView(effectiveGglCampaignId, data, {
            expectedCount: expectedApplicationsCount,
            accountSyncedAt,
          });
          setView(data);
        }
      } catch {
        // Fallback to synthesized offer from slot/thread if applications endpoint fails
      } finally {
        if (!cancelled) setLoadingApps(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, effectiveGglCampaignId, expectedApplicationsCount, accountSyncedAt]);

  const cardMap = useMemo(
    () => new Map(view?.cards.map((c) => [c.siteId, c]) ?? []),
    [view?.cards],
  );
  const recommendations = useMemo(
    () =>
      new Map(
        view?.analysis?.recommendations.map((r, index) => [
          r.siteId,
          { ...r, index },
        ]) ?? [],
      ),
    [view?.analysis],
  );

  useEffect(() => {
    if (!open || !selectedApp || !view) return;
    if (cardMap.get(selectedApp.siteId)?.card) return;
    let cancelled = false;
    (async () => {
      setLoadingCard(true);
      try {
        const response = await fetch(applicationsEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "cards",
            campaignId: view.campaignId,
            snapshotId: view.snapshotId,
            siteIds: [selectedApp.siteId],
          }),
        });
        const data = (await response.json().catch(() => null)) as {
          cards?: GglSiteCardResult[];
        } | null;
        if (!cancelled && response.ok && data?.cards) {
          const mergedMap = new Map(view.cards.map((c) => [c.siteId, c]));
          for (const c of data.cards) mergedMap.set(c.siteId, c);
          const nextView: GglApplicationsView = {
            ...view,
            cards: [...mergedMap.values()],
          };
          setCachedApplicationsView(effectiveGglCampaignId, nextView, {
            expectedCount: expectedApplicationsCount,
            accountSyncedAt,
          });
          setView(nextView);
        }
      } catch {
        // Card details are optional
      } finally {
        if (!cancelled) setLoadingCard(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    selectedApp,
    view,
    cardMap,
    effectiveGglCampaignId,
    expectedApplicationsCount,
    accountSyncedAt,
  ]);

  const selectedFormat = selectedApp
    ? resolvePlacementFormat(selectedApp.placementType)
    : "article";
  const selectedCard = selectedApp ? cardMap.get(selectedApp.siteId)?.card : null;
  const selectedRec = selectedApp
    ? recommendations.get(selectedApp.siteId)
    : null;

  const targetPresetsWithCustom = useMemo(() => {
    if (TARGET_PRESETS.some((p) => p.url === targetUrl)) {
      return TARGET_PRESETS;
    }
    return [
      {
        url: targetUrl,
        label: `Посадочная из слота (${targetUrl.replace(/^https?:\/\/wesetup\.ru/i, "") || "/"})`,
        defaultAnchor: anchor || "электронные журналы ХАССП",
        anchorOptions: anchor
          ? [{ kind: "Анкор слота", value: anchor }]
          : [],
      },
      ...TARGET_PRESETS,
    ];
  }, [targetUrl, anchor]);

  async function handleGenerateDraft() {
    if (!selectedApp) return;
    const cleanAnchor = anchor.trim();
    if (!cleanAnchor) {
      toast.error("Укажите текст анкора");
      return;
    }
    setDrafting(true);
    try {
      const format = selectedFormat === "article" ? "article" : "note";
      const topicField = selectedCard?.fields.find(
        (f) => f.label === "Тематика",
      )?.value;
      const recReason = selectedRec?.reason;
      const topicHint =
        [topicField, recReason].filter(Boolean).join(". ").slice(0, 450) ||
        undefined;
      const response = await fetch(applicationsEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draft",
          donorDomain: selectedApp.domain,
          targetUrl,
          anchor: cleanAnchor,
          placementFormat: format,
          topicHint,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        draft?: GeneratedDraft;
        error?: string;
      } | null;
      if (!response.ok || !data?.draft) {
        throw new Error(data?.error ?? "Не удалось сгенерировать материал");
      }
      setDraft(data.draft);
      toast.success(
        format === "article"
          ? "Черновик статьи готов — проверьте текст перед отправкой"
          : "ТЗ для вебмастера готово",
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось сгенерировать материал",
      );
    } finally {
      setDrafting(false);
    }
  }

  async function handleSubmitOrder() {
    if (!selectedApp) return;
    const cleanAnchor = anchor.trim();
    if (!cleanAnchor) {
      toast.error("Укажите текст анкора");
      return;
    }
    if (
      selectedFormat === "article" &&
      (!draft?.title.trim() || !draft?.bodyHtml.trim())
    ) {
      toast.error("Сначала сгенерируйте или заполните заголовок и текст статьи");
      return;
    }
    setSubmitting(true);
    try {
      // If there is a pending_approval slot for this exact donor and format, update its article/anchor if edited and approve the slot so the planner stays in sync!
      if (
        matchingSlot &&
        matchingSlot.status === "pending_approval" &&
        matchingSlot.donorSiteId === selectedApp.siteId &&
        selectedFormat !== "context"
      ) {
        if (selectedFormat === "article" && draft) {
          await fetch(
            `/api/root/gogetlinks/slots/${encodeURIComponent(matchingSlot.id)}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "update_article",
                articlePatch: {
                  title: draft.title.trim(),
                  announcement:
                    draft.announcement.trim() || draft.title.trim(),
                  bodyHtml: draft.bodyHtml.trim(),
                  metaTitle: draft.metaTitle.trim() || undefined,
                  metaDescription: draft.metaDescription.trim() || undefined,
                  metaKeywords: draft.metaKeywords.trim() || undefined,
                  anchor: cleanAnchor,
                  anchorKind: cleanAnchor.toLowerCase().includes("wesetup")
                    ? "url_brand"
                    : "exact",
                  briefText: draft.briefText.trim() || undefined,
                },
              }),
            },
          ).catch(() => null);
        }
        const approveRes = await fetch(
          `/api/root/gogetlinks/slots/${encodeURIComponent(matchingSlot.id)}/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              idempotencyKey: generateClientIdempotencyKey(
                `chat-slot-submit-${matchingSlot.id}`,
              ),
            }),
          },
        );
        const approveData = (await approveRes.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!approveRes.ok) {
          throw new Error(
            approveData?.error ??
              `Ошибка отправки заявки по слоту (${approveRes.status})`,
          );
        }
        invalidateOverviewCache();
        invalidateApplicationsCache(effectiveGglCampaignId);
        toast.success(
          `Заявка на ${selectedApp.domain} отправлена вебмастеру в GoGetLinks`,
        );
        onOpenChange(false);
        onOrderCreated?.();
        return;
      }

      const activeCampaign =
        campaigns.find(
          (c) =>
            c.gglCampaignId === (view?.campaignId ?? effectiveGglCampaignId),
        ) ?? campaigns.find((c) => c.isWesetup);
      const response = await fetch(ordersEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: activeCampaign?.id,
          donorSiteId: selectedApp.siteId,
          donorDomain: selectedApp.domain,
          placementFormat: selectedFormat,
          maxPriceRub: selectedApp.priceRub ?? matchingSlot?.maxPriceRub ?? 1500,
          targetUrl,
          anchor: cleanAnchor,
          anchorKind: cleanAnchor.toLowerCase().includes("wesetup")
            ? "url_brand"
            : "exact",
          articleDraft:
            selectedFormat === "article" && draft
              ? {
                  title: draft.title.trim(),
                  announcement: draft.announcement.trim(),
                  bodyHtml: draft.bodyHtml.trim(),
                  metaTitle: draft.metaTitle.trim(),
                  metaDescription: draft.metaDescription.trim(),
                  metaKeywords: draft.metaKeywords.trim(),
                }
              : null,
          briefText:
            draft?.briefText?.trim() ||
            `Размещение ссылки ${targetUrl} с анкором «${cleanAnchor}» без атрибута nofollow.`,
          idempotencyKey:
            `chat-app-${selectedApp.id}-${selectedApp.siteId}-${targetUrl}-${cleanAnchor}`.slice(
              0,
              150,
            ),
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          data?.error ?? `Ошибка отправки заявки (${response.status})`,
        );
      }
      invalidateOverviewCache();
      invalidateApplicationsCache(effectiveGglCampaignId);
      toast.success(
        `Заявка на ${selectedApp.domain} отправлена вебмастеру в GoGetLinks`,
      );
      onOpenChange(false);
      onOrderCreated?.();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось отправить заявку",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApproveMatchingSlot() {
    if (!matchingSlot) return;
    setApprovingSlot(true);
    try {
      const response = await fetch(
        `/api/root/gogetlinks/slots/${encodeURIComponent(matchingSlot.id)}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: generateClientIdempotencyKey(
              `chat-slot-approve-${matchingSlot.id}`,
            ),
          }),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          data?.error ??
            "Не удалось подтвердить и отправить закупку слота в GoGetLinks",
        );
      }
      invalidateOverviewCache();
      invalidateApplicationsCache(effectiveGglCampaignId);
      toast.success(
        `Слот ${matchingSlot.donorDomain ?? ""} подтверждён и отправлен в GoGetLinks`,
      );
      onOpenChange(false);
      onOrderCreated?.();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Ошибка подтверждения слота",
      );
    } finally {
      setApprovingSlot(false);
    }
  }

  const titleLabel =
    identity.donorDomain || thread.webmasterLogin || "Вебмастер GoGetLinks";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl border-[#ececf4] bg-white sm:max-w-[780px]">
        <DialogHeader>
          <DialogTitle className="text-[#0b1024]">
            Доступные заявки и размещение · {titleLabel}
          </DialogTitle>
          <DialogDescription>
            Выберите предложение вебмастера или подготовленный слот, сгенерируйте статью ИИ и отправьте размещение в GoGetLinks прямо из диалога.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {loadingApps && matchingApplications.length === 0 ? (
            <div className="flex items-center gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[13px] text-[#6f7282]">
              <Loader2 className="size-4 animate-spin text-[#5566f6]" />
              Ищем доступные заявки от {titleLabel}…
            </div>
          ) : null}

          {/* Available applications / offers from this webmaster */}
          {matchingApplications.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[12px] font-semibold uppercase tracking-wider text-[#6f7282]">
                Предложения площадки ({matchingApplications.length})
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {matchingApplications.map((app) => {
                  const isSelected = selectedApp?.id === app.id;
                  return (
                    <button
                      key={app.id}
                      type="button"
                      onClick={() => setSelectedAppId(app.id)}
                      className={cn(
                        "flex flex-col justify-between rounded-2xl border p-3 text-left transition-colors",
                        isSelected
                          ? "border-[#5566f6] bg-[#eef1ff]/70"
                          : "border-[#dcdfed] bg-white hover:border-[#5566f6]/40",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13.5px] font-semibold text-[#0b1024]">
                          {app.domain} · {app.placementType}
                        </span>
                        <span className="shrink-0 font-semibold text-[#3848c7]">
                          {metric(app.priceRub)} ₽
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11.5px] text-[#6f7282]">
                        <span>
                          TF/CF: {metric(app.tf)}/{metric(app.cf)}
                        </span>
                        <span>·</span>
                        <span>Траст: {metric(app.trust)}</span>
                        <span>·</span>
                        <span>Трафик: {metric(app.dailyTraffic)}/сут</span>
                      </div>
                      {app.badges.length > 0 ? (
                        <div className="mt-1 text-[11px] text-[#3848c7]">
                          {app.badges.join(" · ")}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-4 text-[13px] text-[#6f7282]">
              Для этого диалога не найден числовой ID площадки в GoGetLinks. Откройте вкладку «Заявки вебмастеров» и найдите домен вручную.
            </div>
          )}

          {/* Matching planned slot callout if one exists */}
          {matchingSlot ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-[12.5px] text-emerald-950">
              <div className="space-y-0.5">
                <div className="font-semibold text-emerald-900">
                  В планировщике есть слот на {formatRuShortDate(matchingSlot.scheduledDate)} ({matchingSlot.status === "pending_approval" ? "Ждёт подтверждения" : matchingSlot.status})
                </div>
                <div className="text-emerald-800">
                  Посадочная: <strong>{matchingSlot.targetUrl ?? "—"}</strong> · Анкор: «<strong>{matchingSlot.anchor ?? "—"}</strong>» · {formatRub(matchingSlot.estimatedPriceRub ?? matchingSlot.maxPriceRub)}
                </div>
              </div>
              {matchingSlot.status === "pending_approval" ? (
                <button
                  type="button"
                  disabled={approvingSlot || submitting}
                  onClick={() => void handleApproveMatchingSlot()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#116b2a] px-3.5 text-[12.5px] font-medium text-white shadow-sm hover:bg-[#0e5822] disabled:opacity-50"
                >
                  {approvingSlot ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  Подтвердить готовый слот
                </button>
              ) : null}
            </div>
          ) : null}

          {selectedApp ? (
            <section className="space-y-3 rounded-2xl border border-[#dcdfed] bg-[#f8f9ff] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-[14px] font-semibold text-[#0b1024]">
                    Генерация и отправка размещения
                  </h3>
                  <a
                    href={selectedApp.siteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] text-[#3848c7] hover:underline"
                  >
                    Открыть {selectedApp.domain}
                    <ExternalLink className="size-3" />
                  </a>
                </div>
                <span className="text-[12px] text-[#6f7282]">
                  Списание только после нажатия «Отправить заявку»
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  aria-label="Посадочная страница wesetup.ru"
                  value={targetUrl}
                  disabled={drafting || submitting}
                  onChange={(e) => {
                    const nextUrl = e.target.value;
                    setTargetUrl(nextUrl);
                    const preset = targetPresetsWithCustom.find(
                      (p) => p.url === nextUrl,
                    );
                    if (preset) setAnchor(preset.defaultAnchor);
                  }}
                  className={cn(inputClass, "w-full")}
                >
                  {targetPresetsWithCustom.map((p) => (
                    <option key={p.url} value={p.url}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Анкор ссылки"
                  value={anchor}
                  disabled={drafting || submitting}
                  onChange={(e) => setAnchor(e.target.value)}
                  placeholder="Анкор ссылки (например, электронные журналы ХАССП)"
                  className={cn(inputClass, "w-full")}
                />
              </div>

              {(() => {
                const activePreset = targetPresetsWithCustom.find(
                  (p) => p.url === targetUrl,
                );
                if (!activePreset?.anchorOptions.length) return null;
                return (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
                    <span className="text-[#6f7282]">Регламент анкоров:</span>
                    {activePreset.anchorOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={drafting || submitting}
                        onClick={() => setAnchor(opt.value)}
                        className={cn(
                          "rounded-xl border px-2.5 py-1 transition-colors",
                          anchor === opt.value
                            ? "border-[#5566f6] bg-[#eef1ff] font-medium text-[#3848c7]"
                            : "border-[#dcdfed] bg-white text-[#0b1024] hover:bg-[#f5f6ff]",
                        )}
                      >
                        <span className="text-[#6f7282]">{opt.kind}:</span> «
                        {opt.value}»
                      </button>
                    ))}
                  </div>
                );
              })()}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={drafting || submitting}
                  onClick={() => void handleGenerateDraft()}
                  className={cn(
                    buttonClass,
                    "border-[#5566f6] bg-white text-[#3848c7] hover:bg-[#eef1ff]",
                  )}
                >
                  {drafting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {selectedFormat === "article"
                    ? draft
                      ? "Перегенерировать статью ИИ"
                      : "Сгенерировать статью ИИ"
                    : "Сгенерировать ТЗ ИИ"}
                </button>
                {!draft && selectedFormat === "article" ? (
                  <button
                    type="button"
                    disabled={drafting || submitting}
                    onClick={() =>
                      setDraft({
                        title: "",
                        announcement: "",
                        bodyHtml: `<p>Практический материал для ${selectedApp.domain}, в котором органично размещена ссылка <a href="${targetUrl}">${anchor}</a>.</p>`,
                        metaTitle: "",
                        metaDescription: "",
                        metaKeywords: anchor,
                        briefText: UNIFIED_BRIEF_TEXT,
                      })
                    }
                    className={buttonClass}
                  >
                    <FileText className="size-4" />
                    Заполнить вручную
                  </button>
                ) : null}
              </div>

              {draft ? (
                <div className="space-y-2.5 pt-1">
                  {selectedFormat === "article" ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[12px] font-medium text-[#6f7282]">
                          Текст статьи со встроенной ссылкой
                        </span>
                        <div className="inline-flex rounded-xl border border-[#dcdfed] bg-white p-0.5">
                          <button
                            type="button"
                            onClick={() => setEditorMode("preview")}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors",
                              editorMode === "preview"
                                ? "bg-[#eef1ff] text-[#3848c7]"
                                : "text-[#6f7282] hover:text-[#0b1024]",
                            )}
                          >
                            <Eye className="size-3.5" />
                            Предпросмотр в HTML
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditorMode("html")}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors",
                              editorMode === "html"
                                ? "bg-[#eef1ff] text-[#3848c7]"
                                : "text-[#6f7282] hover:text-[#0b1024]",
                            )}
                          >
                            <Code2 className="size-3.5" />
                            HTML-код
                          </button>
                        </div>
                      </div>
                      <input
                        aria-label="Заголовок статьи"
                        value={draft.title}
                        disabled={submitting}
                        onChange={(e) =>
                          setDraft({ ...draft, title: e.target.value })
                        }
                        placeholder="Заголовок статьи"
                        className={cn(inputClass, "w-full font-medium")}
                      />
                      {editorMode === "preview" ? (
                        <div className="max-h-[320px] overflow-y-auto rounded-2xl border border-[#dcdfed] bg-white p-4">
                          {draft.title ? (
                            <h4 className="mb-3 text-[16px] font-semibold text-[#0b1024]">
                              {draft.title}
                            </h4>
                          ) : null}
                          <div
                            className="prose prose-sm max-w-none text-[13.5px] leading-relaxed text-[#0b1024] [&_a]:font-semibold [&_a]:text-[#3848c7] [&_a]:underline [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-[15.5px] [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-[14px] [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-2.5"
                            dangerouslySetInnerHTML={{
                              __html: sanitizeArticleHtmlForPreview(
                                draft.bodyHtml,
                              ),
                            }}
                          />
                        </div>
                      ) : (
                        <textarea
                          aria-label="HTML-текст статьи"
                          rows={8}
                          value={draft.bodyHtml}
                          disabled={submitting}
                          onChange={(e) =>
                            setDraft({ ...draft, bodyHtml: e.target.value })
                          }
                          placeholder='HTML-текст статьи со встроенной ссылкой <a href="...">анкор</a>'
                          className="w-full rounded-2xl border border-[#dcdfed] bg-white p-3 font-mono text-[12.5px] leading-relaxed text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
                        />
                      )}
                    </>
                  ) : null}
                  <input
                    aria-label="Комментарий и ТЗ вебмастеру"
                    value={draft.briefText}
                    disabled={submitting}
                    onChange={(e) =>
                      setDraft({ ...draft, briefText: e.target.value })
                    }
                    placeholder="Комментарий и ТЗ для вебмастера"
                    className={cn(inputClass, "w-full")}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-[#116b2a]">
                      <CheckCircle2 className="size-4" />
                      Ссылка: {targetUrl} · анкор «{anchor}»
                    </span>
                    <button
                      type="button"
                      disabled={submitting || drafting}
                      onClick={() => void handleSubmitOrder()}
                      className={cn(
                        buttonClass,
                        "border-[#5566f6] bg-[#5566f6] text-white hover:bg-[#4a5bf0]",
                      )}
                    >
                      {submitting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Send className="size-4" />
                      )}
                      Отправить заявку вебмастеру · {metric(selectedApp.priceRub)} ₽
                    </button>
                  </div>
                </div>
              ) : selectedFormat !== "article" ? (
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    disabled={submitting || drafting}
                    onClick={() => void handleSubmitOrder()}
                    className={cn(
                      buttonClass,
                      "border-[#5566f6] bg-[#5566f6] text-white hover:bg-[#4a5bf0]",
                    )}
                  >
                    {submitting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                    Отправить заявку вебмастеру · {metric(selectedApp.priceRub)} ₽
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          {loadingCard && !selectedCard ? (
            <p role="status" className="text-[12.5px] text-[#6f7282]">
              Загружаем карточку площадки и примеры размещения…
            </p>
          ) : null}

          {selectedCard ? (
            <div className="space-y-3">
              {[...new Set(selectedCard.fields.map((f) => f.group))].map(
                (group) => (
                  <section
                    key={group}
                    className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3.5"
                  >
                    <h4 className="mb-2 text-[13px] font-semibold text-[#0b1024]">
                      {group || "Характеристики площадки"}
                    </h4>
                    <dl className="space-y-1.5">
                      {selectedCard.fields
                        .filter((f) => f.group === group)
                        .map((f, i) => (
                          <div
                            key={i}
                            className="flex justify-between gap-4 text-[12.5px]"
                          >
                            <dt className="text-[#6f7282]">{f.label}</dt>
                            <dd className="max-w-[65%] text-right text-[#0b1024]">
                              {f.value}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  </section>
                ),
              )}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
