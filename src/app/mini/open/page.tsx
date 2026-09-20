import Link from "next/link";
import { ArrowLeft, ExternalLink, MonitorSmartphone } from "lucide-react";

type MiniOpenSearchParams = {
  href?: string;
  label?: string;
};

function normalizeDashboardHref(rawHref: string | undefined): string {
  const href = rawHref?.trim() || "/dashboard";
  if (!href.startsWith("/") || href.startsWith("//")) {
    return "/dashboard";
  }
  if (href === "/mini" || href.startsWith("/mini/")) {
    return href;
  }
  return href;
}

export default async function MiniOpenPage({
  searchParams,
}: {
  searchParams: Promise<MiniOpenSearchParams>;
}) {
  const params = await searchParams;
  const href = normalizeDashboardHref(params.href);
  const label = params.label?.trim() || "этот раздел";
  const isMiniHref = href === "/mini" || href.startsWith("/mini/");

  return (
    <div className="flex flex-1 flex-col gap-4 pb-24">
      <Link
        href="/mini"
        className="mini-press inline-flex w-fit items-center gap-1 text-[13px] font-medium"
        style={{ color: "var(--mini-text-muted)" }}
      >
        <ArrowLeft className="size-4" />
        На главную
      </Link>

      <section
        className="rounded-3xl border px-5 py-6 text-center"
        style={{
          background: "var(--mini-surface-1)",
          borderColor: "var(--mini-divider)",
        }}
      >
        <div
          className="mx-auto flex size-12 items-center justify-center rounded-3xl"
          style={{
            background: "var(--mini-lime-soft)",
            color: "var(--mini-lime)",
          }}
        >
          <MonitorSmartphone className="size-6" />
        </div>
        <h1
          className="mt-4 text-[22px] font-semibold tracking-[-0.02em]"
          style={{ color: "var(--mini-text)" }}
        >
          Раздел в полной версии
        </h1>
        <p
          className="mt-2 text-[14px] leading-6"
          style={{ color: "var(--mini-text-muted)" }}
        >
          «{label}» пока нет в телефоне. Полная версия кабинета откроется
          прямо отсюда — в том же окне.
        </p>

        <div className="mt-5 grid gap-2">
          <Link
            href={href}
            className="mini-press inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-4 text-[14px] font-medium"
            style={{
              background: "var(--mini-lime)",
              color: "var(--mini-primary-contrast)",
            }}
          >
            {isMiniHref ? "Открыть в приложении" : "Открыть полную версию"}
            <ExternalLink className="size-4" />
          </Link>
          <Link
            href="/mini"
            className="mini-press inline-flex h-11 items-center justify-center rounded-2xl border px-4 text-[14px] font-medium"
            style={{
              borderColor: "var(--mini-divider-strong)",
              color: "var(--mini-text)",
            }}
          >
            Вернуться на главную
          </Link>
        </div>
      </section>
    </div>
  );
}
