import Link from "next/link";
import {
  ArrowRight,
  BadgePercent,
  Building2,
  Coins,
  Eye,
  FileText,
  Handshake,
  LayoutDashboard,
  Link2,
  Mail,
  Palette,
  ShieldCheck,
  Wrench,
} from "lucide-react";

import { PublicFooter, PublicHeader } from "@/components/public/public-chrome";
import { authOptions } from "@/lib/auth";
import { DEFAULT_OG_IMAGES, DEFAULT_TWITTER_CARD, DEFAULT_TWITTER_IMAGES } from "@/lib/meta-defaults";
import { PLATFORM_BADGE_TEXT } from "@/lib/partners/branding";
import { formatRubFixed } from "@/lib/partners/rewards";
import { getCurrentRewardRule } from "@/lib/partners/schema-extras";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

const TITLE = "Партнёрская программа WeSetup";
const DESC =
  "Партнёрская программа WeSetup для консультантов по СанПиН и ХАССП и интеграторов: клиенты в одном кабинете под вашим брендом и вознаграждение с подписок.";
const URL = "https://wesetup.ru/partners";

export const metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: URL },
  openGraph: { type: "website", locale: "ru_RU", siteName: "WeSetup", url: URL, title: TITLE, description: DESC, images: DEFAULT_OG_IMAGES },
  twitter: { card: DEFAULT_TWITTER_CARD, title: TITLE, description: DESC, images: DEFAULT_TWITTER_IMAGES },
};

/**
 * Публичная страница партнёрской программы: для кого, что даёт, как
 * считается вознаграждение (цифры — из действующей версии правил) и
 * условия участия (#agreement — на неё ссылаются форма заявки и кабинет).
 * Кнопка «Стать партнёром» ведёт на форму в настройках организации:
 * заявку подаёт зарегистрированный пользователь, чтобы кабинет партнёра
 * сразу связался с его аккаунтом.
 */
