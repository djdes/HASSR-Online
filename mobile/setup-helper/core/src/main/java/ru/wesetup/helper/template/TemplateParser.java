package ru.wesetup.helper.template;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Разбор шаблона из JSON (см. {@code assets/templates/*.json}).
 *
 * <p>Ошибка в шаблоне — {@link IllegalArgumentException} с понятной причиной:
 * шаблон, который нельзя напечатать, лучше не показывать вовсе.
 */
public final class TemplateParser {

    private TemplateParser() {
    }

    public static LabelTemplate parse(String json) {
        try {
            JSONObject root = new JSONObject(json);
            String id = requireString(root, "id");
            if (!id.matches("[a-z0-9-]{1,40}")) {
                throw new IllegalArgumentException("Код шаблона — латиница, цифры и дефис: " + id);
            }
            JSONObject size = root.getJSONObject("size");
            float width = (float) size.getDouble("width");
            float height = (float) size.getDouble("height");
            if (width <= 0 || height <= 0) throw new IllegalArgumentException("Размер шаблона должен быть больше нуля");

            List<TemplateField> fields = new ArrayList<>();
            JSONArray rawFields = root.optJSONArray("fields");
            if (rawFields != null) {
                for (int i = 0; i < rawFields.length(); i++) fields.add(parseField(rawFields.getJSONObject(i)));
            }
            List<TemplateElement> elements = new ArrayList<>();
            JSONArray rawElements = root.getJSONArray("elements");
            for (int i = 0; i < rawElements.length(); i++) elements.add(parseElement(rawElements.getJSONObject(i)));

            return new LabelTemplate(id, requireString(root, "title"), root.optString("description", ""),
                    width, height, fields, elements);
        } catch (JSONException e) {
            throw new IllegalArgumentException("Шаблон не разобран: " + e.getMessage(), e);
        }
    }

    private static TemplateField parseField(JSONObject raw) throws JSONException {
        String key = requireString(raw, "key");
        if (!key.matches("[A-Za-z][A-Za-z0-9_]{0,39}")) {
            throw new IllegalArgumentException("Ключ поля — латиница и цифры: " + key);
        }
        TemplateField.Type type;
        switch (raw.optString("type", "text")) {
            case "text":
                type = TemplateField.Type.TEXT;
                break;
            case "datetime":
                type = TemplateField.Type.DATETIME;
                break;
            case "duration":
                type = TemplateField.Type.DURATION;
                break;
            default:
                throw new IllegalArgumentException("Неизвестный тип поля «" + key + "»: " + raw.optString("type"));
        }
        List<String> options = new ArrayList<>();
        JSONArray rawOptions = raw.optJSONArray("options");
        if (rawOptions != null) {
            for (int i = 0; i < rawOptions.length(); i++) {
                String option = rawOptions.getString(i);
                if (Durations.parseMinutes(option) < 0) {
                    throw new IllegalArgumentException("Срок «" + option + "» в поле «" + key + "» не понят");
                }
                options.add(option);
            }
        }
        String defaultValue = raw.optString("default", "");
        if (type == TemplateField.Type.DURATION && Durations.parseMinutes(defaultValue) < 0) {
            throw new IllegalArgumentException("Срок по умолчанию в поле «" + key + "» не понят: " + defaultValue);
        }
        return new TemplateField(key, requireString(raw, "label"), type, defaultValue,
                raw.optBoolean("required", false), raw.optInt("maxLength", 80),
                raw.optBoolean("multiline", false), raw.optString("hint", ""), options);
    }

    private static TemplateElement parseElement(JSONObject raw) throws JSONException {
        String rawType = requireString(raw, "type").toUpperCase(Locale.ROOT);
        TemplateElement element;
        try {
            element = new TemplateElement(TemplateElement.Type.valueOf(rawType));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Неизвестный элемент шаблона: " + raw.optString("type"));
        }
        element.x = (float) raw.optDouble("x", 0);
        element.y = (float) raw.optDouble("y", 0);
        element.w = (float) raw.optDouble("w", 0);
        element.h = (float) raw.optDouble("h", 0);
        element.x2 = (float) raw.optDouble("x2", element.x);
        element.y2 = (float) raw.optDouble("y2", element.y);
        element.thickness = (float) raw.optDouble("thickness", element.thickness);
        element.fill = raw.optBoolean("fill", false);
        element.text = raw.optString("text", "");
        element.size = (float) raw.optDouble("size", element.size);
        element.bold = raw.optBoolean("bold", false);
        element.align = TemplateElement.Align.valueOf(raw.optString("align", "left").toUpperCase(Locale.ROOT));
        element.valign = TemplateElement.VAlign.valueOf(raw.optString("valign", "top").toUpperCase(Locale.ROOT));
        element.maxLines = raw.optInt("maxLines", 0);
        element.fit = raw.optBoolean("fit", true);
        element.minScale = (float) raw.optDouble("minScale", element.minScale);
        element.invert = raw.optBoolean("invert", false);
        element.inset = (float) raw.optDouble("inset", element.inset);
        element.step = (float) raw.optDouble("step", element.step);
        element.length = (float) raw.optDouble("length", element.length);
        if (element.type == TemplateElement.Type.TEXT && (element.w <= 0 || element.h <= 0)) {
            throw new IllegalArgumentException("У текста нужна ширина и высота: " + element.text);
        }
        if (element.type == TemplateElement.Type.TICKS && element.step <= 0) {
            throw new IllegalArgumentException("Шаг делений должен быть больше нуля");
        }
        return element;
    }

    private static String requireString(JSONObject raw, String key) throws JSONException {
        String value = raw.getString(key).trim();
        if (value.isEmpty()) throw new IllegalArgumentException("Пустое поле «" + key + "» в шаблоне");
        return value;
    }
}
