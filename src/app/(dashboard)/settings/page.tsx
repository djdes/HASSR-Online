import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Bell,
  BookOpen,
  Building2,
  ClipboardList,
  CloudUpload,
  Coins,
  CreditCard,
  FileSpreadsheet,
  Eye,
  FlaskConical,
  Gauge,
  Wand2,
  KeyRound,
  ListChecks,
  Package,
  Palette,
  Phone,
  TabletSmartphone,
  Sparkles,
  Plug,
  Scale,
  ScrollText,
  Settings2,
  ShieldCheck,
  Shuffle,
  CalendarRange,
  Users,
  Wrench,
  Network,
  Handshake,
  Award,
  CalendarDays,
  Webhook,
} from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { PageGuide } from "@/components/ui/page-guide";
import { EmailVerifyCard } from "@/components/settings/email-verify-card";
import { isEmailVerified } from "@/lib/email-verification";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { hasCapability } from "@/lib/permission-presets";
import { getRouteTitle } from "@/lib/route-titles";
import { LinkPendingOverlay } from "@/components/ui/link-pending";
// ThemeSwitcher убран отсюда — занимал много места. Переключатель темы
// живёт в меню профиля (иконка справа вверху) → подменю «Тема».

export const dynamic = "force-dynamic";

// Подписи карточек живут в `route-titles.ts` — оттуда же их берут
// хлебные крошки, поэтому название раздела в карточке и в пути всегда
// совпадает. Здесь остаются только иконка, описание и адрес.
const settingsCards = [
  {
    description: "За 3 шага: объект, команда, журналы",
    href: "/settings/onboarding",
    icon: Sparkles,
    iconClass: "text-[#5566f6]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description: "Название, ИНН, адрес, бренд, часовой пояс — для договоров и printable PDF",
    href: "/settings/organization",
    icon: Building2,
    iconClass: "text-[#3848c7]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description: "Производственные зоны и помещения",
    href: "/settings/areas",
    icon: Building2,
    iconClass: "text-[#5566f6]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description:
      "Точки с адресами и помещения внутри — журналы уборки и климата, отдельные журналы по точкам",
    href: "/settings/buildings",
    icon: Building2,
    iconClass: "text-[#5566f6]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description: "Холодильники, печи, датчики",
    href: "/settings/equipment",
    icon: Wrench,
    iconClass: "text-[#7a5cff]",
    bgClass: "bg-[#f0edff]",
  },
  {
    description: "Роли, доступы, приглашения",
    href: "/settings/users",
    icon: Users,
    iconClass: "text-[#0ea5e9]",
    bgClass: "bg-[#e8f7ff]",
  },
  {
    description: "Кто каких сотрудников видит и кому назначает",
    href: "/settings/staff-hierarchy",
    icon: Network,
    iconClass: "text-[#f59e0b]",
    bgClass: "bg-[#fff8eb]",
  },
  {
    description: "Видимость сотрудников по должностям — драйвит TasksFlow и бот",
    href: "/settings/position-staff-visibility",
    icon: Users,
    iconClass: "text-[#0ea5e9]",
    bgClass: "bg-[#e8f7ff]",
  },
  {
    description: "Какие журналы ваша компания ведёт",
    href: "/settings/journals",
    icon: ClipboardList,
    iconClass: "text-[#d946ef]",
    bgClass: "bg-[#fdf4ff]",
  },
  {
    description:
      "Pipeline-инструкции для каждого журнала — что взять, куда идти, что делать",
    href: "/settings/journal-pipelines",
    icon: ListChecks,
    iconClass: "text-[#5566f6]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description:
      "Гонка / свободно / только админ — стиль работы команды над одной задачей",
    href: "/settings/journal-flow",
    icon: Shuffle,
    iconClass: "text-[#7a5cff]",
    bgClass: "bg-[#f0edff]",
  },
  {
    description:
      "Какие возможности у каждого preset'а (admin / head_chef / cook / …)",
    href: "/settings/role-presets",
    icon: ShieldCheck,
    iconClass: "text-[#3848c7]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description:
      "На какой срок создаётся каждый журнал — месяц, N дней, год…",
    href: "/settings/journal-periods",
    icon: CalendarRange,
    iconClass: "text-[#10b981]",
    bgClass: "bg-[#ecfdf5]",
  },
  {
    description: "Импорт из Excel, iiko, 1С",
    href: "/settings/products",
    icon: Package,
    iconClass: "text-[#f59e0b]",
    bgClass: "bg-[#fff8eb]",
  },
  {
    description: "Связать аккаунт с TasksFlow по номеру",
    href: "/settings/phone",
    icon: Phone,
    iconClass: "text-[#3848c7]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description: "Один планшет на смену: сотрудник подписывает записи своим ПИН",
    href: "/settings/kiosk",
    icon: TabletSmartphone,
    iconClass: "text-[#5566f6]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description: "Чтобы каждый месяц не заводить вручную",
    href: "/settings/auto-journals",
    icon: Sparkles,
    iconClass: "text-[#5566f6]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description: "Группы, должности, индивидуальные права",
    href: "/settings/permissions",
    icon: ShieldCheck,
    iconClass: "text-[#3848c7]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description: "Кто сегодня на смене — для авто-назначений",
    href: "/settings/schedule",
    icon: CalendarRange,
    iconClass: "text-[#10b981]",
    bgClass: "bg-[#ecfdf5]",
  },
  {
    description: "Кто какие журналы видит и заполняет",
    href: "/settings/journal-access",
    icon: KeyRound,
    iconClass: "text-[#5566f6]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description:
      "Кто заполняет каждый журнал. Один клик — умные пресеты (уборка → уборщикам)",
    href: "/settings/journal-responsibles",
    icon: Network,
    iconClass: "text-[#7a5cff]",
    bgClass: "bg-[#f0edff]",
  },
  {
    description:
      "Per-журнал: как создаются TasksFlow-задачи (по помещениям/сотрудникам/смене) и нужна ли двойная проверка завед. Здесь — «Без проверки» для журналов где сотрудник заполнил → готово",
    href: "/settings/journal-task-mode",
    icon: Settings2,
    iconClass: "text-[#3848c7]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description:
      "Один клик — и настроены должности, помещения, оборудование, обязательные журналы под тип бизнеса (прилавок/кафе/ресторан/школа/производство)",
    href: "/settings/onboarding-template",
    icon: Wand2,
    iconClass: "text-[#7a5cff]",
    bgClass: "bg-[#f0edff]",
  },
  {
    description:
      "Список действий для каждого журнала (например «разобрать → промыть → продезинфицировать»). Сотрудник видит чек-лист в форме и отмечает галочки. Обязательные пункты блокируют отправку. Все отметки в audit-log",
    href: "/settings/journal-checklists",
    icon: ListChecks,
    iconClass: "text-emerald-700",
    bgClass: "bg-emerald-100",
  },
  {
    description:
      "Если в команде нет шеф-повара — поставьте сложность 1-5 и распределите задачи между поварами равномерно",
    href: "/settings/journal-difficulty",
    icon: Gauge,
    iconClass: "text-[#a16d32]",
    bgClass: "bg-[#fff8eb]",
  },
  {
    description:
      "Кто сколько журналов ведёт в месяц — таблица с подсветкой перекоса между поварами на одинаковой зарплате",
    href: "/settings/workload-balance",
    icon: Scale,
    iconClass: "text-[#10b981]",
    bgClass: "bg-[#ecfdf5]",
  },
  {
    description:
      "Кто из руководства видит ВСЕ задачи в TasksFlow (admin-режим). По умолчанию — никто; включай только для одной должности (обычно «Админ»)",
    href: "/settings/task-visibility",
    icon: Eye,
    iconClass: "text-[#3848c7]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description: "Тот же выбор, но в виде матрицы должность × журнал — для power-юзеров",
    href: "/settings/journals-by-position",
    icon: Network,
    iconClass: "text-[#7a5cff]",
    bgClass: "bg-[#f0edff]",
  },
  {
    description: "Сколько ₽ за «единичные» журналы — мотивация в TasksFlow",
    href: "/settings/journal-bonuses",
    icon: Coins,
    iconClass: "text-[#b45309]",
    bgClass: "bg-[#fef3c7]",
  },
  {
    description: "Telegram-бот, типы оповещений",
    href: "/settings/notifications",
    icon: Bell,
    iconClass: "text-[#10b981]",
    bgClass: "bg-[#ecfdf5]",
  },
  {
    description: "События WeSetup на ваш сервер: записи, отклонения, CAPA, оплаты",
    href: "/settings/webhooks",
    icon: Webhook,
    iconClass: "text-[#3848c7]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description: "Сроки медкнижек, поверок и подписки — в вашем календаре",
    href: "/settings/calendar",
    icon: CalendarDays,
    iconClass: "text-[#3848c7]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description: "История входов, выход со всех устройств",
    href: "/settings/security",
    icon: ShieldCheck,
    iconClass: "text-[#a13a32]",
    bgClass: "bg-[#fff4f2]",
  },
  {
    description: "Баллы за отзывы и рекомендации — скидка на подписку",
    href: "/settings/balance",
    icon: Coins,
    iconClass: "text-[#3848c7]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description: "Тариф, история платежей, автопродление",
    href: "/settings/subscription",
    icon: CreditCard,
    iconClass: "text-[#ec4899]",
    bgClass: "bg-[#fdf2f8]",
  },
  {
    description: "Настройка журналов, аудит, консультации и выезд специалиста",
    href: "/settings/services",
    icon: Sparkles,
    iconClass: "text-[#7a5cff]",
    bgClass: "bg-[#f5f0ff]",
  },
  {
    description: "Приказы по предприятию: заполнить реквизитами и распечатать",
    href: "/orders",
    icon: ScrollText,
    iconClass: "text-[#5566f6]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description: "Аудит всех событий",
    href: "/settings/audit",
    icon: ScrollText,
    iconClass: "text-[#6b7280]",
    bgClass: "bg-[#f3f4f6]",
  },
  {
    description: "Кто может править выполненные записи журналов",
    href: "/settings/compliance",
    icon: ShieldCheck,
    iconClass: "text-[#3848c7]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description: "Экспериментальные фичи: Design v2 и др.",
    href: "/settings/experimental",
    icon: FlaskConical,
    iconClass: "text-[#7a5cff]",
    bgClass: "bg-[#f5f6ff]",
  },
  {
    description: "Read-only ссылка для СЭС / Роспотребнадзора с TTL",
    href: "/settings/inspector-portal",
    icon: ShieldCheck,
    iconClass: "text-[#10b981]",
    bgClass: "bg-[#ecfdf5]",
  },
  {
    description: "Нормативы и требования",
    href: "/sanpin",
    icon: BookOpen,
    iconClass: "text-[#14b8a6]",
    bgClass: "bg-[#f0fdfa]",
  },
  {
    description: "Ключ для внешних систем и датчиков",
    href: "/settings/api",
    icon: KeyRound,
    iconClass: "text-[#8b5cf6]",
    bgClass: "bg-[#f5f3ff]",
  },
  {
    description: "Автозадачи уборщикам через tasksflow.ru",
    href: "/settings/integrations/tasksflow",
    icon: Plug,
    iconClass: "text-[#0ea5e9]",
    bgClass: "bg-[#e8f7ff]",
  },
  {
    description: "Еженедельный JSON-дамп журналов в облако",
    href: "/settings/backup",
    icon: CloudUpload,
    iconClass: "text-[#3848c7]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description: "Еженедельная выгрузка списаний в 1С на email",
    href: "/settings/accounting",
    icon: FileSpreadsheet,
    iconClass: "text-[#3848c7]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description: "Кто сопровождает вас: доступ, контакты, отключение",
    href: "/settings/consultant",
    icon: Handshake,
    iconClass: "text-[#3848c7]",
    bgClass: "bg-[#eef1ff]",
  },
  {
    description: "Подключайте своих клиентов под своим брендом и получайте вознаграждение",
    href: "/settings/partner",
    icon: Award,
    iconClass: "text-[#9a4a06]",
    bgClass: "bg-[#fff7ed]",
  },
  {
    description: "Светлая или тёмная тема кабинета",
    href: "/settings/appearance",
    icon: Palette,
    iconClass: "text-[#5566f6]",
    bgClass: "bg-[#eef1ff]",
  },
];

