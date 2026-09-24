"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Eye,
  ExternalLink,
  Minus,
  Search,
} from "lucide-react";
import type { OrgMetrics } from "@/lib/org-metrics";
import { ownershipLabel, sphereLabel } from "@/lib/org-profile";
import { ActivityDrawer } from "./activity-drawer";
import { OrgRowActions } from "@/app/root/organizations/org-row-actions";

/**
 * Таблица организаций в метриках платформы.
 *
 * Клиентский компонент, потому что сортировка и поиск обязаны работать
 * без похода на сервер: организации уже все пришли одним запросом,
 * гонять round-trip ради переупорядочивания незачем.
 */

type SortKey =
  | "organizationName"
  | "ownerEmail"
  | "ownerRegistrationIp"
  | "sphere"
  | "locationsCount"
  | "inn"
  | "createdAt"
  | "subscriptionPlan"
  | "activeUsers"
  | "documentsCount"
  | "entries7d"
  | "weeklyTrendPct"
  | "lastEntryAt"
  | "actualMrrRub"
  | "balanceRub";

type SortDir = "asc" | "desc";

const COLUMNS: {
  key: SortKey;
  label: string;
  align: "left" | "center" | "right";
}[] = [
  { key: "organizationName", label: "Организация", align: "left" },
  { key: "ownerEmail", label: "Email владельца", align: "left" },
  { key: "ownerRegistrationIp", label: "IP", align: "left" },
  { key: "sphere", label: "Сфера", align: "left" },
  { key: "inn", label: "ИНН", align: "left" },
  { key: "locationsCount", label: "Точек", align: "right" },
  { key: "createdAt", label: "Регистрация", align: "right" },
  { key: "subscriptionPlan", label: "Тариф", align: "center" },
  { key: "activeUsers", label: "Сотрудники", align: "right" },
  { key: "documentsCount", label: "Документы", align: "right" },
  { key: "entries7d", label: "Записи 7д", align: "right" },
  { key: "weeklyTrendPct", label: "Trend", align: "right" },
  { key: "lastEntryAt", label: "Last activity", align: "right" },
  { key: "actualMrrRub", label: "MRR ₽", align: "right" },
  { key: "balanceRub", label: "Баланс ₽", align: "right" },
];

