package ru.wesetup.helper;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * История печати на телефоне: что и сколько напечатали, с теми же
 * значениями полей — чтобы повторить этикетку одним нажатием или поправить
 * и напечатать снова. Хранится только на этом телефоне, без сети.
 */
final class PrintHistory {

    static final String PREFS = "print_history";
    private static final String KEY = "items";
    /** Сколько последних печатей помним. */
    static final int MAX = 50;

    static final class Entry {
        final String templateId;
        final String templateTitle;
        final int copies;
        final long printedAt;
        final Map<String, String> texts;
        final Map<String, Long> times;
        final Map<String, Integer> durations;

        Entry(String templateId, String templateTitle, int copies, long printedAt,
              Map<String, String> texts, Map<String, Long> times, Map<String, Integer> durations) {
            this.templateId = templateId;
            this.templateTitle = templateTitle;
            this.copies = copies;
            this.printedAt = printedAt;
            this.texts = new LinkedHashMap<>(texts);
            this.times = new LinkedHashMap<>(times);
            this.durations = new LinkedHashMap<>(durations);
        }

        /** Чем этикетка отличается от других: первый непустой текст («Салат «Цезарь»»). */
        String summary() {
            for (String value : texts.values()) {
                if (value != null && !value.trim().isEmpty()) return value.trim().replace('\n', ' ');
            }
            return "";
        }

        JSONObject toJson() throws JSONException {
            JSONObject json = new JSONObject();
            json.put("template", templateId);
            json.put("title", templateTitle);
            json.put("copies", copies);
            json.put("at", printedAt);
            JSONObject t = new JSONObject();
            for (Map.Entry<String, String> e : texts.entrySet()) t.put(e.getKey(), e.getValue());
            json.put("texts", t);
            JSONObject d = new JSONObject();
            for (Map.Entry<String, Long> e : times.entrySet()) d.put(e.getKey(), e.getValue());
            json.put("times", d);
            JSONObject m = new JSONObject();
            for (Map.Entry<String, Integer> e : durations.entrySet()) m.put(e.getKey(), e.getValue());
            json.put("durations", m);
            return json;
        }

        static Entry fromJson(JSONObject json) {
            Map<String, String> texts = new LinkedHashMap<>();
            Map<String, Long> times = new LinkedHashMap<>();
            Map<String, Integer> durations = new LinkedHashMap<>();
            JSONObject t = json.optJSONObject("texts");
            if (t != null) {
                for (Iterator<String> keys = t.keys(); keys.hasNext(); ) {
                    String key = keys.next();
                    texts.put(key, t.optString(key, ""));
                }
            }
            JSONObject d = json.optJSONObject("times");
            if (d != null) {
                for (Iterator<String> keys = d.keys(); keys.hasNext(); ) {
                    String key = keys.next();
                    times.put(key, d.optLong(key));
                }
            }
            JSONObject m = json.optJSONObject("durations");
            if (m != null) {
                for (Iterator<String> keys = m.keys(); keys.hasNext(); ) {
                    String key = keys.next();
                    durations.put(key, m.optInt(key));
                }
            }
            return new Entry(json.optString("template", ""), json.optString("title", ""),
                    Math.max(1, json.optInt("copies", 1)), json.optLong("at"), texts, times, durations);
        }
    }

    private final SharedPreferences prefs;

    PrintHistory(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Свежие сверху. Битая запись пропускается, остальные читаются. */
    List<Entry> all() {
        String raw = prefs.getString(KEY, null);
        if (raw == null) return Collections.emptyList();
        List<Entry> entries = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(raw);
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.optJSONObject(i);
                if (item == null) continue;
                Entry entry = Entry.fromJson(item);
                if (!entry.templateId.isEmpty()) entries.add(entry);
            }
        } catch (JSONException e) {
            return Collections.emptyList();
        }
        return entries;
    }

    void add(Entry entry) {
        List<Entry> entries = new ArrayList<>(all());
        entries.add(0, entry);
        JSONArray array = new JSONArray();
        try {
            for (int i = 0; i < entries.size() && i < MAX; i++) array.put(entries.get(i).toJson());
        } catch (JSONException e) {
            return;
        }
        prefs.edit().putString(KEY, array.toString()).apply();
    }
}
