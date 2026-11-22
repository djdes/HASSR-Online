"use client";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { MaxLinkIcon } from "./max-link-icon";

/**
 * Кнопка «MAX» в шапке кабинета, приложения и QR-страниц: ведёт на
 * `/max/connect` и возвращает обратно. Значок — MAX со значком связи
 * (`MaxLinkIcon`): цепь, пока аккаунт не привязан, галочка — когда привязан
 * (`linked` приходит с сервера; неизвестно — как не привязан).
 */
export function MaxConnectButton({ dark = false, linked = false }: { dark?: boolean; linked?: boolean }) {
  const pathname = usePathname();
  const t = useTranslations("sharedUi.maxLink");
  const label = linked ? t("linked") : t("connect");
  return (
    <a
      href={`/max/connect?next=${encodeURIComponent(pathname)}`}
      aria-label={label}
      title={label}
      data-max-connect={linked ? "linked" : "unlinked"}
      onClick={(event) => {
        event.currentTarget.href = `/max/connect?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      }}
      className={`inline-flex size-10 shrink-0 items-center justify-center rounded-2xl transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/30 ${dark ? "bg-white/10 hover:bg-white/20" : "hover:bg-[#eef1ff] newd:rounded-[10px] newd:border newd:border-[#e7e7ec] newd:bg-white newd:hover:bg-[#f1f1f4]"}`}
    >
      <MaxLinkIcon
        linked={linked}
        className={dark ? "size-7" : "size-7 newd:size-[22px]"}
        ringClassName={dark ? "ring-[#0b1024]/50" : undefined}
      />
    </a>
  );
}
