"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { useTranslations } from "next-intl";

/**
 * Само полотно графика — вынесено из `temperature-chart.tsx`, чтобы
 * `recharts` (359 КБ / 107 КБ gzip) не лежал в общем чанке карточек
 * дашборда.
 *
 * Проблема была в том, что карточки дашборда собираются в одну
 * chunk-group: статический импорт recharts здесь означал, что библиотеку
 * качает КАЖДЫЙ, кто открыл /dashboard, — при том что график
 * отрисовывается только у организаций с IoT-датчиками (`iotEquipment.length > 0`),
 * то есть почти ни у кого.
 *
 * Родитель подключает этот модуль через `next/dynamic({ ssr: false })`,
 * поэтому здесь не должно быть ничего, кроме отрисовки.
 */

export type TemperatureGraphPoint = {
  time: string;
  temperature: number;
  humidity: number | null;
};

export function TemperatureChartGraph({
  points,
  hasHumidity,
  tempMin,
  tempMax,
}: {
  points: TemperatureGraphPoint[];
  hasHumidity: boolean;
  tempMin: number | null;
  tempMax: number | null;
}) {
  const t = useTranslations("sharedUi.temperatureChartGraph");
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={points} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="time" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 12 }} domain={["auto", "auto"]} unit="°C" />
        <Tooltip
          formatter={(value: unknown, name: unknown) => {
            const v = Number(value ?? 0);
            if (name === "temperature") return [`${v}°C`, t("temperature")];
            if (name === "humidity") return [`${v}%`, t("humidity")];
            return [v, String(name)];
          }}
        />

        {/* Temperature line */}
        <Line
          type="monotone"
          dataKey="temperature"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          name="temperature"
        />

        {/* Humidity line (optional) */}
        {hasHumidity && (
          <Line
            type="monotone"
            dataKey="humidity"
            stroke="#22c55e"
            strokeWidth={1.5}
            strokeDasharray="5 5"
            dot={false}
            activeDot={{ r: 3 }}
            name="humidity"
          />
        )}

        {/* Min temperature reference line */}
        {tempMin != null && (
          <ReferenceLine
            y={tempMin}
            stroke="#ef4444"
            strokeDasharray="6 4"
            label={{
              value: `min ${tempMin}°C`,
              position: "insideTopLeft",
              fill: "#ef4444",
              fontSize: 11,
            }}
          />
        )}

        {/* Max temperature reference line */}
        {tempMax != null && (
          <ReferenceLine
            y={tempMax}
            stroke="#ef4444"
            strokeDasharray="6 4"
            label={{
              value: `max ${tempMax}°C`,
              position: "insideBottomLeft",
              fill: "#ef4444",
              fontSize: 11,
            }}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
