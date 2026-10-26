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

    /**
     * Подключиться не вышло — с причиной, которую можно показать человеку как
     * есть: «не дал сопрячься» и «не отвечает» лечатся по-разному.
     */
    public static final class ConnectFailure extends IOException {
        public final boolean pairing;

        ConnectFailure(boolean pairing, Throwable cause) {
            super(pairing ? PAIRING_FAILED : NOT_RESPONDING, cause);
            this.pairing = pairing;
        }
    }

    static final String PAIRING_FAILED = "Принтер не дал сопрячься. Если телефон спрашивал PIN-код, введите 0000 "
            + "или 1234. Если этот принтер уже подключали к телефону раньше, удалите его в настройках Bluetooth "
            + "(«Забыть устройство») и добавьте снова.";
    static final String NOT_RESPONDING = "Принтер не отвечает. Проверьте, что он включён и стоит рядом, выключите "
            + "и включите его. Если он подключён к другому телефону или компьютеру или открыт в другом приложении — "
            + "отключите его там.";

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

        ConnectFailure classicFailure = null;
        IOException bleFailure = null;
        for (int pass = 0; pass < 2; pass++) {
            boolean ble = (pass == 0) == bleFirst;
            if (ble && blePossible) {
                try {
                    progress.onStatus("Подключаемся по Bluetooth LE…");
                    BleConnection connection = BleConnection.open(context, device, bleService, bleCharacteristic);
                    return new Result(connection, PrinterInfo.TRANSPORT_BLE, connection.serviceUuid(),
                            connection.characteristicUuid());
                } catch (IOException e) {
                    Log.w(TAG, "BLE не подключился: " + e.getMessage());
                    bleFailure = e;
                }
            }
            if (!ble && classicPossible) {
                boolean bonded;
                try {
                    bonded = Pairing.ensureBonded(context, device, progress, BOND_TIMEOUT_MS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IOException("Подключение прервано", e);
                }
                try {
                    progress.onStatus("Открываем канал печати…");
                    return new Result(SppConnection.open(device, bonded), PrinterInfo.TRANSPORT_CLASSIC, null, null);
                } catch (IOException e) {
                    Log.w(TAG, "SPP не подключился (сопряжён: " + bonded + "): " + e.getMessage());
                    // Без сопряжения канал не открылся — дело, скорее всего, в PIN.
                    classicFailure = new ConnectFailure(!bonded, e);
                }
            }
        }
        // Классический Bluetooth — основной путь IP-802BT: его причина понятнее.
        if (classicFailure != null) throw classicFailure;
        if (bleFailure != null) throw new ConnectFailure(false, bleFailure);
        throw new IOException("Устройство не поддерживает подключение принтера");
    }
}
