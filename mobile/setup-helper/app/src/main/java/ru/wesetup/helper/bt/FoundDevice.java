package ru.wesetup.helper.bt;

import java.util.Comparator;

/** Устройство из поиска: классического, BLE или из списка сопряжённых. */
public final class FoundDevice {

    public static final int NO_RSSI = Integer.MIN_VALUE;

    public final String address;
    public String name;
    public int rssi = NO_RSSI;
    public boolean bonded;
    public boolean classic;
    public boolean le;
    /** Класс устройства Bluetooth (основной + второстепенный) или {@link PrinterNames#NO_CLASS}. */
    public int deviceClass = PrinterNames.NO_CLASS;

    public FoundDevice(String address) {
        this.address = address;
    }

    public boolean hasName() {
        return name != null && !name.trim().isEmpty();
    }

    public int printerScore() {
        return PrinterNames.score(name, deviceClass);
    }

    public boolean isLikelyPrinter() {
        return printerScore() >= 50;
    }

    /**
     * Показывать ли без «Показать все устройства»: с именем, сопряжённое или
     * похожее на принтер по классу — даже если имя так и не прочиталось.
     */
    public boolean visibleByDefault() {
        return hasName() || bonded || isLikelyPrinter();
    }

    /** Принтеры сверху, затем сопряжённые, затем по силе сигнала. */
    public static final Comparator<FoundDevice> ORDER = (a, b) -> {
        int byScore = Integer.compare(b.printerScore(), a.printerScore());
        if (byScore != 0) return byScore;
        if (a.bonded != b.bonded) return a.bonded ? -1 : 1;
        if (a.hasName() != b.hasName()) return a.hasName() ? -1 : 1;
        return Integer.compare(b.rssi, a.rssi);
    };
}
