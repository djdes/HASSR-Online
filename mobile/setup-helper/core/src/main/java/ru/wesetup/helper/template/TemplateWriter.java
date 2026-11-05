package ru.wesetup.helper.template;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;

/**
 * Шаблон → JSON того же формата, что {@code assets/templates/*.json}.
 * {@link TemplateParser} разбирает результат обратно без потерь: так
 * сохраняются макеты, изменённые на телефоне.
 */
public final class TemplateWriter {

    private TemplateWriter() {
    }

    public static String write(LabelTemplate template) {
        return write(TemplateDraft.of(template));
    }

    public static String write(TemplateDraft d) {
        try {
            JSONObject root = new JSONObject();
            root.put("id", d.id);
            root.put("title", d.title == null ? "" : d.title.trim());
            root.put("description", d.description == null ? "" : d.description.trim());
            JSONObject size = new JSONObject();
            size.put("width", round(d.widthMm));
            size.put("height", round(d.heightMm));
            root.put("size", size);

            JSONArray fields = new JSONArray();
            for (TemplateDraft.Field f : d.fields) fields.put(field(f));
            root.put("fields", fields);

            RecordSpec record = d.validRecord();
            if (record != null) root.put("record", record(record));

            JSONArray elements = new JSONArray();
            for (TemplateElement e : d.elements) elements.put(element(e));
            root.put("elements", elements);
            return root.toString(1);
        } catch (JSONException e) {
            throw new IllegalArgumentException("Шаблон не записан: " + e.getMessage(), e);
        }
    }

    private static JSONObject field(TemplateDraft.Field f) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("key", f.key);
        o.put("label", f.label == null ? "" : f.label.trim());
        o.put("type", f.type.name().toLowerCase(Locale.ROOT));
        if (!f.defaultValue.isEmpty()) o.put("default", f.defaultValue);
        if (f.required) o.put("required", true);
        o.put("maxLength", f.maxLength);
        if (f.multiline) o.put("multiline", true);
        if (!f.hint.isEmpty()) o.put("hint", f.hint);
        if (!f.options.isEmpty()) o.put("options", new JSONArray(f.options));
        if (f.dateOnly) o.put("dateOnly", true);
        if (!f.source.isEmpty()) o.put("source", f.source);
        if (!f.fillFrom.isEmpty()) o.put("fillFrom", f.fillFrom);
        return o;
    }

    private static JSONObject record(RecordSpec r) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("item", r.item);
        if (!r.start.isEmpty()) o.put("start", r.start);
        if (!r.untilKey.isEmpty()) {
            o.put("until", r.untilPlus.isEmpty() ? r.untilKey : r.untilKey + "+" + r.untilPlus);
            o.put("untilLabel", r.untilLabel);
        }
        if (!r.by.isEmpty()) o.put("by", r.by);
        return o;
    }

    private static JSONObject element(TemplateElement e) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("type", e.type.name().toLowerCase(Locale.ROOT));
        o.put("x", round(e.x));
        o.put("y", round(e.y));
        o.put("w", round(e.w));
        o.put("h", round(e.h));
        o.put("x2", round(e.x2));
        o.put("y2", round(e.y2));
        o.put("thickness", round(e.thickness));
        if (e.fill) o.put("fill", true);
        if (!e.text.isEmpty()) o.put("text", e.text);
        o.put("size", round(e.size));
        if (e.bold) o.put("bold", true);
        o.put("align", e.align.name().toLowerCase(Locale.ROOT));
        o.put("valign", e.valign.name().toLowerCase(Locale.ROOT));
        if (e.maxLines != 0) o.put("maxLines", e.maxLines);
        if (!e.fit) o.put("fit", false);
        o.put("minScale", round(e.minScale));
        if (e.invert) o.put("invert", true);
        if (e.radius != 0) o.put("radius", round(e.radius));
        if (!e.src.isEmpty()) o.put("src", e.src);
        if (!e.fallbackText.isEmpty()) o.put("fallbackText", e.fallbackText);
        o.put("inset", round(e.inset));
        o.put("step", round(e.step));
        o.put("length", round(e.length));
        return o;
    }

    /** До тысячных миллиметра: в JSON не попадает «2.4000000953674316». */
    private static double round(float value) {
        return Math.round(value * 1000.0) / 1000.0;
    }
}
