package ru.wesetup.helper.template;

import java.util.Collections;
import java.util.List;

/** Поле, которое человек заполняет перед печатью. */
public final class TemplateField {

    public enum Type { TEXT, DATETIME, DURATION }

    public final String key;
    public final String label;
    public final Type type;
    /**
     * Умолчание: для текста — строка с подстановками ({@code {{user.name}}}),
     * для даты — {@code now} или {@code now+24h}, для срока — {@code 24h}.
     */
    public final String defaultValue;
    public final boolean required;
    public final int maxLength;
    public final boolean multiline;
    public final String hint;
    /**
     * Варианты: для срока — {@code 6h}, {@code 24h}, {@code 3d}…; для текста —
     * подсказки в выпадающем списке («+2…+6 °C», «Обед»), вписать своё можно.
     */
    public final List<String> options;
    /** Для даты: выбирается только день («Годен до» по документам), время не печатается. */
    public final boolean dateOnly;
    /**
     * Подсказки из справочников сайта для текста: {@code products}, {@code dishes},
     * {@code suppliers}, {@code staff} или несколько через запятую. Пусто — нет.
     */
    public final String source;
    /**
     * Что подставить из выбранного продукта справочника: срок — {@code shelfLife},
     * текст — {@code storage} (условия хранения) или {@code supplier}. Пусто — ничего.
     */
    public final String fillFrom;

    public TemplateField(String key, String label, Type type, String defaultValue, boolean required,
                         int maxLength, boolean multiline, String hint, List<String> options) {
        this(key, label, type, defaultValue, required, maxLength, multiline, hint, options, false);
    }

    public TemplateField(String key, String label, Type type, String defaultValue, boolean required,
                         int maxLength, boolean multiline, String hint, List<String> options, boolean dateOnly) {
        this(key, label, type, defaultValue, required, maxLength, multiline, hint, options, dateOnly, "", "");
    }

    public TemplateField(String key, String label, Type type, String defaultValue, boolean required,
                         int maxLength, boolean multiline, String hint, List<String> options, boolean dateOnly,
                         String source, String fillFrom) {
        this.key = key;
        this.label = label;
        this.type = type;
        this.defaultValue = defaultValue == null ? "" : defaultValue;
        this.required = required;
        this.maxLength = maxLength;
        this.multiline = multiline;
        this.hint = hint == null ? "" : hint;
        this.options = options == null ? Collections.<String>emptyList() : Collections.unmodifiableList(options);
        this.dateOnly = dateOnly;
        this.source = source == null ? "" : source;
        this.fillFrom = fillFrom == null ? "" : fillFrom;
    }
}
