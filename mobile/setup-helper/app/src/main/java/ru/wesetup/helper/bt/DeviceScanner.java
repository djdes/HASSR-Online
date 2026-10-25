package ru.wesetup.helper.bt;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
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
 * <p>Разрешения проверяет экран до запуска.
 */
@SuppressLint("MissingPermission")
public final class DeviceScanner {

    private static final String TAG = "SetupHelper";
    /** Классический поиск Android и так длится около 12 секунд. */
    private static final long SCAN_MS = 15_000;

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

    private final Runnable stopLater = this::stop;

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            String action = intent.getAction();
            if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                // Классический поиск закончился раньше таймера — BLE ещё ищет.
                return;
            }
            BluetoothDevice device = deviceExtra(intent);
            if (device == null) return;
            FoundDevice found = merge(device);
            found.classic = true;
            String name = intent.getStringExtra(BluetoothDevice.EXTRA_NAME);
            if (name != null && !name.trim().isEmpty()) found.name = name;
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

    public void start() {
        stop();
        running = true;
        devices.clear();
        for (BluetoothDevice device : adapter.getBondedDevices()) {
            FoundDevice found = merge(device);
            found.bonded = true;
        }
        publish();

        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothDevice.ACTION_NAME_CHANGED);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_EXPORTED);
        receiverRegistered = true;
        if (adapter.isDiscovering()) adapter.cancelDiscovery();
        if (!adapter.startDiscovery()) Log.w(TAG, "Классический поиск не запустился");

        leScanner = adapter.getBluetoothLeScanner();
        if (leScanner != null) {
            try {
                ScanSettings settings = new ScanSettings.Builder()
                        .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                        .build();
                leScanner.startScan(null, settings, leCallback);
            } catch (RuntimeException e) {
                Log.w(TAG, "BLE-поиск недоступен", e);
                leScanner = null;
            }
        }
        main.postDelayed(stopLater, SCAN_MS);
    }

    public void stop() {
        main.removeCallbacks(stopLater);
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

    private FoundDevice merge(BluetoothDevice device) {
        FoundDevice found = devices.get(device.getAddress());
        if (found == null) {
            found = new FoundDevice(device.getAddress());
            devices.put(device.getAddress(), found);
        }
        String name = null;
        try {
            name = device.getName();
        } catch (SecurityException e) {
            Log.w(TAG, "Нет разрешения на имя устройства", e);
        }
        if (name != null && !name.trim().isEmpty()) found.name = name;
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
}
