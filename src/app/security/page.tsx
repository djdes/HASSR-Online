import type { Metadata } from "next";
import Link from "next/link";
import {
  CreditCard,
  Download,
  History,
  KeyRound,
  Lock,
  MapPin,
  ShieldCheck,
  Trash2,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { DemoRequestButton } from "@/components/public/demo-request-button";
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome";

export const metadata: Metadata = {
  title: "Безопасность и данные — WeSetup",
  description:
    "Где хранятся журналы WeSetup, как защищены вход и данные, кто что видит, как сделать копию и удалить данные. Серверы в Москве, HTTPS, вход с кодом в Telegram, журнал действий.",
  alternates: { canonical: "https://wesetup.ru/security" },
};

/**
 * «Безопасность и данные» (2026-11-01): ответ покупателю-компании на
 * вопрос «можно ли вам доверить журналы». Только то, что подтверждено
 * кодом и проверкой прода (`.agent/tasks/growth-stage2-2026-11/spec.md`):
 * без сертификатов, процентов доступности и обещаний про резервные копии
 * сервера. Тест `security-page.test.ts` сверяет обещания с кодом.
 */

type Fact = { icon: LucideIcon; title: string; body: React.ReactNode };

const FACTS: Fact[] = [
  {
    icon: MapPin,
    title: "Данные хранятся в России",
    body: (
      <>
        Сервис работает на серверах в дата-центре в Москве. Данные хранятся и обрабатываются на территории
        России — так записано в <Link href="/oferta">договоре-оферте</Link> (п. 10.3) и в{" "}
        <Link href="/consent">согласии на обработку персональных данных</Link>.
      </>
    ),
  },
  {
    icon: Lock,
    title: "Только защищённое соединение",
    body: (
      <>
        Сайт и приложение работают только по HTTPS, а браузер запоминает это (HSTS) и не откроет WeSetup без
        шифрования. Ключи доступа к iiko, ЭДО и другим системам хранятся зашифрованными (AES-256-GCM) и
        целиком больше никогда не показываются.
      </>
    ),
  },
  {
    icon: KeyRound,
    title: "Вход под контролем",
    body: (
      <>
        Пароли не хранятся в открытом виде — только их хэши (bcrypt). Вход можно подтверждать кодом в
        Telegram. В «Настройки → Безопасность» видна история входов с устройствами, а кнопка «Завершить все
        сессии» выводит аккаунт со всех устройств сразу.
      </>
    ),
  },
  {
    icon: UsersRound,
    title: "Каждый видит своё",
    body: (
      <>
        Руководство видит всю организацию, сотрудник — только выданные ему журналы, руководитель точки —
        только свою точку. Проверяющему выдаётся отдельная ссылка с ограниченным сроком действия.
      </>
    ),
  },
  {
    icon: History,
    title: "Ничего не меняется молча",
    body: (
      <>
        Журнал действий показывает, кто и когда добавил, исправил или удалил запись, поменял настройки и
        доступы. Правку прошлых дней можно запретить — тогда журнал не переписать задним числом.
      </>
    ),
  },
  {
    icon: Download,
    title: "Копия всегда у вас",
    body: (
      <>
        Любой журнал выгружается в PDF и Excel. Подключите свой Яндекс Диск в «Настройки → Авто-бэкап на
        Я.Диск» — копия журналов уйдёт туда одной кнопкой.
      </>
    ),
  },
  {
    icon: CreditCard,
    title: "Данные карт к нам не попадают",
    body: (
      <>
        Оплату картой и через СБП проводит «Робокасса». Номер карты и другие её данные WeSetup не получает и
        не хранит.
      </>
    ),
  },
  {
    icon: Trash2,
    title: "Удалить можно в любой момент",
    body: (
      <>
        Аккаунт удаляется в профиле или на странице <Link href="/delete-account">«Удаление аккаунта»</Link>.
        Компания удаляется через 30 дней — до этого удаление можно отменить и скачать архив журналов.
      </>
    ),
  },
];

const DOCUMENTS = [
  { href: "/privacy", label: "Политика конфиденциальности" },
  { href: "/consent", label: "Согласие на обработку персональных данных" },
  { href: "/oferta", label: "Договор-оферта" },
  { href: "/terms", label: "Пользовательское соглашение" },
];

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <PublicHeader />
      <main className="mx-auto max-w-[1100px] space-y-10 px-4 py-12 sm:px-6">
        <header className="max-w-[760px]">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#eef1ff] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#3848c7]">
            <ShieldCheck className="size-3.5" aria-hidden />
            Безопасность
          </span>
          <h1 className="mt-4 text-[clamp(2rem,2vw+1.5rem,2.75rem)] font-semibold leading-[1.1] tracking-[-0.02em]">
            Безопасность и данные
          </h1>
          <p className="mt-3 text-[16px] leading-[1.6] text-[#3c4053]">
            Журналы — это документы, которые вы предъявляете проверяющему. Рассказываем коротко и без громких
            слов: где они хранятся, кто их видит, как сделать копию и как удалить данные.
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2" data-testid="security-facts">
          {FACTS.map(({ icon: Icon, title, body }) => (
            <article key={title} className="rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-6">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
                <Icon className="size-5" aria-hidden />
              </span>
              <h2 className="mt-4 text-[18px] font-semibold tracking-[-0.01em]">{title}</h2>
              <p className="mt-2 text-[15px] leading-[1.6] text-[#3c4053] [&_a]:text-[var(--app-indigo-deep)] [&_a]:underline [&_a]:decoration-[var(--app-indigo-deep)]/30 [&_a]:underline-offset-2 hover:[&_a]:decoration-[var(--app-indigo-deep)]">
                {body}
              </p>
            </article>
          ))}
        </section>

        <section className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6 sm:p-8">
          <h2 className="text-[18px] font-semibold tracking-[-0.01em]">Документы</h2>
          <p className="mt-2 max-w-[640px] text-[14px] leading-[1.6] text-[#3c4053]">
            Оператор персональных данных — ООО «БФС», реквизиты — внизу страницы. Вопросы об обработке данных —
            на <a href="mailto:support@wesetup.ru" className="text-[#3848c7] underline underline-offset-2">support@wesetup.ru</a>.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {DOCUMENTS.map((doc) => (
              <li key={doc.href}>
                <Link
                  href={doc.href}
                  className="inline-flex h-10 items-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                >
                  {doc.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-3xl bg-[#0b1024] p-8 text-white md:p-10">
          <h2 className="text-[24px] font-semibold tracking-[-0.02em]">Остались вопросы о данных?</h2>
          <p className="mt-2 max-w-[520px] text-[15px] leading-relaxed text-white/70">
            Покажем, как устроены доступы и журнал действий, на примере вашей компании — за 15 минут.
          </p>
          <div className="mt-6">
            <DemoRequestButton place="security" variant="onDark" />
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
