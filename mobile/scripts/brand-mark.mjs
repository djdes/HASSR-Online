// Фирменный знак WeSetup — блокнот с буквой «С» — вектором. Один источник для
// иконок и заставок приложений Android/iOS (mobile/scripts/make-assets.mjs) и
// кабинета на домашнем экране, PWA (scripts/make-pwa-assets.mjs), чтобы значок
// приложения из магазина и значок установленного с сайта кабинета совпадали.
//
// Только строки SVG, без зависимостей: растеризует вызывающий скрипт (sharp).

/** Фон приложения: шапка кабинета, заставка, theme_color манифеста. */
export const BG = "#0b1024";

/**
 * Знак в собственной системе координат 120×120, центр в (60, 60).
 * scale — во сколько раз увеличить, (cx, cy) — куда поставить центр.
 * Дальняя от центра точка знака — ~71 единица (угол обложки и кольца):
 * при scale = 0.4·сторона/71 знак целиком внутри круга маски (maskable).
 */
export function mark(cx, cy, scale) {
  const t = `translate(${cx - 60 * scale} ${cy - 60 * scale}) scale(${scale})`;
  return `
  <g transform="${t}">
    <!-- тень под блокнотом -->
    <ellipse cx="62" cy="112" rx="40" ry="5" fill="#000" opacity="0.28"/>
    <!-- задняя обложка -->
    <rect x="26" y="14" width="76" height="96" rx="11" fill="url(#back)"/>
    <!-- страницы -->
    <rect x="30" y="92" width="68" height="11" rx="3" fill="url(#pages)"/>
    <!-- передняя обложка -->
    <rect x="20" y="8" width="78" height="90" rx="11" fill="url(#cover)"/>
    <rect x="23" y="11" width="72" height="84" rx="9" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="1.6"/>
    <!-- застёжка -->
    <rect x="91" y="44" width="15" height="22" rx="4.5" fill="url(#clasp)"/>
    <rect x="93" y="46.5" width="4" height="17" rx="2" fill="#ffffff" opacity="0.22"/>
    <!-- кольца -->
    <g fill="none" stroke="url(#ring)" stroke-width="5.2" stroke-linecap="round">
      <path d="M27 28 C 13 26, 11 38, 26 38"/>
      <path d="M27 50 C 13 48, 11 60, 26 60"/>
      <path d="M27 72 C 13 70, 11 82, 26 82"/>
    </g>
    <!-- буква «С» -->
    <path d="M73.5 40.5 A 17.5 17.5 0 1 0 73.5 65.5" fill="none" stroke="#ffffff" stroke-width="10" stroke-linecap="round"/>
  </g>`;
}

export const DEFS = `
  <defs>
    <linearGradient id="cover" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7584ff"/>
      <stop offset="0.55" stop-color="#5566f6"/>
      <stop offset="1" stop-color="#4353e6"/>
    </linearGradient>
    <linearGradient id="back" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3f4fe0"/>
      <stop offset="1" stop-color="#3342c8"/>
    </linearGradient>
    <linearGradient id="pages" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#dfe3f5"/>
    </linearGradient>
    <linearGradient id="clasp" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6070fb"/>
      <stop offset="1" stop-color="#3b4ad9"/>
    </linearGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#c9cdf7"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.45" r="0.5">
      <stop offset="0" stop-color="#5566f6" stop-opacity="0.38"/>
      <stop offset="1" stop-color="#5566f6" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

/**
 * Квадратный (или прямоугольный) холст: фон, свечение под знаком, тело.
 * width/height — размер в пикселях; glow рисуется кругом от меньшей стороны.
 */
export function svg(width, body, { height = width, background = true, glow = true } = {}) {
  const r = Math.min(width, height) * 0.42;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${DEFS}
  ${background ? `<rect width="${width}" height="${height}" fill="${BG}"/>` : ""}
  ${glow ? `<circle cx="${width / 2}" cy="${height / 2}" r="${r}" fill="url(#glow)"/>` : ""}
  ${body}
</svg>`;
}

/**
 * Белый силуэт знака на прозрачном фоне (24×24) — тот же, что у push в
 * приложении Android (android/app/src/main/res/drawable/ic_stat_notify.xml).
 * Система берёт у такого значка только прозрачность и красит сама.
 */
export function silhouette(size) {
  const k = size / 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="scale(${k})" fill="#ffffff">
    <path fill-rule="evenodd" d="M8,2h9a3,3 0,0 1,3 3v14a3,3 0,0 1,-3 3H8a3,3 0,0 1,-3 -3V5a3,3 0,0 1,3 -3zM15.3,9.2a4,4 0,1 0,0 5.6l-1.4,-1.4a2,2 0,1 1,0 -2.8z"/>
    <path d="M3,6h3v2H3a1,1 0,0 1,0 -2zM3,11h3v2H3a1,1 0,0 1,0 -2zM3,16h3v2H3a1,1 0,0 1,0 -2z"/>
  </g>
</svg>`;
}
