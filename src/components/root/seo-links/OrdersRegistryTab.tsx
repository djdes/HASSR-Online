"use client";

import { useMemo, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  Loader2,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { GglAnchorKind } from "@/lib/seo/gogetlinks-planner";
import {
  badgeToneClass,
  formatOrderAttribution,
  formatOrderStatusBadge,
  formatPlacementFormatLabel,
  formatRub,
  generateClientIdempotencyKey,
} from "@/lib/seo/gogetlinks-ui-format";
import {
  formatRuShortDate,
  type GglCampaignDto,
  type GglOrderDto,
  type GglThreadDto,
  SEO_BTN_OUTLINE_CLASS,
  SEO_BTN_PRIMARY_CLASS,
  SEO_BTN_SM_CLASS,
  SEO_INPUT_CLASS,
  SEO_TEXTAREA_CLASS,
  type SeoLinksViewerCapabilities,
  shortWesetupPath,
} from "./types";

export interface OrdersRegistryTabProps {
  orders: GglOrderDto[];
  campaigns: GglCampaignDto[];
  threads: GglThreadDto[];
  viewer: SeoLinksViewerCapabilities;
  onJumpToThread: (threadId: string | null, donorDomain?: string) => void;
  onRefresh: () => Promise<void> | void;
}

type StatusFilter =
  | "all"
  | "on_check"
  | "in_progress"
  | "paid"
  | "needs_replacement"
  | "rejected";

function matchesStatusFilter(status: string, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "in_progress") {
    return (
      status === "in_progress" ||
      status === "pending_webmaster" ||
      status === "sending"
    );
  }
  if (filter === "rejected") {
    return status === "rejected" || status === "failed";
  }
  return status === filter;
}

