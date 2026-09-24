"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Copy, Link2, Unlink } from "lucide-react";
import { toast } from "sonner";

type Info = {
  ownCode: string;
  linkedCode: string | null;
  linkedOrganizationName: string | null;
  poolSize: number;
};
type Preview = { code: string; organizationName: string; poolSize: number };

/**
 * «Привязать журнал, служебный код» — общий справочник блюд между
 * организациями. Свой код показан рядом: его отдают другим организациям.
 * Привязка и отвязка — только после предупреждения прямо в окне: поверх
 * Radix-модалки второе окно не получает кликов.
 */
export function DishPoolSection({
  onChange,
  hideTitle = false,
}: {
  /** Привязка/отвязка прошла — страница может перечитать свои данные пула. */
  onChange?: () => void;
  /** Заголовок секции рисует страница (настройки мастер-кабинета). */
  hideTitle?: boolean;
} = {}) {
  const [info, setInfo] = useState<Info | null>(null);
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/settings/dish-pool", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: Info | null) => {
        if (!cancelled && body) setInfo(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function send(method: "POST" | "DELETE", body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/dish-pool", {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = (await response.json().catch(() => null)) as
        | { error?: string; preview?: Preview; info?: Info; linked?: Preview }
        | null;
      if (!response.ok) throw new Error(json?.error || "Не получилось");
      return json;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось");
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!info) return null;

  return (
    <div className="space-y-2">
      {hideTitle ? null : (
        <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Общий справочник блюд</div>
      )}
      <p className="text-[12.5px] leading-[1.45] text-[#6f7282]">
        Организации с одним служебным кодом видят общий список блюд: блюдо, внесённое в одной, сразу есть в
        выпадающих списках других.
      </p>
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3 py-2 text-[13.5px]">
        <span className="text-[#6f7282]">Код базы вашей организации:</span>
        <span className="font-mono font-semibold tracking-wider text-[#0b1024]" data-testid="own-service-code">
          {info.ownCode}
        </span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(info.ownCode).then(
              () => toast.success("Код скопирован"),
              () => toast.error("Не удалось скопировать")
            );
          }}
          className="rounded-lg p-1.5 text-[#3848c7] transition-colors duration-150 hover:bg-white"
          aria-label="Скопировать код"
          title="Скопировать код"
        >
          <Copy className="size-4" />
        </button>
      </div>

      {info.linkedCode ? (
        <div className="space-y-2 rounded-2xl border border-[#d4f5e3] bg-[#f3fdf7] px-3 py-2.5 text-[13.5px] text-[#116b2a]">
          <div className="flex flex-wrap items-center gap-2">
            <Link2 className="size-4" />
            Подключено к базе «{info.linkedOrganizationName ?? info.linkedCode}» · организаций в общем списке:{" "}
            {info.poolSize}
            {!confirmUnlink ? (
              <button
                type="button"
                onClick={() => setConfirmUnlink(true)}
                className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#fff4f2]"
              >
                <Unlink className="size-3.5" /> Отвязать
              </button>
            ) : null}
          </div>
          {confirmUnlink ? (
            <div className="rounded-xl border border-[#ffe9b0] bg-[#fff8eb] p-3 text-[13px] text-[#7a4a00]" role="alert">
              В выпадающих списках останутся только блюда вашей организации — блюда других организаций пропадут.
              Записи в журналах не меняются.
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const json = await send("DELETE");
                    if (json?.info) {
                      setInfo(json.info);
                      setConfirmUnlink(false);
                      toast.success("Общий справочник отключён");
                      onChange?.();
                    }
                  }}
                  className="inline-flex h-9 items-center rounded-xl bg-[#d2453d] px-4 text-[13px] font-medium text-white shadow-[0_8px_20px_-10px_rgba(210,69,61,0.6)] transition-colors duration-150 hover:bg-[#b93a33] disabled:opacity-50"
                >
                  Отвязать
                </button>
                <button type="button" onClick={() => setConfirmUnlink(false)} className="inline-flex h-9 items-center rounded-xl px-3 text-[13px] hover:bg-white">
                  Отмена
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setPreview(null);
              setError(null);
            }}
            placeholder="Привязать журнал, служебный код"
            aria-label="Привязать журнал, служебный код"
            className="h-10 min-w-0 flex-1 rounded-xl border border-[#dcdfed] bg-white px-3 font-mono text-[14px] uppercase tracking-wider text-[#0b1024] placeholder:font-sans placeholder:normal-case placeholder:tracking-normal focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
          <button
            type="button"
            disabled={busy || code.trim().length < 5}
            onClick={async () => {
              const json = await send("POST", { code });
              if (json?.preview) setPreview(json.preview);
            }}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#5566f6] px-4 text-[13.5px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-50"
          >
            <Link2 className="size-4" /> Привязать
          </button>
        </div>
      )}

      {error ? <p className="text-[12.5px] text-[#a13a32]">{error}</p> : null}

      {preview && !info.linkedCode ? (
        <div className="space-y-2 rounded-xl border border-[#ffe9b0] bg-[#fff8eb] p-3 text-[13px] text-[#7a4a00]" role="alert">
          <div className="flex items-start gap-2 font-semibold">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Номенклатура блюд станет единой с базой «{preview.organizationName}»
          </div>
          <ul className="list-disc space-y-0.5 pl-6 leading-snug">
            <li>В выпадающих списках блюд появятся блюда всех организаций с этим кодом (сейчас их {preview.poolSize}).</li>
            <li>Блюда, которые вносите вы, увидят и они.</li>
            <li>Касается наименований в бракераже и интенсивном охлаждении; температуры и записи журналов не делятся.</li>
            <li>Отвязать можно в любой момент — ваши блюда останутся у вас.</li>
          </ul>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const json = await send("POST", { code, confirm: true });
                if (json?.info) {
                  setInfo(json.info);
                  setPreview(null);
                  setCode("");
                  toast.success(`Подключено: общий справочник с «${preview.organizationName}»`);
                  onChange?.();
                }
              }}
              className="inline-flex h-9 items-center rounded-xl bg-[#5566f6] px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-50"
            >
              Подключить общий справочник
            </button>
            <button type="button" onClick={() => setPreview(null)} className="inline-flex h-9 items-center rounded-xl px-3 text-[13px] hover:bg-white">
              Отмена
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
