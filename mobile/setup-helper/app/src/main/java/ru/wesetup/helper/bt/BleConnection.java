package ru.wesetup.helper.bt;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothStatusCodes;
import android.content.Context;
import android.os.Build;
import android.util.Log;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * Bluetooth LE — запасной путь для принтеров без классического Bluetooth
 * (по руководству серии IP-802 iPhone подключается без PIN, значит у
 * принтера есть и BLE).
 *
 * <p>Пишем в «UART»-характеристику: сначала ищем известные сервисы
 * принтеров, затем любую записываемую характеристику вне стандартных
 * сервисов. Данные режутся по MTU, следующий кусок уходит только после
 * подтверждения предыдущего — иначе Android молча теряет пакеты.
 */
@SuppressLint("MissingPermission")
final class BleConnection implements PrinterConnection {

    private static final String TAG = "SetupHelper";
    private static final long CONNECT_TIMEOUT_MS = 12_000;
    private static final long DISCOVER_TIMEOUT_MS = 10_000;
    private static final long WRITE_TIMEOUT_MS = 5_000;
    private static final int REQUESTED_MTU = 247;

    /** Сервис и характеристика записи у распространённых модулей термопринтеров. */
    private static final String[][] KNOWN = {
            {"49535343-fe7d-4ae5-8fa9-9fafd205e455", "49535343-8841-43f4-a8d4-ecbe34729bb3"},
            {"000018f0-0000-1000-8000-00805f9b34fb", "00002af1-0000-1000-8000-00805f9b34fb"},
            {"0000ff00-0000-1000-8000-00805f9b34fb", "0000ff02-0000-1000-8000-00805f9b34fb"},
            {"0000ffe0-0000-1000-8000-00805f9b34fb", "0000ffe1-0000-1000-8000-00805f9b34fb"},
            {"e7810a71-73ae-499d-8c15-faa9aef0c3f2", "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f"},
    };
    /** Стандартные сервисы, куда печать точно не пишут: GAP, GATT, сведения об устройстве, батарея. */
    private static final List<String> STANDARD = Arrays.asList("1800", "1801", "180a", "180f");

    private final CountDownLatch connected = new CountDownLatch(1);
    private final CountDownLatch discovered = new CountDownLatch(1);
    private final CountDownLatch mtuChanged = new CountDownLatch(1);
    private final Semaphore writeDone = new Semaphore(0);
    private volatile boolean open;
    private volatile int mtu = 23;
    private volatile int writeStatus = BluetoothGatt.GATT_SUCCESS;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic target;
    private int writeType;

