package ru.wesetup.helper;

import android.graphics.Bitmap;

import java.util.Collections;
import java.util.TimeZone;

import ru.wesetup.helper.print.LabelRenderer;
import ru.wesetup.helper.print.LabelSettings;
import ru.wesetup.helper.template.Durations;
import ru.wesetup.helper.template.LabelTemplate;
import ru.wesetup.helper.template.LayoutEngine;
import ru.wesetup.helper.template.TemplateDraft;
import ru.wesetup.helper.template.TemplateField;
import ru.wesetup.helper.template.TemplateValues;

/**
 * Превью макета в редакторе и в списке: этикетка ровно размера макета (1 мм
 * макета = 1 мм этикетки), поля — примером: умолчание или название поля.
 * Ровно те точки, что уйдут на принтер.
 */
final class LayoutPreview {

    private static final LabelRenderer.AndroidMeasurer MEASURER = new LabelRenderer.AndroidMeasurer();

    private LayoutPreview() {
    }

    static TemplateValues sample(HelperApp app, TemplateDraft draft) {
        long now = System.currentTimeMillis();
        LabelProfileStore profile = app.labelProfile();
        TemplateValues values = new TemplateValues(TimeZone.getDefault())
                .text("user.name", profile.userName().isEmpty() ? "Иван Петров" : profile.userName())
                .text("org.name", profile.orgNameForLabel())
                .text("org.site", profile.siteForLabel())
                .text("printer.name", "IP-802BT")
                .text("label.size", (int) draft.widthMm + "×" + (int) draft.heightMm)
                .text("app.version", BuildConfig.VERSION_NAME)
                .time("now", now);
        for (TemplateDraft.Field f : draft.fields) {
            if (f.type == TemplateField.Type.DATETIME) {
                values.time(f.key, TemplateValues.defaultTime(f.defaultValue, now));
            } else if (f.type == TemplateField.Type.DURATION) {
                int minutes = Durations.parseMinutes(f.defaultValue);
                values.duration(f.key, minutes < 0 ? 24 * 60 : minutes);
            }
        }
        for (TemplateDraft.Field f : draft.fields) {
            if (f.type != TemplateField.Type.TEXT) continue;
            String value = values.resolve(f.defaultValue).trim();
            if (value.isEmpty() && !f.options.isEmpty()) value = f.options.get(0);
            values.text(f.key, value.isEmpty() ? f.label : value);
        }
        return values;
    }

    static LabelSettings settings(float widthMm, float heightMm) {
        LabelSettings s = new LabelSettings();
        s.widthMm = Math.round(widthMm);
        s.heightMm = Math.round(heightMm);
        s.gapMm = 0;
        return s.normalized();
    }

    /** Монохромная картинка этикетки макета. */
    static Bitmap render(HelperApp app, LabelTemplate template) {
        return render(app, TemplateDraft.of(template));
    }

    /**
     * Черновик рисуется и тогда, когда его ещё нельзя сохранить (пустое
     * название): разметке нужны только размер и элементы.
     */
    static Bitmap render(HelperApp app, TemplateDraft draft) {
        LabelTemplate shape = new LabelTemplate(draft.id, "-", "", draft.widthMm, draft.heightMm,
                Collections.<TemplateField>emptyList(), draft.elements);
        LabelSettings s = settings(draft.widthMm, draft.heightMm);
        return LabelRenderer.preview(LabelRenderer.toMono(LabelRenderer.draw(
                LayoutEngine.layout(shape, s, sample(app, draft), MEASURER), Collections.emptyMap())));
    }
}
