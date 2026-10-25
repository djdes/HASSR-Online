package ru.wesetup.helper.net;

import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;

import ru.wesetup.helper.bt.PrinterInfo;

/**
 * События для сайта ({@code POST /api/setup-helper/sync}).
 *
 * <p>У каждого события свой UUID: если ответ сервера потеряется и очередь
 * отправится ещё раз, сервер узнает повтор и ничего не задвоит. Время — по
 * часам телефона в UTC: событие может пролежать в очереди, пока нет сети.
 */
public final class HelperEvents {

    public static final String PRINTER_CONNECTED = "printer_connected";
    public static final String PRINTER_PRINTED = "printer_printed";
    public static final String PRINTER_REMOVED = "printer_removed";

    private HelperEvents() {
    }

    public static JSONObject printerConnected(PrinterInfo printer, long now) {
        try {
            JSONObject details = new JSONObject()
                    .put("address", printer.address)
                    .put("name", printer.displayName())
                    .put("transport", printer.transport);
            if (printer.model != null) details.put("model", printer.model);
            return base(PRINTER_CONNECTED, now).put("printer", details);
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    public static JSONObject printerPrinted(PrinterInfo printer, String templateId, int copies, long now) {
        try {
            return base(PRINTER_PRINTED, now)
                    .put("printer", new JSONObject().put("address", printer.address))
                    .put("template", templateId)
                    .put("copies", copies);
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    public static JSONObject printerRemoved(PrinterInfo printer, long now) {
        try {
            return base(PRINTER_REMOVED, now).put("printer", new JSONObject().put("address", printer.address));
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    /** ISO 8601 в UTC с миллисекундами — {@code java.time} нет на Android 7. */
    public static String isoUtc(long millis) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(millis));
    }

    private static JSONObject base(String type, long now) throws JSONException {
        return new JSONObject()
                .put("id", UUID.randomUUID().toString())
                .put("type", type)
                .put("at", isoUtc(now));
    }
}
