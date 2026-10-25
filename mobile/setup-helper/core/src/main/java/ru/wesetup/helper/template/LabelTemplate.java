package ru.wesetup.helper.template;

import java.util.Collections;
import java.util.List;

/**
 * Шаблон этикетки: поля для заполнения и разметка.
 *
 * <p>Шаблоны лежат в приложении ({@code assets/templates/*.json}), поэтому
 * печать работает без интернета. Формат JSON выбран с расчётом, что позже
 * сайт будет отдавать шаблоны заведения в том же виде.
 */
public final class LabelTemplate {

    /** Код пробной этикетки — её печатает кнопка на главном экране. */
    public static final String TEST_ID = "test-58x40";

    public final String id;
    public final String title;
    public final String description;
    /** Размер, под который нарисован шаблон, мм. */
    public final float widthMm;
    public final float heightMm;
    public final List<TemplateField> fields;
    public final List<TemplateElement> elements;

    public LabelTemplate(String id, String title, String description, float widthMm, float heightMm,
                         List<TemplateField> fields, List<TemplateElement> elements) {
        this.id = id;
        this.title = title;
        this.description = description == null ? "" : description;
        this.widthMm = widthMm;
        this.heightMm = heightMm;
        this.fields = Collections.unmodifiableList(fields);
        this.elements = Collections.unmodifiableList(elements);
    }

    public TemplateField field(String key) {
        for (TemplateField field : fields) {
            if (field.key.equals(key)) return field;
        }
        return null;
    }
}
