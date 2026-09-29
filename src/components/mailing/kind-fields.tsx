"use client";

import { lazy, Suspense, type ComponentType } from "react";
import { Loader2, PuzzleIcon } from "lucide-react";

/**
 * Поля формы конкретного типа рассылки. Общие поля (название, каналы,
 * получатели, время) — в форме ROOT; то, что зависит от типа, — отдельный
 * компонент `src/components/mailing/fields/<kind>.tsx` (default export).
 * Он находится по `kind` сам: новый тип не требует правок формы.
 */

export type MailingKindFieldsProps<P = unknown> = {
  payload: P;
  onChange: (next: P) => void;
  disabled?: boolean;
  /** Сколько выбрано получателей — для подсказок («сфера по получателю»). */
  audience: { users: number; contacts: number };
};

const KIND_RE = /^[a-z][a-z0-9-]{0,39}$/;

type AnyFields = ComponentType<MailingKindFieldsProps<any>>;

function missingFields(kind: string): AnyFields {
  function MissingFields() {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-4 text-[13px] leading-[1.55] text-[#6f7282]">
        <PuzzleIcon className="mt-0.5 size-4 shrink-0 text-[#9b9fb3]" />
        <span>
          Для типа «{kind}» нет формы. Её файл —{" "}
          <code className="rounded bg-white px-1 text-[12px]">src/components/mailing/fields/{kind}.tsx</code>.
        </span>
      </div>
    );
  }
  return MissingFields;
}

const cache = new Map<string, AnyFields>();

function fieldsFor(kind: string): AnyFields {
  const hit = cache.get(kind);
  if (hit) return hit;
  const component = lazy(async () => {
    if (!KIND_RE.test(kind)) return { default: missingFields(kind) };
    try {
      const mod = (await import(`./fields/${kind}`)) as { default?: AnyFields };
      return { default: mod.default ?? missingFields(kind) };
    } catch {
      return { default: missingFields(kind) };
    }
  });
  cache.set(kind, component);
  return component;
}

export function MailingKindFields({ kind, ...props }: MailingKindFieldsProps<any> & { kind: string }) {
  const Fields = fieldsFor(kind);
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 py-6 text-[13px] text-[#6f7282]">
          <Loader2 className="size-4 animate-spin" /> Загружаем поля…
        </div>
      }
    >
      <Fields {...props} />
    </Suspense>
  );
}
