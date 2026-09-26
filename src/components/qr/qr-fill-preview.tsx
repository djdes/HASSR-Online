"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileText, Printer, QrCode, RefreshCw, Sticker } from "lucide-react";

import { BRAND_QR_CAPTION_ASPECT } from "@/lib/brand-qr-shared";
import { formatQrValidUntil, posterDetailLine, type QrFillKind, type QrPoster } from "@/lib/qr-fill-types";
import { cn } from "@/lib/utils";

type Props = {
  kind: QrFillKind;
  /** `null` — объект ещё не в справочнике: показываем подсказку вместо QR. */
  id: string | null;
  /** Что увидит человек, пока QR недоступен (строка не связана / контроль выключен). */
  emptyHint: string;
  className?: string;
  /** Заголовок блока вместо «QR-код для заполнения с телефона». */
  heading?: string;
  /** Основной QR журнала — индиго-рамка (диалог QR документа, 2026-09-23). */
  accent?: boolean;
  /** Куда ведёт «Все коды» (у журнала — экран его QR-кодов). */
  allHref?: string;
};

/** Результат последней загрузки; `key` — id объекта, для которого он получен. */
type Result =
  | { key: string; status: "ready"; poster: QrPoster }
  | { key: string; status: "error"; message: string };

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; poster: QrPoster }
  | { status: "error"; message: string };

/**
 * QR-код объекта прямо в диалоге строки журнала (холодильник /
 * помещение): сотрудник сканирует и вносит показание без входа. Печать —
 * страница плакатов с `autoprint=1`: «Плакат A4» (один на лист) и
 * «Наклейка» (сетка на листе). Ссылки открываются в новой вкладке, чтобы
 * диалог с несохранёнными полями не потерялся.
 */
