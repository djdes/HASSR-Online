"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  MessageCircle,
  PencilLine,
  Phone,
  Search,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageGuide } from "@/components/ui/page-guide";
import {
  Card,
  Pill,
  btnDanger,
  btnOutline,
  btnPrimary,
  formatDate,
  inputClass,
  readError,
} from "@/components/partner/ui";
import { PARTNER_ACCESS_LEVEL_LABELS, type PartnerAccessLevel } from "@/lib/partners/access-guard";
import { phoneHref, telegramHref } from "@/lib/partners/consultant-contact-shared";
import { parseAttachInput } from "@/lib/partners/validation";
import { cn } from "@/lib/utils";

type Consultant = {
  partnerClientId: string;
  accessLevel: PartnerAccessLevel;
  clientHidesBranding: boolean;
  attachedAt: string;
  partnerStatus: string;
  partnerType: string;
  city: string | null;
  brandName: string;
  slug: string;
  logoUrl: string | null;
  supportPhone: string | null;
  supportTelegram: string | null;
  supportEmail: string | null;
  consultantLine: string | null;
  /** Партнёр скрыт от клиента — показываем нейтральную «Службу сопровождения». */
  hidden?: boolean;
};

type Preview = { slug: string; brandName: string; active: boolean; ownOrganization: boolean };

const LEVEL_OPTIONS: { value: PartnerAccessLevel; icon: typeof Eye; hint: string }[] = [
  { value: "view", icon: Eye, hint: "Видит журналы, отчёты и просрочки. Записи вносите вы." },
  { value: "edit", icon: PencilLine, hint: "Может заполнять журналы и настраивать их за вас." },
];

/**
 * Настройки → «Консультант»: подключить по ссылке/коду, сменить уровень
 * доступа, скрыть брендинг, отключить. Одна карточка — одно действие,
 * каждое с подсказкой «что произойдёт».
 */
