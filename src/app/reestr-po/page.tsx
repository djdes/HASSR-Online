import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Building2,
  CheckCircle2,
  Cpu,
  Download,
  FileText,
  HardDrive,
  Headphones,
  Layers,
  Scale,
  Server,
  ShieldCheck,
} from "lucide-react";

import { LegalRequisites } from "@/components/public/legal-article";
import { PublicBreadcrumbs } from "@/components/public/public-breadcrumbs";
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome";
import { COMPANY_EMAIL, COMPANY_MOBILE, COMPANY_PHONE } from "@/lib/company-contacts";
import { JOURNALS_TOTAL_LABEL } from "@/lib/journal-catalog";
import { jsonLdSafeString } from "@/lib/json-ld";
import { DEFAULT_TWITTER_CARD } from "@/lib/meta-defaults";
import { ogImages, twitterImages } from "@/lib/og-image";
import {
  FREE_AFTER_TRIAL_LABEL,
  FREE_TIER_SHORT,
  PAID_SEATS_LABEL,
  POINTS_DISCOUNT_LINE,
  PREMIUM_SEATS_LABEL,
} from "@/lib/plan-catalog";
import { readPromoPlanPricing } from "@/lib/promo-cache";
import {
  SOFTWARE_REGISTRY_CLASSES,
  SOFTWARE_REGISTRY_DOCS,
  SOFTWARE_REGISTRY_REVISION_DATE_RU,
  SOFTWARE_REGISTRY_URL,
  SOFTWARE_REGISTRY_VERSION,
} from "@/lib/software-registry-docs";
import { DEFAULT_PLAN_RATES, planMonthlyRub } from "@/lib/tariff-plans";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TITLE =
  "Сведения о ПО «WeSetup» и эксплуатационная документация (Реестр российского ПО)";
const DESCRIPTION =
  "Официальные сведения о программном комплексе ведения электронных журналов СанПиН и ХАССП «WeSetup» (правообладатель ООО «БФС», ИНН 5018215599): описание функциональных характеристик, инструкция по установке и развёртыванию, руководство пользователя, жизненный цикл, стек технологий и стоимость.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: SOFTWARE_REGISTRY_URL },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: "WeSetup",
    url: SOFTWARE_REGISTRY_URL,
    title: TITLE,
    description: DESCRIPTION,
    images: ogImages({ title: TITLE, subtitle: DESCRIPTION, kind: "page" }),
  },
  twitter: {
    card: DEFAULT_TWITTER_CARD,
    title: TITLE,
    description: DESCRIPTION,
    images: twitterImages({ title: TITLE, subtitle: DESCRIPTION, kind: "page" }),
  },
};

const fmtRub = (n: number) => `${new Intl.NumberFormat("ru-RU").format(n)} ₽`;

const FUNCTIONAL_MODULES = [
  {
    title: `Электронные журналы СанПиН и ХАССП (${JOURNALS_TOTAL_LABEL})`,
    body: "Ведение табличных (сетка «сотрудники/оборудование × дни месяца») и строковых журналов: гигиенический журнал сотрудников, контроль температуры холодильников, температура и влажность складов, бракераж готовой и скоропортящейся продукции, контроль фритюрных жиров, графики текущих и генеральных уборок, бактерицидные установки, учёт медкнижек, суточные пробы, дезинсекция и дератизация, поверка средств измерений (ФГИС «Аршин»).",
  },
  {
    title: "Программа производственного контроля (ППК) и ХАССП-план",
    body: "Конструктор и реестр утверждённых редакций документов ППК («ППК NNN») с построчным сравнением версий, анализ опасных факторов и критических контрольных точек (ККТ), рабочие листы ХАССП и реестр изданных приказов по предприятию.",
  },
  {
    title: "Управление структурой организации, точками, сменами и доступами",
    body: "Поддержка одиночных заведений и многофилиальных сетей (головной офис и точки), справочники помещений и оборудования с температурными нормами, учёт сотрудников и должностей, график смен, распределение ежедневных задач на дежурную должность и ролевое разграничение прав доступа (ACL).",
  },
  {
    title: "Мобильный ввод, QR/NFC-маркировка и приложение «Сетап помощник»",
    body: "Генерация и печать листов QR-кодов, запись NFC-меток для оборудования и помещений, быстрый ввод замеров со смартфона через мобильный веб-интерфейс (PWA), Android-приложение «Сетап помощник», ботов в мессенджерах MAX и Telegram.",
  },
  {
    title: "Сбор телеметрии с датчиков (IoT) и распознавание показаний по фото",
    body: "Автоматический приём показаний температуры и влажности от беспроводных Wi-Fi/BLE-датчиков (контроллеры ESP32, открытый HTTP REST API), распознавание цифр по фотографии экрана термометра/гигрометра, контроль критических пределов и мгновенная отправка уведомлений об отклонениях.",
  },
  {
    title: "Прослеживаемость партий, CAPA, внутренний аудит и режим «Пришла проверка»",
    body: "Учёт партий и сроков годности, печать этикеток маркировки, регистрация несоответствий и корректирующих мероприятий (CAPA), протоколы внутренних аудитов, мгновенная сборка архива журналов в PDF и Excel (XLSX) для проверки Роспотребнадзора, временные защищённые ссылки для инспектора и авто-бэкап на Яндекс Диск.",
  },
  {
    title: "Интеграции с ФГИС «ВетИС» («Меркурий»), 1С, iiko, ЭДО и открытый API",
    body: "Просмотр и гашение ветеринарных сопроводительных документов (ВСД) в ФГИС «Меркурий» с переносом данных в журнал входного контроля, обмен со справочниками 1С, iiko, системами ЭДО и TasksFlow, открытый REST API v1 (OpenAPI 3.1) с идемпотентностью, HMAC-SHA256 вебхуками и поддержкой протокола MCP.",
  },
] as const;

