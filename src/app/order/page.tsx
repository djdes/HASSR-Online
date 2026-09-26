import { PublicHeader, PublicFooter } from "@/components/public/public-chrome";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getBalance } from "@/lib/balance/ledger";
import { readTariffs, fallbackTariffs, TARIFF_BUNDLE } from "@/lib/tariffs";
import { normalizeHardwareConfig, hardwareTotal } from "@/lib/hardware-pricing";
import { OrderClient } from "./order-client";
import { redirect } from "next/navigation";
import { isMobileAppRequest, MOBILE_APP_HOME } from "@/lib/mobile-app-payments";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Страница оформления и результата оплаты.
 *
 * Адрес зафиксирован в кабинете Робокассы как SuccessURL и FailURL
 * (`https://wesetup.ru/order/`), поэтому она же обслуживает возврат
 * пользователя после оплаты. Три состояния разбираются по query —
 * см. OrderClient.
 *
 * noindex: страница транзакционная, в поиске ей делать нечего.
 */
export const metadata = {
  title: "Оформление подписки",
  robots: { index: false, follow: false },
};

export default async function OrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Оформление и оплата — не в приложении (правила магазинов).
  if (await isMobileAppRequest()) redirect(MOBILE_APP_HOME);
  const params = await searchParams;
  const first = (key: string): string => {
    const value = params[key];
    return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  };

  const tariffs = await readTariffs().catch(() => fallbackTariffs());

  // Залогиненного не переспрашиваем о почте: после мгновенной
  // регистрации он мог сразу нажать «Оплатить картой».
  const session = await getServerSession(authOptions).catch(() => null);
  const sessionEmail = session?.user?.email ?? "";

  const planKey = first("plan") || "monthly";
  const tariff = tariffs.find((t) => t.key === planKey && t.active) ?? null;

  // Состав корзины приезжает из калькулятора base64-строкой. Здесь он
  // нужен только чтобы показать сумму — платёжную сумму всё равно
  // пересчитает сервер в /api/payments/robokassa/create.
  let bundleConfig: Record<string, number> | null = null;
  if (tariff?.key === TARIFF_BUNDLE) {
    bundleConfig = normalizeHardwareConfig(decodeConfig(first("cfg")));
  }

  const amountRub = tariff
    ? tariff.priceRub + (bundleConfig ? hardwareTotal(bundleConfig) : 0)
    : 0;

  // Баллы показываем только тому, кто может распоряжаться деньгами
  // организации. ROOT в режиме «войти как» баллы клиента не тратит —
  // ни тумблера, ни списания (сервер откажет так же).
  const canSpendPoints =
    Boolean(session?.user) &&
    hasFullWorkspaceAccess(session!.user) &&
    !isImpersonating(session!);
  const pointsAvailable = canSpendPoints
    ? await getBalance(getActiveOrgId(session!)).catch(() => 0)
    : 0;

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <PublicHeader />
      <main className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-6 md:py-14">
        <OrderClient
          tariff={tariff}
          bundleConfig={bundleConfig}
          amountRub={amountRub}
          sessionEmail={sessionEmail}
          pointsAvailable={pointsAvailable}
          // Баллами оплачивается только подписка: оборудование —
          // физический товар с себестоимостью.
          pointsCap={tariff?.priceRub ?? 0}
          // Пришли из кабинета по кнопке «Включить автопродление».
          recurringDefault={first("recurring") === "1"}
          returnParams={{
            outSum: first("OutSum"),
            invId: first("InvId"),
            signature: first("SignatureValue"),
            completeToken: first("complete"),
          }}
        />
      </main>
      <PublicFooter />
    </div>
  );
}

function decodeConfig(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}
