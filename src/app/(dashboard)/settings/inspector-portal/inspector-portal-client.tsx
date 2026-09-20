"use client";

import { useState } from "react";
import { Copy, ExternalLink, Loader2, Plus, ShieldX, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type TokenRow = {
  id: string;
  label: string | null;
  periodFrom: string;
  periodTo: string;
  expiresAt: string;
  lastAccessedAt: string | null;
  accessCount: number;
  revokedAt: string | null;
  createdAt: string;
};

type Props = {
  initialTokens: TokenRow[];
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function fmt(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function fmtDate(value: string): string {
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function InspectorPortalClient({ initialTokens }: Props) {
  const [tokens, setTokens] = useState<TokenRow[]>(initialTokens);
  const [createOpen, setCreateOpen] = useState(false);
  /** id ссылки, которую просят отозвать — окно подтверждения. */
  const [tokenToRevoke, setTokenToRevoke] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    rawToken: string;
    inspectorUrl: string;
  } | null>(null);

  async function refresh() {
    const response = await fetch("/api/settings/inspector-tokens");
    if (!response.ok) return;
    const data = await response.json();
    if (data.tokens) setTokens(data.tokens);
  }

  async function handleRevoke(id: string) {
    const response = await fetch(
      `/api/settings/inspector-tokens?id=${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      toast.error("Не удалось отозвать");
      return;
    }
    toast.success("Ссылка отозвана");
    refresh();
  }

  const [certOpen, setCertOpen] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setCertOpen(true)}
          className="h-10 rounded-lg border-0 bg-[#5566f6]/[0.04] px-4 text-[14px] font-semibold text-[#5566f6] hover:bg-[#5566f6]/[0.09]"
        >
          🏆 Сертификат соответствия
        </Button>
        <Button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="h-11 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0]"
        >
          <Plus className="size-4" />
          Создать ссылку
        </Button>
      </div>

      {certOpen ? (
        <CertificateDialog onClose={() => setCertOpen(false)} />
      ) : null}

      {tokens.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          <div className="text-[15px] font-medium text-[#0b1024]">
            Пока нет активных ссылок для инспектора
          </div>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] text-[#6f7282]">
            Создайте первую ссылку перед визитом контролёра — выберите
            период, на который инспектор должен видеть журналы, и получите
            URL для пересылки.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#ececf4] bg-white">
          <table className="w-full text-[13px]">
            <thead className="bg-[#fafbff] text-[12px] uppercase tracking-[0.06em] text-[#6f7282]">
              <tr>
                <th className="px-4 py-3 text-left">Назначение</th>
                <th className="px-4 py-3 text-left">Период</th>
                <th className="px-4 py-3 text-left">Действует до</th>
                <th className="px-4 py-3 text-left">Доступов</th>
                <th className="px-4 py-3 text-left">Статус</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ececf4]">
              {tokens.map((t) => {
                const isRevoked = Boolean(t.revokedAt);
                const isExpired = !isRevoked && new Date(t.expiresAt) < new Date();
                const isActive = !isRevoked && !isExpired;
                return (
                  <tr key={t.id}>
                    <td className="px-4 py-3 text-[#0b1024]">
                      {t.label ?? <span className="text-[#9b9fb3]">без названия</span>}
                    </td>
                    <td className="px-4 py-3 text-[#3c4053]">
                      {fmtDate(t.periodFrom)} — {fmtDate(t.periodTo)}
                    </td>
                    <td className="px-4 py-3 text-[#3c4053]">{fmt(t.expiresAt)}</td>
                    <td className="px-4 py-3 text-[#3c4053]">
                      {t.accessCount}
                      {t.lastAccessedAt ? (
                        <span className="ml-2 text-[12px] text-[#9b9fb3]">
                          ({fmt(t.lastAccessedAt)})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {isActive ? (
                        <span className="rounded-full bg-[#ecfdf5] px-2.5 py-1 text-[12px] text-[#116b2a]">
                          Активна
                        </span>
                      ) : isRevoked ? (
                        <span className="rounded-full bg-[#fff4f2] px-2.5 py-1 text-[12px] text-[#a13a32]">
                          Отозвана
                        </span>
                      ) : (
                        <span className="rounded-full bg-[#f3f4f6] px-2.5 py-1 text-[12px] text-[#6b7280]">
                          Просрочена
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isActive ? (
                        <button
                          type="button"
                          onClick={() => setTokenToRevoke(t.id)}
                          className="inline-flex items-center gap-1 rounded-xl px-2 py-1 text-[12px] text-[#a13a32] hover:bg-[#fff4f2]"
                        >
                          <ShieldX className="size-4" />
                          Отозвать
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateTokenDialog
        open={createOpen}
        onOpenChange={(value) => {
          if (!value) setCreated(null);
          setCreateOpen(value);
        }}
        onCreated={(payload) => {
          setCreated(payload);
          refresh();
        }}
      />

      {created ? (
        <SuccessDialog data={created} onClose={() => setCreated(null)} />
      ) : null}

      {/* Нативный confirm() в приложении Telegram может не показаться —
          кнопка тогда молча не срабатывает (CLAUDE.md §6). */}
      <ConfirmDialog
        open={tokenToRevoke !== null}
        onClose={() => setTokenToRevoke(null)}
        onConfirm={async () => {
          const id = tokenToRevoke;
          setTokenToRevoke(null);
          if (id) await handleRevoke(id);
        }}
        title="Отозвать ссылку для проверяющего?"
        description="Ссылка перестанет открываться сразу же."
        bullets={[
          { label: "Проверяющий больше не увидит журналы по этой ссылке", tone: "warn" },
          { label: "Вернуть ссылку нельзя — понадобится выпустить новую", tone: "warn" },
        ]}
        confirmLabel="Отозвать"
        cancelLabel="Отмена"
        variant="danger"
      />
    </div>
  );
}

function CreateTokenDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onCreated: (data: { rawToken: string; inspectorUrl: string }) => void;
}) {
  const [label, setLabel] = useState("");
  const [periodFrom, setPeriodFrom] = useState(daysAgo(30));
  const [periodTo, setPeriodTo] = useState(todayKey());
  const [ttlHours, setTtlHours] = useState(72);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const response = await fetch("/api/settings/inspector-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || undefined,
          periodFrom,
          periodTo,
          ttlHours,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? "Не удалось создать");
      }
      onCreated({ rawToken: data.rawToken, inspectorUrl: data.inspectorUrl });
      onOpenChange(false);
      setLabel("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-[18px]">
            Создать ссылку для инспектора
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[13px] text-[#6f7282]">
              Название (для своего списка)
            </Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Проверка СЭС 2026-04-30 / Иванова И.И."
              className="rounded-xl"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[13px] text-[#6f7282]">Период с</Label>
              <Input
                type="date"
                value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px] text-[#6f7282]">Период по</Label>
              <Input
                type="date"
                value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)}
                className="rounded-xl"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px] text-[#6f7282]">
              Срок действия ссылки (часов)
            </Label>
            <Input
              type="number"
              min={1}
              max={336}
              value={ttlHours}
              onChange={(e) => setTtlHours(Math.max(1, Math.min(336, Number(e.target.value) || 1)))}
              className="rounded-xl"
            />
            <p className="text-[12px] text-[#9b9fb3]">
              По умолчанию 72 ч. Максимум — 14 дней (336 ч).
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="h-10 rounded-2xl border-[#dcdfed] px-4"
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="h-10 rounded-2xl bg-[#5566f6] px-5 text-white hover:bg-[#4a5bf0]"
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Создать"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SuccessDialog({
  data,
  onClose,
}: {
  data: { rawToken: string; inspectorUrl: string };
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-[18px]">
            Ссылка создана
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#ffe7c0] bg-[#fff8eb] p-4 text-[13px] leading-relaxed text-[#7a4a00]">
            <strong>Скопируйте ссылку сейчас.</strong> После закрытия окна
            показать её повторно нельзя — придётся создавать новую.
          </div>
          <div className="rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4">
            <div className="text-[12px] font-medium text-[#6f7282]">URL</div>
            <div className="mt-1 break-all font-mono text-[13px] text-[#0b1024]">
              {data.inspectorUrl}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(data.inspectorUrl);
                  toast.success("URL скопирован");
                }}
                className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-[12px] font-medium text-[#3848c7] hover:bg-[#f5f6ff]"
              >
                <Copy className="size-3.5" />
                Скопировать URL
              </button>
              <a
                href={data.inspectorUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-[12px] font-medium text-[#3848c7] hover:bg-[#f5f6ff]"
              >
                <ExternalLink className="size-3.5" />
                Открыть в новой вкладке
              </a>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              onClick={onClose}
              className="h-10 rounded-2xl bg-[#5566f6] px-5 text-white hover:bg-[#4a5bf0]"
            >
              Готово
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Modal для генерации compliance-сертификата (PDF + QR на 90 дней).
 * Юзер выбирает период «за что отчитываемся», жмёт «Скачать PDF» —
 * браузер стартует загрузку файла. Никакого confirmation-state — open
 * tab с blob URL.
 */
function CertificateDialog({ onClose }: { onClose: () => void }) {
  const [periodFrom, setPeriodFrom] = useState(daysAgo(30));
  const [periodTo, setPeriodTo] = useState(todayKey());
  const [generating, setGenerating] = useState(false);

  async function generate() {
    setGenerating(true);
    try {
      // Open in new tab — browser handles download header.
      const url = `/api/certificate?from=${encodeURIComponent(periodFrom)}&to=${encodeURIComponent(periodTo)}`;
      const response = await fetch(url);
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Не удалось сформировать");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download =
        response.headers
          .get("content-disposition")
          ?.match(/filename\*?=(?:UTF-8'')?([^;]+)/)?.[1] ?? "certificate.pdf";
      a.click();
      URL.revokeObjectURL(objectUrl);
      toast.success("Сертификат скачан — печатайте на A4 и вешайте в зале");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-[18px]">
            🏆 Сертификат соответствия
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-[#6f7282]">
            PDF на A4 с уровнем соответствия за период и QR-кодом для
            проверки. Можно повесить в зале — гости и проверяющие
            сканируют QR со смартфона и видят live-журналы. QR
            действует <strong>90 дней</strong>.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[13px] text-[#6f7282]">За период с</Label>
              <Input
                type="date"
                value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px] text-[#6f7282]">по</Label>
              <Input
                type="date"
                value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)}
                className="rounded-xl"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={generating}
              className="h-10 rounded-2xl border-[#dcdfed] px-4"
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={generate}
              disabled={generating}
              className="h-10 rounded-2xl bg-[#5566f6] px-5 text-white hover:bg-[#4a5bf0]"
            >
              {generating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Скачать PDF"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
