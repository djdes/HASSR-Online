package ru.wesetup.helper.template;

import java.util.ArrayList;
import java.util.List;

/**
 * Изменяемая копия шаблона для редактора макетов на телефоне.
 *
 * <p>{@link #build()} проверяет результат тем же разбором, что и шаблоны из
 * приложения: записывает JSON ({@link TemplateWriter}) и разбирает его
 * ({@link TemplateParser}). Так на печать не попадёт макет, который нельзя
 * открыть заново.
 */
public final class TemplateDraft {

    /** Поле в редакторе: то же, что {@link TemplateField}, но меняется. */
    public static final class Field {
        public String key;
        public String label;
        public TemplateField.Type type;
        public String defaultValue = "";
        public boolean required;
        public int maxLength = 80;
        public boolean multiline;
        public String hint = "";
        public final List<String> options = new ArrayList<>();
        public boolean dateOnly;
        public String source = "";
        public String fillFrom = "";

        public Field(String key, String label, TemplateField.Type type) {
            this.key = key;
            this.label = label;
            this.type = type;
        }

        static Field of(TemplateField f) {
            Field d = new Field(f.key, f.label, f.type);
            d.defaultValue = f.defaultValue;
            d.required = f.required;
            d.maxLength = f.maxLength;
            d.multiline = f.multiline;
            d.hint = f.hint;
            d.options.addAll(f.options);
            d.dateOnly = f.dateOnly;
            d.source = f.source;
            d.fillFrom = f.fillFrom;
            return d;
        }

        Field copy() {
            Field d = new Field(key, label, type);
            d.defaultValue = defaultValue;
            d.required = required;
            d.maxLength = maxLength;
            d.multiline = multiline;
            d.hint = hint;
            d.options.addAll(options);
            d.dateOnly = dateOnly;
            d.source = source;
            d.fillFrom = fillFrom;
            return d;
        }
    }

    public String id;
    public String title;
    public String description;
    public float widthMm;
    public float heightMm;
    public final List<Field> fields = new ArrayList<>();
    public final List<TemplateElement> elements = new ArrayList<>();
    /** Запись для журнала маркировки; выпадает сама, если её поля удалили. */
    public RecordSpec record;

    public TemplateDraft(String id, String title, float widthMm, float heightMm) {
        this.id = id;
        this.title = title;
        this.description = "";
        this.widthMm = widthMm;
        this.heightMm = heightMm;
    }

    public static TemplateDraft of(LabelTemplate template) {
        TemplateDraft d = new TemplateDraft(template.id, template.title, template.widthMm, template.heightMm);
        d.description = template.description;
        for (TemplateField f : template.fields) d.fields.add(Field.of(f));
        for (TemplateElement e : template.elements) d.elements.add(e.copy());
        d.record = template.record;
        return d;
    }

    /** Глубокая копия — шаг истории «Отменить». */
    public TemplateDraft copy() {
        TemplateDraft d = new TemplateDraft(id, title, widthMm, heightMm);
        d.description = description;
        for (Field f : fields) d.fields.add(f.copy());
        for (TemplateElement e : elements) d.elements.add(e.copy());
        d.record = record;
        return d;
    }

    public Field field(String key) {
        for (Field f : fields) {
            if (f.key.equals(key)) return f;
        }
        return null;
    }

    /** Свободный ключ нового поля: {@code field1}, {@code field2}… */
    public String newFieldKey() {
        for (int i = 1; ; i++) {
            String key = "field" + i;
            if (field(key) == null) return key;
        }
    }

    /** Запись журнала, если все её поля на месте и нужного типа, иначе null. */
    RecordSpec validRecord() {
        RecordSpec r = record;
        if (r == null) return null;
        if (!hasField(r.item, TemplateField.Type.TEXT)) return null;
        if (!r.start.isEmpty() && !hasField(r.start, TemplateField.Type.DATETIME)) return null;
        if (!r.untilKey.isEmpty() && !hasField(r.untilKey, TemplateField.Type.DATETIME)) return null;
        if (!r.untilPlus.isEmpty() && !hasField(r.untilPlus, TemplateField.Type.DURATION)) return null;
        if (!r.by.isEmpty() && !hasField(r.by, TemplateField.Type.TEXT)) return null;
        return r;
    }

    private boolean hasField(String key, TemplateField.Type type) {
        Field f = field(key);
        return f != null && f.type == type;
    }

    /** Готовый шаблон; ошибка — {@link IllegalArgumentException} с понятной причиной. */
    public LabelTemplate build() {
        return TemplateParser.parse(TemplateWriter.write(this));
    }
}