export default async function SettingsPage() {
  const session = await requireAuth();
  // /settings — только admin'у. Заведующая (head_chef) попадала сюда
  // через legacy role=owner, видела карточки, кликала «Pipeline»/«Режим
  // задач»/«Пресеты» — мои страницы внутри проверяют admin.full и
  // редиректили на /journals. Чиним: head_chef сразу на /control-board.
  if (!hasCapability(session.user, "admin.full")) {
    if (hasCapability(session.user, "tasks.verify")) {
      redirect("/control-board");
    }
    if (!hasFullWorkspaceAccess(session.user)) {
      redirect("/journals");
    }
    // Manager без admin.full и без tasks.verify — оставляем legacy
    // /journals (на будущее когда manager preset появится).
    redirect("/journals");
  }
  const orgId = getActiveOrgId(session);

  const [areaCount, equipmentCount, userCount, productCount, me] =
    await Promise.all([
      db.area.count({ where: { organizationId: orgId } }),
      db.equipment.count({
        where: { area: { organizationId: orgId } },
      }),
      db.user.count({ where: { organizationId: orgId, isActive: true } }),
      db.product.count({ where: { organizationId: orgId, isActive: true } }),
      db.user.findUnique({
        where: { id: session.user.id },
        select: { email: true, emailVerifiedAt: true },
      }),
    ]);

  return (
    <div className="space-y-5">
      {/* Подтверждение почты. Показывается, пока не подтверждена: это
          единственное место, где оно теперь живёт — из анкеты
          регистрации его убрали, там оно блокировало «Готово». */}
      {me && !isEmailVerified(me) ? (
        <EmailVerifyCard email={me.email} />
      ) : null}
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-[#ececf4] bg-[#0b1024] text-white shadow-[0_20px_60px_-30px_rgba(11,16,36,0.55)]">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 size-[420px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
          <div className="absolute -bottom-40 -right-32 size-[460px] rounded-full bg-[#7a5cff] opacity-30 blur-[140px]" />
        </div>
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(ellipse at 30% 40%, black 40%, transparent 70%)",
          }}
        />
        <div className="relative z-10 p-5 sm:p-8 md:p-10">
          <div className="flex items-start gap-4">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
              <Settings2 className="size-6" />
            </div>
            <div>
              <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] font-bold leading-tight tracking-[-0.02em]">
                Настройки
              </h1>
              <p className="mt-1 text-[15px] text-white/70">
                {session.user.organizationName}
              </p>
            </div>
          </div>

          {/* Одна строка на любом экране: на телефоне это компактная
              полоса цифр, а не четыре крупные плитки в пол-экрана. */}
          <div className="no-mobile-shrink mt-6 grid grid-cols-4 gap-2 sm:mt-8 sm:gap-4">
            <StatPill label="Цехов" value={areaCount} />
            <StatPill label="Оборудования" value={equipmentCount} />
            <StatPill label="Сотрудников" value={userCount} />
            <StatPill label="Продуктов" value={productCount} />
          </div>
        </div>
      </section>

      {/* БОЛЬШАЯ кнопка «Быстрый старт» — прямо под hero. Open
          /settings/onboarding — 3 этапа по 2 карточки. Не
          теряется среди настроечных групп — сразу видна. */}
      <Link
        href="/settings/onboarding"
        className="group relative block overflow-hidden rounded-3xl border border-[#5566f6]/30 bg-gradient-to-br from-[#5566f6] via-[#4a5bf0] to-[#3848c7] p-4 text-white shadow-[0_20px_60px_-30px_rgba(85,102,246,0.8)] transition-transform duration-150 hover:-translate-y-0.5 sm:p-7"
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -right-20 -top-20 size-[300px] rounded-full bg-white opacity-10 blur-[100px]" />
          <div className="absolute -bottom-24 -left-20 size-[280px] rounded-full bg-[#7a5cff] opacity-30 blur-[120px]" />
        </div>
        {/* На телефоне — компактная строка «иконка · название · стрелка»,
            как карточки дашборда: описание на трёх строках занимало
            треть экрана и отодвигало сами настройки. */}
        <div className="relative z-10 flex items-center gap-3 sm:gap-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30 backdrop-blur sm:size-14">
            <Sparkles className="size-5 sm:size-7" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] sm:text-[clamp(1.375rem,1.5vw+1rem,1.75rem)]">
              Быстрый старт
            </h2>
            <p className="mt-0.5 text-[13px] leading-snug text-white/80 sm:mt-1.5 sm:max-w-[640px] sm:text-[15px] sm:leading-relaxed">
              Настройка по шагам: компания, команда, журналы, интеграции.
            </p>
          </div>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/30 sm:hidden">
            <ArrowRight className="size-4" />
          </span>
          <span className="hidden shrink-0 items-center gap-2 rounded-2xl bg-white px-5 py-3 text-[14px] font-semibold text-[#0b1024] shadow-[0_10px_30px_-12px_rgba(11,16,36,0.45)] sm:inline-flex">
            Открыть
            <ArrowRight className="size-4" />
          </span>
        </div>
      </Link>

      <PageGuide
        storageKey="settings-hub"
        title="С чего начать новой команде"
        bullets={[
          {
            title: "Старт",
            body: "Запишите ИНН/адрес, добавьте сотрудников, настройте журналы которые ведёте.",
          },
          {
            title: "Команда и доступы",
            body: "Должности, иерархия (кто кого видит), пресеты прав ролей.",
          },
          {
            title: "Журналы",
            body: "Кто заполняет каждый журнал (Ответственные), как раздавать задачи в TasksFlow (Режимы), и какие журналы вообще нужны вашей кухне.",
          },
          {
            title: "Интеграции",
            body: "TasksFlow для смартфон-задач, Telegram для уведомлений, инспектор-портал для проверок.",
          },
        ]}
        qa={[
          {
            q: "Что если сделал что-то не так",
            a: "Большинство настроек обратимы — открой ту же страницу и поменяй. Опасные действия (удалить документы, изменить во всех) всегда спрашивают подтверждение.",
          },
          {
            q: "Сотрудник не видит задачи в TasksFlow",
            a: "Скорее всего у него нет TasksFlow-привязки. Зайди в «Сотрудники» и убедись что у него есть телефон + он принят в TasksFlow.",
          },
        ]}
      />

      {/* Разделы по смыслу. «Быстрая настройка» сюда не попадает —
          она уже большой кнопкой сверху, дублировать её карточкой
          значит показывать один и тот же адрес дважды. */}
      <SettingsGroup
        title="Организация"
        subtitle="Реквизиты, точки, помещения, оборудование, вид кабинета"
        items={settingsCards.filter((c) => GROUP_ORG.has(c.href as string))}
      />
      <SettingsGroup
        title="Команда и доступы"
        subtitle="Сотрудники, должности, права, графики"
        items={settingsCards.filter((c) => GROUP_TEAM.has(c.href as string))}
      />
      <SettingsGroup
        title="Журналы"
        subtitle="Какие ведём, кто отвечает, как заполняются"
        items={settingsCards.filter((c) => GROUP_JOURNALS.has(c.href as string))}
      />
      <SettingsGroup
        title="Задачи сотрудникам"
        subtitle="Кто получает задачи, как проверяются, премии"
        items={settingsCards.filter((c) => GROUP_TASKS.has(c.href as string))}
      />
      <SettingsGroup
        title="Оплата"
        subtitle="Баланс, тариф, услуги специалиста, партнёрская программа"
        items={settingsCards.filter((c) => GROUP_MONEY.has(c.href as string))}
      />
      <SettingsGroup
        title="Интеграции и уведомления"
        subtitle="TasksFlow, Telegram, бухгалтерия, API, бэкапы"
        items={settingsCards.filter((c) =>
          GROUP_INTEGRATIONS.has(c.href as string)
        )}
      />
      <SettingsGroup
        title="Проверки и безопасность"
        subtitle="Инспектор, соответствие, журнал действий"
        items={settingsCards.filter((c) => GROUP_CHECKS.has(c.href as string))}
      />
    </div>
  );
}

