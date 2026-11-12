"use client";

import { Check, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";

/**
 * Печати «по ХАССП / СанПиН / ТР ТС» на тёмной левой панели входа и
 * регистрации: с первого взгляда видно, что сервис — про журналы пищевой
 * безопасности. Это знаки тематики, не сертификаты: в надписях нет слов
 * «сертифицировано» или «одобрено». Рисуем сами (SVG), без чужих логотипов.
 */
type SealProps = {
  top: string;
  bottom: string;
  center: string;
  sub?: string;
  color: string;
  check?: boolean;
};

function Seal({ top, bottom, center, sub, color, check }: SealProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ring = { fontSize: 8, letterSpacing: 0.8, fontWeight: 700, fill: color } as const;
  return (
    <svg viewBox="0 0 120 120" className="size-[78px] shrink-0 xl:size-[86px]" aria-hidden="true">
      <defs>
        {/* Верхняя надпись стоит на дуге r=47 (буквы наружу), нижняя — на r=55 (буквы внутрь). */}
        <path id={`${id}-top`} d="M 13 60 A 47 47 0 0 1 107 60" fill="none" />
        <path id={`${id}-bottom`} d="M 5 60 A 55 55 0 0 0 115 60" fill="none" />
      </defs>
      <circle cx="60" cy="60" r="58" fill={color} fillOpacity="0.08" stroke={color} strokeWidth="2" />
      <circle cx="60" cy="60" r="43" fill="none" stroke={color} strokeOpacity="0.55" strokeWidth="1" />
      <text {...ring} textAnchor="middle">
        <textPath href={`#${id}-top`} startOffset="50%">{top}</textPath>
      </text>
      <text {...ring} textAnchor="middle">
        <textPath href={`#${id}-bottom`} startOffset="50%">{bottom}</textPath>
      </text>
      <circle cx="9" cy="60" r="1.6" fill={color} />
      <circle cx="111" cy="60" r="1.6" fill={color} />
      {check ? (
        <path d="M 44 61 L 55 72 L 77 48" fill="none" stroke={color} strokeWidth="6"
          strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <>
          <text x="60" y={sub ? 60 : 66} textAnchor="middle" fill="#ffffff" fontSize="17"
            fontWeight="800" letterSpacing="0.3">{center}</text>
          {sub ? (
            <text x="60" y="76" textAnchor="middle" fill={color} fontSize="9" fontWeight="700">{sub}</text>
          ) : (
            <text x="60" y="81" textAnchor="middle" fill={color} fontSize="8" letterSpacing="2">★★★</text>
          )}
        </>
      )}
    </svg>
  );
}

export function AuthComplianceBadges({ className = "" }: { className?: string }) {
  const t = useTranslations("auth.badges");
  const seals: SealProps[] = [
    { top: t("haccp.top"), bottom: t("haccp.bottom"), center: t("haccp.center"), color: "#7cf5c0" },
    { top: t("sanpin.top"), bottom: t("sanpin.bottom"), center: t("sanpin.center"), color: "#a9b6ff" },
    { top: t("trts.top"), bottom: t("trts.bottom"), center: t("trts.center"), sub: "021/2011", color: "#ffd28a" },
    { top: t("food.top"), bottom: t("food.bottom"), center: "", color: "#ff9fc8", check: true },
  ];
  return (
    <section className={"border-t border-white/10 pt-6 " + className} data-auth-badges>
      <h2 className="text-[12px] uppercase tracking-[0.2em] text-white/60">{t("title")}</h2>
      <ul className="mt-4 flex flex-wrap items-center gap-3 xl:gap-4" aria-label={t("title")}>
        {seals.map((seal) => (
          <li key={seal.top} title={seal.check ? `${seal.top} · ${seal.bottom}` : `${seal.center} — ${seal.top} ${seal.bottom}`}>
            <Seal {...seal} />
            <span className="sr-only">{seal.check ? `${seal.top}, ${seal.bottom}` : `${seal.center}: ${seal.top} ${seal.bottom}`}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#7cf5c0]/50 bg-[#7cf5c0]/10">
          <ShieldCheck className="size-5 text-[#7cf5c0]" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-white/90">{t("forms")}</p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-white/65">
            {[t("catering"), t("production"), t("retail")].map((item) => (
              <li key={item} className="flex items-center gap-1.5">
                <Check className="size-3.5 text-[#7cf5c0]" />{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
