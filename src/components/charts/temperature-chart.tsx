"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

/**
 * Полотно графика грузится по требованию: `recharts` весит 359 КБ
 * (107 КБ gzip) и при статическом импорте попадал в общий чанк карточек
 * дашборда — его качали и те организации, у которых нет ни одного
 * IoT-датчика и график никогда не рисуется.
 *
 * `ssr: false` — график всё равно рисуется только после загрузки точек
 * с `/api/charts/temperature`. Высота заглушки совпадает с высотой
 * графика (300px), чтобы карточка не прыгала.
 */
const TemperatureChartGraph = dynamic(
  () => import("./temperature-chart-graph").then((m) => m.TemperatureChartGraph),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[300px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface EquipmentItem {
  id: string;
  name: string;
  tuyaDeviceId: string | null;
}

interface TemperaturePoint {
  time: string;
  temperature: number;
  humidity: number | null;
}

interface ChartData {
  points: TemperaturePoint[];
  equipment: {
    name: string;
    tempMin: number | null;
    tempMax: number | null;
  };
}

type Period = "24h" | "7d" | "30d";

const PERIODS: Period[] = ["24h", "7d", "30d"];
const DATE_LOCALES: Record<string, string> = { ru: "ru-RU", en: "en-GB", uz: "uz-UZ" };

function formatTime(isoString: string, period: Period, locale: string): string {
  const date = new Date(isoString);
  const tag = DATE_LOCALES[locale] ?? "ru-RU";
  if (period === "24h") {
    return date.toLocaleTimeString(tag, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString(tag, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface TemperatureChartProps {
  equipmentList: EquipmentItem[];
}

export function TemperatureChart({ equipmentList }: TemperatureChartProps) {
  const t = useTranslations("sharedUi.temperatureChart");
  const locale = useLocale();
  const periodLabel = (key: Period) =>
    key === "24h" ? t("period24h") : key === "7d" ? t("period7d") : t("period30d");
  const connectedEquipment = equipmentList.filter(
    (eq) => eq.tuyaDeviceId != null
  );

  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string>(
    connectedEquipment[0]?.id ?? ""
  );
  const [period, setPeriod] = useState<Period>("24h");
  const [data, setData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasHumidity =
    data?.points.some((p) => p.humidity != null) ?? false;

  const fetchData = useCallback(async () => {
    if (!selectedEquipmentId) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/charts/temperature?equipmentId=${encodeURIComponent(selectedEquipmentId)}&period=${period}`
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error || t("loadFailed")
        );
      }

      const json: ChartData = await res.json();
      setData(json);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("loadFailed")
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedEquipmentId, period, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const chartPoints = data?.points.map((p) => ({
    ...p,
    time: formatTime(p.time, period, locale),
  }));

  if (connectedEquipment.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("noIotEquipment")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Controls */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Select
            value={selectedEquipmentId}
            onValueChange={setSelectedEquipmentId}
          >
            <SelectTrigger className="w-full sm:w-[260px]">
              <SelectValue placeholder={t("selectEquipment")} />
            </SelectTrigger>
            <SelectContent>
              {connectedEquipment.map((eq) => (
                <SelectItem key={eq.id} value={eq.id}>
                  {eq.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Tabs
            value={period}
            onValueChange={(v) => setPeriod(v as Period)}
          >
            <TabsList>
              {PERIODS.map((key) => (
                <TabsTrigger key={key} value={key}>
                  {periodLabel(key)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {/* Chart area */}
        {loading && (
          <div className="flex h-[300px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex h-[300px] items-center justify-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {!loading && !error && data && chartPoints && (
          <>
            {chartPoints.length === 0 ? (
              <div className="flex h-[300px] items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  {t("noData")}
                </p>
              </div>
            ) : (
              <TemperatureChartGraph
                points={chartPoints}
                hasHumidity={hasHumidity}
                tempMin={data.equipment.tempMin}
                tempMax={data.equipment.tempMax}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
