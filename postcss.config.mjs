import path from "node:path";

/*
 * «Размер текста»: кегли умножаются на CSS-переменную (по умолчанию 1) —
 * см. сам плагин. Путь абсолютный от корня проекта: Turbopack (`next dev`)
 * загружает плагины из своего каталога сборки, относительный путь от
 * конфига там не находится. Next запускается из корня проекта и в dev, и
 * в build.
 */
const textScalePlugin = path.join(process.cwd(), "postcss-plugins", "text-scale.cjs");

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    // После Tailwind — он уже развернул утилиты в обычные правила.
    [textScalePlugin]: {},
  },
};

export default config;
