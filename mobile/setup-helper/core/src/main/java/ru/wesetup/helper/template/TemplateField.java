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
    /** Варианты срока: {@code 6h}, {@code 24h}, {@code 3d}… */
    public final List<String> options;

    public TemplateField(String key, String label, Type type, String defaultValue, boolean required,
                         int maxLength, boolean multiline, String hint, List<String> options) {
        this.key = key;
        this.label = label;
        this.type = type;
        this.defaultValue = defaultValue == null ? "" : defaultValue;
        this.required = required;
        this.maxLength = maxLength;
        this.multiline = multiline;
        this.hint = hint == null ? "" : hint;
        this.options = options == null ? Collections.<String>emptyList() : Collections.unmodifiableList(options);
    }
}
