package ru.wesetup.helper.bt;

import org.json.JSONException;
import org.json.JSONObject;

import ru.wesetup.helper.print.LabelSettings;

/** Подключённый принтер, сохранённый на телефоне. */
public final class PrinterInfo {

    public static final String TRANSPORT_CLASSIC = "classic";
    public static final String TRANSPORT_BLE = "ble";

    public final String address;
    public String name;
    public String model;
    /** {@link #TRANSPORT_CLASSIC} (SPP) или {@link #TRANSPORT_BLE}. */
    public String transport;
    /** Для BLE — сервис и характеристика, в которую пишем. */
    public String bleService;
    public String bleCharacteristic;
    public long addedAt;
    /** Последняя удачная печать — показывается на главном экране. */
    public long lastPrintAt;
    public LabelSettings label = new LabelSettings();

    public PrinterInfo(String address) {
        this.address = address;
    }

    public String displayName() {
        return name == null || name.trim().isEmpty() ? address : name;
    }

    public JSONObject toJson() {
        try {
            JSONObject label = new JSONObject()
                    .put("widthMm", this.label.widthMm)
                    .put("heightMm", this.label.heightMm)
                    .put("gapMm", (double) this.label.gapMm)
                    .put("density", this.label.density)
                    .put("speed", this.label.speed)
                    .put("rotate180", this.label.rotate180)
                    .put("shiftXmm", (double) this.label.shiftXmm)
                    .put("shiftYmm", (double) this.label.shiftYmm);
            return new JSONObject()
                    .put("address", address)
                    .put("name", name == null ? JSONObject.NULL : name)
                    .put("model", model == null ? JSONObject.NULL : model)
                    .put("transport", transport)
                    .put("bleService", bleService == null ? JSONObject.NULL : bleService)
                    .put("bleCharacteristic", bleCharacteristic == null ? JSONObject.NULL : bleCharacteristic)
                    .put("addedAt", addedAt)
                    .put("lastPrintAt", lastPrintAt)
                    .put("label", label);
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    public static PrinterInfo fromJson(JSONObject json) throws JSONException {
        PrinterInfo info = new PrinterInfo(json.getString("address"));
        info.name = optString(json, "name");
        info.model = optString(json, "model");
        info.transport = json.optString("transport", TRANSPORT_CLASSIC);
        info.bleService = optString(json, "bleService");
        info.bleCharacteristic = optString(json, "bleCharacteristic");
        info.addedAt = json.optLong("addedAt", 0L);
        info.lastPrintAt = json.optLong("lastPrintAt", 0L);
        JSONObject label = json.optJSONObject("label");
        if (label != null) {
            LabelSettings s = info.label;
            s.widthMm = label.optInt("widthMm", s.widthMm);
            s.heightMm = label.optInt("heightMm", s.heightMm);
            s.gapMm = (float) label.optDouble("gapMm", s.gapMm);
            s.density = label.optInt("density", s.density);
            s.speed = label.optInt("speed", s.speed);
            s.rotate180 = label.optBoolean("rotate180", s.rotate180);
            s.shiftXmm = (float) label.optDouble("shiftXmm", s.shiftXmm);
            s.shiftYmm = (float) label.optDouble("shiftYmm", s.shiftYmm);
            info.label = s.normalized();
        }
        return info;
    }

    private static String optString(JSONObject json, String key) {
        return json.isNull(key) ? null : json.optString(key, null);
    }
}
