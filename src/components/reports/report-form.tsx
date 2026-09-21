"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FileDown, FileSpreadsheet, Loader2 } from "lucide-react";
import { isInsideTelegram } from "@/app/mini/_components/telegram-web-app";

interface Template {
  id: string;
  code: string;
  name: string;
}

interface Area {
  id: string;
  name: string;
}

interface ReportFormProps {
  templates: Template[];
  areas: Area[];
  /** YYYY-MM-DD — начало периода по умолчанию (30 дней по поясу организации). */
  defaultDateFrom?: string;
  defaultDateTo?: string;
}

type ReportKind = "pdf" | "excel";

function buildReportUrl(
  kind: ReportKind,
  args: { templateCode: string; dateFrom: string; dateTo: string; areaId: string },
  inline = false
): string {
  const params =
    kind === "pdf"
      ? new URLSearchParams({ template: args.templateCode, from: args.dateFrom, to: args.dateTo })
      : new URLSearchParams({ templateCode: args.templateCode, from: args.dateFrom, to: args.dateTo });
  if (args.areaId && args.areaId !== "__all__") {
    params.set(kind === "pdf" ? "area" : "areaId", args.areaId);
  }
  if (inline) params.set("inline", "1");
  return `/api/reports/${kind}?${params.toString()}`;
}

export function ReportForm({
  templates,
  areas,
  defaultDateFrom = "",
  defaultDateTo = "",
}: ReportFormProps) {
  const [templateCode, setTemplateCode] = useState("");
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [areaId, setAreaId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingExcel, setIsLoadingExcel] = useState(false);
  const [error, setError] = useState("");
  // Прямая ссылка на последний файл — запасной вариант, если браузер
  // (или WebView Telegram) не сохранил скачанный файл.
  const [fallbackLink, setFallbackLink] = useState<{ href: string; label: string } | null>(null);

  const validateFields = () => {
    if (!templateCode) { setError("Выберите журнал"); return false; }
    if (!dateFrom) { setError("Укажите дату начала"); return false; }
    if (!dateTo) { setError("Укажите дату окончания"); return false; }
    if (new Date(dateFrom) > new Date(dateTo)) {
      setError("Дата начала не может быть позже даты окончания");
      return false;
    }
    return true;
  };

  const download = async (kind: ReportKind) => {
    setError("");
    setFallbackLink(null);
    if (!validateFields()) return;
    const setBusy = kind === "pdf" ? setIsLoading : setIsLoadingExcel;
    setBusy(true);
    const args = { templateCode, dateFrom, dateTo, areaId };
    const extension = kind === "pdf" ? "pdf" : "xlsx";
    try {
      const response = await fetch(buildReportUrl(kind, args));
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Ошибка при формировании отчёта");
      }
      const inlineUrl = buildReportUrl(kind, args, true);
      setFallbackLink({
        href: inlineUrl,
        label: kind === "pdf" ? "Открыть PDF" : "Открыть файл Excel",
      });
      // В оболочке Telegram скачивание через a[download] + blob не
      // работает: WebView молча игнорирует такой клик. Открываем файл
      // переходом по ссылке в том же окне — сессия (cookie) сохраняется.
      // openLink не подходит: внешний браузер открылся бы без входа.
      if (isInsideTelegram()) {
        window.location.assign(inlineUrl);
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `report_${templateCode}_${dateFrom}_${dateTo}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка при формировании отчёта");
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = () => download("pdf");
  const handleDownloadExcel = () => download("excel");

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Сформировать отчёт</CardTitle>
        <CardDescription>
          Выберите журнал и период — выгрузка в PDF или Excel
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Template selector */}
          <div className="space-y-2">
            <Label>Журнал</Label>
            <Select value={templateCode} onValueChange={setTemplateCode}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Выберите журнал" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.code}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date from */}
          <div className="space-y-2">
            <Label>Дата начала</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>

          {/* Date to */}
          <div className="space-y-2">
            <Label>Дата окончания</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          {/* Area filter (optional) */}
          <div className="space-y-2">
            <Label>
              Участок{" "}
              <span className="text-muted-foreground font-normal">
                (необязательно)
              </span>
            </Label>
            <Select value={areaId} onValueChange={setAreaId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Все участки" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Все участки</SelectItem>
                {areas.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Error message */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {fallbackLink ? (
            <p className="text-[13px] text-[#6f7282]">
              Файл не скачался?{" "}
              <a
                href={fallbackLink.href}
                target="_blank"
                rel="noopener"
                className="font-medium text-[#3848c7] underline-offset-2 transition-colors hover:text-[#5566f6] hover:underline"
              >
                {fallbackLink.label}
              </a>
            </p>
          ) : null}

          {/* Submit buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleDownload}
              disabled={isLoading || isLoadingExcel}
              className="flex-1"
            >
              {isLoading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Формирование...
                </>
              ) : (
                <>
                  <FileDown className="size-4" />
                  Скачать PDF
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleDownloadExcel}
              disabled={isLoading || isLoadingExcel}
              className="flex-1"
            >
              {isLoadingExcel ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Формирование...
                </>
              ) : (
                <>
                  <FileSpreadsheet className="size-4" />
                  Скачать Excel
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
