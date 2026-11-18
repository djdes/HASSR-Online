import { BrandLogo, WORDMARK_INK } from "@/components/brand/logo";

/** Доля ширины файла знака, занятая буквами (без прозрачных полей). */
const INK_WIDTH = 1 - WORDMARK_INK.left - WORDMARK_INK.right;

/**
 * Логотип шапки публичных страниц с подписью «Ваш электронный ХАССП»
 * (правки 05.11.2026: «далее — везде»). На `sm` и шире подпись стоит справа
 * от знака через черту.
 *
 * На телефоне подпись под знаком, и знак подогнан под неё (правки
 * 18.11.2026): ширину блока задаёт строка подписи, знак растягивается так,
 * чтобы его буквы — а не коробка файла с прозрачными полями — начинались и
 * заканчивались ровно над подписью. Поэтому коробка знака шире блока на поля
 * файла и сдвинута влево на левое поле.
 */
export function BrandWithTagline({ tagline }: { tagline: string }) {
  // Длинная подпись (узбекская — 32 знака) в одну строку вытеснила бы из шапки
  // телефона «Тарифы» и вход: на телефоне она идёт в две строки.
  const long = tagline.length > 24;
  return (
    <span className="inline-flex flex-col items-stretch gap-[5px] sm:flex-row sm:items-center sm:gap-3">
      <span
        className="block sm:hidden"
        style={{
          width: 0,
          minWidth: `${100 / INK_WIDTH}%`,
          marginLeft: `${(-WORDMARK_INK.left / INK_WIDTH) * 100}%`,
        }}
      >
        <BrandLogo fluid title="" />
      </span>
      <span className="hidden sm:block">
        <BrandLogo height={26} title="" />
      </span>
      <span
        className={
          "brand-tagline text-[11px] font-medium text-[#6f7282] sm:max-w-none sm:whitespace-nowrap sm:border-l sm:border-[#dcdfed] sm:py-0.5 sm:pl-3 sm:text-[14px] sm:leading-none " +
          (long ? "max-w-[124px] leading-[1.15]" : "whitespace-nowrap leading-none")
        }
      >
        {tagline}
      </span>
    </span>
  );
}
