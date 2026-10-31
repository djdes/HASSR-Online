package ru.wesetup.helper.template;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;

/**
 * Напечатанная этикетка для журнала маркировки на сайте: что, когда
 * изготовлено, до какого времени годно, кто и остальные поля — ровно то, что
 * на этикетке. Собирается по {@link RecordSpec} шаблона и значениям полей.
 *
 * <p>Длины обрезаны под лимиты сайта: событие с длинным полем сайт отверг
 * бы целиком, а этикетка уже напечатана.
 */
public final class LabelRecord {

    public static final int ITEM_MAX = 120;
    public static final int BY_MAX = 80;
    public static final int LABEL_MAX = 40;
    public static final int FIELD_LABEL_MAX = 60;
    public static final int VALUE_MAX = 160;
    public static final int FIELDS_MAX = 12;

    /** Поле этикетки «как напечатано»: подпись и значение. */
    public static final class Field {
        public final String label;
        public final String value;

        Field(String label, String value) {
            this.label = label;
            this.value = value;
        }
    }

    public final String item;
    /** Начало (изготовлено, вскрыто…), мс, или null. */
    public final Long startAt;
    public final String startLabel;
    /** «Годен до», мс, или null — у брака и аллергенов срока нет. */
    public final Long until;
    public final String untilLabel;
    /** На этикетке только даты: «годен до 03.11» — до конца этого дня. */
    public final boolean dateOnly;
    public final String by;
    public final String byLabel;
    public final List<Field> fields;

    private LabelRecord(String item, Long startAt, String startLabel, Long until, String untilLabel,
                        boolean dateOnly, String by, String byLabel, List<Field> fields) {
        this.item = item;
        this.startAt = startAt;
        this.startLabel = startLabel;
        this.until = until;
        this.untilLabel = untilLabel;
        this.dateOnly = dateOnly;
        this.by = by;
        this.byLabel = byLabel;
        this.fields = Collections.unmodifiableList(fields);
    }

    /** Запись по шаблону и значениям или null: у шаблона её нет или «что» не заполнено. */
    public static LabelRecord of(LabelTemplate template, TemplateValues values) {
        RecordSpec spec = template.record;
        if (spec == null) return null;
        String item = clip(values.text(spec.item), ITEM_MAX);
        if (item.isEmpty()) return null;

        TemplateField startField = spec.start.isEmpty() ? null : template.field(spec.start);
        TemplateField untilField = spec.untilKey.isEmpty() ? null : template.field(spec.untilKey);
        boolean dateOnly = (startField != null && startField.dateOnly) || (untilField != null && untilField.dateOnly);
        Long startAt = startField == null ? null : values.time(spec.start);

        Long until = null;
        Long base = untilField == null ? null : values.time(spec.untilKey);
        if (base != null) {
            Integer minutes = spec.untilPlus.isEmpty() ? Integer.valueOf(0) : values.duration(spec.untilPlus);
            if (minutes != null) until = base + minutes * 60_000L;
        }
        if (until != null && dateOnly) until = endOfDay(until, values);

        TemplateField byField = spec.by.isEmpty() ? null : template.field(spec.by);
        String by = byField == null ? "" : clip(values.text(spec.by), BY_MAX);

        List<Field> fields = new ArrayList<>();
        for (TemplateField field : template.fields) {
            if (field.type != TemplateField.Type.TEXT || field.key.equals(spec.item) || field.key.equals(spec.by)) continue;
            String value = clip(values.text(field.key), VALUE_MAX);
            if (value.isEmpty()) continue;
            fields.add(new Field(clip(field.label, FIELD_LABEL_MAX), value));
            if (fields.size() == FIELDS_MAX) break;
        }
        return new LabelRecord(item, startAt, startField == null ? "" : clip(startField.label, LABEL_MAX),
                until, clip(spec.untilLabel, LABEL_MAX), dateOnly, by,
                byField == null ? "" : clip(byField.label, LABEL_MAX), fields);
    }

    private static long endOfDay(long millis, TemplateValues values) {
        Calendar calendar = Calendar.getInstance(values.zone());
        calendar.setTimeInMillis(millis);
        calendar.set(Calendar.HOUR_OF_DAY, 23);
        calendar.set(Calendar.MINUTE, 59);
        calendar.set(Calendar.SECOND, 59);
        calendar.set(Calendar.MILLISECOND, 999);
        return calendar.getTimeInMillis();
    }

    /**
     * Пробелы схлопнуты, длина — не больше {@code max} знаков UTF-16 (так
     * считает сайт); суррогатная пара не разрезается.
     */
    static String clip(String value, int max) {
        if (value == null) return "";
        String text = value.replaceAll("\\s+", " ").trim();
        if (text.length() <= max) return text;
        int end = Character.isHighSurrogate(text.charAt(max - 1)) ? max - 1 : max;
        return text.substring(0, end).trim();
    }
}
