package ru.wesetup.helper.bt;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.util.Log;

import androidx.core.content.ContextCompat;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Сопряжение с принтером.
 *
 * <p>По руководству серии AIYIN IP-802 Android сопрягается с PIN «0000» или
 * «1234». Если принтер спросит PIN, подставляем «0000», не вышло — повторяем
 * сопряжение с «1234». Если подставить не дали (некоторые прошивки Android),
 * человек увидит системное окно — подсказка с PIN есть на экране.
 */
@SuppressLint("MissingPermission")
final class Pairing {

    private static final String TAG = "SetupHelper";
    static final String[] PINS = {"0000", "1234"};

    private Pairing() {
    }

    /** true — устройство сопряжено. */
    static boolean ensureBonded(Context context, BluetoothDevice device, PrinterConnector.Progress progress,
                                long timeoutMs) throws InterruptedException {
        if (device.getBondState() == BluetoothDevice.BOND_BONDED) return true;

        CountDownLatch done = new CountDownLatch(1);
        AtomicBoolean pinRequested = new AtomicBoolean(false);
        AtomicInteger attempt = new AtomicInteger(0);

        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                BluetoothDevice target = DeviceScanner.deviceExtra(intent);
                if (target == null || !device.getAddress().equals(target.getAddress())) return;
                String action = intent.getAction();
                if (BluetoothDevice.ACTION_PAIRING_REQUEST.equals(action)) {
                    int variant = intent.getIntExtra(BluetoothDevice.EXTRA_PAIRING_VARIANT, -1);
                    if (variant == BluetoothDevice.PAIRING_VARIANT_PIN) {
                        pinRequested.set(true);
                        String pin = PINS[Math.min(attempt.get(), PINS.length - 1)];
                        progress.onStatus("Сопряжение, PIN " + pin + "…");
                        try {
                            target.setPin(pin.getBytes(StandardCharsets.US_ASCII));
                        } catch (RuntimeException e) {
                            Log.w(TAG, "PIN не подставлен — введёт человек", e);
                        }
                    }
                } else if (BluetoothDevice.ACTION_BOND_STATE_CHANGED.equals(action)) {
                    int state = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.BOND_NONE);
                    int previous = intent.getIntExtra(BluetoothDevice.EXTRA_PREVIOUS_BOND_STATE, BluetoothDevice.BOND_NONE);
                    if (state == BluetoothDevice.BOND_BONDED) {
                        done.countDown();
                    } else if (state == BluetoothDevice.BOND_NONE && previous == BluetoothDevice.BOND_BONDING) {
                        if (pinRequested.get() && attempt.incrementAndGet() < PINS.length) {
                            progress.onStatus("Пробуем PIN " + PINS[attempt.get()] + "…");
                            if (!target.createBond()) done.countDown();
                        } else {
                            done.countDown();
                        }
                    }
                }
            }
        };

        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
        filter.addAction(BluetoothDevice.ACTION_PAIRING_REQUEST);
        filter.setPriority(IntentFilter.SYSTEM_HIGH_PRIORITY - 1);
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_EXPORTED);
        try {
            progress.onStatus("Сопряжение с принтером…");
            if (!device.createBond() && device.getBondState() != BluetoothDevice.BOND_BONDING) {
                return device.getBondState() == BluetoothDevice.BOND_BONDED;
            }
            done.await(timeoutMs, TimeUnit.MILLISECONDS);
            return device.getBondState() == BluetoothDevice.BOND_BONDED;
        } finally {
            context.unregisterReceiver(receiver);
        }
    }
}
