"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";

import { useRegisterRefresh } from "../_components/refresh-provider";

type Equipment = {
  id: string;
  name: string;
  type: string;
  tempMin: number | null;
  tempMax: number | null;
  tuyaDeviceId: string | null;
  area: { name: string };
};

export default function MiniIotPage() {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mini/iot", { cache: "no-store" });
      // Отказ по правам и обрыв связи — разные беды, и делать с ними надо
      // разное. Раньше и то и другое звучало одинаково.
      if (res.status === 401) {
        throw new Error("Сессия закончилась. Откройте приложение заново.");
      }
      if (res.status === 403) {
        throw new Error(
          "Раздел с датчиками доступен руководителю. Попросите его посмотреть показания."
        );
      }
      if (!res.ok) {
        throw new Error(
          "Не удалось загрузить датчики. Проверьте связь и нажмите «Повторить»."
        );
      }
      const data = await res.json();
      setEquipment(data.equipment ?? []);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Не удалось загрузить датчики."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRegisterRefresh(load);

  if (loading) {
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
  if (error)
    return (
      <div
        className="rounded-2xl px-4 py-3.5 text-[13px] leading-5"
        style={{
          background: "var(--mini-crimson-soft)",
          border: "1px solid var(--mini-divider)",
          color: "var(--mini-crimson)",
        }}
      >
        {error}
        <button
          type="button"
          onClick={() => void load()}
          className="mini-press mt-3 block rounded-xl px-4 py-2 text-[13px] font-medium"
          style={{
            background: "var(--mini-lime)",
            color: "var(--mini-primary-contrast)",
          }}
        >
          Повторить
        </button>
      </div>
    );

  return (
    <div className="flex flex-1 flex-col gap-4 pb-24">
      <Link
        href="/mini"
        className="inline-flex items-center gap-1 text-[13px] font-medium"
        style={{ color: "var(--mini-text-muted)" }}
      >
        <ArrowLeft className="size-4" />
        На главную
      </Link>

      <header className="px-1">
        <h1
          className="text-[20px] font-semibold"
          style={{ color: "var(--mini-text)" }}
        >
          Датчики температуры
        </h1>
        <p
          className="mt-0.5 text-[13px] leading-5"
          style={{ color: "var(--mini-text-muted)" }}
        >
          Холодильники и морозилки, где стоит датчик: он сам передаёт
          температуру, и её не нужно записывать вручную.
        </p>
      </header>

      {equipment.length === 0 ? (
        /* Пустой экран без объяснения читался как поломка: непонятно, ждать
           данных или что-то настраивать. */
        <div
          className="rounded-2xl px-4 py-6 text-[14px] leading-5"
          style={{
            background: "var(--mini-surface-1)",
            border: "1px dashed var(--mini-divider-strong)",
            color: "var(--mini-text-muted)",
          }}
        >
          <p style={{ color: "var(--mini-text)" }} className="font-medium">
            Датчиков пока нет
          </p>
          <p className="mt-1.5">
            Пока ни к одному холодильнику не подключён датчик — температуру
            записывают вручную в журнале. Подключить датчик можно в полной
            версии кабинета, раздел «Оборудование».
          </p>
          <Link
            href="/mini/equipment"
            className="mini-press mt-3 inline-flex rounded-xl px-4 py-2 text-[13px] font-medium"
            style={{
              background: "var(--mini-surface-2)",
              border: "1px solid var(--mini-divider)",
              color: "var(--mini-text)",
            }}
          >
            Открыть список оборудования
          </Link>
        </div>
      ) : (
        <section className="space-y-3">
          {equipment.map((eq) => (
            <div
              key={eq.id}
              className="rounded-2xl px-4 py-3"
              style={{
                background: "var(--mini-card-solid-bg)",
                border: "1px solid var(--mini-divider)",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-[15px] font-medium"
                  style={{ color: "var(--mini-text)" }}
                >
                  {eq.name}
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    background: eq.tuyaDeviceId
                      ? "var(--mini-sage-soft)"
                      : "var(--mini-surface-2)",
                    color: eq.tuyaDeviceId
                      ? "var(--mini-sage)"
                      : "var(--mini-text-muted)",
                  }}
                >
                  {eq.tuyaDeviceId ? "Подключено" : "—"}
                </span>
              </div>
              <p
                className="mt-0.5 text-[13px]"
                style={{ color: "var(--mini-text-muted)" }}
              >
                {eq.area.name}
              </p>
              {eq.tempMin != null && eq.tempMax != null ? (
                <div className="mt-2 flex items-center gap-2 text-[13px]">
                  <span style={{ color: "var(--mini-text-muted)" }}>Норма:</span>
                  <span
                    className="font-medium"
                    style={{ color: "var(--mini-text)" }}
                  >
                    {eq.tempMin}…{eq.tempMax}°C
                  </span>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
