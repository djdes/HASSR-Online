import Link from "next/link";

import {
  GOOGLE_PLAY_AUTH_PAGE_PATH,
  GOOGLE_PLAY_AUTH_PDF_PATH,
  GOOGLE_PLAY_AUTH_SIGNATURE_IMAGE_PATH,
  GOOGLE_PLAY_AUTH_STATEMENT_RU,
} from "@/lib/setup-helper-play-authorization";

export type GooglePlayAuthorizationCopy = {
  heading: string;
  statement: string;
  signatureAlt: string;
  pageLinkLabel: string;
  pdfLinkLabel: string;
};

const DEFAULT_COPY: GooglePlayAuthorizationCopy = {
  heading: "Разрешение правообладателя для Google Play",
  statement: `«${GOOGLE_PLAY_AUTH_STATEMENT_RU}»`,
  signatureAlt:
    "Подпись Генерального директора ООО «БФС» Волкова Д. В. и печать организации",
  pageLinkLabel: "Официальная страница разрешения",
  pdfLinkLabel: "Скачать бланк с подписью и печатью (PDF)",
};

export function GooglePlayAuthorizationCard({
  id = "google-play-authorization",
  copy = DEFAULT_COPY,
  showPageLink = true,
  compact = false,
}: {
  id?: string;
  copy?: GooglePlayAuthorizationCopy;
  showPageLink?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      id={id}
      className={
        compact
          ? "mt-5 border-t border-[#ececf4] pt-4 text-[14px] leading-[1.65] text-[#3c4053]"
          : "mt-6 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-5 text-[14px] leading-[1.7] text-[#3c4053] md:p-6"
      }
    >
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">
        {copy.heading}
      </div>
      <p className="mt-0! text-[14px] font-medium leading-[1.65] text-[#0b1024]">
        {copy.statement}
      </p>
      <div className="mt-3 overflow-hidden rounded-xl border border-[#e6e8f2] bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={GOOGLE_PLAY_AUTH_SIGNATURE_IMAGE_PATH}
          alt={copy.signatureAlt}
          width={920}
          height={300}
          loading="lazy"
          className="block h-auto w-full max-w-[560px]"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] font-medium">
        {showPageLink ? (
          <Link
            href={GOOGLE_PLAY_AUTH_PAGE_PATH}
            className="text-[#3848c7] underline decoration-[#3848c7]/30 underline-offset-2 transition-colors hover:text-[#0b1024]"
          >
            {copy.pageLinkLabel}
          </Link>
        ) : null}
        <a
          href={GOOGLE_PLAY_AUTH_PDF_PATH}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#3848c7] underline decoration-[#3848c7]/30 underline-offset-2 transition-colors hover:text-[#0b1024]"
        >
          {copy.pdfLinkLabel}
        </a>
      </div>
    </div>
  );
}
