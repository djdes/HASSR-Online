package ru.wesetup.helper.template;

/**
 * Какие поля шаблона — запись в журнале маркировки на сайте.
 *
 * <p>В JSON шаблона: {@code "record": {"item": "product", "start": "madeAt",
 * "until": "madeAt+shelfLife", "untilLabel": "Годен до", "by": "employee"}}.
 * {@code until} — та же дата, что печатается на этикетке: поле даты
 * ({@code "expiresAt"}) или дата плюс срок ({@code "madeAt+shelfLife"}).
 */
public final class RecordSpec {

    /** Текстовое поле «что»: продукт или блюдо. */
    public final String item;
    /** Дата начала: изготовлено, вскрыто… Пусто — нет. */
    public final String start;
    /** Ключ даты срока; пусто — срока нет («Брак», «Аллергены»). */
    public final String untilKey;
    /** Ключ срока, который прибавляется к {@link #untilKey}, или пусто. */
    public final String untilPlus;
    /** Подпись срока, как на этикетке: «Годен до», «Реализовать до»… */
    public final String untilLabel;
    /** Текстовое поле «кто»: изготовил, ответственный. Пусто — нет. */
    public final String by;

    public RecordSpec(String item, String start, String untilKey, String untilPlus, String untilLabel, String by) {
        this.item = item;
        this.start = start == null ? "" : start;
        this.untilKey = untilKey == null ? "" : untilKey;
        this.untilPlus = untilPlus == null ? "" : untilPlus;
        this.untilLabel = untilLabel == null ? "" : untilLabel;
        this.by = by == null ? "" : by;
    }
}