/**
 * Группы разделов — по смыслу, а не «старт / дополнительно».
 *
 * Что было не так: в группе «Старт» вперемешку лежали баланс, реквизиты,
 * сотрудники, журналы и быстрая настройка — по названию группы нельзя
 * было понять, что там найдёшь, а баланс и тариф прятались в разных
 * местах. Теперь: сначала организация, потом люди, потом журналы, потом
 * деньги, интеграции и проверки. Быстрая настройка живёт отдельной
 * большой кнопкой сверху и в группах не дублируется.
 */
const GROUP_ORG = new Set([
  "/settings/organization",
  "/settings/buildings",
  "/settings/areas",
  "/settings/equipment",
  "/settings/products",
  "/settings/appearance",
]);
const GROUP_TEAM = new Set([
  "/settings/users",
  "/settings/role-presets",
  "/settings/permissions",
  "/settings/security",
  "/settings/staff-hierarchy",
  "/settings/position-staff-visibility",
  "/settings/schedule",
  "/settings/phone",
  "/settings/kiosk",
]);
const GROUP_JOURNALS = new Set([
  "/settings/journals",
  "/settings/journal-responsibles",
  "/settings/auto-journals",
  "/settings/journal-periods",
  "/settings/journal-access",
  "/settings/journals-by-position",
  "/settings/journal-checklists",
  "/settings/journal-pipelines",
  "/settings/onboarding-template",
  "/orders",
]);
const GROUP_TASKS = new Set([
  "/settings/journal-task-mode",
  "/settings/journal-flow",
  "/settings/task-visibility",
  "/settings/workload-balance",
  "/settings/journal-difficulty",
  "/settings/journal-bonuses",
]);
const GROUP_MONEY = new Set([
  "/settings/balance",
  "/settings/subscription",
  "/settings/services",
  "/settings/partner",
]);
const GROUP_INTEGRATIONS = new Set([
  "/settings/integrations/tasksflow",
  "/settings/notifications",
  "/settings/calendar",
  "/settings/webhooks",
  "/settings/accounting",
  "/settings/consultant",
  "/settings/api",
  "/settings/backup",
]);
const GROUP_CHECKS = new Set([
  "/settings/inspector-portal",
  "/settings/compliance",
  "/settings/audit",
  "/sanpin",
  "/settings/experimental",
]);

