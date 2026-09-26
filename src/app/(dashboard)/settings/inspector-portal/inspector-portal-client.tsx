"use client";

import { useRef, useState } from "react";
import { Copy, ExternalLink, Loader2, Plus, Printer, QrCode, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { fileNameFromContentDisposition, saveBlob } from "@/lib/native-bridge";
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

import type {
  CabinetInspectorActivity,
  CabinetInspectorToken,
} from "@/lib/inspector-qr-service";

type TokenRow = CabinetInspectorToken;

type Props = {
  initialTokens: TokenRow[];
  initialActivity: CabinetInspectorActivity[];
};

const QR_TTL_OPTIONS: Array<{ value: "1d" | "7d" | "30d" | "forever"; label: string; hint: string }> = [
  { value: "1d", label: "1 день", hint: "на время визита" },
  { value: "7d", label: "7 дней", hint: "плановая проверка" },
  { value: "30d", label: "30 дней", hint: "проверка с доработками" },
  { value: "forever", label: "До отзыва", hint: "постоянный лист в зале" },
];

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

export function InspectorPortalClient({ initialTokens, initialActivity }: Props) {
  const [tokens, setTokens] = useState<TokenRow[]>(initialTokens);
  const [activity, setActivity] = useState<CabinetInspectorActivity[]>(initialActivity);
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
    if (data.activity) setActivity(data.activity);
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
    toast.success("Доступ отозван — QR и ссылка больше не открываются");
    refresh();
  }

  const [certOpen, setCertOpen] = useState(false);
  const activeQrs = tokens.filter((t) => t.isQr && t.inspectorUrl);

  return (
    <div className="space-y-5">
      <InspectorQrCard
        activeQrs={activeQrs}
        onCreated={(data) => {
          if (data.tokens) setTokens(data.tokens);
          if (data.activity) setActivity(data.activity);
        }}
        onRevoke={(id) => setTokenToRevoke(id)}
      />

      <VisitsCard activity={activity} tokens={tokens} />

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div>
          <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">Все доступы</h2>
          <p className="text-[13px] text-[#6f7282]">QR и разовые ссылки с фиксированным периодом.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          Разовая ссылка
        </Button>
        </div>
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
            ссылку для пересылки.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#ececf4] bg-white">
          <table className="w-full min-w-[720px] text-[13px]">
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
                      <span className="mr-2 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] text-[#3848c7]">
                        {t.isQr ? "QR" : "Ссылка"}
                      </span>
                      {t.label ?? <span className="text-[#9b9fb3]">без названия</span>}
                    </td>
                    <td className="px-4 py-3 text-[#3c4053]">
                      {t.isQr ? "Выбирает проверяющий" : `${fmtDate(t.periodFrom)} — ${fmtDate(t.periodTo)}`}
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
        // Закрытие окна создания НЕ трогает `created`: handleSubmit сначала
        // отдаёт ссылку наверх, потом закрывает окно — раньше второй вызов
        // тут же обнулял её, и окно «Ссылка создана» не показывалось.
        onOpenChange={setCreateOpen}
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
        title="Отозвать доступ для проверяющего?"
        description="QR-код и ссылка перестанут открываться сразу же."
        bullets={[
          { label: "По этому QR проверяющий увидит экран «Доступ отозван»", tone: "warn" },
          { label: "Распечатанный лист с этим QR больше не работает — снимите его", tone: "warn" },
          { label: "Вернуть доступ нельзя — понадобится выпустить новый QR", tone: "warn" },
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
              aria-busy={submitting}
              className="h-10 min-w-[112px] rounded-2xl bg-[#5566f6] px-5 text-white hover:bg-[#4a5bf0]"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Создать
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
  const urlInputRef = useRef<HTMLInputElement | null>(null);

  async function handleCopy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(data.inspectorUrl);
      toast.success("Ссылка скопирована");
    } catch {
      // Буфер обмена недоступен (WebView Telegram, http) — выделяем
      // текст в поле, чтобы человек скопировал его сам.
      const input = urlInputRef.current;
      if (input) {
        input.focus();
        input.select();
        input.setSelectionRange(0, input.value.length);
      }
      toast.info("Ссылка выделена — скопируйте её долгим нажатием");
    }
  }

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
            <div className="text-[12px] font-medium text-[#6f7282]">Ссылка</div>
            {/* Поле, а не текст: если буфер обмена недоступен (оболочка
                Telegram), ссылка остаётся выделенной — её копируют сами. */}
            <input
              ref={urlInputRef}
              readOnly
              value={data.inspectorUrl}
              onFocus={(event) => event.currentTarget.select()}
              className="mt-1 w-full rounded-xl border border-[#dcdfed] bg-white px-3 py-2 font-mono text-[13px] text-[#0b1024] outline-none transition-shadow focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-[12px] font-medium text-[#3848c7] transition-colors hover:bg-[#f5f6ff]"
              >
                <Copy className="size-3.5" />
                Скопировать ссылку
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
      // В браузере — скачивание, в приложении WeSetup — «Поделиться».
      await saveBlob(
        blob,
        fileNameFromContentDisposition(response.headers.get("content-disposition")) ??
          "certificate.pdf"
      );
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
            проверки. QR ведёт на действующий «QR для проверяющих» — новый
            доступ при каждом скачивании не создаётся. Если действующего QR
            нет, будет выпущен один, «до отзыва».
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

/**
 * «QR для проверяющих» — постоянный QR (схема не менялась: тот же
 * InspectorToken, «открытый период», токен выводится из id строки).
 * Превью и печать листа A4 — повторяемые, отзыв — через ConfirmDialog.
 */
function InspectorQrCard({
  activeQrs,
  onCreated,
  onRevoke,
}: {
  activeQrs: TokenRow[];
  onCreated: (data: { tokens?: TokenRow[]; activity?: CabinetInspectorActivity[] }) => void;
  onRevoke: (id: string) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const showForm = formOpen || activeQrs.length === 0;

  return (
    <section
      className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7"
      data-inspector-qr-card
    >
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <QrCode className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">QR для проверяющих</h2>
          <p className="mt-1 max-w-[640px] text-[13.5px] leading-relaxed text-[#6f7282]">
            Распечатайте лист с QR и отдайте проверяющему (или повесьте у входа).
            Скан открывает журналы без входа и PIN: проверяющий сам выбирает
            период за последние 12 месяцев и листает журналы как бумажные.
          </p>
        </div>
      </div>

      {activeQrs.map((t) => (
        <ActiveQrRow key={t.id} token={t} onRevoke={() => onRevoke(t.id)} />
      ))}

      {showForm ? (
        <CreateQrForm
          onCancel={activeQrs.length > 0 ? () => setFormOpen(false) : undefined}
          onCreated={(data) => {
            onCreated(data);
            setFormOpen(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          <Plus className="size-4 text-[#5566f6]" />
          Выпустить ещё один QR
        </button>
      )}
    </section>
  );
}

function ActiveQrRow({ token, onRevoke }: { token: TokenRow; onRevoke: () => void }) {
  async function copy() {
    if (!token.inspectorUrl) return;
    try {
      await navigator.clipboard.writeText(token.inspectorUrl);
      toast.success("Ссылка скопирована");
    } catch {
      toast.info(token.inspectorUrl);
    }
  }
  const forever = new Date(token.expiresAt).getTime() - new Date(token.createdAt).getTime() > 300 * 86_400_000;
  return (
    <div
      className="mt-5 grid gap-5 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 sm:grid-cols-[168px_1fr] sm:p-5"
      data-active-qr={token.id}
    >
      <div
        className="mx-auto w-[168px] rounded-2xl border border-[#dcdfed] bg-white p-3 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
        aria-label="QR-код для проверяющих"
        role="img"
        data-qr-svg
        // SVG строит сервер библиотекой qrcode из нашего же адреса — не пользовательский ввод.
        dangerouslySetInnerHTML={{ __html: token.qrSvg ?? "" }}
      />
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-[#0b1024]">
          {token.label || "QR для проверяющих"}
        </div>
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-[#6f7282]">Действует</dt>
            <dd className="text-[#0b1024]">{forever ? "до отзыва" : `до ${fmt(token.expiresAt)}`}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-[#6f7282]">Просмотров</dt>
            <dd className="tabular-nums text-[#0b1024]" data-access-count>
              {token.accessCount}
              {token.lastAccessedAt ? (
                <span className="text-[#9b9fb3]">, последний {fmt(token.lastAccessedAt)}</span>
              ) : null}
            </dd>
          </div>
        </dl>
        <input
          readOnly
          value={token.inspectorUrl ?? ""}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-3 w-full rounded-xl border border-[#dcdfed] bg-white px-3 py-2 font-mono text-[12px] text-[#3c4053] outline-none transition-shadow focus:ring-4 focus:ring-[#5566f6]/15"
          aria-label="Адрес QR"
          data-qr-url
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`/inspector-sheet/${token.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            data-print-sheet
          >
            <Printer className="size-4" />
            Печать листа A4
          </a>
          <a
            href={token.inspectorUrl ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            <ExternalLink className="size-4 text-[#5566f6]" />
            Как видит проверяющий
          </a>
          <button
            type="button"
            onClick={copy}
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            <Copy className="size-4 text-[#5566f6]" />
            Скопировать ссылку
          </button>
          <button
            type="button"
            onClick={onRevoke}
            className="inline-flex h-10 items-center gap-2 rounded-2xl px-3 text-[14px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#fff4f2]"
            data-revoke-qr
          >
            <ShieldX className="size-4" />
            Отозвать
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateQrForm({
  onCancel,
  onCreated,
}: {
  onCancel?: () => void;
  onCreated: (data: { tokens?: TokenRow[]; activity?: CabinetInspectorActivity[] }) => void;
}) {
  const [ttl, setTtl] = useState<(typeof QR_TTL_OPTIONS)[number]["value"]>("7d");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/settings/inspector-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "qr", ttl, label: label.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось создать QR");
      toast.success("QR для проверяющих создан — распечатайте лист A4");
      setLabel("");
      onCreated(data ?? {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-4 sm:p-5" data-create-qr>
      <div className="text-[13px] font-medium text-[#0b1024]">Срок действия QR</div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Срок действия QR">
        {QR_TTL_OPTIONS.map((o) => {
          const active = ttl === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTtl(o.value)}
              data-ttl={o.value}
              className={`flex flex-col items-start rounded-2xl border px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
                active
                  ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]"
                  : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              }`}
            >
              <span className="text-[14px] font-semibold">{o.label}</span>
              <span className="text-[12px] text-[#6f7282]">{o.hint}</span>
            </button>
          );
        })}
      </div>
      <Label htmlFor="qr-label" className="mt-4 block text-[13px] text-[#6f7282]">
        Заметка для себя (необязательно)
      </Label>
      <Input
        id="qr-label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={120}
        placeholder="Плановая проверка РПН"
        className="mt-1.5 h-11 rounded-2xl"
      />
      <p className="mt-2 text-[12.5px] text-[#6f7282]">
        После создания появится QR и кнопка печати листа A4. Лист можно
        печатать сколько угодно раз — QR не меняется, пока вы его не отзовёте.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={submit}
          disabled={submitting}
          aria-busy={submitting}
          className="h-11 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0]"
          data-create-qr-submit
        >
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
          Создать QR
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="h-11 rounded-2xl border-[#dcdfed] px-4"
          >
            Отмена
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function VisitsCard({ activity, tokens }: { activity: CabinetInspectorActivity[]; tokens: TokenRow[] }) {
  const labels = new Map(tokens.map((t) => [t.id, t.label || (t.isQr ? "QR" : "Ссылка")]));
  return (
    <section
      className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7"
      data-visits
    >
      <h2 className="text-[16px] font-semibold text-[#0b1024]">Последние просмотры</h2>
      <p className="mt-0.5 text-[13px] text-[#6f7282]">
        Что открывал проверяющий, когда и с какого адреса. Полный список — в журнале действий.
      </p>
      {activity.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-8 text-center text-[13px] text-[#6f7282]">
          Пока никто не открывал журналы по QR или ссылке.
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-[#ececf4]">
          {activity.map((a) => (
            <li key={a.id} className="grid gap-1 py-2.5 text-[13px] sm:grid-cols-[150px_1fr_auto] sm:gap-4" data-visit-row>
              <span className="tabular-nums text-[#6f7282]">{fmt(a.at)}</span>
              <span className="min-w-0 text-[#0b1024] [overflow-wrap:anywhere]">
                {a.what}
                {a.viewer ? <span className="text-[#3848c7]"> — {a.viewer}</span> : null}
              </span>
              <span className="text-[12px] text-[#9b9fb3]">
                {a.tokenId ? labels.get(a.tokenId) ?? "" : ""}
                {a.ip ? `, IP ${a.ip}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