const TECH_STACK = [
  {
    label: "Архитектура ПО",
    value:
      "Клиент-серверная трёхуровневая веб-архитектура с мультитенантной изоляцией данных организаций (по идентификатору organizationId), открытым REST API v1 и мобильным контуром (PWA / Android).",
  },
  {
    label: "Языки программирования и среда выполнения",
    value: "TypeScript 5, JavaScript (ES2022), SQL, HTML5, CSS3; серверная среда выполнения — Node.js 22 LTS.",
  },
  {
    label: "Фреймворки и библиотеки",
    value:
      "Next.js 16, React 19, Prisma ORM 7, Zod 4, jsPDF, ExcelJS — компоненты с открытым исходным кодом под свободными лицензиями (MIT, Apache-2.0, BSD, ISC), не требующие зарубежных серверов активации.",
  },
  {
    label: "Система управления базами данных (СУБД)",
    value:
      "PostgreSQL 15+ (совместимо с российскими СУБД из Единого реестра российского ПО: Postgres Pro Standard / Enterprise, Tantor SE).",
  },
  {
    label: "Серверные операционные системы",
    value:
      "Российские ОС из Единого реестра российского ПО: РЕД ОС (7.3, 8+), Astra Linux Special Edition / Common Edition (1.7, 1.8+), Альт Сервер (10+), а также совместимые дистрибутивы Linux (Debian 12+, Ubuntu Server 22.04/24.04 LTS).",
  },
  {
    label: "Клиентские операционные системы и браузеры",
    value:
      "Альт Рабочая станция, РЕД ОС, Astra Linux, Windows 10/11, macOS, Android 8+, iOS 15+; браузеры: Яндекс Браузер, Chromium, Google Chrome, Microsoft Edge, Mozilla Firefox, Apple Safari.",
  },
  {
    label: "Размещение инфраструктуры и защита данных",
    value:
      "Серверы и базы данных расположены на территории Российской Федерации (дата-центр в г. Москве, ч. 5 ст. 18 ФЗ № 152-ФЗ). Передача данных по HTTPS (TLS 1.2/1.3, HSTS), хеширование паролей bcrypt, шифрование ключей интеграций AES-256-GCM.",
  },
] as const;