    private final BluetoothGattCallback callback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                open = true;
                connected.countDown();
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                open = false;
                connected.countDown();
                discovered.countDown();
                mtuChanged.countDown();
                writeDone.release();
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            discovered.countDown();
        }

        @Override
        public void onMtuChanged(BluetoothGatt g, int newMtu, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) mtu = newMtu;
            mtuChanged.countDown();
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic characteristic, int status) {
            writeStatus = status;
            writeDone.release();
        }
    };

    private BleConnection() {
    }

    static BleConnection open(Context context, BluetoothDevice device, String preferredService,
                              String preferredCharacteristic) throws IOException {
        BleConnection connection = new BleConnection();
        try {
            connection.gatt = device.connectGatt(context, false, connection.callback, BluetoothDevice.TRANSPORT_LE);
            if (connection.gatt == null) throw new IOException("Bluetooth LE недоступен");
            if (!connection.connected.await(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS) || !connection.open) {
                throw new IOException("Принтер не ответил по Bluetooth LE");
            }
            if (!connection.gatt.discoverServices()
                    || !connection.discovered.await(DISCOVER_TIMEOUT_MS, TimeUnit.MILLISECONDS) || !connection.open) {
                throw new IOException("Не удалось получить службы принтера");
            }
            connection.target = pick(connection.gatt.getServices(), preferredService, preferredCharacteristic);
            if (connection.target == null) throw new IOException("У устройства нет канала для печати по Bluetooth LE");
            int props = connection.target.getProperties();
            connection.writeType = (props & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0
                    ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                    : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
            if (connection.gatt.requestMtu(REQUESTED_MTU)) {
                connection.mtuChanged.await(3, TimeUnit.SECONDS);
            }
            return connection;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            connection.close();
            throw new IOException("Подключение прервано", e);
        } catch (IOException | RuntimeException e) {
            connection.close();
            throw e instanceof IOException ? (IOException) e : new IOException(e.getMessage(), e);
        }
    }

    static BluetoothGattCharacteristic pick(List<BluetoothGattService> services, String preferredService,
                                            String preferredCharacteristic) {
        if (preferredService != null && preferredCharacteristic != null) {
            BluetoothGattCharacteristic saved = find(services, preferredService, preferredCharacteristic);
            if (saved != null) return saved;
        }
        for (String[] pair : KNOWN) {
            BluetoothGattCharacteristic known = find(services, pair[0], pair[1]);
            if (known != null && writable(known)) return known;
        }
        for (BluetoothGattService service : services) {
            if (STANDARD.contains(shortUuid(service.getUuid()))) continue;
            for (BluetoothGattCharacteristic characteristic : service.getCharacteristics()) {
                if (writable(characteristic)) return characteristic;
            }
        }
        return null;
    }

    private static BluetoothGattCharacteristic find(List<BluetoothGattService> services, String service,
                                                    String characteristic) {
        for (BluetoothGattService s : services) {
            if (!s.getUuid().toString().equalsIgnoreCase(service)) continue;
            BluetoothGattCharacteristic c = s.getCharacteristic(UUID.fromString(characteristic));
            if (c != null) return c;
        }
        return null;
    }

    private static boolean writable(BluetoothGattCharacteristic characteristic) {
        int props = characteristic.getProperties();
        return (props & (BluetoothGattCharacteristic.PROPERTY_WRITE
                | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) != 0;
    }

    private static String shortUuid(UUID uuid) {
        String value = uuid.toString().toLowerCase(Locale.ROOT);
        return value.endsWith("-0000-1000-8000-00805f9b34fb") ? value.substring(4, 8) : value;
    }

    String serviceUuid() {
        return target.getService().getUuid().toString();
    }

    String characteristicUuid() {
        return target.getUuid().toString();
    }

    @Override
    public void write(byte[] data) throws IOException {
        int chunk = Math.max(20, mtu - 3);
        for (int offset = 0; offset < data.length; offset += chunk) {
            writeChunk(Arrays.copyOfRange(data, offset, Math.min(data.length, offset + chunk)));
        }
    }

    @SuppressWarnings("deprecation")
    private void writeChunk(byte[] part) throws IOException {
        for (int attempt = 0; attempt < 100; attempt++) {
            if (!open) throw new IOException("Связь с принтером по Bluetooth LE прервалась");
            writeDone.drainPermits();
            boolean started;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                started = gatt.writeCharacteristic(target, part, writeType) == BluetoothStatusCodes.SUCCESS;
            } else {
                target.setWriteType(writeType);
                target.setValue(part);
                started = gatt.writeCharacteristic(target);
            }
            if (started) {
                try {
                    if (!writeDone.tryAcquire(WRITE_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                        throw new IOException("Принтер не принял данные по Bluetooth LE");
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IOException("Печать прервана", e);
                }
                if (!open) throw new IOException("Связь с принтером по Bluetooth LE прервалась");
                if (writeStatus != BluetoothGatt.GATT_SUCCESS) {
                    throw new IOException("Ошибка записи по Bluetooth LE: " + writeStatus);
                }
                return;
            }
            // Очередь Bluetooth занята предыдущей записью — чуть ждём.
            try {
                Thread.sleep(10);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("Печать прервана", e);
            }
        }
        throw new IOException("Bluetooth LE занят — попробуйте ещё раз");
    }

    @Override
    public int readStatus(long timeoutMs) {
        // Ответы по BLE приходят уведомлениями; для простоты состояние не читаем.
        return -1;
    }

    @Override
    public boolean isOpen() {
        return open;
    }

    @Override
    public void close() {
        open = false;
        if (gatt == null) return;
        try {
            gatt.disconnect();
            gatt.close();
        } catch (RuntimeException e) {
            Log.w(TAG, "BLE не закрылся", e);
        }
        gatt = null;
    }
}
