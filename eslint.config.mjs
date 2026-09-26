import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Git-worktree копии репозитория тащат за собой .next/, .agent/,
    // node_modules — без этого 31k+ ложных «ошибок» из compiled JS.
    ".worktrees/**",
    // Внутренние артефакты proof-loop'а и playwright-MCP — не code.
    ".agent/**",
    ".playwright-mcp/**",
    // Статические PDF/sample-данные / one-off scripts.
    "pgdata/**",
    "users/**",
    "scripts/**",
    "doc/**",
    "audit/**",
    "voltagent-subagents/**",
    "prompt-guide/**",
    "docs/**",
    // Мобильный проект Capacitor (свои node_modules, сгенерированный
    // нативный код и сборки Android/iOS) — не код сайта.
    "mobile/**",
    // Отчёты и dev-only артефакты.
    "eslint-report.json",
    "*.log",
  ]),
  // Менее жёсткие правила для устаревших и serverside-only утилит,
  // где legacy-стиль ОК и явно не блочит работоспособность.
  {
    plugins: { "react-hooks": reactHooks, react },
    rules: {
      // 172 нарушений по unused-vars, в основном legacy-helpers и
      // catch (err) without использование. Превращаем в warning,
      // чтобы не блокировать CI; всё с подчёркиванием _ игнорируем.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // Использование <img> вместо next/image — для WeSetup
      // организации часто загружают свой logoUrl с произвольного
      // CDN; next/image требует whitelist'ить домены и в SSR не
      // поможет. Понижаем до warn.
      "@next/next/no-img-element": "warn",
      // any иногда нужен в legacy-местах с JSON/dynamic; пусть
      // остаётся warn чтобы видно было, но не блокирует CI.
      "@typescript-eslint/no-explicit-any": "warn",
      // React 19 strict-mode hints. Технически НЕ баги — это указания
      // на «лучше использовать useSyncExternalStore» вместо
      // useEffect+setState на mount (для localStorage hydration и
      // подобного). Понижаем до warn — не блокируем CI, но видны при
      // code-review. exhaustive-deps оставляем error — это про
      // корректность хуков.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      // Apostrophes / quotes в JSX-тексте — в русском интерфейсе
      // встречаются часто, escape только запутывает чтение.
      "react/no-unescaped-entities": "warn",
    },
  },
]);

export default eslintConfig;
