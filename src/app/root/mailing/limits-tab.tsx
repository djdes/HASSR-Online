"use client";

import { useEffect, useState } from "react";
import { Activity, Gauge, Loader2, Power } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import { humanMsk } from "@/lib/mailing/forecast";
import {
  GAP_HOURS_MAX,
  PER_DAY_MAX,
  PER_HOUR_MAX,
  PER_MINUTE_MAX,
  type MailingSettings,
} from "@/lib/mailing/rate-limit";
import type { WorkerHeartbeat } from "@/lib/mailing/settings.server";
import { cn } from "@/lib/utils";

import { CARD, Notice, PRIMARY, SECTION_LABEL, api } from "./ui";

export type SettingsSnapshot = {
  settings: MailingSettings;
  sentToday: number;
  sentLastMinute: number;
  sentThisHour: number;
  heartbeat: WorkerHeartbeat | null;
};

type NumberKey = Exclude<keyof MailingSettings, "enabled">;

const FIELDS: Array<{ key: NumberKey; label: string; hint: string; max: number; min: number }> = [
  { key: "perMinute", label: "Писем в минуту", hint: "Проход очереди — раз в минуту", min: 1, max: PER_MINUTE_MAX },
  { key: "perHour", label: "Писем в час", hint: "Часы — по Москве", min: 1, max: PER_HOUR_MAX },
  { key: "perDay", label: "Писем в сутки", hint: "Сутки — с 00:00 МСК", min: 1, max: PER_DAY_MAX },
  {
    key: "perDomainHour",
    label: "В час на один домен",
    hint: "mail.ru, yandex.ru… — ждёт только этот домен",
    min: 1,
    max: PER_HOUR_MAX,
  },
  {
    key: "gapHours",
    label: "Перерыв одному адресу, часов",
    hint: "Между разными рассылками; 0 — без перерыва",
    min: 0,
    max: GAP_HOURS_MAX,
  },
];

const HEARTBEAT_STALE_MS = 5 * 60_000;

/**
 * «Лимиты» — как вкладка лимитов рассылок YesBeat: выключатель обработки
 * очереди, скорость писем (в минуту, час, сутки, на домен) и перерыв между
 * рассылками одному адресу. Колокольчик, push и Telegram лимиты писем не
 * считают; выключатель и часы отправки действуют на все каналы.
 */