export function ConsultantSettingsClient({
  initialAttachSlug,
  initialAttachLevel,
}: {
  initialAttachSlug: string | null;
  initialAttachLevel: PartnerAccessLevel;
}) {
  const [consultant, setConsultant] = useState<Consultant | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [detachOpen, setDetachOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/consultant", { cache: "no-store" });
    if (!res.ok) {
      toast.error(await readError(res, "Не удалось загрузить настройки консультанта"));
      setConsultant(null);
      return;
    }
    const data = (await res.json()) as { consultant: Consultant | null };
    setConsultant(data.consultant);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: Record<string, unknown>, key: string, okText: string) {
    setBusy(key);
    try {
      const res = await fetch("/api/settings/consultant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readError(res, "Не удалось сохранить"));
      const data = (await res.json()) as { consultant: Consultant | null };
      setConsultant(data.consultant);
      toast.success(okText);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setBusy(null);
    }
  }

  async function detach() {
    const res = await fetch("/api/settings/consultant", { method: "DELETE" });
    if (!res.ok) {
      toast.error(await readError(res, "Не удалось отключить консультанта"));
      return;
    }
    setDetachOpen(false);
    setConsultant(null);
    toast.success("Сопровождение отключено. Доступ консультанта закрыт.");
  }

  if (consultant === undefined) {
    return (
      <div className="flex items-center gap-2 rounded-3xl border border-[#ececf4] bg-white px-6 py-10 text-[14px] text-[#6f7282]">
        <Loader2 className="size-4 animate-spin text-[#5566f6]" />
        Загружаем…
      </div>
    );
  }

  if (!consultant) {
    return (
      <>
        <PageGuide
          storageKey="settings-consultant"
          title="Как это работает"
          bullets={[
            { title: "Подключение", body: "Консультант присылает ссылку вида wesetup.ru/p/название или 6-значный код. Вставьте сюда — увидите, кто это, и выберете доступ." },
            { title: "Уровень доступа", body: "«Только просмотр» — консультант видит, но не меняет. «Просмотр и редактирование» — может заполнять журналы за вас. Менять можно в любой момент; если уровень изменит сам консультант, вам придёт уведомление." },
            { title: "Что консультант не делает никогда", body: "Не платит и не меняет тариф, не удаляет организацию и не отключает сам себя. Все его действия видны в журнале действий с пометкой «партнёр», а отключить сопровождение можно в один клик." },
          ]}
        />
        <AttachCard initialSlug={initialAttachSlug} initialLevel={initialAttachLevel} onAttached={load} />
      </>
    );
  }

  const contacts = [
    consultant.supportPhone ? { icon: Phone, label: consultant.supportPhone, href: phoneHref(consultant.supportPhone) } : null,
    consultant.supportTelegram
      ? { icon: MessageCircle, label: consultant.supportTelegram, href: telegramHref(consultant.supportTelegram) }
      : null,
    consultant.supportEmail ? { icon: Mail, label: consultant.supportEmail, href: `mailto:${consultant.supportEmail}` } : null,
  ].filter((c): c is NonNullable<typeof c> => Boolean(c));
  const partnerActive = consultant.partnerStatus === "active";

  return (
    <div className="space-y-5">
      <Card eyebrow="Ваш консультант">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#ececf4] bg-[#fafbff] p-2">
            {consultant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={consultant.logoUrl} alt={consultant.brandName} className="max-h-full max-w-full object-contain" />
            ) : (
              <Building2 className="size-6 text-[#3848c7]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]">{consultant.brandName}</div>
              <Pill tone={partnerActive ? "ok" : "warn"}>{partnerActive ? "Сопровождает" : "Партнёр приостановлен"}</Pill>
              <Pill tone="indigo">{PARTNER_ACCESS_LEVEL_LABELS[consultant.accessLevel]}</Pill>
            </div>
            <div className="mt-1 text-[13px] text-[#6f7282]">
              {consultant.city ? `${consultant.city} · ` : ""}подключён {formatDate(consultant.attachedAt)}
            </div>
            {contacts.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[14px]">
                {contacts.map((c) => (
                  <a key={c.label} href={c.href} className="inline-flex items-center gap-1.5 text-[#0b1024] transition-colors hover:text-[#3848c7]">
                    <c.icon className="size-4 text-[#5566f6]" />
                    {c.label}
                  </a>
                ))}
              </div>
            ) : consultant.hidden ? (
              <div className="mt-3 text-[13px] text-[#6f7282]">Связь — через чат поддержки в правом нижнем углу.</div>
            ) : (
              <div className="mt-3 text-[13px] text-[#9b9fb3]">Консультант ещё не указал контакты.</div>
            )}
            {!partnerActive ? (
              <p className="mt-3 rounded-2xl bg-[#fff4f2] px-3 py-2 text-[13px] leading-[1.5] text-[#a13a32]">
                Партнёрство приостановлено платформой: консультант временно не видит ваш кабинет, брендинг не показывается.
                Связка сохранена — как только партнёра восстановят, всё вернётся.
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <Card
        eyebrow="Уровень доступа"
        title="Что консультант может делать в вашем кабинете"
      >
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Уровень доступа консультанта">
          {LEVEL_OPTIONS.map((opt) => {
            const active = consultant.accessLevel === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy !== null}
                onClick={() =>
                  !active &&
                  void patch(
                    { accessLevel: opt.value },
                    "level",
                    opt.value === "edit"
                      ? `${consultant.brandName} теперь может редактировать журналы`
                      : `${consultant.brandName} теперь только смотрит`,
                  )
                }
                className={cn(
                  "flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors duration-150 disabled:cursor-wait",
                  active
                    ? "border-[#5566f6] bg-[#f5f6ff] ring-4 ring-[#5566f6]/10"
                    : "border-[#dcdfed] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl",
                    active ? "bg-[#5566f6] text-white" : "bg-[#eef1ff] text-[#3848c7]",
                  )}
                >
                  <opt.icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-[#0b1024]">{PARTNER_ACCESS_LEVEL_LABELS[opt.value]}</span>
                  <span className="mt-0.5 block text-[12px] leading-[1.5] text-[#6f7282]">{opt.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 flex items-start gap-2 text-[12px] leading-[1.5] text-[#6f7282]">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[#116b2a]" />
          Смена уровня действует сразу. На любом уровне консультант не видит оплату и тариф и не удаляет
          организацию. Уровень он может изменить и сам — тогда вы получите уведомление, а событие попадёт в
          журнал; вернуть «только просмотр» или отключить консультанта можно здесь в один клик. Его действия
          попадают в{" "}
          <Link href="/settings/audit" className="text-[#3848c7] underline-offset-2 hover:underline">
            журнал действий
          </Link>{" "}
          с пометкой «{consultant.hidden ? "служба сопровождения" : "партнёр"}».
        </p>
      </Card>

      {consultant.hidden ? null : (
      <Card eyebrow="Оформление" title="Логотип и контакты консультанта в вашем кабинете">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[560px] text-[14px] leading-[1.55] text-[#3c4053]">
            Пока сопровождение включено, в шапке кабинета, на странице входа и в PDF показываются логотип и контакты{" "}
            {consultant.brandName}. Если хотите видеть только оформление WeSetup — выключите. Консультант при этом
            сохраняет доступ.
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void patch(
                { hideBranding: !consultant.clientHidesBranding },
                "branding",
                consultant.clientHidesBranding ? "Оформление консультанта снова показывается" : "Оформление консультанта скрыто",
              )
            }
            className={cn(btnOutline, "shrink-0")}
          >
            {consultant.clientHidesBranding ? <Eye className="size-4 text-[#5566f6]" /> : <EyeOff className="size-4 text-[#5566f6]" />}
            {consultant.clientHidesBranding ? "Показывать оформление" : "Скрыть оформление"}
          </button>
        </div>
      </Card>
      )}

      <Card eyebrow="Отключение" title="Прекратить сопровождение">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[560px] text-[14px] leading-[1.55] text-[#3c4053]">
            Доступ консультанта закроется сразу, оформление вернётся к WeSetup. Ваши журналы и записи, которые он
            вносил, останутся. Подключить консультанта снова можно в любой момент — по ссылке или коду.
          </p>
          <button type="button" onClick={() => setDetachOpen(true)} className={cn(btnDanger, "shrink-0")}>
            <Unplug className="size-4" />
            Отключить консультанта
          </button>
        </div>
      </Card>

      <ConfirmDialog
        open={detachOpen}
        onClose={() => setDetachOpen(false)}
        onConfirm={detach}
        variant="danger"
        title={`Отключить ${consultant.brandName}?`}
        description="Сопровождение прекратится немедленно."
        bullets={[
          { label: "Консультант потеряет доступ к кабинету в течение минуты", tone: "warn" },
          { label: "Логотип и контакты консультанта исчезнут из кабинета, PDF и писем" },
          { label: "Все журналы, записи и история действий сохраняются" },
          { label: "Консультант получит уведомление об отключении" },
        ]}
        confirmLabel="Отключить"
      />
    </div>
  );
}

function AttachCard({
  initialSlug,
  initialLevel,
  onAttached,
}: {
  initialSlug: string | null;
  initialLevel: PartnerAccessLevel;
  onAttached: () => Promise<void>;
}) {
  const [raw, setRaw] = useState(initialSlug ?? "");
  const [level, setLevel] = useState<PartnerAccessLevel>(initialLevel);
  const [preview, setPreview] = useState<Preview | null | "missing">(null);
  const [looking, setLooking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const parsed = useMemo(() => parseAttachInput(raw), [raw]);

  const lookup = useCallback(async () => {
    if (!parsed) {
      setPreview(null);
      return;
    }
    setLooking(true);
    try {
      const qs = "slug" in parsed ? `slug=${encodeURIComponent(parsed.slug)}` : `code=${encodeURIComponent(parsed.code)}`;
      const res = await fetch(`/api/partners/attach?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res, "Не удалось проверить партнёра"));
      const data = (await res.json()) as { partner: Preview | null };
      setPreview(data.partner ?? "missing");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось проверить партнёра");
      setPreview(null);
    } finally {
      setLooking(false);
    }
  }, [parsed]);

  // Пришли с /p/<slug> — сразу показываем, кого подключаем.
  useEffect(() => {
    if (initialSlug) void lookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSlug]);

  // Ввод меняется — прошлый предпросмотр больше не про него.
  useEffect(() => {
    setPreview((prev) => (prev && prev !== "missing" && parsed && "slug" in parsed && parsed.slug === prev.slug ? prev : null));
  }, [parsed]);

  const found = preview && preview !== "missing" ? preview : null;
  const canAttach = Boolean(found && found.active && !found.ownOrganization);

  async function attach() {
    if (!parsed) return;
    const res = await fetch("/api/partners/attach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...parsed, accessLevel: level }),
    });
    if (!res.ok) {
      toast.error(await readError(res, "Не удалось подключить консультанта"));
      return;
    }
    const data = (await res.json()) as { brandName: string };
    setConfirmOpen(false);
    toast.success(`${data.brandName} подключён как консультант`);
    await onAttached();
  }

  return (
    <Card eyebrow="Подключить консультанта" title="Ссылка или код партнёра">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup();
        }}
      >
        <input
          className={inputClass}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="wesetup.ru/p/название или код ABC234"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={!parsed || looking} className={cn(btnPrimary, "h-11 shrink-0")}>
          {looking ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Найти
        </button>
      </form>
      {raw.trim() && !parsed ? (
        <p className="mt-2 text-[12px] text-[#a13a32]">Похоже на опечатку: нужна ссылка wesetup.ru/p/… или код из 6 символов.</p>
      ) : (
        <p className="mt-2 text-[12px] text-[#6f7282]">Ссылку или код вам даёт консультант. Без него ничего подключать не нужно.</p>
      )}

      {preview === "missing" ? (
        <div className="mt-4 rounded-2xl border border-[#ececf4] bg-[#fff4f2] px-4 py-3 text-[14px] text-[#a13a32]">
          Партнёр с такой ссылкой или кодом не найден. Проверьте написание или уточните у консультанта.
        </div>
      ) : null}

      {found ? (
        <div className="mt-5 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
              <Building2 className="size-5" />
            </span>
            <div className="text-[16px] font-semibold text-[#0b1024]">{found.brandName}</div>
            <span className="text-[13px] text-[#6f7282]">wesetup.ru/p/{found.slug}</span>
            {!found.active ? <Pill tone="warn">Партнёр не активен</Pill> : null}
          </div>

          {found.ownOrganization ? (
            <p className="mt-3 text-[13px] leading-[1.5] text-[#a13a32]">
              Это ваша собственная партнёрская организация — она не может быть своим же клиентом.
            </p>
          ) : !found.active ? (
            <p className="mt-3 text-[13px] leading-[1.5] text-[#a13a32]">
              Партнёрство ещё не подтверждено или приостановлено. Подключить можно будет, когда партнёр станет активным.
            </p>
          ) : (
            <>
              <div className="mt-4 text-[13px] font-medium text-[#3c4053]">Какой доступ дать {found.brandName}?</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Уровень доступа консультанта">
                {LEVEL_OPTIONS.map((opt) => {
                  const active = level === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setLevel(opt.value)}
                      className={cn(
                        "flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors duration-150",
                        active
                          ? "border-[#5566f6] bg-white ring-4 ring-[#5566f6]/10"
                          : "border-[#dcdfed] bg-white hover:border-[#5566f6]/40",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl",
                          active ? "bg-[#5566f6] text-white" : "bg-[#eef1ff] text-[#3848c7]",
                        )}
                      >
                        <opt.icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[14px] font-medium text-[#0b1024]">
                          {PARTNER_ACCESS_LEVEL_LABELS[opt.value]}
                          {opt.value === "view" ? <span className="ml-1.5 text-[12px] font-normal text-[#6f7282]">по умолчанию</span> : null}
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-[1.5] text-[#6f7282]">{opt.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <button type="button" onClick={() => setConfirmOpen(true)} disabled={!canAttach} className={cn(btnPrimary, "mt-4")}>
                Подключить {found.brandName}
                <ArrowRight className="size-4" />
              </button>
            </>
          )}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={attach}
        variant="info"
        title={found ? `Подключить ${found.brandName}?` : "Подключить консультанта?"}
        description={`Уровень доступа: ${PARTNER_ACCESS_LEVEL_LABELS[level]}. Поменять можно в любой момент.`}
        bullets={[
          {
            label:
              level === "edit"
                ? "Консультант сможет заполнять журналы и менять их настройки"
                : "Консультант увидит журналы, отчёты и просрочки, но ничего не изменит",
          },
          { label: "В кабинете появятся логотип и контакты консультанта (можно скрыть)" },
          { label: "Оплата, тариф и удаление организации остаются только у вас" },
          { label: "Отключить сопровождение можно здесь же, в один клик" },
        ]}
        confirmLabel="Подключить"
      />
    </Card>
  );
}
