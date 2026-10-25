package ru.wesetup.helper.bt;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;

import java.util.ArrayList;
import java.util.List;

/** Подключённые принтеры на телефоне (SharedPreferences, JSON). */
public final class PrinterStore {

    private static final String TAG = "SetupHelper";
    private static final String KEY = "list";

    private final SharedPreferences prefs;

    public PrinterStore(Context context) {
        prefs = context.getSharedPreferences("printers", Context.MODE_PRIVATE);
    }

    public synchronized List<PrinterInfo> all() {
        List<PrinterInfo> printers = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(prefs.getString(KEY, "[]"));
            for (int i = 0; i < array.length(); i++) printers.add(PrinterInfo.fromJson(array.getJSONObject(i)));
        } catch (JSONException e) {
            Log.w(TAG, "Список принтеров повреждён", e);
        }
        return printers;
    }

    public synchronized PrinterInfo get(String address) {
        for (PrinterInfo printer : all()) {
            if (printer.address.equals(address)) return printer;
        }
        return null;
    }

    public synchronized void save(PrinterInfo printer) {
        List<PrinterInfo> printers = all();
        boolean replaced = false;
        for (int i = 0; i < printers.size(); i++) {
            if (printers.get(i).address.equals(printer.address)) {
                printers.set(i, printer);
                replaced = true;
            }
        }
        if (!replaced) printers.add(printer);
        write(printers);
    }

    public synchronized void remove(String address) {
        List<PrinterInfo> kept = new ArrayList<>();
        for (PrinterInfo printer : all()) {
            if (!printer.address.equals(address)) kept.add(printer);
        }
        write(kept);
    }

    public synchronized void clear() {
        prefs.edit().clear().apply();
    }

    private void write(List<PrinterInfo> printers) {
        JSONArray array = new JSONArray();
        for (PrinterInfo printer : printers) array.put(printer.toJson());
        prefs.edit().putString(KEY, array.toString()).apply();
    }
}
