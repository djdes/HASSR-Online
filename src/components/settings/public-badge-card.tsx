"use client";

import { BadgeCheck, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";

export type BadgeState = {
  enabled: boolean;
  code: string | null;
  publicUrl: string | null;
  imageUrl: string | null;
  embedHtml: string | null;
  percent: number | null;
  previewSvgDataUrl: string;
};

const CARD = "rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7";
const PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60";
const SECONDARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60";

/**
 * Публичный бейдж на `/settings/organization`: живой пример, как он
 * выглядит на сайте заведения, описание в две фразы, готовые ссылка и код.
 *
 * Сами бейдж не включаем: включение публикует страницу `/b/<код>` с
 * названием организации и процентом заполнения журналов. Поэтому до
 * включения ссылка и код — предпросмотр (по ним ничего не открывается), а
 * включение — одна кнопка «Включить и скопировать код» или переключатель.
 * Выключается тем же переключателем, сразу: код сохраняется, включить
 * обратно можно в любой момент.
 */
export function PublicBadgeCard({ initial, organizationName }: { initial: BadgeState; organizationName: string }) {
  const [state, setState] = useState<BadgeState>(initial);
  const [busy, setBusy] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);

  async function call(method: "PATCH" | "POST", body?: unknown): Promise<BadgeState | null> {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/badge", {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await response.json().catch(() => null)) as (BadgeState & { error?: string }) | null;
      if (!response.ok || !data) throw new Error(data?.error ?? "Не удалось сохранить");
      setState(data);
      return data;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string | null, what: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} — скопировано`);
    } catch {
      toast.error("Не удалось скопировать — выделите текст вручную");
    }
  }

  async function enableAndCopy() {
    // Копируем первым делом, пока нажатие ещё «свежее»: после ответа
    // сервера браузер может не пустить в буфер обмена.
    let copied = false;
    if (state.embedHtml) {
      try {
        await navigator.clipboard.writeText(state.embedHtml);
        copied = true;
      } catch {
        copied = false;
      }
    }
    const next = await call("PATCH", { enabled: true });
    if (!next) return;
    toast.success(copied ? "Бейдж включён, код скопирован — вставьте его на сайт" : "Бейдж включён — скопируйте код ниже");
  }

  async function toggle(enabled: boolean) {
    const next = await call("PATCH", { enabled });
    if (!next) return;
    toast.success(enabled ? "Бейдж включён" : "Бейдж выключен: страница и картинка больше не открываются");
  }

  return (
    <section id="badge" className={CARD} data-testid="badge-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
          <BadgeCheck className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
          Бейдж «Журналы ведутся в WeSetup»
        </div>
        <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[13px] font-medium text-[#3c4053]">
          <span data-testid="badge-switch-label">{state.enabled ? "Включён" : "Выключен"}</span>
          <Switch
            checked={state.enabled}
            disabled={busy}
            onCheckedChange={(checked) => void toggle(checked)}
            aria-label={state.enabled ? "Выключить бейдж" : "Включить бейдж"}
            data-testid="badge-switch"
          />
        </label>
      </div>
      <p className="mt-1 max-w-[720px] text-[13px] leading-relaxed text-[#6f7282]" data-testid="badge-description">
        Значок для сайта, меню или соцсетей заведения: гости видят, что журналы ХАССП ведутся в электронном виде и сколько
        их заполнено за 30 дней. По нажатию открывается страница со статусом — без имён сотрудников и записей.
      </p>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <figure className="min-w-0" data-testid="badge-example">
          <div className="overflow-hidden rounded-2xl border border-[#ececf4] bg-white shadow-[0_10px_30px_-24px_rgba(11,16,36,0.35)]">
            <div className="flex items-center gap-1.5 border-b border-[#ececf4] bg-[#f4f5fb] px-3 py-2" aria-hidden>
              <span className="size-2 rounded-full bg-[#dcdfed]" />
              <span className="size-2 rounded-full bg-[#dcdfed]" />
              <span className="size-2 rounded-full bg-[#dcdfed]" />
              <span className="ml-2 min-w-0 truncate rounded-md bg-white px-2 py-0.5 text-[11px] text-[#9b9fb3]">
                сайт вашего заведения
              </span>
            </div>
            <div className="px-4 py-4">
              <div className="truncate text-[15px] font-semibold text-[#0b1024]">{organizationName}</div>
              <div className="mt-2 space-y-1.5" aria-hidden>
                <div className="h-2 w-4/5 rounded-full bg-[#eef0f6]" />
                <div className="h-2 w-3/5 rounded-full bg-[#eef0f6]" />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[#f0f1f7] pt-3">
                <span className="text-[11px] text-[#9b9fb3]" aria-hidden>
                  Меню · Контакты
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element -- та же SVG-картинка, что отдаёт /b/<код>/badge.svg */}
                <img
                  src={state.previewSvgDataUrl}
                  alt="Бейдж WeSetup: электронные журналы ХАССП"
                  height={22}
                  className="ml-auto h-[22px] w-auto"
                  data-testid="badge-preview"
                />
              </div>
            </div>
          </div>
          <figcaption className="mt-2 text-[12px] leading-relaxed text-[#9b9fb3]">
            Так бейдж выглядит на сайте заведения
            {state.percent !== null ? ` — сейчас ${state.percent}% журналов за 30 дней` : " — процент появится, когда журналы начнут заполняться"}.
          </figcaption>
        </figure>

        <div className="min-w-0 space-y-3">
          <div>
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">Код для сайта</div>
            <textarea
              readOnly
              value={state.embedHtml ?? "Код появится после включения"}
              rows={3}
              data-testid="badge-embed"
              onFocus={(event) => event.currentTarget.select()}
              className={`w-full rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-4 py-3 font-mono text-[12px] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 ${
                state.enabled ? "text-[#0b1024]" : "text-[#9b9fb3]"
              }`}
            />
            {state.publicUrl ? (
              <div className="mt-1 break-all text-[12px] text-[#6f7282]" data-testid="badge-public-url">
                Ссылка для соцсетей и карт: <span className="text-[#3848c7]">{state.publicUrl}</span>
              </div>
            ) : null}
          </div>

          {state.enabled ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void copy(state.embedHtml, "Код")} className={PRIMARY} data-testid="badge-copy-code">
                <Copy className="size-4" aria-hidden />
                Скопировать код
              </button>
              <button type="button" onClick={() => void copy(state.publicUrl, "Ссылка")} className={SECONDARY}>
                <Copy className="size-4 text-[#5566f6]" aria-hidden />
                Скопировать ссылку
              </button>
              {state.publicUrl ? (
                <a href={state.publicUrl} target="_blank" rel="noreferrer" className={SECONDARY} data-testid="badge-public-link">
                  <ExternalLink className="size-4 text-[#5566f6]" aria-hidden />
                  Открыть страницу
                </a>
              ) : null}
              <button type="button" onClick={() => setRotateOpen(true)} disabled={busy} className={SECONDARY}>
                <RefreshCw className="size-4 text-[#5566f6]" aria-hidden />
                Перевыпустить
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => void enableAndCopy()}
                disabled={busy}
                className={PRIMARY}
                data-testid="badge-enable-copy"
              >
                <BadgeCheck className="size-4" aria-hidden />
                {busy ? "Включаем…" : "Включить и скопировать код"}
              </button>
              <p className="text-[12.5px] leading-relaxed text-[#9b9fb3]">
                Пока бейдж выключен, ссылка и код не работают. Включение открывает страницу с названием организации и
                процентом заполнения журналов, поэтому без вашего решения мы его не включаем.
              </p>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={rotateOpen}
        onClose={() => setRotateOpen(false)}
        variant="warn"
        title="Перевыпустить код бейджа?"
        description="Старая ссылка и старый HTML-код перестанут работать — картинку на сайте нужно будет заменить."
        bullets={[{ label: "Новый код появится сразу" }, { label: "Старые вставки покажут «нет данных»" }]}
        confirmLabel="Перевыпустить"
        onConfirm={async () => {
          if (await call("POST")) toast.success("Код перевыпущен");
          setRotateOpen(false);
        }}
        confirmDisabled={busy}
      />
    </section>
  );
}
