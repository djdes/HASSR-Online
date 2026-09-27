import type { CSSProperties } from "react";
import { QrCode } from "lucide-react";

/**
 * QR-наклейка — золотая, как «QR-точка контроля» в кабинете (золото в
 * дизайн-системе — только акцент QR, одно на экран). Цвета inline, чтобы
 * ночная тема не перекрасила белую подложку кода. Размеры в `em`: наклейку
 * масштабирует `font-size` родителя.
 *
 * Код — фирменный ч/б QR (знак по центру), SVG собирается на сервере
 * (`buildQrMatrix` в `qr-matrix.ts`) — пакет `qrcode` в клиентский бандл
 * не попадает.
 */
export type QrMatrix = {
  /** Без рамки и полосы «Отсканировать»: подпись даёт золотая рамка наклейки. */
  bare: string;
  /** Как печатает продукт (формат «наклейка»): с рамкой и полосой. */
  printed: string;
};

export function QrSticker({
  qr,
  caption = "Отсканируйте",
  className,
  style,
}: {
  qr: QrMatrix;
  caption?: string | false;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        borderRadius: "0.95em",
        padding: "0.42em",
        background: "linear-gradient(135deg,#fff3c4 0%,#fcd34d 40%,#f5b301 75%,#dc9d00 100%)",
        boxShadow: "0 0.8em 1.8em -0.9em rgba(220,157,0,0.75), inset 0 0.06em 0 rgba(255,255,255,0.65)",
        ...style,
      }}
    >
      <div
        style={{ background: "#ffffff", borderRadius: "0.6em", padding: "0.4em" }}
        aria-hidden="true"
        // SVG собран на сервере из нашего же адреса — безопасно встраивать.
        dangerouslySetInnerHTML={{ __html: qr.bare }}
      />
      {caption ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.3em",
            marginTop: "0.35em",
            color: "#5b3a00",
            fontWeight: 700,
            fontSize: "0.66em",
            letterSpacing: "0.01em",
            whiteSpace: "nowrap",
          }}
        >
          <QrCode style={{ width: "1.1em", height: "1.1em" }} />
          {caption}
        </div>
      ) : null}
    </div>
  );
}
