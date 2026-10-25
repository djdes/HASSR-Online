package ru.wesetup.helper.bt;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Поиск Bluetooth-устройств: сопряжённые + классический поиск (через него
 * Android находит принтеры с SPP, как IP-802BT) + BLE-сканирование (для
 * принтеров только с Bluetooth LE). Результаты сливаются по адресу.
 *
 * <p>Что делает поиск надёжнее:
 * <ul>
 *     <li>идёт 40 секунд, а классический поиск Android (≈12 с) запускается
 *     заново, когда заканчивается, — имена успевают прочитаться;</li>
 *     <li>{@code startDiscovery()} сразу после включения Bluetooth может
 *     вернуть false — повторяем;</li>
 *     <li>BLE-поиск не перезапускается чаще, чем позволяет Android
 *     ({@link ScanThrottle}), — иначе система молча перестаёт отдавать
 *     результаты;</li>
 *     <li>класс устройства (Imaging/Printer) берётся из результатов поиска:
 *     принтер виден, даже если имя не прочиталось.</li>
 * </ul>
 *
 * <p>Разрешения проверяет экран до запуска.
 */
@SuppressLint("MissingPermission")
public final class DeviceScanner {

    private static final String TAG = "SetupHelper";
    static final long SCAN_MS = 40_000;
    static final int MAX_DISCOVERY_ROUNDS = 3;
    static final long DISCOVERY_RETRY_MS = 1_500;
    static final int MAX_DISCOVERY_RETRIES = 3;

    /** Ограничение Android на запуски BLE-поиска — на всё приложение. */
    private static final ScanThrottle BLE_THROTTLE = new ScanThrottle();

    public interface Listener {
        void onDevicesChanged(List<FoundDevice> devices);

        void onScanFinished();
    }

    private final Context context;
    private final BluetoothAdapter adapter;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, FoundDevice> devices = new LinkedHashMap<>();
    private boolean running;
    private boolean receiverRegistered;
    private BluetoothLeScanner leScanner;
    private int discoveryRounds;
    private int discoveryRetries;

