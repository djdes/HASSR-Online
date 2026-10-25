package ru.wesetup.helper.print;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * Команды TSPL2 для AIYIN IP-802BT.
 *
 * <p>Язык и набор команд — по базе моделей драйвера AiYin (Seagull 12.3):
 * у «AiYin IP-802BT» {@code CommandClass=TSPL2}, драйвер шлёт {@code SIZE},
 * {@code GAP}, {@code DIRECTION}, {@code REFERENCE}, {@code DENSITY},
 * {@code SPEED}, {@code CLS}, {@code BITMAP}, {@code PRINT}; калибровка —
 * {@code AUTODETECT}, самотест — {@code SELFTEST}. {@code SHIFT} и
 * {@code SET TEAR} эта модель не поддерживает, поэтому сдвиг делается в
 * самой картинке.
 *
 * <p>Строки — ASCII с CRLF. Числа пишем без локали: на русском телефоне
 * {@code String.format("%.1f")} дал бы «2,5», и принтер не понял бы команду.
 */
public final class Tspl {

    /** {@code <ESC>!?} — байт состояния (0 — готов). */
    public static final byte[] STATUS_QUERY = {0x1B, '!', '?'};

    public static final int STATUS_HEAD_OPEN = 0x01;
    public static final int STATUS_PAPER_JAM = 0x02;
    public static final int STATUS_OUT_OF_PAPER = 0x04;
    public static final int STATUS_OUT_OF_RIBBON = 0x08;
    public static final int STATUS_PAUSE = 0x10;
    public static final int STATUS_PRINTING = 0x20;
    public static final int STATUS_COVER_OPEN = 0x40;
    public static final int STATUS_OTHER_ERROR = 0x80;

    public static final int MAX_COPIES = 99;

    private Tspl() {
    }

    /** Одна этикетка картинкой, {@code copies} экземпляров. */
    public static byte[] labelJob(LabelSettings settings, MonoBitmap image, int copies) {
        LabelSettings s = settings.normalized();
        if (image.width > LabelSettings.MAX_WIDTH_MM * LabelSettings.DOTS_PER_MM) {
            throw new IllegalArgumentException("Картинка шире печатной области принтера (72 мм)");
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream(image.bytesPerRow * image.height + 256);
        header(out, s);
        line(out, "DIRECTION " + (s.rotate180 ? 0 : 1));
        line(out, "REFERENCE 0,0");
        line(out, "DENSITY " + s.density);
        line(out, "SPEED " + s.speed);
        line(out, "CLS");
        ascii(out, "BITMAP 0,0," + image.bytesPerRow + "," + image.height + ",0,");
        byte[] data = image.tsplData();
        out.write(data, 0, data.length);
        line(out, "");
        // «PRINT m,1» — m наборов по одному: и полные TSPL, и упрощённые
        // прошивки, читающие только первое число, напечатают m этикеток.
        line(out, "PRINT " + Math.max(1, Math.min(MAX_COPIES, copies)) + ",1");
        return out.toByteArray();
    }

    /** Калибровка датчика зазора: принтер прогонит несколько этикеток. */
    public static byte[] calibrate(LabelSettings settings) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(64);
        header(out, settings.normalized());
        line(out, "AUTODETECT");
        return out.toByteArray();
    }

    /** Страница самотеста с настройками принтера. */
    public static byte[] selfTest() {
        ByteArrayOutputStream out = new ByteArrayOutputStream(16);
        line(out, "SELFTEST");
        return out.toByteArray();
    }

    /** Ошибка по байту состояния или null, если печатать можно. */
    public static String statusProblem(int status) {
        if (status < 0) return null;
        if ((status & STATUS_HEAD_OPEN) != 0 || (status & STATUS_COVER_OPEN) != 0) {
            return "Открыта крышка принтера — закройте её до щелчка";
        }
        if ((status & STATUS_OUT_OF_PAPER) != 0) return "В принтере закончились этикетки";
        if ((status & STATUS_PAPER_JAM) != 0) return "Замялась этикетка — откройте крышку и заправьте ленту заново";
        if ((status & STATUS_PAUSE) != 0) return "Принтер на паузе — нажмите кнопку на принтере";
        if ((status & STATUS_OTHER_ERROR) != 0) return "Принтер сообщил об ошибке — выключите и включите его";
        return null;
    }

    static String mm(float value) {
        float rounded = Math.round(value * 10f) / 10f;
        if (rounded == (int) rounded) return Integer.toString((int) rounded);
        return String.format(Locale.ROOT, "%.1f", rounded);
    }

    private static void header(ByteArrayOutputStream out, LabelSettings s) {
        line(out, "SIZE " + s.widthMm + " mm," + s.heightMm + " mm");
        line(out, "GAP " + mm(s.gapMm) + " mm,0 mm");
    }

    private static void line(ByteArrayOutputStream out, String text) {
        ascii(out, text);
        out.write('\r');
        out.write('\n');
    }

    private static void ascii(ByteArrayOutputStream out, String text) {
        byte[] bytes = text.getBytes(StandardCharsets.US_ASCII);
        out.write(bytes, 0, bytes.length);
    }
}
