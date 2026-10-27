package ru.wesetup.helper.template;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Значения для подстановки в шаблон.
 *
 * <p>Подстановка — {@code {{ключ}}} с необязательным фильтром:
 * {@code {{madeAt|date}}}. Дату можно сложить со сроком:
 * {@code {{madeAt+shelfLife|datetime}}} — «годен до». Фильтры:
 * {@code datetime}, {@code date}, {@code time}, {@code duration},
 * {@code upper}. Дата без фильтра печатается как {@code datetime}, срок —
 * как {@code duration}. Неизвестный ключ даёт пустую строку.
 *
 * <p>Кроме полей шаблона есть общие значения: {@code user.name},
 * {@code org.name}, {@code org.site}, {@code printer.name}, {@code printer.model},
 * {@code label.size}, {@code app.version}, {@code now}. Картинка
 * {@code org.logo} — отдельно, через {@link #image}.
 */
public final class TemplateValues {

    private static final Pattern PLACEHOLDER = Pattern.compile(
            "\\{\\{\\s*([A-Za-z0-9_.]+)(?:\\s*\\+\\s*([A-Za-z0-9_.]+))?\\s*(?:\\|\\s*([a-z]+)\\s*)?\\}\\}");
    private static final Locale RU = Locale.forLanguageTag("ru");

    private final Map<String, String> texts = new HashMap<>();
    private final Map<String, Long> times = new HashMap<>();
    private final Map<String, Integer> durations = new HashMap<>();
    private final Map<String, int[]> images = new HashMap<>();
    private final TimeZone zone;

    public TemplateValues(TimeZone zone) {
        this.zone = zone;
    }

    public TemplateValues text(String key, String value) {
        texts.put(key, value == null ? "" : value);
        return this;
    }

    public TemplateValues time(String key, long epochMillis) {
        times.put(key, epochMillis);
        return this;
    }

    public TemplateValues duration(String key, int minutes) {
        durations.put(key, minutes);
        return this;
    }

    /** Картинка есть и имеет такой размер в точках (например, {@code org.logo}). */
    public TemplateValues image(String key, int widthDots, int heightDots) {
        if (widthDots > 0 && heightDots > 0) images.put(key, new int[] {widthDots, heightDots});
        return this;
    }

    /** {ширина, высота} в точках или null, если картинки нет. */
    public int[] imageSize(String key) {
        return images.get(key);
    }

    public String text(String key) {
        String value = texts.get(key);
        return value == null ? "" : value;
    }

    public Long time(String key) {
        return times.get(key);
    }

    public Integer duration(String key) {
        return durations.get(key);
    }

    public String resolve(String pattern) {
        if (pattern == null || pattern.isEmpty()) return "";
        Matcher matcher = PLACEHOLDER.matcher(pattern);
        StringBuffer out = new StringBuffer();
        while (matcher.find()) {
            String value = value(matcher.group(1), matcher.group(2), matcher.group(3));
            matcher.appendReplacement(out, Matcher.quoteReplacement(value));
        }
        matcher.appendTail(out);
        return out.toString();
    }

    private String value(String key, String plus, String filter) {
        Long time = times.get(key);
        if (time != null) {
            long millis = time;
            if (plus != null) {
                Integer minutes = durations.get(plus);
                if (minutes == null) return "";
                millis += minutes * 60_000L;
            }
            return formatTime(millis, filter == null ? "datetime" : filter);
        }
        if (plus != null) return "";
        Integer minutes = durations.get(key);
        if (minutes != null) {
            String formatted = Durations.format(minutes);
            return "upper".equals(filter) ? formatted.toUpperCase(RU) : formatted;
        }
        String text = texts.get(key);
        if (text == null) return "";
        return "upper".equals(filter) ? text.toUpperCase(RU) : text;
    }

    public String formatTime(long millis, String filter) {
        String pattern;
        switch (filter) {
            case "date":
                pattern = "dd.MM.yyyy";
                break;
            case "time":
                pattern = "HH:mm";
                break;
            default:
                pattern = "dd.MM.yyyy HH:mm";
        }
        SimpleDateFormat format = new SimpleDateFormat(pattern, RU);
        format.setTimeZone(zone);
        return format.format(new Date(millis));
    }

    /**
     * Умолчание поля даты: {@code now}, {@code now+24h}, {@code now-30m}.
     * Непонятное — тоже «сейчас»: пустая дата на этикетке хуже.
     */
    public static long defaultTime(String expression, long now) {
        if (expression == null) return now;
        String value = expression.trim().toLowerCase(Locale.ROOT);
        if (value.startsWith("now+") || value.startsWith("now-")) {
            int minutes = Durations.parseMinutes(value.substring(4));
            if (minutes >= 0) return now + (value.charAt(3) == '+' ? 1 : -1) * minutes * 60_000L;
        }
        return now;
    }
}
