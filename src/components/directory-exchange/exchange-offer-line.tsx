"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Info } from "lucide-react";

import {
  exchangeParticipants,
  loadExchangeState,
  loadForeignState,
  pendingRequests,
  type ExchangeState,
  type ForeignState,
} from "./exchange-api";
import { ExchangeDialog } from "./exchange-dialog";

/**
 * Строка-предложение в шаге «Объекты» мастера настройки (Р9): у аккаунта уже
 * есть другая организация — её справочники можно связать с этой или перенести
 * один раз. Видит владелец аккаунта, когда соседние организации есть; иначе
 * строки нет вовсе. Организация уже в обмене — строка говорит, с кем связана.
 *
 * Запрос в мастер-кабинет другой компании ждёт решения (спека
 * org-exchange-foreign-2026-11-19) — строка говорит об этом, даже когда
 * соседних организаций нет.
 */
export function ExchangeOfferLine({
  onApplied,
}: {
  /** Связь или перенос выполнены — объекты и другие списки могли измениться. */
  onApplied?: () => void;
}) {
  const t = useTranslations("dashboardUi.directoryExchange.offer");
  const tf = useTranslations("dashboardUi.directoryExchange.foreign");
  const [state, setState] = useState<ExchangeState | null>(null);
  const [foreign, setForeign] = useState<ForeignState | null>(null);
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadExchangeState().then(async (next) => {
      if (!next) return;
      // Запросы в чужие кабинеты читаем только владельцу и до показа строки: текст не мигает.
      const requests = next.canManage ? await loadForeignState() : null;
      if (!alive) return;
      setState(next);
      setForeign(requests);
    });
    return () => {
      alive = false;
    };
  }, [version]);

  if (!state || !state.canManage) return null;

  const waiting = foreign ? pendingRequests(foreign) : [];
  if (state.siblings.length === 0 && waiting.length === 0) return null;

  const ownId = state.organization.id;
  const participants = exchangeParticipants(state);
  const partners = participants.filter((member) => member.organizationId !== ownId);
  const linked = partners.length > 0 && participants.some((member) => member.organizationId === ownId);
  const names = linked ? partners.map((member) => member.name) : state.siblings.map((sibling) => sibling.name);
  const name = names[0] ?? "";
  const more = names.length - 1;
  const text =
    waiting.length > 1
      ? tf("offerPendingMore", { name: waiting[0].cabinetName, count: waiting.length - 1 })
      : waiting.length === 1
        ? tf("offerPending", { name: waiting[0].cabinetName })
        : linked
          ? more > 0
            ? t("linkedMore", { name, count: more })
            : t("linked", { name })
          : more > 0
            ? t("availableMore", { name, count: more })
            : t("available", { name });

  return (
    // Одна обёртка: окно рисуется рядом со строкой и не попадает под отступы списка шага.
    <div
      data-testid="exchange-offer-line"
      data-linked={linked ? "true" : "false"}
      data-pending={waiting.length > 0 ? "true" : "false"}
    >
      <div className="flex items-center gap-2.5 rounded-2xl border border-[#dcdfed] bg-[#f5f6ff] py-1.5 pl-3 pr-1.5">
        <Info className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
        <p className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug text-[#3c4053]" title={text}>
          {text}
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-8 shrink-0 items-center rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#fafbff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          data-testid="exchange-offer-open"
        >
          {waiting.length > 0 ? tf("offerOpen") : linked ? t("change") : t("configure")}
        </button>
      </div>
      {open ? (
        <ExchangeDialog
          onClose={() => setOpen(false)}
          onApplied={() => {
            setVersion((value) => value + 1);
            onApplied?.();
          }}
        />
      ) : null}
    </div>
  );
}
