"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { PpkRecordBlock } from "@/lib/ppk/records";

/** Запись блока, как её отдаёт API. */
export type PpkRecordRow<T> = { id: string; data: T; sortOrder: number; updatedAt: string };

const API = "/api/production-control/records";

/** Ошибка сервера — текстом; без текста — общая фраза (`fallback`). */
async function serverError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" && body.error ? body.error : fallback;
}

/**
 * Записи одного блока раздела ППК: список и операции создания, правки и удаления.
 * Ошибки показываются тостом с текстом сервера. После каждого изменения список
 * перечитывается и уходит событие `ppk:changed` — по нему обновляется статус блоков.
 *
 * `initial` — записи, пришедшие с сервера вместе со страницей: тогда первый
 * запрос не нужен.
 */
export function usePpkRecords<T>(block: PpkRecordBlock, initial?: PpkRecordRow<T>[]) {
  const t = useTranslations("productionControl");
  const [records, setRecords] = useState<PpkRecordRow<T>[]>(initial ?? []);
  const [loading, setLoading] = useState(!initial);
  const hasInitial = useRef(Boolean(initial));

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API}?block=${block}`, { cache: "no-store" });
      if (!response.ok) {
        toast.error(await serverError(response, t("records.saveFailed")));
        return;
      }
      const body = (await response.json()) as { records: PpkRecordRow<T>[] };
      setRecords(body.records);
    } catch {
      toast.error(t("records.offline"));
    } finally {
      setLoading(false);
    }
  }, [block, t]);

  useEffect(() => {
    if (!hasInitial.current) void reload();
  }, [reload]);

  /** Отправить изменение и перечитать список; true — сервер принял. */
  const send = useCallback(
    async (request: Promise<Response>): Promise<boolean> => {
      try {
        const response = await request;
        if (!response.ok) {
          toast.error(await serverError(response, t("records.saveFailed")));
          return false;
        }
      } catch {
        toast.error(t("records.offline"));
        return false;
      }
      window.dispatchEvent(new Event("ppk:changed"));
      await reload();
      return true;
    },
    [reload, t],
  );

  const create = useCallback(
    (data: T) =>
      send(
        fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ block, data }),
        }),
      ),
    [block, send],
  );

  const update = useCallback(
    (id: string, data: T) =>
      send(
        fetch(`${API}/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data }),
        }),
      ),
    [send],
  );

  const remove = useCallback(
    (id: string) => send(fetch(`${API}/${id}`, { method: "DELETE" })),
    [send],
  );

  return { records, loading, create, update, remove, reload };
}
