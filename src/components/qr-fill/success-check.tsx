import { QR_CHECK_CSS, QR_CHECK_SVG } from "@/lib/qr-pin-ui";

/**
 * Галка экрана «Записано» на QR-формах: залитый сине-зелёный круг с белой
 * галкой и мягким ореолом, короткий «pop». Раньше — зелёный контурный круг,
 * его путали с логотипом Сбербанка. Разметка и CSS — общие с серверными
 * страницами (`QR_CHECK_*` в `qr-pin-ui.ts`); стиль подключается здесь же
 * (React 19 дедуплицирует `<style href precedence>`), в `globals.css` не
 * зависит. При `prefers-reduced-motion` — сразу готовая.
 */
export function SuccessCheck({ label = "Сохранено", size = 112 }: { label?: string; size?: number }) {
  return (
    <div className="mx-auto mb-5 flex justify-center p-3">
      <style href="wesetup-qr-check" precedence="default">
        {QR_CHECK_CSS}
      </style>
      <div
        role="status"
        aria-label={label}
        className="qc"
        style={{ ["--qc" as string]: `${size}px` }}
        dangerouslySetInnerHTML={{ __html: QR_CHECK_SVG }}
      />
    </div>
  );
}
