package ru.wesetup.helper.bt;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Похоже ли Bluetooth-устройство на принтер — чтобы при поиске принтер
 * оказался вверху списка, а не среди наушников и телевизоров соседей.
 *
 * <p>Имя при классическом поиске приходит не всегда (Android читает его
 * отдельным запросом, и тот может не успеть), поэтому учитывается и класс
 * устройства Bluetooth: принтеры объявляют основной класс «Imaging» и бит
 * «Printer» (Bluetooth Assigned Numbers, Class of Device).
 */
public final class PrinterNames {

    /** Серия IP у AiYin: «IP-802BT», «IP802», «IP-486BT»… */
    private static final Pattern AIYIN_IP = Pattern.compile("\\bIP[-_ ]?(\\d{3})\\s*(BT)?\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern GENERIC = Pattern.compile(
            "PRINT|PRT|LABEL|THERMAL|\\bPOS(?![A-Z])|TSC|XPRINTER|\\bXP-|\\bQR-|\\bGP-|\\bBT-?\\d|\\bMPT|\\bHPRT|\\bQIRUI"
                    + "|\\bBEEPRT|\\bIDPRT|NIIMBOT|PHOMEMO|MUNBYN|ZEBRA|BIXOLON|SEWOO|\\bRPP|\\bZJ-|\\bSPRT|\\bPT-?\\d"
                    + "|\\bQL-|\\bTD-",
            Pattern.CASE_INSENSITIVE);

    /** Основной класс устройства Bluetooth (биты 8–12) и его значение «Imaging». */
    static final int MAJOR_MASK = 0x1F00;
    static final int MAJOR_IMAGING = 0x0600;
    /** Бит «Printer» второстепенного класса для Imaging. */
    static final int MINOR_PRINTER = 0x0080;
    /** Класс неизвестен. */
    public static final int NO_CLASS = -1;

    private PrinterNames() {
    }

    /** 100 — точно AIYIN IP-802, 90 — серия AIYIN, 50 — похоже на принтер, 0 — нет. */
    public static int score(String name) {
        if (name == null || name.trim().isEmpty()) return 0;
        String upper = name.toUpperCase(Locale.ROOT);
        Matcher ip = AIYIN_IP.matcher(upper);
        if (ip.find()) return "802".equals(ip.group(1)) ? 100 : 90;
        if (upper.contains("AIYIN") || upper.contains("AYIN")) return 90;
        return GENERIC.matcher(upper).find() ? 50 : 0;
    }

    /** Лучшее из оценки по имени и по классу устройства ({@link #NO_CLASS} — класс неизвестен). */
    public static int score(String name, int deviceClass) {
        return Math.max(score(name), classScore(deviceClass));
    }

    /** 75 — Imaging с битом Printer, 60 — Imaging (принтер, сканер, камера), 0 — другое. */
    static int classScore(int deviceClass) {
        if (deviceClass < 0 || (deviceClass & MAJOR_MASK) != MAJOR_IMAGING) return 0;
        return (deviceClass & MINOR_PRINTER) != 0 ? 75 : 60;
    }

    public static boolean isLikelyPrinter(String name) {
        return score(name) >= 50;
    }

    /** Модель для сайта, если имя её выдаёт: «IP-802BT» → «AIYIN IP-802BT». */
    public static String modelFor(String name) {
        if (name == null) return null;
        Matcher ip = AIYIN_IP.matcher(name.toUpperCase(Locale.ROOT));
        if (!ip.find()) return null;
        if ("802".equals(ip.group(1))) return "AIYIN IP-802BT";
        return "AIYIN IP-" + ip.group(1) + (ip.group(2) != null ? "BT" : "");
    }
}
