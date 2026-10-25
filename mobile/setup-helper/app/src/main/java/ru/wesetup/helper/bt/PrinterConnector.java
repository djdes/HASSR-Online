package ru.wesetup.helper.bt;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.Context;
import android.util.Log;

import java.io.IOException;

/**
 * Подключение к принтеру «чтобы точно подключился».
 *
 * <p>Порядок: остановить поиск (он мешает подключению) → для классического
 * Bluetooth сопрячь (PIN 0000/1234) и открыть SPP тремя способами → если не
 * вышло или устройство только BLE — Bluetooth LE. Для принтера, который уже
 * подключали по BLE, сначала пробуем BLE.
 */
@SuppressLint("MissingPermission")
public final class PrinterConnector {

    private static final String TAG = "SetupHelper";
    private static final long BOND_TIMEOUT_MS = 45_000;

    public interface Progress {
        void onStatus(String message);
    }

    public static final class Result {
        public final PrinterConnection connection;
        public final String transport;
        public final String bleService;
        public final String bleCharacteristic;

        Result(PrinterConnection connection, String transport, String bleService, String bleCharacteristic) {
            this.connection = connection;
            this.transport = transport;
            this.bleService = bleService;
            this.bleCharacteristic = bleCharacteristic;
        }
    }

    private PrinterConnector() {
    }

    public static Result connect(Context context, BluetoothAdapter adapter, String address, String preferredTransport,
                                 String bleService, String bleCharacteristic, Progress progress) throws IOException {
        BluetoothDevice device = adapter.getRemoteDevice(address);
        if (adapter.isDiscovering()) adapter.cancelDiscovery();

        int type = device.getType();
        boolean classicPossible = type != BluetoothDevice.DEVICE_TYPE_LE;
        boolean blePossible = type != BluetoothDevice.DEVICE_TYPE_CLASSIC;
        boolean bleFirst = PrinterInfo.TRANSPORT_BLE.equals(preferredTransport) || type == BluetoothDevice.DEVICE_TYPE_LE;

        IOException last = null;
        for (int pass = 0; pass < 2; pass++) {
            boolean ble = (pass == 0) == bleFirst;
            try {
                if (ble && blePossible) {
                    progress.onStatus("Подключаемся по Bluetooth LE…");
                    BleConnection connection = BleConnection.open(context, device, bleService, bleCharacteristic);
                    return new Result(connection, PrinterInfo.TRANSPORT_BLE, connection.serviceUuid(),
                            connection.characteristicUuid());
                }
                if (!ble && classicPossible) {
                    boolean bonded = Pairing.ensureBonded(context, device, progress, BOND_TIMEOUT_MS);
                    progress.onStatus("Открываем канал печати…");
                    return new Result(SppConnection.open(device, bonded), PrinterInfo.TRANSPORT_CLASSIC, null, null);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("Подключение прервано", e);
            } catch (IOException e) {
                Log.w(TAG, (ble ? "BLE" : "SPP") + " не подключился: " + e.getMessage());
                last = e;
            }
        }
        throw last != null ? last : new IOException("Устройство не поддерживает подключение принтера");
    }
}
