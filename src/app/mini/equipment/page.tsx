"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Loader2, Package, Thermometer } from "lucide-react";

import {
  MiniSearchField,
  SEARCH_WORTH_IT_FROM,
} from "../_components/mini-search-field";
import { filterAndRank } from "../_lib/list-search";
import { getEquipmentTypeLabel } from "@/lib/equipment-type-label";
import { useRegisterRefresh } from "../_components/refresh-provider";

type EquipmentItem = {
  id: string;
  name: string;
  type: string | null;
  tempMin: number | null;
  tempMax: number | null;
  areaName: string;
};

/** Типы, которым положен значок термометра (в базе тип хранится кодом). */
const TEMP_TYPES = new Set(["refrigerator", "fridge", "freezer", "sensor", "thermometer"]);

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: EquipmentItem[] };

export default function MiniEquipmentPage() {
  const { status } = useSession();
  const [state, setState] = useState<State>({ kind: "loading" });
  // Наклейка на оборудовании ведёт сюда с `?q=<id>`. Раньше параметр
  // молча терялся, и сканирование приводило в общий список из сорока
  // строк — то есть ровно туда, откуда человек и хотел уйти.
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");

  const load = useCallback(async () => {
    try {
      const resp = await fetch("/api/mini/equipment", { cache: "no-store" });
      // Раньше на экран выводилось «HTTP 403» — человеку это ни о чём.
      if (resp.status === 401) {
        throw new Error("Сессия закончилась. Откройте приложение заново.");
      }
      if (resp.status === 403) {
        throw new Error(
          "Справочник оборудования доступен руководителю. Попросите его открыть нужную карточку."
        );
      }
      if (!resp.ok) {
        throw new Error(
          "Не удалось загрузить оборудование. Проверьте связь и нажмите «Повторить»."
        );
      }
      const data = await resp.json();
      setState({ kind: "ready", items: data.equipment });
    } catch (err) {
      setState({
        kind: "error",
        message:
          err instanceof Error && err.message
            ? err.message
            : "Не удалось загрузить оборудование.",
      });
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    void load();
  }, [status, load]);

  useRegisterRefresh(load);

  if (state.kind === "loading") {
    return (
      <div
        className="flex flex-1 items-center justify-center text-[14px]"
        style={{ color: "var(--mini-text-muted)" }}
      >
        <Loader2
          className="mr-2 size-4 animate-spin"
          style={{ color: "var(--mini-lime)" }}
        />
        Загружаем…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div
        className="rounded-2xl px-4 py-4"
        style={{
          background: "var(--mini-crimson-soft)",
          border: "1px solid var(--mini-divider)",
        }}
      >
        <p
          className="text-[14px] leading-5"
          style={{ color: "var(--mini-crimson)" }}
        >
          {state.message}
        </p>
        <button
          type="button"
          onClick={() => {
            setState({ kind: "loading" });
            void load();
          }}
          className="mini-press mt-3 rounded-xl px-4 py-2 text-[13px] font-medium"
          style={{
            background: "var(--mini-lime)",
            color: "var(--mini-primary-contrast)",
          }}
        >
          Повторить
        </button>
      </div>
    );
  }

  const shown = filterAndRank(state.items, query, (item) => [
    item.name,
    item.type,
    getEquipmentTypeLabel(item.type),
    item.areaName,
    item.id,
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4 pb-24">
      <header
        className="rounded-3xl px-5 py-5"
        style={{
          background: "var(--mini-card-solid-bg)",
          border: "1px solid var(--mini-divider)",
        }}
      >
        <p
          className="mini-eyebrow"
          style={{ letterSpacing: "0.14em" }}
        >
          Справочник
        </p>
        <h1
          className="mt-1 text-[22px] font-semibold tracking-[-0.02em]"
          style={{ color: "var(--mini-text)" }}
        >
          Оборудование
        </h1>
        {/* Раньше экран молчал о том, что добавить или переименовать
            холодильник отсюда нельзя — человек искал кнопку и не находил. */}
        <p
          className="mt-2 text-[13px] leading-5"
          style={{ color: "var(--mini-text-muted)" }}
        >
          Список только для просмотра: норма температуры и цех — чтобы
          свериться на месте. Добавить оборудование или изменить норму можно в
          полной версии кабинета — раздел «Оборудование» в настройках.
        </p>
      </header>

      {state.items.length >= SEARCH_WORTH_IT_FROM || query.trim() ? (
        <MiniSearchField
          value={query}
          onChange={setQuery}
          placeholder="Название, тип или цех"
          resultLabel={
            query.trim()
              ? `Найдено ${shown.length} из ${state.items.length}`
              : undefined
          }
        />
      ) : null}

      <section className="space-y-2">
        {state.items.length === 0 ? (
          <div
            className="rounded-3xl px-4 py-7 text-center text-[14px]"
            style={{
              background: "var(--mini-surface-1)",
              border: "1px dashed var(--mini-divider-strong)",
              color: "var(--mini-text-muted)",
            }}
          >
            Пока нет оборудования.
          </div>
        ) : shown.length === 0 ? (
          <div
            className="rounded-3xl px-4 py-7 text-center text-[14px]"
            style={{
              background: "var(--mini-surface-1)",
              border: "1px dashed var(--mini-divider-strong)",
              color: "var(--mini-text-muted)",
            }}
          >
            Ничего не нашлось по «{query.trim()}».
          </div>
        ) : (
          shown.map((item: EquipmentItem) => (
            <div
              key={item.id}
              className="flex items-start gap-3 rounded-2xl px-4 py-3"
              style={{
                background: "var(--mini-card-solid-bg)",
                border: "1px solid var(--mini-divider)",
              }}
            >
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-2xl"
                style={{
                  background: "var(--mini-lime-soft)",
                  color: "var(--mini-lime)",
                }}
              >
                {/* Тип в базе — код («refrigerator»), а не русское слово:
                    старая проверка на «темп» не срабатывала никогда. */}
                {TEMP_TYPES.has((item.type ?? "").toLowerCase()) ? (
                  <Thermometer className="size-5" />
                ) : (
                  <Package className="size-5" />
                )}
              </span>
              <div className="min-w-0">
                <p
                  className="truncate text-[15px] font-medium"
                  style={{ color: "var(--mini-text)" }}
                >
                  {item.name}
                </p>
                <p
                  className="text-[13px]"
                  style={{ color: "var(--mini-text-muted)" }}
                >
                  {getEquipmentTypeLabel(item.type) || "Тип не указан"} ·{" "}
                  {item.areaName}
                </p>
                {item.tempMin != null && item.tempMax != null ? (
                  <p className="mt-0.5 text-[13px]">
                    <span style={{ color: "var(--mini-text-muted)" }}>
                      Норма:{" "}
                    </span>
                    <span
                      className="mini-mono font-medium"
                      style={{ color: "var(--mini-text)" }}
                    >
                      от {item.tempMin} до {item.tempMax} °C
                    </span>
                  </p>
                ) : null}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