export default async function PartnersPage() {
  const [rule, session] = await Promise.all([getCurrentRewardRule(), getServerSession(authOptions)]);
  const applyHref = session?.user ? "/settings/partner" : "/register?next=%2Fsettings%2Fpartner";

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <PublicHeader />
      <main className="mx-auto max-w-[1000px] space-y-10 px-4 py-12 sm:px-6">
        <section className="relative overflow-hidden rounded-3xl border border-[#ececf4] bg-[#0b1024] text-white shadow-[0_20px_60px_-30px_rgba(11,16,36,0.55)]">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 -top-24 size-[420px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
            <div className="absolute -bottom-40 -right-32 size-[460px] rounded-full bg-[#7a5cff] opacity-30 blur-[140px]" />
          </div>
          <div className="relative z-10 p-8 md:p-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[12px] uppercase tracking-[0.18em] text-white/70">
              <Handshake className="size-3.5" />
              Партнёрская программа
            </div>
            <h1 className="mt-5 max-w-[720px] text-[clamp(2rem,2.4vw+1.4rem,3rem)] font-semibold leading-[1.08] tracking-[-0.03em]">
              Ведите клиентов по СанПиН и ХАССП под своим брендом
            </h1>
            <p className="mt-4 max-w-[600px] text-[16px] leading-[1.6] text-white/75">
              Один кабинет для всех ваших заведений: кто просрочил журналы, у кого заканчиваются медкнижки, где нужна
              помощь. Клиенты видят ваш логотип и контакты, а вы получаете {rule.subscriptionPercent}% с подписок и{" "}
              {rule.hardwarePercent}% с оборудования.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={applyHref}
                className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]"
              >
                Стать партнёром
                <ArrowRight className="size-4" />
              </Link>
              <a
                href="#agreement"
                className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/20 bg-white/5 px-6 text-[15px] font-medium text-white transition-colors hover:bg-white/10"
              >
                Условия программы
              </a>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-[26px] font-semibold tracking-[-0.02em]">Для кого</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Feature icon={ShieldCheck} title="Консультанты по СанПиН / ХАССП">
              Сопровождаете несколько заведений — видите их журналы и просрочки без звонков и скриншотов, помогаете при
              проверке через «Инспектор пришёл».
            </Feature>
            <Feature icon={Wrench} title="Интеграторы и сервис оборудования">
              Ставите датчики и планшеты — подключаете клиента к WeSetup, получаете долю с подписки и с
              оборудования, купленного через вас.
            </Feature>
            <Feature icon={Building2} title="Сети и управляющие компании">
              Свой бренд на входе и в кабинете, общий обзор по всем точкам, отдельные доступы для сотрудников вашей
              команды.
            </Feature>
          </div>
        </section>

        <section className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6 md:p-8">
          <h2 className="text-[26px] font-semibold tracking-[-0.02em]">Что вы получаете</h2>
          <div className="mt-5 grid gap-x-8 gap-y-5 md:grid-cols-2">
            <Point icon={LayoutDashboard} title="Кабинет партнёра">
              Обзор клиентов: активные, просроченные журналы сегодня, медкнижки, которые заканчиваются в ближайшие 30
              дней. Карточка каждого клиента с заметками только для вас.
            </Point>
            <Point icon={Palette} title="White-label">
              Логотип, акцентный цвет, приветствие на странице входа, подпись в PDF, блок «Ваш консультант» в кабинете,
              письмах и Telegram-боте. Подпись «{PLATFORM_BADGE_TEXT}» остаётся.
            </Point>
            <Point icon={Link2} title="Своя страница и код">
              wesetup.ru/p/&lt;ваш-адрес&gt; и шестизначный код: клиент регистрируется по ссылке или вводит код в
              настройках — и сразу привязан к вам.
            </Point>
            <Point icon={Eye} title="Доступ решает клиент">
              Клиент сам выбирает «только просмотр» или «редактирование», может сменить уровень или отключить вас в
              любой момент. Все ваши действия в его кабинете видны в журнале действий.
            </Point>
            <Point icon={Mail} title="Приглашения">
              Готовые тексты для Telegram и почты, email-приглашения со статусами «отправлено / зарегистрировался /
              отказался».
            </Point>
            <Point icon={Coins} title="Прозрачное вознаграждение">
              Каждое начисление привязано к платежу клиента, месячные итоги, выгрузка CSV, реквизиты и статус договора
              — в одном разделе.
            </Point>
          </div>
        </section>

        <section>
          <h2 className="text-[26px] font-semibold tracking-[-0.02em]">Вознаграждение</h2>
          <p className="mt-2 max-w-[640px] text-[15px] leading-[1.6] text-[#3c4053]">
            Действующие правила — версия {rule.version}. Правила версионируются: каждое начисление помнит версию, по
            которой рассчитано, и новая версия не пересчитывает старые.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Reward value={`${rule.subscriptionPercent}%`} label="с каждого платежа за подписку">
              в течение {rule.subscriptionMonths} месяцев с первой оплаты клиента
            </Reward>
            <Reward value={`${rule.hardwarePercent}%`} label="со стоимости оборудования">
              после того как заказ оплачен и отгружен
            </Reward>
            <Reward value={formatRubFixed(rule.bonusAmountRub)} label="разовый бонус">
              после {rule.bonusAfterPayments}-го платежа клиента за подписку
            </Reward>
          </div>
          <ul className="mt-5 grid gap-2 text-[14px] leading-[1.6] text-[#3c4053] sm:grid-cols-2">
            <li className="flex gap-2">
              <BadgePercent className="mt-1 size-4 shrink-0 text-[#5566f6]" />
              Пример: подписка 1 990 ₽ → {formatRubFixed((1990 * rule.subscriptionPercent) / 100)} партнёру за каждый
              платёж.
            </li>
            <li className="flex gap-2">
              <BadgePercent className="mt-1 size-4 shrink-0 text-[#5566f6]" />
              Оборудование на 17 750 ₽ → {formatRubFixed((17750 * rule.hardwarePercent) / 100)}.
            </li>
            <li className="flex gap-2">
              <FileText className="mt-1 size-4 shrink-0 text-[#5566f6]" />
              Возврат клиенту — сторно на ту же сумму. Начисления за месяц становятся «к выплате» 1-го числа
              следующего месяца.
            </li>
            <li className="flex gap-2">
              <FileText className="mt-1 size-4 shrink-0 text-[#5566f6]" />
              Минимальная выплата — {formatRubFixed(rule.minPayoutRub)}; меньшая сумма переносится на следующий месяц.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-[26px] font-semibold tracking-[-0.02em]">Как стать партнёром</h2>
          <ol className="mt-5 grid gap-4 md:grid-cols-3">
            <Step n={1} title="Заявка">
              Название компании, ИНН, тип, город, телефон, сколько заведений ведёте и адрес вашей страницы. Заявку
              подаём из настроек организации в WeSetup.
            </Step>
            <Step n={2} title="Проверка">
              Мы рассматриваем заявку вручную, обычно за один-два рабочих дня. Ответ придёт на почту и в Telegram.
            </Step>
            <Step n={3} title="Запуск">
              Три шага в кабинете: логотип и контакты, ссылка для приглашений, реквизиты. После подписания договора
              начинаем выплаты.
            </Step>
          </ol>
          <div className="mt-6">
            <Link
              href={applyHref}
              className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]"
            >
              Подать заявку
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>

        <section id="agreement" className="scroll-mt-24 rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-8">
          <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Условия партнёрской программы</div>
          <h2 className="text-[22px] font-semibold tracking-[-0.02em]">Партнёрское соглашение — основные положения</h2>
          <p className="mt-2 text-[14px] leading-[1.6] text-[#3c4053]">
            Полный текст —{" "}
            <Link href="/partner-agreement" className="text-[#3848c7] underline-offset-2 hover:underline">
              договор партнёрской программы
            </Link>
            . Отметку «договор подписан» ставит WeSetup; до неё начисления копятся, но не выплачиваются.
          </p>
          <ol className="mt-5 space-y-3 text-[14px] leading-[1.6] text-[#3c4053]">
            <Clause n="1">
              Партнёр — юридическое лицо, ИП или самозанятый, прошедший проверку. Партнёр не является представителем
              WeSetup и не заключает договоры от его имени; оферта и тарифы для клиентов остаются без изменений.
            </Clause>
            <Clause n="2">
              Клиент подключается к партнёру только по собственному действию: по ссылке, коду или приглашению. У
              организации может быть не более одного партнёра одновременно; собственная организация партнёра его
              клиентом быть не может.
            </Clause>
            <Clause n="3">
              Уровень доступа к кабинету клиента («только просмотр» или «редактирование») выбирает клиент и может
              изменить или отозвать его в любой момент. Партнёр использует доступ только для сопровождения клиента и
              не передаёт его третьим лицам.
            </Clause>
            <Clause n="4">
              Вознаграждение начисляется по действующей на момент платежа версии правил ({rule.subscriptionPercent}% с
              подписки в течение {rule.subscriptionMonths} месяцев, {rule.hardwarePercent}% с оборудования,{" "}
              {formatRubFixed(rule.bonusAmountRub)} бонус после {rule.bonusAfterPayments}-го платежа). Возврат средств
              клиенту влечёт сторно начисления.
            </Clause>
            <Clause n="5">
              Начисления за месяц переходят в статус «к выплате» 1-го числа следующего месяца. Выплата производится при
              сумме не менее {formatRubFixed(rule.minPayoutRub)} по реквизитам, указанным в кабинете, после подписания
              договора; меньшая сумма переносится.
            </Clause>
            <Clause n="6">
              White-label распространяется на логотип, цвет, приветствие, контакты и подпись; подпись «{PLATFORM_BADGE_TEXT}
              » не удаляется. Партнёр гарантирует права на загружаемые материалы.
            </Clause>
            <Clause n="7">
              Партнёр не является работником или должностным лицом привлекаемого клиента, не участвует в его решении о
              закупке и не передаёт вознаграждение работникам клиента (антикоррупционная оговорка, 273-ФЗ).
            </Clause>
            <Clause n="8">
              WeSetup вправе приостановить партнёрство при нарушении условий или жалобах клиентов: брендинг снимается,
              доступ к кабинетам закрывается, начисления прекращаются; накопленная история сохраняется.
            </Clause>
          </ol>
          <p className="mt-4 text-[13px] text-[#6f7282]">
            Вопросы по программе: <a href="mailto:partners@wesetup.ru" className="text-[#3848c7]">partners@wesetup.ru</a>.
          </p>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}

