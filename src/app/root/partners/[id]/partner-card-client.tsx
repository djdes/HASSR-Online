"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Crown, ExternalLink, Package, Pencil, RotateCcw, Truck, Unlink } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Card,
  EmptyState,
  Field,
  Pill,
  btnDanger,
  btnOutline,
  btnPrimary,
  formatDate,
  formatDateTime,
  formatMonth,
  formatRubFixed,
  inputClass,
  planLabel,
  readError,
} from "@/components/partner/ui";
import { PARTNER_ACCESS_LEVEL_LABELS, type PartnerAccessLevel } from "@/lib/partners/access-guard";
import type { getPartnerForAdmin } from "@/lib/partners/admin";
import { ACCRUAL_KIND_LABELS, ACCRUAL_STATUS_LABELS } from "@/lib/partners/rewards";
import { cn } from "@/lib/utils";

import { REVIEW_ACTION_LABELS, ReviewDialog, availableReviewActions, type ReviewAction } from "../review-dialog";
import {
  EditToggle,
  PartnerPayoutForm,
  PartnerProfileForm,
  PartnerRenameDialog,
  type PayoutInitial,
  type ProfileInitial,
} from "./partner-edit-forms";

type CardData = Awaited<ReturnType<typeof getPartnerForAdmin>>;
type ClientRow = CardData["clients"][number];
type OrderRow = CardData["orders"][number];

const STATUS_TONE: Record<string, "neutral" | "ok" | "warn" | "danger" | "indigo"> = {
  pending: "warn",
  active: "ok",
  rejected: "neutral",
  suspended: "danger",
};

const SOURCE_LABELS: Record<string, string> = {
  link: "по ссылке",
  code: "по коду",
  invite: "по приглашению",
  manual: "вручную",
  // Владелец сам перевёл свою организацию в клиенты (lib/partners/org-conversion.ts).
  converted: "переведена владельцем из личного аккаунта",
};

const DETACHED_BY_LABELS: Record<string, string> = {
  client: "клиентом",
  partner: "партнёром",
  admin: "администратором",
};

const INVITE_STATUS_LABELS: Record<string, string> = {
  sent: "отправлено",
  registered: "зарегистрировались",
  declined: "отказались",
  expired: "истекли",
};

const ACCRUAL_TONE: Record<string, "neutral" | "ok" | "warn" | "danger" | "indigo"> = {
  accrued: "neutral",
  payable: "indigo",
  paid: "ok",
};

function payoutDetailRows(raw: unknown): Array<[string, string]> {
  if (!raw || typeof raw !== "object") return [];
  const d = raw as Record<string, unknown>;
  const rows: Array<[string, string]> = [];
  const push = (label: string, key: string) => {
    const v = d[key];
    if (typeof v === "string" && v.trim()) rows.push([label, v]);
  };
  push("Получатель", "fullName");
  push("ИНН", "inn");
  push("Банк", "bank");
  push("БИК", "bik");
  push("Расчётный счёт", "account");
  push("Корр. счёт", "corrAccount");
  push("Комментарий", "comment");
  return rows;
}

/**
 * Реквизиты из JSON — в плоские поля формы. Пустые строки вместо
 * undefined: иначе управляемый input переключается на неуправляемый.
 */
function payoutFormValues(payoutType: string | null, raw: unknown): PayoutInitial {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (key: string) => (typeof d[key] === "string" ? (d[key] as string) : "");
  return {
    payoutType: payoutType ?? "ip",
    fullName: str("fullName"),
    inn: str("inn"),
    kpp: str("kpp"),
    ogrn: str("ogrn"),
    bank: str("bank"),
    bik: str("bik"),
    account: str("account"),
  };
}

