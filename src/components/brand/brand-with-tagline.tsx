import { BrandLogo } from "@/components/brand/logo";

/**
 * Логотип шапки публичных страниц с подписью «Ваш электронный ХАССП»
 * (правки 05.11.2026: «далее — везде»). На телефоне подпись под знаком —
 * рядом с ним в шапке нет места, на `sm` и шире — справа через черту.
 */
export function BrandWithTagline({ tagline }: { tagline: string }) {
  return (
    <span className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-3">
      <BrandLogo height={24} className="sm:[--logo-h:26px]" title="" />
      <span className="brand-tagline whitespace-nowrap text-[11px] font-medium leading-none text-[#6f7282] sm:border-l sm:border-[#dcdfed] sm:py-0.5 sm:pl-3 sm:text-[14px]">
        {tagline}
      </span>
    </span>
  );
}
