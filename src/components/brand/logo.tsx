/**
 * Брендовые знаки WeSetup.
 *
 * Начертание — присланный файл `public/brand/wordmark.png` (белые
 * буквы на прозрачном фоне). Показываем его НЕ картинкой, а маской:
 * прозрачность PNG вырезает форму букв, а цвет даёт `currentColor`
 * родителя. Иначе пришлось бы держать два файла — белый для тёмных
 * шапок и тёмный для светлых — и вручную выбирать нужный в каждом из
 * девяти мест, где стоит знак. С маской он темнеет на лендинге,
 * белеет на экране входа и подхватывается тёмной темой кабинета сам.
 *
 * Ширина считается от высоты по пропорции файла. Проп `height` — это
 * запасное значение для CSS-переменной `--logo-h`, а не inline-высота,
 * поэтому на брейкпоинте размер можно переопределить классом:
 * `className="sm:[--logo-h:26px]"`. Голый `sm:h-[26px]` не сработает —
 * inline-стиль класс не перебивает; и саму переменную inline не задаём
 * по той же причине.
 */
const WORDMARK_SRC = "/brand/wordmark.png";
/**
 * Файл обрезан по фактическим границам букв (2006×533). В исходнике
 * вокруг знака были поля, и маска центрировала коробку, а не сам знак —
 * он вставал выше оптического центра строки.
 */
export const WORDMARK_RATIO = 2006 / 533;

/**
 * Где в файле знака буквы (доли ширины, непрозрачность ≥ 32 из 255): слева
 * поле 3.2%, справа 8.3% — остальное почти прозрачная кайма. По буквам, а не
 * по коробке, равняется подпись на главной (`logo.test.ts` сверяет с файлом).
 */
export const WORDMARK_INK = { left: 29 / 900, right: 75 / 900 } as const;

export function BrandLogo({
  height = 22,
  className,
  title = "WeSetup",
  gradient = false,
}: {
  /** Высота знака в px. */
  height?: number;
  className?: string;
  /** Пустая строка — знак декоративный, читалка его пропустит. */
  title?: string;
  /**
   * Градиент индиго → бирюза → лаванда, как на визитке (главная, 2026-10-29):
   * через ту же маску, цвета — `--app-wordmark-gradient` (свой для тёмной темы).
   */
  gradient?: boolean;
}) {
  return (
    <span
      role={title ? "img" : "presentation"}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={className}
      style={{
        // block, а не inline-block: у строчного элемента бокс садится
        // на базовую линию, и знак вставал выше центра строки.
        display: "block",
        height: `var(--logo-h, ${height}px)`,
        width: `calc(var(--logo-h, ${height}px) * ${WORDMARK_RATIO})`,
        ...(gradient
          ? { backgroundImage: "var(--app-wordmark-gradient)" }
          : { backgroundColor: "currentColor" }),
        WebkitMaskImage: `url(${WORDMARK_SRC})`,
        maskImage: `url(${WORDMARK_SRC})`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}

/**
 * Иконка приложения — растровая: в ней объём и цветная подложка,
 * которые в маску не переносятся. Тот же файл лежит в PWA-иконках и
 * в фавиконе.
 */
export function BrandMark({
  size = 32,
  className,
  title = "WeSetup",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/icon-64.png"
      width={size}
      height={size}
      alt={title}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}