export function PartnerCardClient({ data }: { data: CardData }) {
  const router = useRouter();
  const { partner: p, clients, members, accruals, balances, orders, invites } = data;
  const [review, setReview] = useState<{ partnerId: string; name: string; action: ReviewAction } | null>(null);
  // Анкета и реквизиты правятся по одной: открытые сразу обе формы
  // превращают карточку в сплошное поле ввода без ориентиров.
  const [editing, setEditing] = useState<"profile" | "payout" | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const refresh = () => router.refresh();
  const stopEditing = () => setEditing(null);
  const savedAndClose = () => {
    setEditing(null);
    refresh();
  };

  const profileInitial: ProfileInitial = {
    companyName: p.companyName,
    brandName: p.brandName,
    type: p.type,
    inn: p.inn,
    city: p.city,
    phone: p.phone,
    telegram: p.telegram ?? "",
    contactEmail: p.contactEmail,
    venuesCount: p.venuesCount,
    slug: p.slug,
  };
  const payoutInitial: PayoutInitial = payoutFormValues(p.payoutType, p.payoutDetails);

  const activeClients = clients.filter((c) => !c.detachedAt);
  const pastClients = clients.filter((c) => c.detachedAt);

  return (
    <div className="space-y-6">
      {/* Шапка */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[clamp(1.625rem,1.5vw+1.2rem,2rem)] font-semibold tracking-[-0.02em] text-[#0b1024]">
              {p.brandName || p.companyName}
            </h1>
            <Pill tone={STATUS_TONE[p.status] ?? "neutral"} className="text-[13px]">
              {p.statusLabel}
            </Pill>
            <Pill tone="indigo" className="text-[13px]">
              {p.typeLabel}
            </Pill>
          </div>
          <p className="mt-1 text-[14px] text-[#6f7282]">
            {p.brandName && p.brandName !== p.companyName ? `${p.companyName} · ` : ""}
            {p.city} · ИНН {p.inn} · заявка от {formatDateTime(p.createdAt)}
          </p>
          {p.reviewComment ? (
            <p className="mt-2 max-w-[720px] rounded-2xl bg-[#fff7ed] px-3.5 py-2 text-[13px] leading-[1.5] text-[#9a4a06]">
              Комментарий к решению ({formatDateTime(p.reviewedAt)}): {p.reviewComment}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnOutline} onClick={() => setRenameOpen(true)}>
            <Pencil className="size-4 text-[#5566f6]" />
            Переименовать
          </button>
          {availableReviewActions(p.status).map((action) => (
            <button
              key={action}
              type="button"
              className={action === "approve" || action === "reactivate" ? btnPrimary : action === "suspend" ? btnDanger : btnOutline}
              onClick={() => setReview({ partnerId: p.id, name: p.companyName, action })}
            >
              {REVIEW_ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      </div>

      {/* Баланс */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Начислено" value={formatRubFixed(balances.accrued)} hint="ждёт закрытия месяца" />
        <Stat label="К выплате" value={formatRubFixed(balances.payable)} hint="в ведомости" accent />
        <Stat label="Выплачено" value={formatRubFixed(balances.paid)} hint="за всё время" />
        <Stat label="Сторно" value={formatRubFixed(balances.reversed)} hint="возвраты платежей" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          {/* Реквизиты заявки */}
          <Card
            eyebrow="Заявка"
            title="Контакты и доступы"
            actions={
              <EditToggle
                editing={editing === "profile"}
                onToggle={() => setEditing(editing === "profile" ? null : "profile")}
              />
            }
          >
            {editing === "profile" ? (
              <PartnerProfileForm
                partnerId={p.id}
                initial={profileInitial}
                onSaved={savedAndClose}
                onCancel={stopEditing}
              />
            ) : (
            <>
            <dl className="grid gap-x-8 gap-y-2.5 text-[14px] sm:grid-cols-2">
              <Row label="Публичная ссылка">
                <a
                  href={p.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[#3848c7] hover:underline"
                >
                  {p.publicUrl.replace(/^https?:\/\//, "")} <ExternalLink className="size-3.5" />
                </a>
              </Row>
              <Row label="Код подключения">
                <code className="rounded bg-[#f4f5fb] px-1.5 py-0.5 text-[13px] tracking-[0.12em]">{p.code}</code>
              </Row>
              <Row label="Телефон">{p.phone}</Row>
              <Row label="Email">{p.contactEmail}</Row>
              <Row label="Telegram">{p.telegram ? `@${p.telegram.replace(/^@/, "")}` : "—"}</Row>
              <Row label="Объектов у клиентов">{p.venuesCount}</Row>
              <Row label="Заявитель">
                {p.applicantName || "—"}
                {p.applicantEmail ? <span className="text-[#6f7282]"> · {p.applicantEmail}</span> : null}
              </Row>
              <Row label="Организация заявителя">
                {p.applicantOrganizationId ? (
                  <Link href={`/root/organizations/${p.applicantOrganizationId}`} className="text-[#3848c7] hover:underline">
                    {p.applicantOrganizationName || "открыть"}
                  </Link>
                ) : (
                  "—"
                )}
              </Row>
            </dl>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Pill tone={p.onboardingDone ? "ok" : "neutral"}>
                {p.onboardingDone ? "онбординг пройден" : "онбординг не пройден"}
              </Pill>
              <Pill tone={p.payoutFilled ? "ok" : "neutral"}>
                {p.payoutFilled ? "реквизиты заполнены" : "реквизиты не заполнены"}
              </Pill>
              <Pill tone={p.agreementSigned ? "ok" : "neutral"}>
                {p.agreementSigned ? "договор подписан" : "договор не подписан"}
              </Pill>
            </div>
            </>
            )}
          </Card>

          {/* Клиенты */}
          <Card
            eyebrow="Клиенты"
            title={`Подключённые организации · ${activeClients.length}`}
            actions={
              pastClients.length ? <span className="text-[13px] text-[#6f7282]">отключённых: {pastClients.length}</span> : null
            }
          >
            {clients.length === 0 ? (
              <EmptyState
                title="Клиентов пока нет"
                hint="Клиенты подключаются по ссылке /p/<slug>, коду или email-приглашению из кабинета партнёра."
              />
            ) : (
              <ClientsTable partnerId={p.id} clients={clients} onChanged={refresh} />
            )}
          </Card>

          {/* Заказы клиентов */}
          <Card eyebrow="Платежи клиентов" title={`Оплаченные заказы · ${orders.length}`}>
            <p className="mb-4 text-[13px] leading-[1.55] text-[#6f7282]">
              Подписка и бонус начисляются автоматически при оплате. Оборудование из bundle — только после вашей
              отметки «отгружено» (15 % по правилам). Возврат сторнирует все начисления по заказу.
            </p>
            {orders.length === 0 ? (
              <p className="text-[14px] text-[#6f7282]">За время привязки клиенты ещё не платили.</p>
            ) : (
              <OrdersTable orders={orders} onChanged={refresh} />
            )}
          </Card>

          {/* Начисления */}
          <Card eyebrow="Вознаграждение" title={`Начисления · ${accruals.length}`}>
            {accruals.length === 0 ? (
              <p className="text-[14px] text-[#6f7282]">Начислений пока нет.</p>
            ) : (
              <div className="-mx-5 overflow-x-auto md:-mx-6">
                <table className="w-full min-w-[880px] text-[14px]">
                  <thead className="bg-[#f8f9fc] text-[12px] uppercase tracking-[0.08em] text-[#6f7282]">
                    <tr>
                      <th className="px-5 py-3 text-left font-medium md:px-6">Дата</th>
                      <th className="px-3 py-3 text-left font-medium">Клиент</th>
                      <th className="px-3 py-3 text-left font-medium">Вид</th>
                      <th className="px-3 py-3 text-right font-medium">База</th>
                      <th className="px-3 py-3 text-right font-medium">Ставка</th>
                      <th className="px-3 py-3 text-right font-medium">Сумма</th>
                      <th className="px-3 py-3 text-left font-medium">Период</th>
                      <th className="px-5 py-3 text-left font-medium md:px-6">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accruals.map((a) => (
                      <tr key={a.id} className="border-t border-[#f2f3f8]">
                        <td className="px-5 py-2.5 text-[#3c4053] md:px-6">{formatDate(a.date)}</td>
                        <td className="px-3 py-2.5 text-[#0b1024]">
                          {a.clientName}
                          {a.paymentOrderId ? <span className="text-[12px] text-[#9b9fb3]"> · заказ #{a.paymentOrderId}</span> : null}
                        </td>
                        <td className="px-3 py-2.5 text-[#3c4053]">{ACCRUAL_KIND_LABELS[a.kind]}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[#6f7282]">{formatRubFixed(a.baseAmountRub)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[#6f7282]">
                          {a.ratePercent === null ? "—" : `${a.ratePercent} %`}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right tabular-nums font-medium",
                            a.amountRub < 0 ? "text-[#a13a32]" : "text-[#0b1024]",
                          )}
                        >
                          {formatRubFixed(a.amountRub)}
                        </td>
                        <td className="px-3 py-2.5 text-[#3c4053]">
                          {formatMonth(a.periodMonth)}
                          <span className="text-[12px] text-[#9b9fb3]"> · v{a.ruleVersion}</span>
                        </td>
                        <td className="px-5 py-2.5 md:px-6">
                          <Pill tone={ACCRUAL_TONE[a.status] ?? "neutral"}>{ACCRUAL_STATUS_LABELS[a.status]}</Pill>
                          {a.status === "paid" && a.paidAt ? (
                            <div className="mt-0.5 text-[12px] text-[#6f7282]">
                              {formatDate(a.paidAt)}
                              {a.paidDocumentNo ? ` · ${a.paidDocumentNo}` : ""}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <AgreementCard partnerId={p.id} signed={p.agreementSigned} number={p.agreementNumber} signedAt={p.agreementSignedAt} onChanged={refresh} />

          <Card
            eyebrow="Выплаты"
            title="Реквизиты партнёра"
            actions={
              <EditToggle
                editing={editing === "payout"}
                onToggle={() => setEditing(editing === "payout" ? null : "payout")}
              />
            }
          >
            {editing === "payout" ? (
              <PartnerPayoutForm
                partnerId={p.id}
                initial={payoutInitial}
                onSaved={savedAndClose}
                onCancel={stopEditing}
              />
            ) : p.payoutTypeLabel ? (
              <>
                <Pill tone="indigo">{p.payoutTypeLabel}</Pill>
                <dl className="mt-3 space-y-1.5 text-[14px]">
                  {payoutDetailRows(p.payoutDetails).map(([label, value]) => (
                    <div key={label} className="flex gap-2">
                      <dt className="w-[128px] shrink-0 text-[#6f7282]">{label}</dt>
                      <dd className="min-w-0 break-words text-[#0b1024]">{value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <p className="text-[14px] text-[#6f7282]">
                Партнёр ещё не заполнил реквизиты в разделе «Вознаграждение». Без них выплата не оформляется.
              </p>
            )}
          </Card>

          <Card eyebrow="Команда" title={`Сотрудники партнёра · ${members.length}`}>
            <ul className="space-y-2">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-2.5 text-[14px]">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[13px] font-semibold text-[#3848c7]">
                    {(m.name || m.email || "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 font-medium text-[#0b1024]">
                      {m.name || m.email}
                      {m.role === "owner" ? <Crown className="size-3.5 text-[#d4a017]" /> : null}
                    </span>
                    <span className="block truncate text-[12px] text-[#6f7282]">{m.email}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card eyebrow="Приглашения" title="Email-приглашения">
            {Object.keys(invites).length === 0 ? (
              <p className="text-[14px] text-[#6f7282]">Партнёр ещё никого не приглашал по email.</p>
            ) : (
              <dl className="space-y-1.5 text-[14px]">
                {Object.entries(invites).map(([status, count]) => (
                  <div key={status} className="flex justify-between">
                    <dt className="text-[#6f7282]">{INVITE_STATUS_LABELS[status] ?? status}</dt>
                    <dd className="tabular-nums text-[#0b1024]">{count}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        </div>
      </div>

      <ReviewDialog
        target={review}
        onClose={() => setReview(null)}
        onDone={() => {
          setReview(null);
          refresh();
        }}
      />

      <PartnerRenameDialog
        partnerId={p.id}
        open={renameOpen}
        onOpenChange={setRenameOpen}
        initial={{ companyName: p.companyName, brandName: p.brandName ?? "" }}
        onSaved={refresh}
      />
    </div>
  );
}

/* ---------- мелкие блоки ---------- */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-[150px] shrink-0 text-[#6f7282]">{label}</dt>
      <dd className="min-w-0 break-words text-[#0b1024]">{children}</dd>
    </div>
  );
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-2xl border p-4", accent ? "border-[#5566f6]/30 bg-[#f5f6ff]" : "border-[#ececf4] bg-white")}>
      <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-[#6f7282]">{label}</div>
      <div className="mt-1 text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-[#0b1024]">{value}</div>
      {hint ? <div className="mt-0.5 text-[12px] text-[#6f7282]">{hint}</div> : null}
    </div>
  );
}

function AgreementCard({
  partnerId,
  signed,
  number,
  signedAt,
  onChanged,
}: {
  partnerId: string;
  signed: boolean;
  number: string | null;
  signedAt: string | null;
  onChanged: () => void;
}) {
  const [draftNumber, setDraftNumber] = useState(number ?? "");
  const [busy, setBusy] = useState(false);
  const [unsignOpen, setUnsignOpen] = useState(false);

  async function save(nextSigned: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/root/partners/${partnerId}/agreement`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signed: nextSigned, number: draftNumber.trim() || null }),
      });
      if (!res.ok) {
        toast.error(await readError(res, "Не удалось обновить договор"));
        return;
      }
      toast.success(nextSigned ? "Договор отмечен подписанным" : "Отметка о договоре снята");
      setUnsignOpen(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card eyebrow="Договор" title={signed ? "Подписан" : "Не подписан"}>
      {signed ? (
        <p className="text-[14px] leading-[1.55] text-[#3c4053]">
          {number ? <>№ {number} · </> : null}
          {formatDate(signedAt)}. Партнёр видит статус «договор подписан» в разделе «Вознаграждение».
        </p>
      ) : (
        <p className="text-[14px] leading-[1.55] text-[#6f7282]">
          Пока договор не подписан, партнёр видит предупреждение в кабинете, а выплата остаётся под вашу
          ответственность.
        </p>
      )}
      <div className="mt-3 space-y-3">
        <Field label="Номер договора" hint="Необязательно; попадёт в ведомость и в кабинет партнёра.">
          <input
            value={draftNumber}
            onChange={(e) => setDraftNumber(e.target.value)}
            maxLength={64}
            placeholder="ПП-2026/014"
            className={inputClass}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => save(true)}>
            {signed ? "Сохранить номер" : "Отметить подписанным"}
          </button>
          {signed ? (
            <button type="button" className={btnOutline} disabled={busy} onClick={() => setUnsignOpen(true)}>
              Снять отметку
            </button>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={unsignOpen}
        onClose={() => setUnsignOpen(false)}
        onConfirm={() => save(false)}
        title="Снять отметку о подписанном договоре?"
        description="Партнёр снова увидит предупреждение «договор не подписан». Начисления и клиенты не затрагиваются."
        confirmLabel="Снять отметку"
        variant="warn"
      />
    </Card>
  );
}

function ClientsTable({
  partnerId,
  clients,
  onChanged,
}: {
  partnerId: string;
  clients: ClientRow[];
  onChanged: () => void;
}) {
  const [detach, setDetach] = useState<ClientRow | null>(null);
  const [levelBusy, setLevelBusy] = useState<string | null>(null);

  /**
   * Уровень доступа консультанта. Нужен поддержке: клиент звонит
   * «консультант ничего не может заполнить», и переключить быстрее, чем
   * вести его по настройкам. Клиент получит то же уведомление, что и
   * при смене уровня самим партнёром.
   */
  async function setLevel(client: ClientRow, level: PartnerAccessLevel) {
    setLevelBusy(client.partnerClientId);
    try {
      const res = await fetch(`/api/root/partners/${partnerId}/clients/${client.organizationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessLevel: level }),
      });
      if (!res.ok) {
        toast.error(await readError(res, "Не удалось изменить уровень доступа"));
        return;
      }
      toast.success(
        level === "edit"
          ? `«${client.name}»: консультант может редактировать`
          : `«${client.name}»: консультанту оставлен только просмотр`,
      );
      onChanged();
    } finally {
      setLevelBusy(null);
    }
  }

  async function confirmDetach() {
    if (!detach) return;
    const res = await fetch(`/api/root/partners/${partnerId}/clients/${detach.organizationId}/detach`, { method: "POST" });
    if (!res.ok) {
      toast.error(await readError(res, "Не удалось отключить клиента"));
      return;
    }
    toast.success(`«${detach.name}» отключена от партнёра`);
    setDetach(null);
    onChanged();
  }

  return (
    <>
      <div className="-mx-5 overflow-x-auto md:-mx-6">
        <table className="w-full min-w-[880px] text-[14px]">
          <thead className="bg-[#f8f9fc] text-[12px] uppercase tracking-[0.08em] text-[#6f7282]">
            <tr>
              <th className="px-5 py-3 text-left font-medium md:px-6">Организация</th>
              <th className="px-3 py-3 text-left font-medium">Тариф</th>
              <th className="px-3 py-3 text-left font-medium">Доступ</th>
              <th className="px-3 py-3 text-left font-medium">Подключена</th>
              <th className="px-3 py-3 text-left font-medium">Первый платёж</th>
              <th className="px-5 py-3 text-right font-medium md:px-6"></th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.partnerClientId} className={cn("border-t border-[#f2f3f8] align-top", c.detachedAt && "opacity-60")}>
                <td className="px-5 py-3 md:px-6">
                  <Link href={`/root/organizations/${c.organizationId}`} className="font-medium text-[#0b1024] hover:text-[#3848c7]">
                    {c.name}
                  </Link>
                  {c.clientHidesBranding ? <div className="text-[12px] text-[#6f7282]">брендинг скрыт клиентом</div> : null}
                </td>
                <td className="px-3 py-3 text-[#3c4053]">
                  {planLabel(c.plan)}
                  {c.subscriptionEnd ? <div className="text-[12px] text-[#6f7282]">до {formatDate(c.subscriptionEnd)}</div> : null}
                </td>
                <td className="px-3 py-3">
                  {c.detachedAt ? (
                    <Pill tone={c.accessLevel === "edit" ? "indigo" : "neutral"}>
                      {PARTNER_ACCESS_LEVEL_LABELS[c.accessLevel as PartnerAccessLevel] ?? c.accessLevel}
                    </Pill>
                  ) : (
                    <select
                      value={c.accessLevel}
                      disabled={levelBusy === c.partnerClientId}
                      onChange={(e) => void setLevel(c, e.target.value as PartnerAccessLevel)}
                      className="h-8 rounded-xl border border-[#dcdfed] bg-white px-2 text-[13px] text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-50"
                    >
                      <option value="view">{PARTNER_ACCESS_LEVEL_LABELS.view}</option>
                      <option value="edit">{PARTNER_ACCESS_LEVEL_LABELS.edit}</option>
                    </select>
                  )}
                </td>
                <td className="px-3 py-3 text-[#3c4053]">
                  {formatDate(c.attachedAt)}
                  <div className="text-[12px] text-[#6f7282]">{SOURCE_LABELS[c.source] ?? c.source}</div>
                </td>
                <td className="px-3 py-3 text-[#3c4053]">{formatDate(c.firstPaymentAt)}</td>
                <td className="px-5 py-3 text-right md:px-6">
                  {c.detachedAt ? (
                    <span className="text-[12px] text-[#6f7282]">
                      отключена {formatDate(c.detachedAt)}
                      <br />
                      {DETACHED_BY_LABELS[c.detachedBy ?? ""] ?? ""}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={cn(btnOutline, "h-8 px-3 text-[13px] text-[#a13a32] hover:border-[#a13a32]/40 hover:bg-[#fff4f2]")}
                      onClick={() => setDetach(c)}
                    >
                      <Unlink className="size-3.5" /> Отключить
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={Boolean(detach)}
        onClose={() => setDetach(null)}
        onConfirm={confirmDetach}
        title={detach ? `Отключить «${detach.name}» от партнёра?` : ""}
        description="То же, что делает клиент кнопкой «Отключить консультанта» — но от имени администратора платформы."
        bullets={[
          { label: "Партнёр теряет доступ к кабинету клиента сразу", tone: "warn" },
          { label: "Брендинг клиента возвращается к стандартному WeSetup", tone: "warn" },
          { label: "Новые начисления по этому клиенту прекращаются; история сохраняется", tone: "default" },
          { label: "Партнёр получит уведомление об отключении", tone: "info" },
        ]}
        confirmLabel="Отключить"
        variant="danger"
      />
    </>
  );
}

function OrdersTable({ orders, onChanged }: { orders: OrderRow[]; onChanged: () => void }) {
  const [target, setTarget] = useState<{ order: OrderRow; action: "shipped" | "unshipped" | "refunded" } | null>(null);

  async function run() {
    if (!target) return;
    const res = await fetch(`/api/root/partners/orders/${target.order.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: target.action }),
    });
    if (!res.ok) {
      toast.error(await readError(res, "Не удалось обновить заказ"));
      return;
    }
    const data = (await res.json()) as { created: number };
    const done =
      target.action === "shipped"
        ? `Отгрузка отмечена, начислений создано: ${data.created}`
        : target.action === "unshipped"
          ? "Отметка об отгрузке снята"
          : `Возврат отмечен, сторно-строк: ${data.created}`;
    toast.success(done);
    setTarget(null);
    onChanged();
  }

  const meta =
    target?.action === "shipped"
      ? {
          title: `Отметить заказ #${target.order.id} отгруженным?`,
          description: `Партнёру начислится процент с оборудования на ${formatRubFixed(target.order.hardwareRub)} по текущим правилам.`,
          confirmLabel: "Отгружено",
          variant: "info" as const,
        }
      : target?.action === "unshipped"
        ? {
            title: `Снять отметку об отгрузке с заказа #${target.order.id}?`,
            description:
              "Возможно только пока по отгрузке нет начисления (например, отметили не тот заказ). Если начисление уже создано, система откажет — тогда оформляйте возврат.",
            confirmLabel: "Снять отметку",
            variant: "warn" as const,
          }
        : target
          ? {
              title: `Оформить возврат по заказу #${target.order.id}?`,
              description: `Все начисления по заказу на ${formatRubFixed(target.order.amountRub)} будут сторнированы отрицательными строками. Действие необратимо.`,
              confirmLabel: "Возврат",
              variant: "danger" as const,
            }
          : null;

  return (
    <>
      <div className="-mx-5 overflow-x-auto md:-mx-6">
        <table className="w-full min-w-[820px] text-[14px]">
          <thead className="bg-[#f8f9fc] text-[12px] uppercase tracking-[0.08em] text-[#6f7282]">
            <tr>
              <th className="px-5 py-3 text-left font-medium md:px-6">Заказ</th>
              <th className="px-3 py-3 text-left font-medium">Клиент</th>
              <th className="px-3 py-3 text-right font-medium">Сумма</th>
              <th className="px-3 py-3 text-right font-medium">Оборудование</th>
              <th className="px-3 py-3 text-left font-medium">Состояние</th>
              <th className="px-5 py-3 text-right font-medium md:px-6"></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t border-[#f2f3f8] align-top">
                <td className="px-5 py-3 md:px-6">
                  <span className="font-medium text-[#0b1024]">#{o.id}</span>
                  <div className="text-[12px] text-[#6f7282]">
                    {formatDate(o.paidAt)} · {o.tariffKey}
                  </div>
                </td>
                <td className="px-3 py-3 text-[#0b1024]">
                  {o.organizationId ? (
                    <Link href={`/root/organizations/${o.organizationId}`} className="hover:text-[#3848c7]">
                      {o.clientName}
                    </Link>
                  ) : (
                    o.clientName
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-[#0b1024]">{formatRubFixed(o.amountRub)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-[#3c4053]">
                  {o.hardwareRub > 0 ? formatRubFixed(o.hardwareRub) : <span className="text-[#9b9fb3]">—</span>}
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {o.refundedAt ? <Pill tone="danger">возврат {formatDate(o.refundedAt)}</Pill> : null}
                    {o.hardwareRub > 0 ? (
                      o.shippedAt ? (
                        <Pill tone="ok">отгружено {formatDate(o.shippedAt)}</Pill>
                      ) : (
                        <Pill tone="warn">ждёт отгрузки</Pill>
                      )
                    ) : null}
                    {!o.refundedAt && !(o.hardwareRub > 0) ? <Pill tone="ok">оплачен</Pill> : null}
                  </div>
                </td>
                <td className="px-5 py-3 text-right md:px-6">
                  {o.refundedAt ? null : (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {o.hardwareRub > 0 ? (
                        o.shippedAt ? (
                          <button
                            type="button"
                            className={cn(btnOutline, "h-8 px-3 text-[13px]")}
                            onClick={() => setTarget({ order: o, action: "unshipped" })}
                          >
                            <RotateCcw className="size-3.5 text-[#5566f6]" /> Снять отгрузку
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={cn(btnPrimary, "h-8 px-3 text-[13px]")}
                            onClick={() => setTarget({ order: o, action: "shipped" })}
                          >
                            <Truck className="size-3.5" /> Отгружено
                          </button>
                        )
                      ) : null}
                      <button
                        type="button"
                        className={cn(btnOutline, "h-8 px-3 text-[13px] text-[#a13a32] hover:border-[#a13a32]/40 hover:bg-[#fff4f2]")}
                        onClick={() => setTarget({ order: o, action: "refunded" })}
                      >
                        <Package className="size-3.5" /> Возврат
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={Boolean(target && meta)}
        onClose={() => setTarget(null)}
        onConfirm={run}
        title={meta?.title ?? ""}
        description={meta?.description}
        confirmLabel={meta?.confirmLabel}
        variant={meta?.variant ?? "default"}
        typeToConfirm={target?.action === "refunded" ? "ВОЗВРАТ" : undefined}
      />
    </>
  );
}
