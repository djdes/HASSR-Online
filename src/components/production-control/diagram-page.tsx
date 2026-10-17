"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2, Printer, Check, AlertTriangle } from "lucide-react";
import type { DiagramData } from "@/lib/ppk/records";
import { DiagramEditor } from "@/components/production-control/diagram-editor";
import { PPK_BUTTON_OUTLINE_CLASS } from "@/components/production-control/ppk-ui";

type SaveState = "saved" | "dirty" | "saving" | "failed";

const SAVE_DELAY_MS = 800;

/**
 * Страница одной схемы: название-поле, индикатор сохранения, кнопки печати и
 * редактор. Изменения уходят на сервер сами через 800 мс после последней правки.
 */
export function DiagramPage({
  id,
  kind,
  basePath,
  initial,
  areas,
  controlNumbers,
}: {
  id: string;
  kind: "flowchart" | "floor-plan";
  basePath: string;
  initial: DiagramData;
  areas: { id: string; name: string }[];
  controlNumbers: string[];
}) {
  const t = useTranslations("productionControl.diagram");
  const [data, setData] = useState<DiagramData>(initial);
  const [state, setState] = useState<SaveState>("saved");
  const latest = useRef(initial);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  // Текст ошибки сервера (например, превышен лимит) — показываем под заголовком.
  const [errorText, setErrorText] = useState<string | null>(null);

  const url = `/api/production-control/records/${id}`;

  const save = useCallback(async () => {
    if (saving.current) {
      // Запрос уже идёт: повторим, когда он закончится.
      timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
      return;
    }
    saving.current = true;
    dirty.current = false;
    setState("saving");
    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: latest.current }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof body?.error === "string" ? body.error : String(response.status));
      }
      setErrorText(null);
      setState(dirty.current ? "dirty" : "saved");
      window.dispatchEvent(new Event("ppk:changed"));
    } catch (error) {
      dirty.current = true;
      setErrorText(error instanceof Error && !/^\d+$/.test(error.message) ? error.message : null);
      setState("failed");
    } finally {
      saving.current = false;
    }
  }, [url]);

  const change = useCallback(
    (next: DiagramData) => {
      latest.current = next;
      dirty.current = true;
      setData(next);
      setState("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
    },
    [save],
  );

  // Уходя со страницы, дослать несохранённое.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current) {
        const body = JSON.stringify({ data: latest.current });
        // keepalive-запросы ограничены 64 КБ: тяжёлую схему шлём обычным fetch.
        void fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: body.length < 60_000,
        }).catch(() => {});
      }
    };
  }, [url]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <input
            value={data.title}
            maxLength={120}
            onChange={(event) => change({ ...latest.current, title: event.target.value })}
            aria-label={t("titleField")}
            title={t("rename")}
            placeholder={t("unnamed")}
            className="w-full rounded-2xl border border-transparent bg-transparent px-2 py-1 text-[24px] font-semibold tracking-[-0.02em] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 hover:border-[#dcdfed] focus:border-[#5566f6] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 md:text-[26px]"
          />
          <div className="mt-1 flex h-5 items-center gap-1.5 px-2 text-[13px]" aria-live="polite">
            {state === "saving" || state === "dirty" ? (
              <span className="inline-flex items-center gap-1.5 text-[#6f7282]">
                <Loader2 className="size-3.5 animate-spin" />
                {t("saving")}
              </span>
            ) : state === "failed" ? (
              <span className="inline-flex items-center gap-1.5 text-[#a13a32]">
                <AlertTriangle className="size-3.5" />
                {t("saveFailed")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[#1f9d55]">
                <Check className="size-3.5" />
                {t("saved")}
              </span>
            )}
          </div>
          {state === "failed" && errorText ? (
            <p className="px-2 text-[13px] text-[#a13a32]" role="alert">
              {errorText}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`${basePath}/${id}/print`} className={PPK_BUTTON_OUTLINE_CLASS}>
            <Printer className="size-4 text-[#5566f6]" />
            {t("print")}
          </Link>
          {kind === "floor-plan" ? (
            <Link href={`${basePath}/${id}/print?by=flow`} className={PPK_BUTTON_OUTLINE_CLASS}>
              <Printer className="size-4 text-[#5566f6]" />
              {t("printByFlow")}
            </Link>
          ) : null}
        </div>
      </div>

      <DiagramEditor kind={kind} value={data} onChange={change} areas={areas} controlNumbers={controlNumbers} />
    </div>
  );
}
