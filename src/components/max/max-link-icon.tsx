import { Check, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MaxIcon } from "./max-icon";

/**
 * Значок «привязать MAX к аккаунту» (владелец, 2026-11-22: «к иконке MAX
 * привяжи значок связи — цепь, чтобы было понятно, что это привязка MAX к
 * аккаунту»). Знак MAX и маленький круглый значок в правом нижнем углу:
 *   • не привязан — цепь: нажмите, чтобы связать;
 *   • привязан — зелёная галочка (цвет статуса «готово»).
 * Значок лежит внутри коробки кнопки и отделён от знака кольцом цвета фона
 * (`ringClassName` — для тёмной шапки приложения). Голый знак MAX без значка
 * остаётся там, где MAX — просто канал связи (контакты, бланки).
 */
export function MaxLinkIcon({
  linked = false,
  className,
  ringClassName = "ring-[var(--app-surface,#fff)]",
}: {
  linked?: boolean;
  className?: string;
  ringClassName?: string;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)} data-max-link-icon={linked ? "linked" : "unlinked"}>
      <MaxIcon className="size-full" />
      <span
        aria-hidden
        className={cn(
          "absolute -right-[3px] -bottom-[3px] flex size-[46%] items-center justify-center rounded-full ring-2",
          ringClassName,
          linked ? "bg-[#16a34a] text-white" : "bg-[var(--app-surface,#fff)] text-[var(--app-text-secondary,#3c4053)]",
        )}
      >
        {linked ? <Check className="size-[72%] stroke-[3]" /> : <Link2 className="size-[74%] stroke-[2.4]" />}
      </span>
    </span>
  );
}
