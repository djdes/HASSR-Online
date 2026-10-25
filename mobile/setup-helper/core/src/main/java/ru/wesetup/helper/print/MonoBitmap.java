package ru.wesetup.helper.print;

/**
 * Монохромная картинка в формате команды TSPL {@code BITMAP}.
 *
 * <p>Строки идут сверху вниз, в байте старший бит — левая точка. Полярность
 * как у TSPL: бит 0 — чёрная точка, 1 — белая (пример из руководства
 * TSPL/TSPL2: байты {@code 00 00 … 07 FF} дают чёрную стрелку на белом).
 * Хвост строки, не кратной 8 точкам, заполнен белыми битами.
 *
 * <p>Принтеру IP-802BT картинку отправляем всегда: его драйвер сам рисует
 * текст растром, встроенных кириллических шрифтов у принтера нет.
 */
public final class MonoBitmap {

    public final int width;
    public final int height;
    public final int bytesPerRow;
    private final byte[] data;

    public MonoBitmap(int width, int height) {
        if (width <= 0 || height <= 0) {
            throw new IllegalArgumentException("Размер картинки должен быть больше нуля");
        }
        this.width = width;
        this.height = height;
        this.bytesPerRow = (width + 7) / 8;
        this.data = new byte[bytesPerRow * height];
        java.util.Arrays.fill(data, (byte) 0xFF);
    }

    /**
     * Из пикселей ARGB: темнее порога — чёрная точка. Прозрачное считаем
     * белым (под этикеткой белая бумага).
     */
    public static MonoBitmap fromArgb(int[] argb, int width, int height, int threshold) {
        if (argb.length < width * height) {
            throw new IllegalArgumentException("Пикселей меньше, чем width × height");
        }
        MonoBitmap image = new MonoBitmap(width, height);
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                if (luminance(argb[y * width + x]) < threshold) image.set(x, y, true);
            }
        }
        return image;
    }

    /** Яркость 0–255 с учётом прозрачности поверх белого. */
    static int luminance(int argb) {
        int a = (argb >>> 24) & 0xFF;
        int r = (argb >> 16) & 0xFF;
        int g = (argb >> 8) & 0xFF;
        int b = argb & 0xFF;
        int lum = (r * 299 + g * 587 + b * 114) / 1000;
        return (lum * a + 255 * (255 - a)) / 255;
    }

    public void set(int x, int y, boolean black) {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        int index = y * bytesPerRow + (x >> 3);
        int mask = 0x80 >> (x & 7);
        if (black) {
            data[index] = (byte) (data[index] & ~mask);
        } else {
            data[index] = (byte) (data[index] | mask);
        }
    }

    public boolean isBlack(int x, int y) {
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        return (data[y * bytesPerRow + (x >> 3)] & (0x80 >> (x & 7))) == 0;
    }

    public int blackCount() {
        int count = 0;
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                if (isBlack(x, y)) count++;
            }
        }
        return count;
    }

    /** Данные для {@code BITMAP} — копия, картинку снаружи не испортить. */
    public byte[] tsplData() {
        return data.clone();
    }

    /** Пиксели ARGB (чёрный/белый) — для предпросмотра ровно того, что уйдёт на принтер. */
    public int[] toArgb() {
        int[] pixels = new int[width * height];
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                pixels[y * width + x] = isBlack(x, y) ? 0xFF000000 : 0xFFFFFFFF;
            }
        }
        return pixels;
    }
}