export default async function SoftwareRegistryPage() {
  const pricing = await readPromoPlanPricing().catch(() => ({
    rates: DEFAULT_PLAN_RATES,
    available: true,
  }));
  const rates = pricing.rates ?? DEFAULT_PLAN_RATES;

  const pageJsonLd = jsonLdSafeString({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${SOFTWARE_REGISTRY_URL}#software`,
    name: "WeSetup",
    alternateName:
      "Программный комплекс ведения электронных журналов санитарного контроля (СанПиН) и системы ХАССП «WeSetup»",
    applicationCategory: "BusinessApplication",
    operatingSystem: "РЕД ОС, Astra Linux, Альт, Linux, Windows, macOS, Android, iOS (Web / PWA)",
    softwareVersion: SOFTWARE_REGISTRY_VERSION,
    url: SOFTWARE_REGISTRY_URL,
    inLanguage: "ru-RU",
    author: {
      "@type": "Organization",
      "@id": "https://wesetup.ru/#org",
      name: "ООО «БФС»",
      legalName: "Общество с ограниченной ответственностью «БФС»",
      taxID: "5018215599",
      email: COMPANY_EMAIL,
      telephone: COMPANY_PHONE.tel,
    },
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "RUB",
      lowPrice: 0,
      highPrice: planMonthlyRub(rates, "vip", "month"),
      url: "https://wesetup.ru/pricing",
    },
  });

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: pageJsonLd }} />
      <PublicHeader />

      <main className="mx-auto max-w-[1100px] space-y-10 px-4 py-10 sm:px-6 sm:py-12">
        <header className="max-w-[880px]">
          <PublicBreadcrumbs
            tone="light"
            className="mb-5"
            items={[{ name: "Сведения о ПО и документация (Реестр ПО)" }]}
          />
          <span className="inline-flex items-center gap-2 rounded-full bg-[#eef1ff] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#3848c7]">
            <ShieldCheck className="size-3.5" aria-hidden />
            Единый реестр российского ПО · Постановление Правительства РФ № 1236
          </span>
          <h1 className="mt-4 text-[clamp(1.85rem,2.2vw+1.25rem,2.65rem)] font-semibold leading-[1.12] tracking-[-0.02em]">
            Программный комплекс «WeSetup» — сведения о правообладателе и эксплуатационная документация
          </h1>
          <p className="mt-3 text-[16px] leading-[1.65] text-[#3c4053]">
            Настоящая страница опубликована в открытом круглосуточном доступе (без необходимости регистрации, авторизации
            или ввода персональных данных) в соответствии с требованиями Постановления Правительства Российской Федерации
            от 16.11.2015 № 1236 и методическими рекомендациями Минцифры России (ФГБУ «ЦКИТ»).
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] text-[#6f7282]">
            <span>Версия ПО: <strong className="font-semibold text-[#0b1024]">{SOFTWARE_REGISTRY_VERSION}</strong></span>
            <span>·</span>
            <span>Актуальная редакция документации: <strong className="font-semibold text-[#0b1024]">{SOFTWARE_REGISTRY_REVISION_DATE_RU}</strong></span>
            <span>·</span>
            <span>Правообладатель: <strong className="font-semibold text-[#0b1024]">ООО «БФС» (ИНН 5018215599)</strong></span>
          </div>
        </header>

        {/* 1. Обязательный комплект документации в формате PDF (прямое скачивание без регистрации) */}
        <section
          id="documentation"
          aria-labelledby="heading-documentation"
          className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6 sm:p-8"
          data-testid="registry-pdf-docs"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-[720px]">
              <div className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#3848c7]">
                <FileText className="size-4" aria-hidden />
                Пункт 11(1) «ж» Правил (ПП РФ № 1236)
              </div>
              <h2 id="heading-documentation" className="mt-2 text-[22px] font-semibold tracking-[-0.015em]">
                1. Комплект технической и эксплуатационной документации (PDF)
              </h2>
              <p className="mt-2 text-[14.5px] leading-[1.6] text-[#3c4053]">
                Все документы утверждены Генеральным директором ООО «БФС» Волковым Д. В., заверены печатью организации и
                доступны для прямого просмотра и скачивания в формате PDF бесплатно и без регистрации.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {SOFTWARE_REGISTRY_DOCS.map((doc) => (
              <article
                key={doc.key}
                id={doc.anchor}
                className="flex flex-col justify-between rounded-2xl border border-[#ececf4] bg-white p-5"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-[#6f7282]">
                    <span className="rounded-lg bg-[#eef1ff] px-2.5 py-0.5 font-mono text-[11.5px] font-semibold text-[#3848c7]">
                      {doc.code}
                    </span>
                    <span>{doc.regulatoryBasis}</span>
                  </div>
                  <h3 className="mt-3 text-[16px] font-semibold leading-[1.35] text-[#0b1024]">
                    {doc.title}
                  </h3>
                  <p className="mt-2 text-[13.5px] leading-[1.6] text-[#3c4053]">
                    {doc.description}
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3 pt-2">
                  <a
                    href={doc.pdfPath}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[13.5px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
                  >
                    <Download className="size-4" aria-hidden />
                    Открыть и скачать PDF
                  </a>
                  <a
                    href={doc.pdfPath}
                    download={doc.filename}
                    className="inline-flex h-10 items-center rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                  >
                    {doc.filename}
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* 2. Сведения о ПО, правообладателе и исключительных правах */}
        <section
          id="rightsholder"
          aria-labelledby="heading-rightsholder"
          className="rounded-3xl border border-[#ececf4] bg-white p-6 sm:p-8"
        >
          <div className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#3848c7]">
            <Building2 className="size-4" aria-hidden />
            Паспорт программного продукта и правообладатель
          </div>
          <h2 id="heading-rightsholder" className="mt-2 text-[22px] font-semibold tracking-[-0.015em]">
            2. Сведения о программном обеспечении, правообладателе и исключительных правах
          </h2>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full border-collapse text-left text-[14px] leading-[1.6]">
              <tbody className="divide-y divide-[#ececf4]">
                <tr>
                  <th className="w-[280px] py-3 pr-4 align-top font-medium text-[#6f7282]">
                    Полное наименование ПО
                  </th>
                  <td className="py-3 font-semibold text-[#0b1024]">
                    Программный комплекс ведения электронных журналов санитарного контроля (СанПиН) и системы ХАССП «WeSetup»
                  </td>
                </tr>
                <tr>
                  <th className="py-3 pr-4 align-top font-medium text-[#6f7282]">
                    Сокращённое наименование ПО
                  </th>
                  <td className="py-3 text-[#0b1024]">WeSetup (ПО «WeSetup»)</td>
                </tr>
                <tr>
                  <th className="py-3 pr-4 align-top font-medium text-[#6f7282]">
                    Правообладатель (разработчик)
                  </th>
                  <td className="py-3 font-semibold text-[#0b1024]">
                    Общество с ограниченной ответственностью «БФС» (ООО «БФС»)
                  </td>
                </tr>
                <tr>
                  <th className="py-3 pr-4 align-top font-medium text-[#6f7282]">
                    ИНН / КПП / ОГРН правообладателя
                  </th>
                  <td className="py-3 text-[#0b1024]">
                    ИНН 5018215599 · КПП 501801001 · ОГРН 1235000105306 (дата регистрации: 24.08.2023)
                  </td>
                </tr>
                <tr>
                  <th className="py-3 pr-4 align-top font-medium text-[#6f7282]">
                    Адрес в пределах места нахождения
                  </th>
                  <td className="py-3 text-[#0b1024]">
                    141065, Российская Федерация, Московская область, г. Королёв, ул. Ленина, д. 10/6
                  </td>
                </tr>
                <tr>
                  <th className="py-3 pr-4 align-top font-medium text-[#6f7282]">
                    Единоличный исполнительный орган
                  </th>
                  <td className="py-3 text-[#0b1024]">
                    Генеральный директор — Волков Денис Владимирович
                  </td>
                </tr>
                <tr>
                  <th className="py-3 pr-4 align-top font-medium text-[#6f7282]">
                    Контактные данные правообладателя
                  </th>
                  <td className="py-3 text-[#0b1024]">
                    Тел.:{" "}
                    <a href={`tel:${COMPANY_PHONE.tel}`} className="text-[#3848c7] underline underline-offset-2">
                      {COMPANY_PHONE.display}
                    </a>
                    ,{" "}
                    <a href={`tel:${COMPANY_MOBILE.tel}`} className="text-[#3848c7] underline underline-offset-2">
                      {COMPANY_MOBILE.display}
                    </a>{" "}
                    · E-mail:{" "}
                    <a href={`mailto:${COMPANY_EMAIL}`} className="text-[#3848c7] underline underline-offset-2">
                      {COMPANY_EMAIL}
                    </a>{" "}
                    · Официальный сайт:{" "}
                    <Link href="/" className="text-[#3848c7] underline underline-offset-2">
                      https://wesetup.ru
                    </Link>
                  </td>
                </tr>
                <tr>
                  <th className="py-3 pr-4 align-top font-medium text-[#6f7282]">
                    Сведения об исключительных правах
                  </th>
                  <td className="py-3 text-[#0b1024]">
                    Исключительное право на программный комплекс «WeSetup» (исходный текст, объектный код, архитектуру,
                    структуру базы данных, пользовательский интерфейс и документацию) принадлежит{" "}
                    <strong>ООО «БФС»</strong> в полном объёме на территории всего мира и на весь срок действия
                    исключительного права в соответствии со ст. 1229, 1259, 1261 и 1295 Гражданского кодекса Российской
                    Федерации. Программное обеспечение создано штатными специалистами ООО «БФС» в рамках выполнения
                    служебных обязанностей, свободно от прав и обременений третьих лиц и не требует выплаты лицензионных
                    отчислений иностранным правообладателям.
                  </td>
                </tr>
                <tr>
                  <th className="py-3 pr-4 align-top font-medium text-[#6f7282]">
                    Способы предоставления прав использования
                  </th>
                  <td className="py-3 text-[#0b1024]">
                    Предоставление удалённого доступа к функциональным возможностям ПО через сеть Интернет (модель SaaS)
                    и/либо предоставление права использования на условиях простой (неисключительной) лицензии на
                    основании публичного{" "}
                    <Link href="/oferta" className="text-[#3848c7] underline underline-offset-2">
                      Договора-оферты (wesetup.ru/oferta)
                    </Link>
                    ,{" "}
                    <Link href="/terms" className="text-[#3848c7] underline underline-offset-2">
                      Пользовательского соглашения (wesetup.ru/terms)
                    </Link>{" "}
                    или двустороннего договора с юридическими лицами и индивидуальными предпринимателями (в том числе в
                    рамках закупок по Федеральным законам № 44-ФЗ и № 223-ФЗ).
                  </td>
                </tr>
                <tr>
                  <th className="py-3 pr-4 align-top font-medium text-[#6f7282]">
                    Коды ОКПД 2
                  </th>
                  <td className="py-3 text-[#0b1024]">
                    <code>62.01.29.000</code> — Оригиналы программного обеспечения прочие;{" "}
                    <code>63.11.13.000</code> — Услуги по предоставлению программного обеспечения без его размещения на
                    компьютере пользователя.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 className="mt-6 text-[16px] font-semibold text-[#0b1024]">
            Классификация ПО по классификатору Минцифры России (Приказ Минкомсвязи России от 22.09.2020 № 486)
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {SOFTWARE_REGISTRY_CLASSES.map((cls) => (
              <div key={cls.code} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-lg bg-[#eef1ff] px-2.5 py-0.5 font-mono text-[13px] font-semibold text-[#3848c7]">
                    Код {cls.code}
                  </span>
                  <span className="text-[12px] font-medium text-[#6f7282]">{cls.role}</span>
                </div>
                <div className="mt-2.5 text-[14.5px] font-semibold leading-[1.35] text-[#0b1024]">
                  {cls.name}
                </div>
                <p className="mt-1.5 text-[13px] leading-[1.55] text-[#3c4053]">{cls.note}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 3. Описание функциональных характеристик */}
        <section
          id="functional-characteristics"
          aria-labelledby="heading-functional"
          className="rounded-3xl border border-[#ececf4] bg-white p-6 sm:p-8"
        >
          <div className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#3848c7]">
            <Layers className="size-4" aria-hidden />
            Функциональные характеристики
          </div>
          <h2 id="heading-functional" className="mt-2 text-[22px] font-semibold tracking-[-0.015em]">
            3. Назначение и функциональные характеристики ПО «WeSetup»
          </h2>
          <p className="mt-2 max-w-[820px] text-[15px] leading-[1.65] text-[#3c4053]">
            Программный комплекс «WeSetup» автоматизирует ведение обязательной санитарной и производственной
            документации по требованиям СанПиН 2.3/2.4.3590-20, СанПиН 2.3/2.4.4282-26, СП 2.3.6.3668-20 и Технического
            регламента ТР ТС 021/2011 на предприятиях общественного питания, пищевых производствах, в продуктовом
            ритейле, отелях, образовательных и медицинских учреждениях.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {FUNCTIONAL_MODULES.map((m) => (
              <div key={m.title} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-5">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#3848c7]" aria-hidden />
                  <div>
                    <h3 className="text-[15.5px] font-semibold leading-[1.35] text-[#0b1024]">{m.title}</h3>
                    <p className="mt-1.5 text-[13.5px] leading-[1.6] text-[#3c4053]">{m.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="/reestr-po/functional-characteristics.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[13.5px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
            >
              <Download className="size-4" aria-hidden />
              Скачать полное описание функциональных характеристик (PDF)
            </a>
            <Link
              href="/journals-info"
              className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Каталог {JOURNALS_TOTAL_LABEL} <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="/features"
              className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Обзор возможностей <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </section>

        {/* 4. Стоимость программного обеспечения и порядок её расчёта */}
        <section
          id="pricing-info"
          aria-labelledby="heading-pricing-info"
          className="rounded-3xl border border-[#ececf4] bg-white p-6 sm:p-8"
        >
          <div className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#3848c7]">
            <Scale className="size-4" aria-hidden />
            Тарификация и лицензионное вознаграждение
          </div>
          <h2 id="heading-pricing-info" className="mt-2 text-[22px] font-semibold tracking-[-0.015em]">
            4. Сведения о стоимости ПО и порядке расчёта цены
          </h2>
          <p className="mt-2 max-w-[820px] text-[15px] leading-[1.65] text-[#3c4053]">
            Стоимость предоставления доступа к программному комплексу «WeSetup» определяется по публичным тарифам за одну
            производственную точку (объект) за расчётный период (1 месяц или 1 год). ООО «БФС» применяет упрощённую
            систему налогообложения (НДС не облагается, п. 4.5{" "}
            <Link href="/oferta" className="text-[#3848c7] underline underline-offset-2">
              договора-оферты
            </Link>
            ).
          </p>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full border-collapse text-left text-[14px] leading-[1.6]">
              <thead>
                <tr className="border-b border-[#0b1024] text-[12px] uppercase tracking-[0.08em] text-[#6f7282]">
                  <th className="py-2.5 pr-4 font-semibold">Тарифный план</th>
                  <th className="py-2.5 px-4 font-semibold">При оплате помесячно</th>
                  <th className="py-2.5 px-4 font-semibold">При оплате за год (в пересчёте за мес.)</th>
                  <th className="py-2.5 pl-4 font-semibold">Объём прав и включённые возможности на 1 точку</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ececf4]">
                <tr>
                  <td className="py-3 pr-4 font-semibold text-[#0b1024]">Бесплатный</td>
                  <td className="py-3 px-4 font-semibold text-[#0b1024]">0 ₽</td>
                  <td className="py-3 px-4 font-semibold text-[#0b1024]">0 ₽</td>
                  <td className="py-3 pl-4 text-[#3c4053]">
                    {FREE_TIER_SHORT} без ограничений по числу журналов и сотрудников (без привязки карты); далее
                    бессрочно бесплатно — {FREE_AFTER_TRIAL_LABEL} на 1 точку.
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-semibold text-[#0b1024]">«Стандарт»</td>
                  <td className="py-3 px-4 font-semibold text-[#0b1024]">
                    {fmtRub(planMonthlyRub(rates, "standard", "month"))} / мес
                  </td>
                  <td className="py-3 px-4 font-semibold text-[#0b1024]">
                    {fmtRub(planMonthlyRub(rates, "standard", "year"))} / мес
                    <span className="block text-[12px] font-normal text-[#6f7282]">
                      ({fmtRub(planMonthlyRub(rates, "standard", "year") * 12)} / год)
                    </span>
                  </td>
                  <td className="py-3 pl-4 text-[#3c4053]">
                    Все {JOURNALS_TOTAL_LABEL} СанПиН и ХАССП, {PAID_SEATS_LABEL}, конструктор ППК и приказов, QR/NFC,
                    выгрузка в PDF и Excel, режим «Пришла проверка», хранилище документов до 10 МБ.
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-semibold text-[#0b1024]">«Премиум»</td>
                  <td className="py-3 px-4 font-semibold text-[#0b1024]">
                    {fmtRub(planMonthlyRub(rates, "premium", "month"))} / мес
                  </td>
                  <td className="py-3 px-4 font-semibold text-[#0b1024]">
                    {fmtRub(planMonthlyRub(rates, "premium", "year"))} / мес
                    <span className="block text-[12px] font-normal text-[#6f7282]">
                      ({fmtRub(planMonthlyRub(rates, "premium", "year") * 12)} / год)
                    </span>
                  </td>
                  <td className="py-3 pl-4 text-[#3c4053]">
                    Все возможности тарифа «Стандарт», {PREMIUM_SEATS_LABEL}, подключение IoT-датчиков температуры и
                    влажности, автоввод по фотографии табло, интеграция с ФГИС «Меркурий», типовой пакет документов,
                    хранилище до 1 ГБ.
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-semibold text-[#0b1024]">«ВИП»</td>
                  <td className="py-3 px-4 font-semibold text-[#0b1024]">
                    {fmtRub(planMonthlyRub(rates, "vip", "month"))} / мес
                  </td>
                  <td className="py-3 px-4 font-semibold text-[#0b1024]">
                    {fmtRub(planMonthlyRub(rates, "vip", "year"))} / мес
                    <span className="block text-[12px] font-normal text-[#6f7282]">
                      ({fmtRub(planMonthlyRub(rates, "vip", "year") * 12)} / год)
                    </span>
                  </td>
                  <td className="py-3 pl-4 text-[#3c4053]">
                    Все возможности тарифа «Премиум», выделенный персональный консультант, приоритетная горячая линия
                    сопровождения и индивидуальная настройка процессов.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-[13.5px] leading-[1.6] text-[#3c4053]">
            <strong>Методика расчёта для сети объектов:</strong> каждая дополнительная производственная точка
            тарифицируется по ставке выбранного плана с автоматическим применением сетевой скидки на весь заказ:{" "}
            {POINTS_DISCOUNT_LINE}. Оплата принимается по безналичному счёту для юридических лиц и ИП (с закрывающими
            документами УПД, в том числе через ЭДО), а также банковской картой или через СБП.
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/pricing"
              className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Подробная страница тарифов и калькулятор стоимости <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="/oferta"
              className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Договор-оферта <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </section>

        {/* 5. Технологический стек, системные требования и инструкция по установке */}
        <section
          id="installation-and-stack"
          aria-labelledby="heading-stack"
          className="rounded-3xl border border-[#ececf4] bg-white p-6 sm:p-8"
        >
          <div className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#3848c7]">
            <Cpu className="size-4" aria-hidden />
            Стек, совместимость с российскими ОС и установка
          </div>
          <h2 id="heading-stack" className="mt-2 text-[22px] font-semibold tracking-[-0.015em]">
            5. Технологический стек, системные требования и порядок установки
          </h2>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full border-collapse text-left text-[14px] leading-[1.6]">
              <tbody className="divide-y divide-[#ececf4]">
                {TECH_STACK.map((row) => (
                  <tr key={row.label}>
                    <th className="w-[280px] py-3 pr-4 align-top font-medium text-[#6f7282]">{row.label}</th>
                    <td className="py-3 text-[#0b1024]">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-5">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
                <Server className="size-4 text-[#3848c7]" aria-hidden />
                Развёртывание серверной части (on-premise / стенд экспертизы)
              </div>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13.5px] leading-[1.6] text-[#3c4053]">
                <li>
                  Подготовьте сервер под управлением российской ОС (РЕД ОС 7.3/8+, Astra Linux SE 1.7/1.8+, Альт Сервер
                  10+) или Debian/Ubuntu (от 2 ядер ЦП x86_64, 4 ГБ ОЗУ, 40 ГБ SSD) с установленными пакетами{" "}
                  <code>Node.js 22 LTS</code>, <code>PostgreSQL 15+</code> и <code>Nginx</code>.
                </li>
                <li>
                  Создайте базу данных в кодировке UTF-8 в СУБД PostgreSQL и распакуйте дистрибутив серверной части в{" "}
                  <code>/var/www/wesetup/app</code>.
                </li>
                <li>
                  Установите зависимости (<code>npm ci</code>), заполните параметры подключения к БД и ключи в файле{" "}
                  <code>.env</code> по образцу <code>.env.shared</code>.
                </li>
                <li>
                  Инициализируйте схему БД и базовые справочники шаблонов журналов:{" "}
                  <code>npx prisma generate &amp;&amp; npx prisma db push &amp;&amp; npx tsx prisma/seed.ts</code>.
                </li>
                <li>
                  Выполните сборку (<code>npm run build</code>), запустите службу на порту <code>3002</code> под
                  управлением PM2/systemd, настройте проксирование в Nginx и проверьте готовность узла:{" "}
                  <code>curl -i http://127.0.0.1:3002/api/external/healthz</code> (ответ <code>200 OK</code>).
                </li>
              </ol>
            </div>

            <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-5">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
                <HardDrive className="size-4 text-[#3848c7]" aria-hidden />
                Подключение пользователей в облачном режиме (SaaS)
              </div>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13.5px] leading-[1.6] text-[#3c4053]">
                <li>
                  Локальная установка дистрибутива на рабочее место пользователя не требуется — работа ведётся через
                  веб-браузер (Яндекс Браузер, Chromium, Chrome, Firefox, Safari) по адресу{" "}
                  <Link href="/" className="text-[#3848c7] underline underline-offset-2">
                    https://wesetup.ru
                  </Link>
                  .
                </li>
                <li>
                  Руководитель регистрирует организацию на{" "}
                  <Link href="/register" className="text-[#3848c7] underline underline-offset-2">
                    wesetup.ru/register
                  </Link>
                  , вводит ИНН (реквизиты загружаются из ЕГРЮЛ автоматически) и выбирает тип предприятия.
                </li>
                <li>
                  Система автоматически создаёт рабочее пространство и комплект обязательных электронных журналов
                  СанПиН и ХАССП для выбранной отрасли.
                </li>
                <li>
                  Для работы со смартфона сотрудники открывают мобильную веб-версию (PWA), приложение «Сетап помощник»
                  или сканируют QR/NFC-метки на оборудовании и в помещениях.
                </li>
              </ol>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="/reestr-po/installation-guide.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[13.5px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
            >
              <Download className="size-4" aria-hidden />
              Скачать руководство по установке и развёртыванию (PDF)
            </a>
            <a
              href="/reestr-po/user-manual.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <Download className="size-4 text-[#3848c7]" aria-hidden />
              Скачать руководство пользователя (PDF)
            </a>
            <Link
              href="/baza-znaniy"
              className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <BookOpen className="size-4 text-[#3848c7]" aria-hidden />
              Онлайн-база знаний со снимками экранов
            </Link>
          </div>
        </section>

        {/* 6. Жизненный цикл, техническая поддержка и персонал */}
        <section
          id="lifecycle-and-support"
          aria-labelledby="heading-lifecycle"
          className="rounded-3xl border border-[#ececf4] bg-white p-6 sm:p-8"
        >
          <div className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#3848c7]">
            <Headphones className="size-4" aria-hidden />
            Сопровождение и жизненный цикл ПО в РФ
          </div>
          <h2 id="heading-lifecycle" className="mt-2 text-[22px] font-semibold tracking-[-0.015em]">
            6. Поддержание жизненного цикла, устранение неисправностей и техническая поддержка
          </h2>
          <p className="mt-2 max-w-[820px] text-[15px] leading-[1.65] text-[#3c4053]">
            Разработка, тестирование, эксплуатация серверной инфраструктуры, устранение неисправностей, актуализация под
            изменения санитарного законодательства РФ и техническая поддержка пользователей осуществляются штатным
            персоналом ООО «БФС» на территории Российской Федерации (141065, Московская область, г. Королёв, ул. Ленина,
            д. 10/6).
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
              <div className="text-[13px] font-semibold text-[#0b1024]">Техническая поддержка и SLA</div>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-[#3c4053]">
                Приём обращений 24/7 по почте{" "}
                <a href={`mailto:${COMPANY_EMAIL}`} className="text-[#3848c7] underline underline-offset-2">
                  {COMPANY_EMAIL}
                </a>
                , в кабинете и мессенджерах, по телефонам {COMPANY_PHONE.display} и {COMPANY_MOBILE.display}. Реакция на
                критические инциденты — до 30 минут, восстановление — до 4 часов.
              </p>
            </div>
            <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
              <div className="text-[13px] font-semibold text-[#0b1024]">Бесшовные обновления и бэкапы</div>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-[#3c4053]">
                Каждое обновление проходит более 900 автоматических тестов и выкладывается без остановки работы
                пользователей (zero-downtime) с автоматической проверкой здоровья узла и ежедневным резервным
                копированием БД в РФ.
              </p>
            </div>
            <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
              <div className="text-[13px] font-semibold text-[#0b1024]">Актуализация норм СанПиН и ХАССП</div>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-[#3c4053]">
                Обновления форм журналов, приказов и шаблонов ППК под новые редакции СанПиН и ТР ТС выпускаются
                регулярно и входят в стоимость подписки. Журнал релизов публикуется в разделе{" "}
                <Link href="/whats-new" className="text-[#3848c7] underline underline-offset-2">
                  «Что нового»
                </Link>
                .
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="/reestr-po/lifecycle-and-support.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[13.5px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
            >
              <Download className="size-4" aria-hidden />
              Скачать регламент жизненного цикла и техподдержки (PDF)
            </a>
            <Link
              href="/status"
              className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Статус работы подсистем <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="/security"
              className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Безопасность и локализация данных <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </section>

        <section aria-labelledby="heading-requisites">
          <h2 id="heading-requisites" className="text-[20px] font-semibold tracking-[-0.01em]">
            7. Реквизиты правообладателя ООО «БФС»
          </h2>
          <LegalRequisites showGooglePlayAuth={false} />
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