export function LimitsTab({
  snapshot,
  onSaved,
}: {
  snapshot: SettingsSnapshot;
  onSaved: (next: SettingsSnapshot) => void;
}) {
  const { settings } = snapshot;
  const [values, setValues] = useState<Record<NumberKey, string>>(() => toStrings(settings));
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => setValues(toStrings(settings)), [settings]);

  async function put(body: Partial<Record<keyof MailingSettings, unknown>>, done: string) {
    setBusy(true);
    try {
      const next = await api<SettingsSnapshot>("/api/root/mailing/settings", { method: "PUT", json: body });
      onSaved(next);
      toast.success(done);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function saveLimits() {
    const body: Partial<Record<NumberKey, number>> = {};
    for (const f of FIELDS) body[f.key] = Number(values[f.key]);
    void put(body, "Лимиты сохранены");
  }

  const dirty = FIELDS.some((f) => values[f.key] !== String(settings[f.key]));
  const beat = snapshot.heartbeat;
  const stale = !beat || new Date(beat.lastRunAt).getTime() < Date.now() - HEARTBEAT_STALE_MS;
  const leftToday = Math.max(0, settings.perDay - snapshot.sentToday);
  const leftHour = Math.max(0, settings.perHour - snapshot.sentThisHour);

  return (
    <div className="space-y-5" data-testid="mailing-limits-tab">
      <section className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-2xl",
                settings.enabled ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#fff4f2] text-[#a13a32]"
              )}
            >
              <Power className="size-5" />
            </span>
            <div>
              <div className="text-[16px] font-semibold text-[#0b1024]">Обрабатывать очередь рассылок</div>
              <p className="mt-0.5 max-w-[620px] text-[13px] leading-relaxed text-[#6f7282]">
                {settings.enabled
                  ? "Включено: рассылки уходят по лимитам ниже и в часы отправки каждой рассылки."
                  : "Выключено: ни одна рассылка не отправляется, получатели ждут в очереди. Тест себе работает."}{" "}
                Служебные письма (коды входа, счета) от выключателя не зависят.
              </p>
            </div>
          </div>
          <Switch
            checked={settings.enabled}
            disabled={busy}
            onCheckedChange={(on: boolean) => {
              if (on) void put({ enabled: true }, "Очередь включена — рассылки пойдут на ближайшем проходе");
              else setConfirmOff(true);
            }}
            aria-label="Обрабатывать очередь рассылок"
            data-testid="limits-queue-switch"
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]" data-testid="limits-heartbeat">
          <Activity className={cn("size-4", stale ? "text-[#a13a32]" : "text-[#116b2a]")} />
          {beat ? (
            <span className={stale ? "text-[#a13a32]" : "text-[#3c4053]"}>
              Обработчик очереди последний раз запускался {humanMsk(beat.lastRunAt)} МСК
              {stale ? " — больше 5 минут назад: проверьте cron /api/cron/mailing на сервере" : ""}
            </span>
          ) : (
            <span className="text-[#a13a32]">Обработчик очереди ещё ни разу не запускался — проверьте cron /api/cron/mailing</span>
          )}
        </div>
      </section>

      <section className={CARD}>
        <div className="mb-4 flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <Gauge className="size-5" />
          </span>
          <div>
            <div className="text-[16px] font-semibold text-[#0b1024]">Скорость отправки писем</div>
            <p className="mt-0.5 text-[13px] text-[#6f7282]" data-testid="sent-today">
              Сегодня отправлено <b className="tabular-nums text-[#0b1024]">{snapshot.sentToday}</b> из {settings.perDay}
              {leftToday === 0 ? " — суточный лимит исчерпан, остальные письма уйдут завтра" : ` · осталось ${leftToday}`}. В
              этом часе — <b className="tabular-nums text-[#0b1024]">{snapshot.sentThisHour}</b> из {settings.perHour}
              {leftHour === 0 ? " — ждём следующего часа" : ""}.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {FIELDS.map((f) => (
            <label key={f.key} className="block min-w-0">
              <span className="mb-1 block text-[12px] font-medium text-[#6f7282]">{f.label}</span>
              <input
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                inputMode="numeric"
                className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3 text-[15px] tabular-nums text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                data-testid={`limits-${f.key}`}
              />
              <span className="mt-1 block text-[12px] leading-snug text-[#9b9fb3]">
                {f.hint} · {f.min}–{f.max}
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[640px] text-[12px] leading-relaxed text-[#6f7282]">
            Работает меньший из лимитов. Колокольчик, push, Telegram и MAX письма не считают. Перерыв считается между
            разными рассылками на один адрес почты: письмо следующей ждёт его окончания, остальные каналы того же
            получателя ждут вместе с ним.
          </p>
          <button type="button" className={PRIMARY} disabled={busy || !dirty} onClick={saveLimits} data-testid="limits-save">
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Сохранить лимиты
          </button>
        </div>
      </section>

      <section className={CARD}>
        <div className={cn(SECTION_LABEL, "mb-3")}>Как работает очередь</div>
        <Notice tone="info" icon={<Activity />}>
          Очередь разбирается раз в минуту. У каждой рассылки свои часы отправки (по умолчанию 09:00–21:00 МСК) — они
          задаются при запуске; вне них получатели ждут утра. Почтовый домен, выбравший свой часовой лимит, ждёт следующего
          часа, письма на другие домены идут дальше. Причину ожидания каждого получателя видно в «Журнале» и в карточке
          рассылки.
        </Notice>
      </section>

      <ConfirmDialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        onConfirm={async () => {
          if (await put({ enabled: false }, "Очередь выключена — рассылки ждут")) setConfirmOff(false);
        }}
        variant="warn"
        title="Выключить обработку очереди?"
        description="Все рассылки перестанут отправляться, пока очередь снова не включат."
        bullets={[
          { label: "Уже отправленное не отзывается", tone: "info" },
          { label: "Запланированные стартуют, но будут ждать включения", tone: "warn" },
          { label: "Тест себе и служебные письма продолжают работать", tone: "info" },
        ]}
        confirmLabel="Выключить очередь"
      />
    </div>
  );
}

function toStrings(settings: MailingSettings): Record<NumberKey, string> {
  return {
    perMinute: String(settings.perMinute),
    perHour: String(settings.perHour),
    perDay: String(settings.perDay),
    perDomainHour: String(settings.perDomainHour),
    gapHours: String(settings.gapHours),
  };
}