export function QrFillPreview({ kind, id, emptyHint, className, heading, accent = false, allHref }: Props) {
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const key = `${kind}:${id}:${attempt}`;
    fetch(`/api/qr-fill/${kind}/${encodeURIComponent(id)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.poster) {
          throw new Error(payload?.error || "Не удалось загрузить QR-код");
        }
        if (!cancelled) setResult({ key, status: "ready", poster: payload.poster as QrPoster });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResult({
          key,
          status: "error",
          message: error instanceof Error ? error.message : "Не удалось загрузить QR-код",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [id, kind, attempt]);

  // Состояние выводится из результата: пока ключ не совпал — грузим.
  const state: State = !id
    ? { status: "idle" }
    : result && result.key === `${kind}:${id}:${attempt}`
      ? result
      : { status: "loading" };

  const posterKind = kind === "room" ? "rooms" : kind === "journal" ? "journals" : "equipment";
  const printHref = (layout: "poster" | "sheet") =>
    `/settings/qr-posters?kind=${posterKind}&layout=${layout}&ids=${encodeURIComponent(id ?? "")}&autoprint=1`;

  return (
    <section
      data-qr-fill-preview={kind}
      data-qr-preview-id={id ?? undefined}
      className={cn(
        "rounded-2xl border p-4",
        accent ? "border-[#5566f6]/50 bg-white shadow-[0_0_0_3px_rgba(85,102,246,0.08)]" : "border-[#ececf4] bg-[#fafbff]",
        className
      )}
    >
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
        <QrCode className="size-3.5 text-[#5566f6]" />
        {heading ?? "QR-код для заполнения с телефона"}
      </div>

      {!id ? (
        <p className="mt-2 rounded-xl border border-dashed border-[#dcdfed] bg-white px-3 py-3 text-[13px] leading-[1.5] text-[#6f7282]">
          {emptyHint}
        </p>
      ) : state.status === "error" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-[#ffd7d3] bg-[#fff4f2] px-3 py-2.5 text-[13px] text-[#a13a32]">
          <span className="min-w-0 flex-1">{state.message}</span>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[12.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            <RefreshCw className="size-3.5" />
            Повторить
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
          <div
            className="qr-fill-preview-box mx-auto w-full max-w-[200px] shrink-0 rounded-2xl border border-[#ececf4] bg-white p-2 sm:mx-0"
            aria-busy={state.status !== "ready"}
          >
            {state.status === "ready" ? (
              // SVG собран на сервере (brand-qr.ts) из нашего адреса — безопасно встраивать.
              <div dangerouslySetInnerHTML={{ __html: state.poster.svg }} />
            ) : (
              // Заглушка — в пропорциях фирменного QR (с плашкой), без прыжка при загрузке.
              <div className="w-full animate-pulse rounded-xl bg-[#eef1ff]" style={{ aspectRatio: `1 / ${BRAND_QR_CAPTION_ASPECT}` }} />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            {state.status === "ready" ? (
              <>
                <div className="truncate text-[14px] font-medium text-[#0b1024]">
                  {state.poster.title}
                </div>
                <div className="text-[12.5px] leading-[1.5] text-[#6f7282]">
                  {state.poster.orgName}
                  {posterDetailLine(state.poster) ? (
                    <span className="block">{posterDetailLine(state.poster)}</span>
                  ) : null}
                </div>
                <p className="text-[12.5px] leading-[1.5] text-[#3c4053]">
                  {kind === "journal"
                    ? state.poster.validUntil
                      ? "Ведёт только в этот документ: сотрудник выбирает себя и отвечает на вопросы формы."
                      : "Сотрудник наводит камеру, выбирает себя и отвечает на вопросы формы — запись ложится в действующий документ журнала."
                    : "Сотрудник наводит камеру, выбирает своё имя и вводит показание — запись ложится в журнал за сегодня."}
                </p>
                {state.poster.validUntil ? (
                  <div data-qr-valid-until={state.poster.validUntil} className="inline-flex rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium tabular-nums text-[#3848c7]">
                    {formatQrValidUntil(state.poster.validUntil) === "бессрочно"
                      ? "Действует, пока действует документ"
                      : `Действует до ${formatQrValidUntil(state.poster.validUntil).slice(0, 5)} — до конца периода документа`}
                  </div>
                ) : (
                  <div className="text-[11.5px] text-[#9b9fb3]">Код бессрочный — печатается один раз.</div>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded bg-[#eef1ff]" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-[#eef1ff]" />
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <a
                href={printHref("poster")}
                target="_blank"
                rel="noopener"
                aria-disabled={state.status !== "ready"}
                title="Открыть плакат A4 с этим QR-кодом и сразу отправить на печать"
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3.5 text-[13px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0]",
                  state.status !== "ready" && "pointer-events-none opacity-50"
                )}
              >
                <Printer className="size-4" />
                Плакат A4
              </a>
              <a
                href={printHref("sheet")}
                target="_blank"
                rel="noopener"
                aria-disabled={state.status !== "ready"}
                title="Маленькая наклейка на дверцу — печать на листе A4"
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
                  state.status !== "ready" && "pointer-events-none opacity-50"
                )}
              >
                <Sticker className="size-4 text-[#5566f6]" />
                Наклейка
              </a>
              <a
                href={state.status === "ready" ? state.poster.url : "#"}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={state.status !== "ready"}
                title="Открыть ссылку из QR-кода в новой вкладке — проверить, что форма открывается"
                data-testid="qr-check-link"
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
                  state.status !== "ready" && "pointer-events-none opacity-50"
                )}
              >
                <ExternalLink className="size-4 text-[#5566f6]" />
                Проверить ссылку
              </a>
              <a
                href={allHref ?? `/settings/qr-posters?kind=${posterKind}`}
                target="_blank"
                rel="noopener"
                title="Все плакаты и наклейки организации"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[12.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff]"
              >
                <FileText className="size-3.5" />
                Все коды
              </a>
            </div>
          </div>
        </div>
      )}
      <style>{`.qr-fill-preview-box svg { display: block; width: 100%; height: auto; }`}</style>
    </section>
  );
}