export function OrdersRegistryTab({
  orders,
  campaigns,
  threads,
  viewer,
  onJumpToThread,
  onRefresh,
}: OrdersRegistryTabProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [originFilter, setOriginFilter] = useState<string>("all");
  const [initiatorFilter, setInitiatorFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const [revisionOrderId, setRevisionOrderId] = useState<string | null>(null);
  const [revisionComment, setRevisionComment] = useState("");
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [manualModalOpen, setManualModalOpen] = useState(false);

  const reviewKeysRef = useRef<Map<string, string>>(new Map());

  const wesetupCampaigns = useMemo(
    () => campaigns.filter((c) => c.isWesetup),
    [campaigns],
  );

  const threadByOrderId = useMemo(() => {
    const map = new Map<string, GglThreadDto>();
    for (const t of threads) {
      if (t.orderId) map.set(t.orderId, t);
    }
    return map;
  }, [threads]);

  const uniqueInitiators = useMemo(() => {
    const names = new Set<string>();
    for (const o of orders) {
      if (o.initiatedByName?.trim()) names.add(o.initiatedByName.trim());
      if (o.approvedByName?.trim()) names.add(o.approvedByName.trim());
    }
    return [...names].sort((a, b) => a.localeCompare(b, "ru"));
  }, [orders]);

  const statusCounts = useMemo(() => {
    const out: Record<StatusFilter, number> = {
      all: orders.length,
      on_check: 0,
      in_progress: 0,
      paid: 0,
      needs_replacement: 0,
      rejected: 0,
    };
    for (const o of orders) {
      if (matchesStatusFilter(o.status, "on_check")) out.on_check += 1;
      if (matchesStatusFilter(o.status, "in_progress")) out.in_progress += 1;
      if (matchesStatusFilter(o.status, "paid")) out.paid += 1;
      if (matchesStatusFilter(o.status, "needs_replacement"))
        out.needs_replacement += 1;
      if (matchesStatusFilter(o.status, "rejected")) out.rejected += 1;
    }
    return out;
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (!matchesStatusFilter(o.status, statusFilter)) return false;
      if (originFilter !== "all" && o.origin !== originFilter) return false;
      if (initiatorFilter !== "all") {
        const initName = o.initiatedByName?.trim() ?? "";
        const appName = o.approvedByName?.trim() ?? "";
        if (initName !== initiatorFilter && appName !== initiatorFilter) {
          return false;
        }
      }
      if (needle) {
        const hay = [
          o.donorDomain,
          o.targetUrl,
          o.anchor,
          o.publishedUrl ?? "",
          o.campaign?.domain ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [orders, statusFilter, originFilter, initiatorFilter, search]);

  async function submitReview(
    order: GglOrderDto,
    action: "accept" | "request_revision",
  ) {
    if (order.campaign?.isWesetup === false) {
      toast.error("Архивные кампании других доменов доступны только для чтения");
      return;
    }
    if (action === "request_revision" && revisionComment.trim().length < 5) {
      toast.error("Укажите причину возврата на доработку (минимум 5 символов)");
      return;
    }

    const cacheName = `${order.id}:${action}`;
    let key = reviewKeysRef.current.get(cacheName);
    if (!key) {
      key = generateClientIdempotencyKey(`order-review-${order.id}-${action}`);
      reviewKeysRef.current.set(cacheName, key);
    }

    setBusyOrderId(order.id);
    try {
      const response = await fetch(
        `/api/root/gogetlinks/orders/${encodeURIComponent(order.id)}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            ...(action === "request_revision"
              ? { comment: revisionComment.trim() }
              : {}),
            idempotencyKey: key,
          }),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        reviewKeysRef.current.delete(cacheName);
        throw new Error(
          data?.error ?? "Не удалось отправить решение по размещению",
        );
      }
      reviewKeysRef.current.delete(cacheName);
      toast.success(
        action === "accept"
          ? `Размещение на ${order.donorDomain} принято`
          : `Размещение на ${order.donorDomain} возвращено вебмастеру на доработку`,
      );
      setRevisionOrderId(null);
      setRevisionComment("");
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка проверки");
    } finally {
      setBusyOrderId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: status pills + filters + manual order button */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { key: "all", label: `Все · ${statusCounts.all}` },
              { key: "on_check", label: `На проверке · ${statusCounts.on_check}` },
              { key: "in_progress", label: `В работе · ${statusCounts.in_progress}` },
              { key: "paid", label: `Оплачено · ${statusCounts.paid}` },
              {
                key: "needs_replacement",
                label: `На замену · ${statusCounts.needs_replacement}`,
              },
              { key: "rejected", label: `Отклонено · ${statusCounts.rejected}` },
            ] as Array<{ key: StatusFilter; label: string }>
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setStatusFilter(item.key)}
              className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                statusFilter === item.key
                  ? "border-[#5566f6] bg-[#5566f6] text-white"
                  : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {viewer.canManagePlans ? (
          <button
            type="button"
            onClick={() => setManualModalOpen(true)}
            className={SEO_BTN_PRIMARY_CLASS}
          >
            <Plus className="size-4" />
            Разовая закупка
          </button>
        ) : null}
      </div>

      {/* Secondary filter bar */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по донору, URL, анкору…"
            className={`${SEO_INPUT_CLASS} pl-9`}
          />
        </div>

        <select
          value={originFilter}
          onChange={(e) => setOriginFilter(e.target.value)}
          className={SEO_INPUT_CLASS}
        >
          <option value="all">Все способы закупки</option>
          <option value="scheduled_wesetup">По плану Wesetup</option>
          <option value="manual_wesetup">Вручную из админки Wesetup</option>
          <option value="external_ggl">Из кабинета GoGetLinks</option>
        </select>

        <select
          value={initiatorFilter}
          onChange={(e) => setInitiatorFilter(e.target.value)}
          className={SEO_INPUT_CLASS}
        >
          <option value="all">Все администраторы / инициаторы</option>
          {uniqueInitiators.map((person) => (
            <option key={person} value={person}>
              {person}
            </option>
          ))}
        </select>
      </div>

      {/* Registry table */}
      {filteredOrders.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center text-[14px] text-[#6f7282]">
          {orders.length === 0
            ? "Заявок и размещений по wesetup.ru пока нет."
            : "По заданным фильтрам закупки не найдены."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <table className="w-full min-w-[1060px] text-[13px]">
            <thead>
              <tr className="bg-[#fafbff] text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
                <th className="px-4 py-3">Донор и URL размещения</th>
                <th className="px-4 py-3">Целевая посадочная и анкор</th>
                <th className="px-4 py-3">Метрики</th>
                <th className="px-4 py-3">Потрачено</th>
                <th className="px-4 py-3">Кто купил</th>
                <th className="px-4 py-3">Статус и дата</th>
                <th className="px-4 py-3 text-right">Чат и приёмка</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => {
                const isArchive = order.campaign?.isWesetup === false;
                const attribution = formatOrderAttribution(order);
                const statusBadge = formatOrderStatusBadge(order.status);
                const linkedThread = threadByOrderId.get(order.id) ?? null;
                const isBusy = busyOrderId === order.id;
                const showingRevision = revisionOrderId === order.id;

                return (
                  <tr
                    key={order.id}
                    className={`border-t border-[#ececf4] align-top ${
                      isArchive ? "bg-[#fafbff]/80 opacity-85" : "hover:bg-[#fafbff]/50"
                    }`}
                  >
                    {/* Donor & published URL */}
                    <td className="max-w-[240px] px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <a
                          href={`https://${order.donorDomain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-[#0b1024] underline-offset-2 hover:underline"
                        >
                          {order.donorDomain}
                          <ExternalLink className="size-3 text-[#6f7282]" />
                        </a>
                        {isArchive && order.campaign ? (
                          <span className="rounded-md border border-[#dcdfed] bg-[#f4f4f8] px-1.5 py-0.5 text-[10.5px] font-medium text-[#6f7282]">
                            архив: {order.campaign.domain}
                          </span>
                        ) : null}
                      </div>
                      {order.publishedUrl ? (
                        <a
                          href={order.publishedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 block truncate text-[11.5px] text-[#3848c7] underline-offset-2 hover:underline"
                          title={order.publishedUrl}
                        >
                          {order.publishedUrl}
                        </a>
                      ) : (
                        <div className="mt-1 text-[11.5px] text-[#9b9fb3]">
                          URL публикации ещё не передан
                        </div>
                      )}
                      {order.gglReviewId ? (
                        <div className="mt-0.5 text-[11px] text-[#6f7282]">
                          Обзор #{order.gglReviewId}
                        </div>
                      ) : null}
                    </td>

                    {/* Target & anchor */}
                    <td className="max-w-[250px] px-4 py-3">
                      <a
                        href={order.targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-[#0b1024] underline-offset-2 hover:underline"
                      >
                        {isArchive
                          ? order.targetUrl
                          : shortWesetupPath(order.targetUrl)}
                        <ExternalLink className="size-3 text-[#6f7282]" />
                      </a>
                      <div className="mt-0.5 text-[12px] text-[#3c4053]">
                        Анкор: «<strong>{order.anchor || "безанкор"}</strong>»
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#6f7282]">
                        {formatPlacementFormatLabel(order.placementFormat)}
                      </div>
                    </td>

                    {/* Donor metrics */}
                    <td className="whitespace-nowrap px-4 py-3 text-[12px] text-[#3c4053]">
                      <div>
                        TF/CF:{" "}
                        <strong className="text-[#0b1024]">
                          {order.donorTfCf || "—"}
                        </strong>
                      </div>
                      <div className="mt-0.5 text-[#6f7282]">
                        Трафик: {order.donorDailyTraffic ?? "—"}/сут
                        {order.donorTrust !== null
                          ? ` · Траст ${order.donorTrust}`
                          : ""}
                      </div>
                    </td>

                    {/* Price */}
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-[#0b1024]">
                      {formatRub(order.priceRub)}
                    </td>

                    {/* Attribution: Кто купил */}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium ${badgeToneClass(
                          attribution.badgeTone,
                        )}`}
                      >
                        {attribution.primary}
                      </span>
                      {attribution.secondary ? (
                        <div className="mt-1 text-[11px] text-[#6f7282]">
                          {attribution.secondary}
                        </div>
                      ) : null}
                    </td>

                    {/* Status & date */}
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium ${badgeToneClass(
                          statusBadge.badgeTone,
                        )}`}
                      >
                        {statusBadge.label}
                      </span>
                      <div className="mt-1 text-[11.5px] text-[#6f7282]">
                        {formatRuShortDate(order.paidAt ?? order.createdAt)}
                      </div>
                    </td>

                    {/* Chat & inline placement review */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            onJumpToThread(
                              linkedThread?.id ?? null,
                              order.donorDomain,
                            )
                          }
                          className={SEO_BTN_SM_CLASS}
                        >
                          <MessageSquare className="size-3.5 text-[#5566f6]" />
                          Чат
                          {linkedThread && linkedThread.unreadCount > 0 ? (
                            <span className="rounded-full bg-[#5566f6] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              {linkedThread.unreadCount}
                            </span>
                          ) : null}
                        </button>

                        {order.status === "on_check" ? (
                          isArchive ? (
                            <span className="text-[11px] text-[#6f7282]">
                              Только чтение
                            </span>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  void submitReview(order, "accept")
                                }
                                className="inline-flex h-8 items-center gap-1 rounded-xl bg-[#116b2a] px-2.5 text-[12px] font-medium text-white transition-colors hover:bg-[#0e5822] disabled:opacity-50"
                              >
                                {isBusy ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Check className="size-3.5" />
                                )}
                                Принять
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => {
                                  setRevisionOrderId((curr) =>
                                    curr === order.id ? null : order.id,
                                  );
                                  setRevisionComment("");
                                }}
                                className={SEO_BTN_SM_CLASS}
                              >
                                <RotateCcw className="size-3.5 text-[#a13a32]" />
                                На доработку
                              </button>
                            </>
                          )
                        ) : null}
                      </div>

                      {showingRevision && !isArchive ? (
                        <div className="mt-2.5 rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-2.5 text-left">
                          <textarea
                            rows={2}
                            value={revisionComment}
                            onChange={(e) => setRevisionComment(e.target.value)}
                            placeholder="Укажите вебмастеру, что исправить (минимум 5 символов)…"
                            className="w-full rounded-xl border border-[#dcdfed] bg-white px-2.5 py-1.5 text-[12px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
                          />
                          <div className="mt-1.5 flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setRevisionOrderId(null)}
                              className="rounded-lg px-2 py-1 text-[11.5px] text-[#6f7282] hover:text-[#0b1024]"
                            >
                              Отмена
                            </button>
                            <button
                              type="button"
                              disabled={
                                isBusy || revisionComment.trim().length < 5
                              }
                              onClick={() =>
                                void submitReview(order, "request_revision")
                              }
                              className="inline-flex items-center gap-1 rounded-lg bg-[#a13a32] px-2.5 py-1 text-[11.5px] font-medium text-white disabled:opacity-50"
                            >
                              Отправить на доработку
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {manualModalOpen ? (
        <ManualOrderModal
          wesetupCampaigns={wesetupCampaigns}
          onClose={() => setManualModalOpen(false)}
          onCreated={onRefresh}
        />
      ) : null}
    </div>
  );
}

function ManualOrderModal({
  wesetupCampaigns,
  onClose,
  onCreated,
}: {
  wesetupCampaigns: GglCampaignDto[];
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}) {
  const [campaignId, setCampaignId] = useState(wesetupCampaigns[0]?.id ?? "");
  const [donorSiteId, setDonorSiteId] = useState("");
  const [donorDomain, setDonorDomain] = useState("");
  const [placementFormat, setPlacementFormat] = useState<
    "article" | "note" | "context"
  >("note");
  const [maxPriceRub, setMaxPriceRub] = useState("1200");
  const [targetUrl, setTargetUrl] = useState("/journals-info");
  const [anchor, setAnchor] = useState("wesetup.ru");
  const [anchorKind, setAnchorKind] = useState<GglAnchorKind>("url_brand");
  const [briefText, setBriefText] = useState("");
  const [articleTitle, setArticleTitle] = useState("");
  const [articleAnnouncement, setArticleAnnouncement] = useState("");
  const [articleBodyHtml, setArticleBodyHtml] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const idempotencyRef = useRef<string>(
    generateClientIdempotencyKey("manual-order"),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedDonorId = Number.parseInt(donorSiteId, 10);
    const parsedMaxPrice = Number.parseFloat(maxPriceRub);
    if (!Number.isFinite(parsedDonorId) || parsedDonorId <= 0) {
      toast.error("Укажите числовой ID площадки из каталога GoGetLinks");
      return;
    }
    if (!donorDomain.trim() || !donorDomain.includes(".")) {
      toast.error("Укажите домен площадки-донора");
      return;
    }
    if (!Number.isFinite(parsedMaxPrice) || parsedMaxPrice <= 0) {
      toast.error("Укажите максимальную цену ссылки в рублях");
      return;
    }
    if (
      placementFormat === "article" &&
      (articleTitle.trim().length < 3 || articleBodyHtml.trim().length < 10)
    ) {
      toast.error(
        "Для формата «Статья» укажите заголовок и HTML-текст статьи",
      );
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/root/gogetlinks/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(campaignId ? { campaignId } : {}),
          donorSiteId: parsedDonorId,
          donorDomain: donorDomain.trim(),
          placementFormat,
          maxPriceRub: parsedMaxPrice,
          targetUrl: targetUrl.trim(),
          anchor: anchor.trim(),
          anchorKind,
          briefText: briefText.trim() || null,
          articleDraft:
            placementFormat === "article"
              ? {
                  title: articleTitle.trim(),
                  ...(articleAnnouncement.trim()
                    ? { announcement: articleAnnouncement.trim() }
                    : {}),
                  bodyHtml: articleBodyHtml.trim(),
                }
              : null,
          idempotencyKey: idempotencyRef.current,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        idempotencyRef.current = generateClientIdempotencyKey("manual-order");
        throw new Error(
          data?.error ?? "Не удалось отправить разовую заявку в GoGetLinks",
        );
      }
      toast.success(
        `Разовая заявка на ${donorDomain.trim()} отправлена в GoGetLinks`,
      );
      await onCreated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка создания заявки");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1024]/45 p-4 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="max-h-[90vh] w-full max-w-[640px] overflow-y-auto rounded-3xl border border-[#dcdfed] bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[18px] font-semibold text-[#0b1024]">
              Разовая закупка ссылки на wesetup.ru
            </h3>
            <p className="mt-0.5 text-[12.5px] text-[#6f7282]">
              Перед отправкой сервер проверит актуальную цену площадки в каталоге GoGetLinks и остаток доступного баланса.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-xl border border-[#dcdfed] text-[#6f7282] hover:text-[#0b1024]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
              Кампания wesetup.ru
            </label>
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className={SEO_INPUT_CLASS}
            >
              {wesetupCampaigns.length === 0 ? (
                <option value="">По умолчанию (активная wesetup.ru)</option>
              ) : (
                wesetupCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (#{c.gglCampaignId})
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
              ID площадки-донора (siteId)
            </label>
            <input
              type="number"
              required
              min={1}
              value={donorSiteId}
              onChange={(e) => setDonorSiteId(e.target.value)}
              placeholder="Например, 148920"
              className={SEO_INPUT_CLASS}
            />
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
              Домен донора
            </label>
            <input
              type="text"
              required
              value={donorDomain}
              onChange={(e) => setDonorDomain(e.target.value)}
              placeholder="horeca-magazine.ru"
              className={SEO_INPUT_CLASS}
            />
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
              Формат размещения
            </label>
            <select
              value={placementFormat}
              onChange={(e) =>
                setPlacementFormat(
                  e.target.value as "article" | "note" | "context",
                )
              }
              className={SEO_INPUT_CLASS}
            >
              <option value="note">Заметка (пишет вебмастер по ТЗ)</option>
              <option value="article">Статья (загружаем свой HTML)</option>
              <option value="context">Контекстная ссылка</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
              Потолок цены (₽)
            </label>
            <input
              type="number"
              required
              min={50}
              value={maxPriceRub}
              onChange={(e) => setMaxPriceRub(e.target.value)}
              className={SEO_INPUT_CLASS}
            />
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
              Целевой адрес wesetup.ru
            </label>
            <input
              type="text"
              required
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="/zhurnal-brakerazha-gotovoy-produkcii"
              className={SEO_INPUT_CLASS}
            />
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
              Текст анкора
            </label>
            <input
              type="text"
              required
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
              placeholder="wesetup.ru"
              className={SEO_INPUT_CLASS}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
              Тип анкора
            </label>
            <select
              value={anchorKind}
              onChange={(e) => setAnchorKind(e.target.value as GglAnchorKind)}
              className={SEO_INPUT_CLASS}
            >
              <option value="url_brand">Безанкор / бренд (wesetup.ru)</option>
              <option value="diluted">Разбавленный</option>
              <option value="exact">Точное вхождение</option>
            </select>
          </div>

          {placementFormat === "article" ? (
            <div className="space-y-3 sm:col-span-2">
              <div>
                <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
                  Заголовок статьи
                </label>
                <input
                  type="text"
                  required
                  value={articleTitle}
                  onChange={(e) => setArticleTitle(e.target.value)}
                  placeholder="Санитарные журналы ХАССП на кухне ресторана"
                  className={SEO_INPUT_CLASS}
                />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
                  Краткий анонс
                </label>
                <input
                  type="text"
                  value={articleAnnouncement}
                  onChange={(e) => setArticleAnnouncement(e.target.value)}
                  className={SEO_INPUT_CLASS}
                />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
                  HTML-текст статьи
                </label>
                <textarea
                  rows={5}
                  required
                  value={articleBodyHtml}
                  onChange={(e) => setArticleBodyHtml(e.target.value)}
                  placeholder="<p>Текст статьи со ссылкой...</p>"
                  className={`${SEO_TEXTAREA_CLASS} font-mono text-[12px]`}
                />
              </div>
            </div>
          ) : (
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
                Комментарий / ТЗ для вебмастера
              </label>
              <textarea
                rows={3}
                value={briefText}
                onChange={(e) => setBriefText(e.target.value)}
                placeholder="Органично впишите ссылку в материал про общепит, пищевую безопасность или СанПиН…"
                className={SEO_TEXTAREA_CLASS}
              />
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-[#ececf4] pt-4">
          <button
            type="button"
            onClick={onClose}
            className={SEO_BTN_OUTLINE_CLASS}
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={SEO_BTN_PRIMARY_CLASS}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {submitting ? "Отправка в GoGetLinks…" : "Подтвердить и купить"}
          </button>
        </div>
      </form>
    </div>
  );
}
