"use client";

import { useState } from "react";
import { useLocale, useMessages, useTranslations } from "next-intl";
import { journalTitle } from "@/i18n/journal-presentation";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/i18n/locales";
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
import { saveBlob } from "@/lib/native-bridge";

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
  args: { templateCode: string; dateFrom: string; dateTo: string; areaId: string; locale: Locale },
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
  params.set("locale", args.locale);
  return `/api/reports/${kind}?${params.toString()}`;
}

export function ReportForm({
  templates,
  areas,
  defaultDateFrom = "",
  defaultDateTo = "",
}: ReportFormProps) {
  const locale = useLocale();
  const language = useTranslations("language");
  const t = useTranslations("reports");
  const journalNames = useMessages().journals.names;
  const [localeOverride, setLocaleOverride] = useState<Locale | null>(null);
  const exportLocale = localeOverride ?? locale;
  const [templateCode, setTemplateCode] = useState("");
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [areaId, setAreaId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingExcel, setIsLoadingExcel] = useState(false);
  const [error, setError] = useState("");
  // Прямая ссылка на последний файл — запасной вариант, если браузер
  // (или WebView Telegram) не сохранил скачанный файл.
  const [fallbackLink, setFallbackLink] = useState<{ href: string; kind: ReportKind } | null>(null);

  const validateFields = () => {
    if (!templateCode) { setError(t("errors.selectJournal")); return false; }
    if (!dateFrom) { setError(t("errors.dateFromRequired")); return false; }
    if (!dateTo) { setError(t("errors.dateToRequired")); return false; }
    if (new Date(dateFrom) > new Date(dateTo)) {
      setError(t("errors.dateOrderClient"));
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
    const args = { templateCode, dateFrom, dateTo, areaId, locale: exportLocale };
    const extension = kind === "pdf" ? "pdf" : "xlsx";
    try {
      const response = await fetch(buildReportUrl(kind, args));
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || t("errors.reportGeneration"));
      }
      const inlineUrl = buildReportUrl(kind, args, true);
      setFallbackLink({
        href: inlineUrl,
        kind,
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
      // В браузере — скачивание, в приложении WeSetup — «Поделиться».
      await saveBlob(blob, `report_${templateCode}_${dateFrom}_${dateTo}.${extension}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.reportGeneration"));
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = () => download("pdf");
  const handleDownloadExcel = () => download("excel");

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>{t("form.title")}</CardTitle>
        <CardDescription>
          {t("form.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="report-locale">{language("exportLabel")}</Label>
            <Select value={exportLocale} onValueChange={(value) => setLocaleOverride(value as Locale)}>
              <SelectTrigger id="report-locale" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LOCALES.map((value) => <SelectItem key={value} value={value}>{LOCALE_NAMES[value]}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[13px] text-muted-foreground">{language("exportHint")}</p>
          </div>
          {/* Template selector */}
          <div className="space-y-2">
            <Label>{t("form.journal")}</Label>
            <Select value={templateCode} onValueChange={setTemplateCode}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("form.selectJournal")} />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.code}>
                    {journalTitle(locale, journalNames, t.code, t.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date from */}
          <div className="space-y-2">
            <Label>{t("form.dateFrom")}</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>

          {/* Date to */}
          <div className="space-y-2">
            <Label>{t("form.dateTo")}</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          {/* Area filter (optional) */}
          <div className="space-y-2">
            <Label>
              {t("form.area")} {" "}
              <span className="text-muted-foreground font-normal">
                ({t("form.optional")})
              </span>
            </Label>
            <Select value={areaId} onValueChange={setAreaId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("form.allAreas")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("form.allAreas")}</SelectItem>
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
              {t.rich("form.fileNotDownloaded", {
                label: fallbackLink.kind === "pdf" ? t("form.openPdf") : t("form.openExcel"),
                link: (chunks) => (
                  <a
                    href={fallbackLink.href}
                    target="_blank"
                    rel="noopener"
                    className="font-medium text-[#3848c7] underline-offset-2 transition-colors hover:text-[#5566f6] hover:underline"
                  >
                    {chunks}
                  </a>
                ),
              })}
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
                  {t("form.generating")}
                </>
              ) : (
                <>
                  <FileDown className="size-4" />
                  {t("form.downloadPdf")}
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
                  {t("form.generating")}
                </>
              ) : (
                <>
                  <FileSpreadsheet className="size-4" />
                  {t("form.downloadExcel")}
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