    private final Runnable stopLater = this::stop;
    private final Runnable retryDiscovery = this::startClassicDiscovery;

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            String action = intent.getAction();
            if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                // Круг классического поиска закончился, а время ещё есть — ещё круг:
                // за это время дочитываются имена и находятся «сонные» устройства.
                if (running && discoveryRounds < MAX_DISCOVERY_ROUNDS) startClassicDiscovery();
                return;
            }
            BluetoothDevice device = deviceExtra(intent);
            if (device == null) return;
            FoundDevice found = merge(device);
            found.classic = true;
            String name = intent.getStringExtra(BluetoothDevice.EXTRA_NAME);
            if (name != null && !name.trim().isEmpty()) found.name = name;
            BluetoothClass bluetoothClass = classExtra(intent);
            if (bluetoothClass != null) found.deviceClass = bluetoothClass.getDeviceClass();
            if (BluetoothDevice.ACTION_FOUND.equals(action)) {
                short rssi = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE);
                if (rssi != Short.MIN_VALUE) found.rssi = rssi;
            }
            publish();
        }
    };

    private final ScanCallback leCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            main.post(() -> {
                if (!running) return;
                FoundDevice found = merge(result.getDevice());
                found.le = true;
                found.rssi = Math.max(found.rssi, result.getRssi());
                ScanRecord record = result.getScanRecord();
                if (!found.hasName() && record != null && record.getDeviceName() != null) {
                    found.name = record.getDeviceName();
                }
                publish();
            });
        }

        @Override
        public void onScanFailed(int errorCode) {
            Log.w(TAG, "BLE-поиск не запустился: " + errorCode);
        }
    };

    public DeviceScanner(Context context, BluetoothAdapter adapter, Listener listener) {
        this.context = context.getApplicationContext();
        this.adapter = adapter;
        this.listener = listener;
    }

    /** Новый поиск. Уже идущий BLE-поиск не перезапускается — только список и классический поиск. */
    public void start() {
        main.removeCallbacks(stopLater);
        main.removeCallbacks(retryDiscovery);
        running = true;
        discoveryRounds = 0;
        discoveryRetries = 0;
        devices.clear();
        for (BluetoothDevice device : adapter.getBondedDevices()) {
            FoundDevice found = merge(device);
            found.bonded = true;
        }
        publish();

        if (!receiverRegistered) {
            IntentFilter filter = new IntentFilter();
            filter.addAction(BluetoothDevice.ACTION_FOUND);
            filter.addAction(BluetoothDevice.ACTION_NAME_CHANGED);
            filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
            ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_EXPORTED);
            receiverRegistered = true;
        }
        if (adapter.isDiscovering()) adapter.cancelDiscovery();
        startClassicDiscovery();
        startBle();
        main.postDelayed(stopLater, SCAN_MS);
    }

    public void stop() {
        main.removeCallbacks(stopLater);
        main.removeCallbacks(retryDiscovery);
        boolean wasRunning = running;
        running = false;
        if (receiverRegistered) {
            try {
                context.unregisterReceiver(receiver);
            } catch (IllegalArgumentException ignored) {
                // уже снят
            }
            receiverRegistered = false;
        }
        try {
            if (adapter.isDiscovering()) adapter.cancelDiscovery();
            if (leScanner != null) leScanner.stopScan(leCallback);
        } catch (RuntimeException e) {
            Log.w(TAG, "Поиск не остановился", e);
        }
        leScanner = null;
        if (wasRunning) listener.onScanFinished();
    }

    public boolean isRunning() {
        return running;
    }

    private void startClassicDiscovery() {
        if (!running) return;
        try {
            if (adapter.startDiscovery()) {
                discoveryRounds++;
                return;
            }
        } catch (SecurityException e) {
            Log.w(TAG, "Классический поиск без разрешения", e);
            return;
        }
        // Bluetooth только что включили или он занят — через секунду-другую получится.
        if (discoveryRetries < MAX_DISCOVERY_RETRIES) {
            discoveryRetries++;
            main.postDelayed(retryDiscovery, DISCOVERY_RETRY_MS);
        } else {
            Log.w(TAG, "Классический поиск не запустился");
        }
    }

    private void startBle() {
        if (leScanner != null) return; // уже ищет — не трогаем, чтобы не упереться в ограничение Android
        if (!BLE_THROTTLE.tryStart(SystemClock.elapsedRealtime())) {
            Log.i(TAG, "BLE-поиск недавно запускался — в этот раз только классический");
            return;
        }
        BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) return;
        try {
            ScanSettings settings = new ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                    .build();
            scanner.startScan(null, settings, leCallback);
            leScanner = scanner;
        } catch (RuntimeException e) {
            Log.w(TAG, "BLE-поиск недоступен", e);
        }
    }

    private FoundDevice merge(BluetoothDevice device) {
        FoundDevice found = devices.get(device.getAddress());
        if (found == null) {
            found = new FoundDevice(device.getAddress());
            devices.put(device.getAddress(), found);
        }
        try {
            String name = device.getName();
            if (name != null && !name.trim().isEmpty()) found.name = name;
            if (found.deviceClass == PrinterNames.NO_CLASS) {
                BluetoothClass bluetoothClass = device.getBluetoothClass();
                if (bluetoothClass != null) found.deviceClass = bluetoothClass.getDeviceClass();
            }
        } catch (SecurityException e) {
            Log.w(TAG, "Нет разрешения на имя устройства", e);
        }
        int type = device.getType();
        if (type == BluetoothDevice.DEVICE_TYPE_CLASSIC || type == BluetoothDevice.DEVICE_TYPE_DUAL) found.classic = true;
        if (type == BluetoothDevice.DEVICE_TYPE_LE || type == BluetoothDevice.DEVICE_TYPE_DUAL) found.le = true;
        if (device.getBondState() == BluetoothDevice.BOND_BONDED) found.bonded = true;
        return found;
    }

    private void publish() {
        List<FoundDevice> list = new ArrayList<>(devices.values());
        Collections.sort(list, FoundDevice.ORDER);
        listener.onDevicesChanged(list);
    }

    @SuppressWarnings("deprecation")
    static BluetoothDevice deviceExtra(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class);
        }
        return intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
    }

    @SuppressWarnings("deprecation")
    static BluetoothClass classExtra(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(BluetoothDevice.EXTRA_CLASS, BluetoothClass.class);
        }
        return intent.getParcelableExtra(BluetoothDevice.EXTRA_CLASS);
    }
}
