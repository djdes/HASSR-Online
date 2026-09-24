"use client";

import { AbsoluteFill, useCurrentFrame } from "remotion";

import { SceneFrame, type SceneDay } from "./scene";
import type { QrMatrix } from "./qr-sticker";

export type QrCompositionProps = {
  fridgeTemp: number;
  bodyTemp: number;
  today: SceneDay;
  qr: QrMatrix;
};

/**
 * Композиция Remotion: номер кадра выдаёт `useCurrentFrame()` Плеера,
 * картинка — тот же чистый `SceneFrame(frame)`, что и раньше.
 *
 * `@container` стоит на корне композиции: cqw-шрифты сцены считаются от
 * размеров композиции (px из `compositionWidth/Height`), а Плеер
 * масштабирует готовый кадр под контейнер — пропорции инвариантны.
 */
export const QrComposition: React.FC<QrCompositionProps> = ({ fridgeTemp, bodyTemp, today, qr }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill className="@container">
      <SceneFrame frame={frame} fridgeTemp={fridgeTemp} bodyTemp={bodyTemp} today={today} qr={qr} />
    </AbsoluteFill>
  );
};