function SettingsGroup({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: typeof settingsCards;
}) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3">
      {title ? (
        <div className="px-1">
          <h2 className="text-[16px] font-semibold text-[#0b1024]">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 text-[12px] text-[#6f7282]">{subtitle}</p>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={card.href}
              className="group relative overflow-hidden rounded-2xl"
            >
              <div className="flex h-full items-start gap-4 rounded-2xl border border-[#ececf4] bg-white px-5 py-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-all hover:border-[#d6d9ee] hover:shadow-[0_8px_24px_-12px_rgba(85,102,246,0.18)]">
                <div
                  className={`flex size-10 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105 ${card.bgClass}`}
                >
                  <Icon className={`size-5 ${card.iconClass}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[15px] font-semibold text-[#0b1024]">
                      {getRouteTitle(card.href) ?? card.href}
                    </div>
                    <ArrowRight className="size-4 text-[#c7ccea] transition-all group-hover:translate-x-0.5 group-hover:text-[#5566f6]" />
                  </div>
                  <div className="mt-1 text-[13px] text-[#6f7282]">
                    {card.description}
                  </div>
                </div>
              </div>
              <LinkPendingOverlay />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-2xl bg-white/10 px-1 py-2.5 text-center backdrop-blur-sm sm:px-4 sm:py-3 sm:text-left">
      <div className="text-[20px] font-semibold leading-none tabular-nums sm:text-[24px]">
        {value}
      </div>
      <div className="mt-1 truncate text-[10px] leading-tight tracking-[-0.01em] text-white/60 sm:text-[12px] sm:tracking-normal">
        {label}
      </div>
    </div>
  );
}
