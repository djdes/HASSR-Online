package ru.wesetup.helper.net;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Очередь событий для сайта на телефоне.
 *
 * <p>Без сети события ждут здесь и уходят, когда сеть появится. Из печатей
 * одного принтера хранится только последняя: сайт показывает «последнюю
 * печать», а копить сотни строк за неделю без интернета незачем.
 */
public final class Outbox {

    /** Где лежит очередь: на телефоне — SharedPreferences, в тестах — память. */
    public interface Storage {
        String read();

        void write(String value);
    }

    /** Предохранитель: очередь не должна расти бесконечно. */
    static final int MAX_EVENTS = 300;

    private final Storage storage;

    public Outbox(Storage storage) {
        this.storage = storage;
    }

    public synchronized void add(JSONObject event) {
        List<JSONObject> events = load();
        if (HelperEvents.PRINTER_PRINTED.equals(event.optString("type"))) {
            String address = addressOf(event);
            List<JSONObject> kept = new ArrayList<>();
            for (JSONObject queued : events) {
                boolean samePrinterPrint = HelperEvents.PRINTER_PRINTED.equals(queued.optString("type"))
                        && address.equals(addressOf(queued));
                if (!samePrinterPrint) kept.add(queued);
            }
            events = kept;
        }
        events.add(event);
        while (events.size() > MAX_EVENTS) events.remove(0);
        save(events);
    }

    /** Первые {@code max} событий по порядку — сервер обрабатывает их в этом же порядке. */
    public synchronized List<JSONObject> peek(int max) {
        List<JSONObject> events = load();
        return new ArrayList<>(events.subList(0, Math.min(max, events.size())));
    }

    public synchronized void remove(Collection<String> ids) {
        if (ids.isEmpty()) return;
        Set<String> drop = new HashSet<>(ids);
        List<JSONObject> kept = new ArrayList<>();
        for (JSONObject event : load()) {
            if (!drop.contains(event.optString("id"))) kept.add(event);
        }
        save(kept);
    }

    public synchronized int size() {
        return load().size();
    }

    public synchronized void clear() {
        storage.write("[]");
    }

    private List<JSONObject> load() {
        List<JSONObject> events = new ArrayList<>();
        String raw = storage.read();
        if (raw == null || raw.isEmpty()) return events;
        try {
            JSONArray array = new JSONArray(raw);
            for (int i = 0; i < array.length(); i++) {
                JSONObject event = array.optJSONObject(i);
                if (event != null) events.add(event);
            }
        } catch (JSONException e) {
            // Испорченную очередь не чиним: лучше потерять отметки, чем падать.
            storage.write("[]");
        }
        return events;
    }

    private void save(List<JSONObject> events) {
        JSONArray array = new JSONArray();
        for (JSONObject event : events) array.put(event);
        storage.write(array.toString());
    }

    private static String addressOf(JSONObject event) {
        JSONObject printer = event.optJSONObject("printer");
        return printer == null ? "" : printer.optString("address");
    }
}
