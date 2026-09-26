"""
Печать, «камера» и два независимых декодера для проверки фирменного QR
(вызывается из check-brand-qr.ts и e2e-brand-qr.ts, отдельно не нужен).

Вход (stdin, JSON): {"out": <папка>, "items": [...]}, элемент — либо
  {"id", "kind": "print", "master": <PNG 600 dpi>, "captures": [150, 200, 300], "url"}
  — код на реальном размере печати, отрисованный как печатает принтер (600 dpi);
либо
  {"id", "kind": "screen", "file": <PNG экрана>, "dpi": 96|192|288, "url"}.
Выход (stdout, JSON): [{"id", "dpi", "transform", "file", "cv", "cvHow", "zx"}]

Печать → камера (для каждого dpi снимка из captures):
  clean        — камера снимает лист при dpi (усреднение по площади пикселя);
  gray         — ч/б печать: яркость BT.601;
  threshold    — ч/б без полутонов: жёсткий порог 50 % по снимку;
  dither       — ч/б лазерный принтер: серое 600 dpi → упорядоченный растр
                 Байера 8×8 (точки тонера; чёрные модули остаются сплошными)
                 → оптика камеры 0,1 мм → снимок при dpi;
  phone        — «снимок с телефона» по спеке: поворот 7°, лёгкое размытие
                 σ = 0,8 px, JPEG q = 85;
  dither+phone — ч/б печать, снятая телефоном;
  phone-hard   — жёстче спеки (стресс): ещё наклон (трапеция 5 %), яркость
                 ×0,9 + 8, шум σ = 3, JPEG q = 75.
Экран (kind=screen): clean, gray, phone, phone-hard по пикселям экрана.

Декодеры: OpenCV (cv2.QRCodeDetector, при неудаче — cv2.QRCodeDetectorAruco;
без увеличения картинки) и zxing-cpp (ZXING_PY — путь к пакету во временной
папке, в зависимости проекта не входит). jsQR читает те же файлы в TS-скрипте.
"""
import json
import os
import sys

import cv2
import numpy as np

if os.environ.get("ZXING_PY"):
    sys.path.insert(0, os.environ["ZXING_PY"])
import zxingcpp  # noqa: E402

PRINT_DPI = 600.0


def bayer(n):
    m = np.array([[0, 2], [3, 1]])
    while m.shape[0] < n:
        m = np.block([[4 * m, 4 * m + 2], [4 * m + 3, 4 * m + 1]])
    return m


BAYER8 = bayer(8)


def to_gray(img):
    return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def resample(img, dpi, from_dpi=PRINT_DPI):
    h, w = img.shape[:2]
    f = dpi / from_dpi
    return cv2.resize(img, (max(1, round(w * f)), max(1, round(h * f))), interpolation=cv2.INTER_AREA)


def halftone(master):
    g = to_gray(master).astype(np.float32)
    h, w = g.shape
    thr = (np.tile(BAYER8, (h // 8 + 1, w // 8 + 1))[:h, :w] + 0.5) / 64.0 * 255.0
    dots = np.where(g > thr, 255.0, 0.0).astype(np.float32)
    # Оптика камеры: 0,1 мм при 600 dpi = 2,36 px.
    return cv2.GaussianBlur(dots, (0, 0), sigmaX=PRINT_DPI / 254.0)


def phone(img, hard=False, seed=7):
    rng = np.random.default_rng(seed)
    color = img if img.ndim == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    h, w = color.shape[:2]
    pad = int(0.08 * max(h, w))
    color = cv2.copyMakeBorder(color, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    H, W = color.shape[:2]
    if hard:
        k = 0.05 * W
        src = np.float32([[0, 0], [W, 0], [W, H], [0, H]])
        dst = np.float32([[k, 0], [W - k, 0], [W, H], [0, H]])
        color = cv2.warpPerspective(color, cv2.getPerspectiveTransform(src, dst), (W, H), flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255))
    rot = cv2.getRotationMatrix2D((W / 2, H / 2), 7, 1.0)
    color = cv2.warpAffine(color, rot, (W, H), flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255))
    color = cv2.GaussianBlur(color, (0, 0), 0.8)
    if hard:
        color = np.clip(color.astype(np.float32) * 0.9 + 8 + rng.normal(0, 3, color.shape), 0, 255).astype(np.uint8)
    ok, enc = cv2.imencode(".jpg", color, [cv2.IMWRITE_JPEG_QUALITY, 75 if hard else 85])
    return cv2.imdecode(enc, cv2.IMREAD_COLOR)


DETECTOR = cv2.QRCodeDetector()
ARUCO = cv2.QRCodeDetectorAruco()


def cv_decode(img, url):
    for how, det in (("QRCodeDetector", DETECTOR), ("QRCodeDetectorAruco", ARUCO)):
        try:
            text, _points, _ = det.detectAndDecode(img)
        except cv2.error:
            text = ""
        if text == url:
            return True, how
    return False, None


def zx_decode(img, url):
    rgb = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return any(r.text == url for r in zxingcpp.read_barcodes(rgb, formats=zxingcpp.BarcodeFormat.QRCode))


def print_images(item):
    master = cv2.imread(item["master"], cv2.IMREAD_COLOR)
    if master is None:
        raise SystemExit(f"не читается {item['master']}")
    dots = halftone(master)
    for dpi in item["captures"]:
        capture = resample(master, dpi)
        dithered = np.clip(resample(dots, dpi), 0, 255).astype(np.uint8)
        gray = to_gray(capture)
        yield dpi, "clean", capture
        yield dpi, "gray", gray
        yield dpi, "threshold", np.where(gray >= 128, 255, 0).astype(np.uint8)
        yield dpi, "dither", dithered
        yield dpi, "phone", phone(capture)
        yield dpi, "dither+phone", phone(dithered)
        yield dpi, "phone-hard", phone(capture, hard=True)


def screen_images(item):
    img = cv2.imread(item["file"], cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"не читается {item['file']}")
    yield item["dpi"], "clean", img
    yield item["dpi"], "gray", to_gray(img)
    yield item["dpi"], "phone", phone(img)
    yield item["dpi"], "phone-hard", phone(img, hard=True)


def main():
    job = json.load(sys.stdin)
    out_dir = job["out"]
    os.makedirs(out_dir, exist_ok=True)
    rows = []
    for item in job["items"]:
        images = print_images(item) if item["kind"] == "print" else screen_images(item)
        for dpi, name, img in images:
            path = os.path.join(out_dir, f"{item['id']}@{dpi}__{name.replace('+', '-')}.png")
            cv2.imwrite(path, img)
            cv_ok, cv_how = cv_decode(img, item["url"])
            rows.append({
                "id": item["id"],
                "dpi": dpi,
                "transform": name,
                "file": path,
                "cv": cv_ok,
                "cvHow": cv_how,
                "zx": zx_decode(img, item["url"]),
            })
    json.dump(rows, sys.stdout)


if __name__ == "__main__":
    main()
