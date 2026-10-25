package ru.wesetup.helper.template;

/**
 * Измерение текста. На телефоне — {@code android.graphics.Paint}, в тестах на
 * JVM — шрифты AWT: разметка ({@link LayoutEngine}) одна и та же.
 */
public interface TextMeasurer {

    float width(String text, float sizePx, boolean bold);

    /** Расстояние от базовой линии до верха строки (положительное). */
    float ascent(float sizePx, boolean bold);

    /** Расстояние от базовой линии до низа строки (положительное). */
    float descent(float sizePx, boolean bold);
}
