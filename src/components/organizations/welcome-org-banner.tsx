"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, ClipboardList, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";

const STORAGE_PREFIX = "wesetup.welcome-org.";

/**
 * sessionStorage читаем через useSyncExternalStore, а не в useEffect:
 * на сервере снапшот всегда `false` (баннер рисуется), на клиенте —
 * реальное значение. Так нет ни рассинхрона гидрации, ни каскадного
 * ре-рендера от setState внутри эффекта.
 */
const noopSubscribe = () => () => {};

function readDismissed(organizationId: string): boolean {
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + organizationId) === "1";
  } catch {
    // Приватный режим / заблокированное хранилище — просто показываем баннер.
    return false;
  }
}

/**
 * Быстрый старт новой организации.
 *
 * После создания точки человек попадает на пустой дашборд и в первую
 * секунду не понимает, переключился ли он вообще. Баннер отвечает сразу
 * на оба вопроса: вот новая организация, вот два шага, которые
 * осталось сделать (люди и набор журналов).
 *
 * Показывается только по `?welcome-org=1` — то есть ровно один раз,
 * сразу после создания. Закрытие помним в `sessionStorage`, чтобы
 * `router.refresh()` не вернул баннер обратно.
 */
export function WelcomeOrgBanner({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const router = useRouter();
  const t = useTranslations("organizationsUi");
  const searchParams = useSearchParams();
  const requested = searchParams.get("welcome-org") === "1";
  const [dismissed, setDismissed] = useState(false);
  const dismissedBefore = useSyncExternalStore(
    noopSubscribe,
    () => readDismissed(organizationId),
    () => false,
  );

  if (!requested || dismissed || dismissedBefore) return null;

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(STORAGE_PREFIX + organizationId, "1");
    } catch {
      /* приватный режим — переживём */
    }
    // Убираем параметр из адреса: перезагрузка страницы не должна
    // возвращать уже закрытый баннер.
    router.replace("/dashboard");
  }

  return (
    <div className="mx-auto w-full max-w-[1800px] px-4 pt-4 md:px-8">
      <div className="relative overflow-hidden rounded-3xl border border-[#ececf4] bg-[#fafbff] p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6">
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("welcomeOrgBanner.hide")}
          className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-full text-[#9b9fb3] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#0b1024]"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-start gap-3 pr-8">
          <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <Building2 className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-[#0b1024]">
              {t("welcomeOrgBanner.title", { name: organizationName })}
            </div>
            <p className="mt-1 text-[14px] leading-[1.55] text-[#6f7282]">
              {t("welcomeOrgBanner.description")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/settings/users"
                className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0]"
              >
                <Users className="size-4" />
                {t("welcomeOrgBanner.addStaff")}
              </Link>
              <Link
                href="/settings/journals"
                className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                <ClipboardList className="size-4 text-[#5566f6]" />
                {t("welcomeOrgBanner.checkJournals")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
