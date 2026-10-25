package ru.wesetup.helper.template;

import java.util.Locale;

/** Сроки годности: «24h», «3d», «90m» ⇄ минуты ⇄ «24 ч», «3 сут.», «1 ч 30 мин». */
public final class Durations {

    private Durations() {
    }

    /** Минуты или -1, если строка не срок. */
    public static int parseMinutes(String raw) {
        if (raw == null) return -1;
        String value = raw.trim().toLowerCase(Locale.ROOT);
        if (value.length() < 2) return -1;
        char unit = value.charAt(value.length() - 1);
        int amount;
        try {
            amount = Integer.parseInt(value.substring(0, value.length() - 1));
        } catch (NumberFormatException e) {
            return -1;
        }
        if (amount < 0) return -1;
        switch (unit) {
            case 'm':
                return amount;
            case 'h':
                return amount * 60;
            case 'd':
                return amount * 24 * 60;
            default:
                return -1;
        }
    }

    public static String format(int minutes) {
        if (minutes < 0) return "";
        if (minutes < 60) return minutes + " мин";
        if (minutes % (24 * 60) == 0) return (minutes / (24 * 60)) + " сут.";
        int hours = minutes / 60;
        int rest = minutes % 60;
        return rest == 0 ? hours + " ч" : hours + " ч " + rest + " мин";
    }
}