/** «ООО · Кафе» — форма собственности и сфера одной строкой. */
function sphereText(m: OrgMetrics): string {
  return [
    m.ownershipKind ? ownershipLabel(m.ownershipKind) : null,
    sphereLabel(m.type),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Значение для сравнения. null уезжает в конец при любом направлении. */
function sortValue(m: OrgMetrics, key: SortKey): string | number | null {
  switch (key) {
    case "organizationName":
      return m.organizationName.toLowerCase();
    case "ownerEmail":
      return m.ownerEmail ? m.ownerEmail.toLowerCase() : null;
    case "ownerRegistrationIp":
      return ipSortKey(m.ownerRegistrationIp ?? m.ownerLastLoginIp);
    case "createdAt":
      return new Date(m.createdAt).getTime();
    case "subscriptionPlan":
      return m.subscriptionPlan;
    case "sphere":
      return sphereText(m).toLowerCase();
    case "inn":
      // Пустой ИНН уезжает в конец, а не притворяется нулём.
      return m.inn ? m.inn : null;
    case "lastEntryAt":
      return m.lastEntryAt ? new Date(m.lastEntryAt).getTime() : null;
    default:
      return m[key] as number | null;
  }
}

export function MetricsTable({
  rows,
  now,
}: {
  rows: OrgMetrics[];
  /// Момент отрисовки приходит с сервера: Date.now() прямо в рендере —
  /// нечистая функция, она разъезжается между SSR и гидратацией и ломает
  /// правило react-hooks/purity.
  now: number;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("actualMrrRub");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Какую организацию раскрыли в панели активности. Держим id и название:
  // название нужно в шапке панели сразу, до ответа сервера.
  const [openOrg, setOpenOrg] = useState<{ id: string; name: string } | null>(
    null,
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rows.filter(
          (m) =>
            m.organizationName.toLowerCase().includes(q) ||
            (m.ownerEmail ?? "").toLowerCase().includes(q) ||
            (m.ownerRegistrationIp ?? "").includes(q) ||
            (m.ownerLastLoginIp ?? "").includes(q) ||
            m.type.toLowerCase().includes(q) ||
            // ИНН и форма собственности — колонки есть, значит и искать
            // по ним человек будет.
            (m.inn ?? "").includes(q) ||
            sphereText(m).toLowerCase().includes(q) ||
            m.subscriptionPlan.toLowerCase().includes(q),
        )
      : rows;

    return [...filtered].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      // Пустые значения всегда внизу — иначе «никогда» и организации без
      // владельца забивают верх при сортировке по возрастанию.
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), "ru");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    // Числа интереснее сверху вниз, текст — от А до Я.
    const isText =
      key === "organizationName" ||
      key === "ownerEmail" ||
      key === "ownerRegistrationIp" ||
      key === "subscriptionPlan";
    setSortDir(isText ? "asc" : "desc");
  }

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef0f6] px-5 py-4">
        <label className="relative flex-1 sm:max-w-[420px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по названию, почте, IP, ИНН, сфере, тарифу"
            className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white pl-10 pr-4 text-[14px] text-[#0b1024] outline-none transition-colors placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </label>
        <div className="text-[13px] tabular-nums text-[#6f7282]">
          {query
            ? `Найдено ${visible.length} из ${rows.length}`
            : `Всего ${rows.length}`}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1560px] text-[14px]">
          <thead className="bg-[#fafbff] text-[12px] uppercase tracking-wider text-[#6f7282]">
            <tr>
              {COLUMNS.map((c) => {
                const active = sortKey === c.key;
                const Icon = !active
                  ? ChevronsUpDown
                  : sortDir === "asc"
                    ? ArrowUp
                    : ArrowDown;
                return (
                  <th
                    key={c.key}
                    className={`px-5 py-3 font-medium ${
                      c.align === "left"
                        ? "text-left"
                        : c.align === "center"
                          ? "text-center"
                          : "text-right"
                    }`}
                    aria-sort={
                      active
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      title="Сортировать"
                      className={`inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 uppercase tracking-wider transition-colors hover:text-[#3848c7] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]/40 ${
                        active ? "text-[#3848c7]" : ""
                      } ${c.align === "right" ? "flex-row-reverse" : ""}`}
                    >
                      <Icon className={active ? "size-3.5" : "size-3.5 opacity-40"} />
                      {c.label}
                    </button>
                  </th>
                );
              })}
              <th className="px-5 py-3 text-right font-medium">
                <span className="sr-only">Действия</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length + 1}
                  className="px-5 py-12 text-center text-[#6f7282]"
                >
                  {rows.length === 0
                    ? "Пока нет организаций."
                    : "Ничего не нашлось. Попробуйте другую часть адреса."}
                </td>
              </tr>
            ) : null}
            {visible.map((m) => {
              const lastActivity = m.lastEntryAt
                ? formatRelative(new Date(m.lastEntryAt), now)
                : "никогда";
              const isStale =
                !m.lastEntryAt ||
                now - new Date(m.lastEntryAt).getTime() >
                  14 * 24 * 60 * 60 * 1000;
              return (
                <tr
                  key={m.organizationId}
                  className="group/row border-t border-[#eef0f6] transition-colors hover:bg-[#fafbff]"
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/root/organizations/${m.organizationId}`}
                      className="text-[#0b1024] hover:text-[#3848c7]"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{m.organizationName}</span>
                        {m.isDemo ? (
                          // Демо-песочница владельца: данные тестовые, в MRR
                          // не входит, удалится сама — чтобы ROOT не принял
                          // её за живого клиента.
                          <span className="inline-flex items-center rounded-full bg-[#eef1ff] px-2.5 py-0.5 text-[12px] font-medium text-[#3848c7]">
                            Демо
                            {m.demoExpiresAt
                              ? ` · до ${new Date(m.demoExpiresAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}`
                              : ""}
                          </span>
                        ) : null}
                        {m.isDirectory ? (
                          // Служебный кабинет бэк-офиса пула служебного кода:
                          // только меню и сырьё, журналов и оплаты нет.
                          <span className="inline-flex items-center rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[12px] font-medium text-[#3848c7]">
                            Мастер-кабинет
                          </span>
                        ) : null}
                      </div>
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    {m.ownerEmail ? (
                      <a
                        href={`mailto:${m.ownerEmail}`}
                        className="text-[13px] text-[#3848c7] hover:underline"
                      >
                        {m.ownerEmail}
                      </a>
                    ) : (
                      <span className="text-[13px] text-[#9b9fb3]">
                        нет пользователей
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <OwnerIpCell
                      registrationIp={m.ownerRegistrationIp}
                      lastLoginIp={m.ownerLastLoginIp}
                      lastLoginAt={m.ownerLastLoginAt}
                    />
                  </td>
                  <td className="px-5 py-3 text-[13px] text-[#3c4053]">
                    {sphereText(m) || "—"}
                  </td>
                  <td className="px-5 py-3 text-[13px] tabular-nums text-[#3c4053]">
                    {m.inn || "—"}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {m.locationsCount > 1 ? (
                      // Больше одной точки — сеть: с 2026-09-05 анкета
                      // заводит точки и включает раздельные журналы.
                      // Подсвечиваем, чтобы такие организации были на виду.
                      <span className="inline-flex items-center rounded-full bg-[#fff3ed] px-2.5 py-0.5 text-[13px] font-medium text-[#b45309]">
                        {m.locationsCount}
                      </span>
                    ) : (
                      <span className="text-[#6f7282]">
                        {m.locationsCount || 1}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right text-[13px] tabular-nums text-[#3c4053]">
                    {new Date(m.createdAt).toLocaleDateString("ru-RU")}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <PlanPill plan={m.subscriptionPlan} />
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {m.activeUsers}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-[#3c4053]">
                    {m.documentsCount}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {/* Цифра отвечает «сколько», но не «что»: одна и та же
                        стоит у организации с восемью журналами и у той, где
                        одна уборщица отмечается в одном. Клик раскрывает
                        разбивку и ленту. */}
                    <button
                      type="button"
                      onClick={() =>
                        setOpenOrg({
                          id: m.organizationId,
                          name: m.organizationName,
                        })
                      }
                      title="Посмотреть, что заполняют"
                      className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 tabular-nums transition-colors hover:bg-[#eef1ff] hover:text-[#3848c7] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]/40"
                    >
                      {m.entries7d}
                      <span className="text-[12px] text-[#9b9fb3]">
                        / {m.entries30d} за 30
                      </span>
                      <Eye className="size-3.5 opacity-0 transition-opacity group-hover/row:opacity-60" />
                    </button>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <TrendBadge value={m.weeklyTrendPct} />
                  </td>
                  <td
                    className={`px-5 py-3 text-right text-[13px] ${
                      isStale ? "text-[#a13a32]" : "text-[#3c4053]"
                    }`}
                  >
                    {lastActivity}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {m.actualMrrRub > 0 ? (
                      <span className="font-semibold text-[#0b1024]">
                        {m.actualMrrRub.toLocaleString("ru-RU")}
                      </span>
                    ) : (
                      <span className="text-[#9b9fb3]">
                        {m.potentialMrrRub > 0
                          ? `(${m.potentialMrrRub.toLocaleString("ru-RU")})`
                          : "—"}
                      </span>
                    )}
                  </td>
                  {/* Баллы — обязательство платформы: их потратят вместо
                      денег при следующей оплате. Ноль не подсвечиваем. */}
                  <td className="px-5 py-3 text-right tabular-nums">
                    {m.balanceRub > 0 ? (
                      <span className="font-medium text-[#3848c7]">
                        {m.balanceRub.toLocaleString("ru-RU")}
                      </span>
                    ) : (
                      <span className="text-[#9b9fb3]">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {/* Удаление прямо из метрик: мусорные регистрации
                        видно именно здесь — по нулевой активности, — и
                        уходить ради этого в список организаций незачем. */}
                    <OrgRowActions
                      organizationId={m.organizationId}
                      organizationName={m.organizationName}
                      usersCount={m.activeUsers}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openOrg ? (
        <ActivityDrawer
          organizationId={openOrg.id}
          organizationName={openOrg.name}
          onClose={() => setOpenOrg(null)}
        />
      ) : null}
    </section>
  );
}

function PlanPill({ plan }: { plan: string }) {
  const styles: Record<string, { bg: string; fg: string }> = {
    trial: { bg: "#fff8eb", fg: "#7a4a00" },
    paid: { bg: "#ecfdf5", fg: "#116b2a" },
    pro: { bg: "#eef1ff", fg: "#3848c7" },
  };
  const s = styles[plan] ?? { bg: "#f5f6ff", fg: "#6f7282" };
  return (
    <span
      className="inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {plan}
    </span>
  );
}

function TrendBadge({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-[12px] text-[#9b9fb3]">—</span>;
  }
  const Icon = value > 5 ? ArrowUp : value < -5 ? ArrowDown : Minus;
  const fg = value > 5 ? "#116b2a" : value < -5 ? "#a13a32" : "#6f7282";
  return (
    <span
      className="inline-flex items-center gap-1 text-[13px] font-medium tabular-nums"
      style={{ color: fg }}
    >
      <Icon className="size-3.5" />
      {value > 0 ? "+" : ""}
      {value}%
    </span>
  );
}

function formatRelative(date: Date, now: number): string {
  const diff = now - date.getTime();
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours < 1) return "только что";
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} дн назад`;
  const months = Math.floor(days / 30);
  return `${months} мес назад`;
}

/**
 * Ключ сортировки для IP. Лексикографически «10.0.0.2» стоит раньше
 * «9.9.9.9», поэтому октеты IPv4 добиваем нулями до трёх знаков —
 * тогда обычное сравнение строк совпадает с числовым. IPv6 и мусор
 * возвращаем как есть: их мало, и точный порядок между ними неважен.
 */
function ipSortKey(ip: string | null): string | null {
  if (!ip) return null;
  const parts = ip.split(".");
  if (parts.length !== 4) return ip;
  const padded = parts.map((p) => p.padStart(3, "0"));
  return padded.every((p) => /^\d{3}$/.test(p)) ? padded.join(".") : ip;
}

/**
 * IP владельца: адрес регистрации и адрес последнего входа. Совпадают
 * они чаще всего, поэтому одинаковые схлопываем в одну строку — иначе
 * колонка на весь список выглядит как дубли.
 */
function OwnerIpCell({
  registrationIp,
  lastLoginIp,
  lastLoginAt,
}: {
  registrationIp: string | null;
  lastLoginIp: string | null;
  lastLoginAt: string | null;
}) {
  if (!registrationIp && !lastLoginIp) {
    // Не молчим прочерком: у ROOT'а возникает законный вопрос «почему
    // пусто». Адрес пишется только при входе, а колонки появились
    // 26.08.2026 — у всех, кто с тех пор не заходил, писать было
    // нечего. Задним числом заполнено то, что нашлось в журнале
    // действий; у остальных адрес не сохранён нигде.
    return (
      <span
        className="cursor-help text-[13px] text-[#9b9fb3] underline decoration-dotted underline-offset-4"
        title={
          "Адрес не записан. IP сохраняется при входе, а запись включена " +
          "26.08.2026 — этот человек с тех пор не заходил. Более ранние " +
          "адреса подтянуты из журнала действий, но там есть только те, " +
          "кто делал административные операции."
        }
      >
        нет входов
      </span>
    );
  }

  const loginTitle = lastLoginAt
    ? `Последний вход: ${new Date(lastLoginAt).toLocaleString("ru-RU")}`
    : "Последний вход: не зафиксирован";

  if (registrationIp && registrationIp === lastLoginIp) {
    return (
      <div className="text-[13px] leading-snug">
        <IpLink ip={registrationIp} title={loginTitle} />
        <div className="text-[11px] text-[#9b9fb3]">регистрация и вход</div>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 text-[13px] leading-snug">
      {registrationIp ? (
        <div>
          <IpLink ip={registrationIp} title="IP при регистрации" />
          <span className="ml-1.5 text-[11px] text-[#9b9fb3]">рег.</span>
        </div>
      ) : null}
      {lastLoginIp ? (
        <div>
          <IpLink ip={lastLoginIp} title={loginTitle} />
          <span className="ml-1.5 text-[11px] text-[#9b9fb3]">вход</span>
        </div>
      ) : null}
    </div>
  );
}

function IpLink({ ip, title }: { ip: string; title: string }) {
  return (
    <a
      href={`https://ipinfo.io/${encodeURIComponent(ip)}`}
      target="_blank"
      rel="noreferrer noopener"
      title={title}
      className="group inline-flex items-center gap-1 tabular-nums text-[#3848c7] hover:underline"
    >
      {ip}
      <ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-70" />
    </a>
  );
}