function Feature({ icon: Icon, title, children }: { icon: typeof Handshake; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <span className="flex size-10 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
        <Icon className="size-5" />
      </span>
      <h3 className="mt-3 text-[16px] font-semibold tracking-[-0.01em]">{title}</h3>
      <p className="mt-1.5 text-[14px] leading-[1.6] text-[#3c4053]">{children}</p>
    </div>
  );
}

function Point({ icon: Icon, title, children }: { icon: typeof Handshake; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-white text-[#5566f6] shadow-[0_0_0_1px_rgba(236,236,244,1)]">
        <Icon className="size-4" />
      </span>
      <div>
        <div className="text-[15px] font-semibold">{title}</div>
        <p className="mt-1 text-[14px] leading-[1.6] text-[#3c4053]">{children}</p>
      </div>
    </div>
  );
}

function Reward({ value, label, children }: { value: string; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="text-[32px] font-semibold tabular-nums tracking-[-0.02em] text-[#5566f6]">{value}</div>
      <div className="mt-1 text-[15px] font-medium">{label}</div>
      <p className="mt-1 text-[13px] leading-[1.5] text-[#6f7282]">{children}</p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <span className="flex size-9 items-center justify-center rounded-full bg-[#5566f6] text-[14px] font-semibold text-white">{n}</span>
      <h3 className="mt-3 text-[16px] font-semibold">{title}</h3>
      <p className="mt-1.5 text-[14px] leading-[1.6] text-[#3c4053]">{children}</p>
    </li>
  );
}

function Clause({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="w-6 shrink-0 font-semibold tabular-nums text-[#3848c7]">{n}.</span>
      <span>{children}</span>
    </li>
  );
}
