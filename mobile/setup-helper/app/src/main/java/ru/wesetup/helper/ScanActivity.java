package ru.wesetup.helper;

import android.bluetooth.BluetoothAdapter;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.progressindicator.LinearProgressIndicator;

import java.util.ArrayList;
import java.util.List;

import ru.wesetup.helper.bt.BtSupport;
import ru.wesetup.helper.bt.DeviceScanner;
import ru.wesetup.helper.bt.FoundDevice;
import ru.wesetup.helper.bt.PrinterInfo;
import ru.wesetup.helper.bt.PrinterManager;
import ru.wesetup.helper.net.HelperEvents;

/**
 * «Добавить оборудование»: поиск Bluetooth-устройств телефона и
 * подключение выбранного принтера. После подключения принтер сохраняется
 * на телефоне, а сайту уходит отметка (сразу или когда появится сеть).
 *
 * <p>Если поиск закончился, а похожего на принтер нет, экран говорит, что
 * проверить, и ведёт в системные настройки Bluetooth: сопряжённый там
 * принтер появляется здесь при возврате.
 */
public final class ScanActivity extends BaseActivity implements DeviceScanner.Listener {

    private HelperApp app;
    private DeviceScanner scanner;
    private TextView statusText;
    private LinearProgressIndicator progress;
    private MaterialButton showAll;
    private View help;
    private View helpLocation;
    private TextView empty;
    private LinearLayout list;
    private List<FoundDevice> devices = new ArrayList<>();
    private boolean showAllDevices;
    private boolean scanFinished;
    private boolean connecting;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        app = HelperApp.get(this);
        setContentView(R.layout.activity_scan);
        Ui.applySystemBarInsets(this, findViewById(R.id.scan_root));

        statusText = findViewById(R.id.scan_status);
        progress = findViewById(R.id.scan_progress);
        showAll = findViewById(R.id.scan_show_all);
        help = findViewById(R.id.scan_help);
        helpLocation = findViewById(R.id.scan_help_location);
        empty = findViewById(R.id.scan_empty);
        list = findViewById(R.id.scan_list);

        findViewById(R.id.scan_back).setOnClickListener(v -> finish());
        findViewById(R.id.scan_again).setOnClickListener(v -> withBluetooth(true, this::startScan));
        findViewById(R.id.scan_help_settings).setOnClickListener(v -> openBluetoothSettings());
        showAll.setOnClickListener(v -> {
            showAllDevices = !showAllDevices;
            renderList();
        });
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (!connecting) withBluetooth(true, this::startScan);
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (scanner != null) scanner.stop();
    }

    private void startScan() {
        BluetoothAdapter adapter = BtSupport.adapter(this);
        if (adapter == null || !adapter.isEnabled()) return;
        if (scanner == null) scanner = new DeviceScanner(this, adapter, this);
        statusText.setText(R.string.scan_running);
        progress.setVisibility(View.VISIBLE);
        empty.setVisibility(View.GONE);
        scanFinished = false;
        help.setVisibility(View.GONE);
        try {
            scanner.start();
        } catch (SecurityException e) {
            progress.setVisibility(View.GONE);
            Ui.message(this, getString(R.string.scan_title), getString(R.string.bt_permission_needed));
        }
    }

    @Override
    public void onDevicesChanged(List<FoundDevice> found) {
        devices = found;
        renderList();
    }

    @Override
    public void onScanFinished() {
        progress.setVisibility(View.GONE);
        statusText.setText(R.string.scan_done);
        scanFinished = true;
        renderList();
    }

    private void renderList() {
        list.removeAllViews();
        LayoutInflater inflater = LayoutInflater.from(this);
        int shown = 0;
        int hidden = 0;
        boolean printerFound = false;
        for (FoundDevice device : devices) {
            if (device.isLikelyPrinter()) printerFound = true;
            if (!device.visibleByDefault() && !showAllDevices) {
                hidden++;
                continue;
            }
            View item = inflater.inflate(R.layout.item_device, list, false);
            TextView name = item.findViewById(R.id.device_name);
            name.setText(device.hasName() ? device.name : getString(R.string.scan_unnamed));
            ((TextView) item.findViewById(R.id.device_address)).setText(device.address);
            List<String> badges = new ArrayList<>();
            if (device.printerScore() >= 50) badges.add(getString(R.string.scan_printer_badge));
            if (device.bonded) badges.add(getString(R.string.scan_bonded_badge));
            if (device.le && !device.classic) badges.add(getString(R.string.scan_ble_badge));
            TextView badgeView = item.findViewById(R.id.device_badges);
            if (!badges.isEmpty()) {
                badgeView.setVisibility(View.VISIBLE);
                badgeView.setText(TextUtils.join(" · ", badges));
            }
            item.setOnClickListener(v -> withBluetooth(false, () -> connect(device)));
            list.addView(item);
            shown++;
        }
        boolean scanning = scanner != null && scanner.isRunning();
        empty.setVisibility(shown == 0 && !scanning ? View.VISIBLE : View.GONE);
        if (showAllDevices) {
            showAll.setVisibility(View.VISIBLE);
            showAll.setText(R.string.scan_hide_unnamed);
        } else {
            showAll.setVisibility(hidden > 0 ? View.VISIBLE : View.GONE);
            showAll.setText(getString(R.string.scan_show_all, hidden));
        }
        boolean needHelp = scanFinished && !scanning && !printerFound;
        help.setVisibility(needHelp ? View.VISIBLE : View.GONE);
        // С Android 12 геолокация поиску не нужна, но некоторые прошивки без неё не ищут.
        helpLocation.setVisibility(needHelp && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && BtSupport.locationDisabled(this) ? View.VISIBLE : View.GONE);
    }

    private void openBluetoothSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS));
        } catch (ActivityNotFoundException e) {
            Ui.message(this, getString(R.string.scan_bt_settings), getString(R.string.bt_enable_needed));
        }
    }

    private void connect(FoundDevice device) {
        if (connecting) return;
        connecting = true;
        if (scanner != null) scanner.stop();
        String title = getString(R.string.scan_connecting_title, device.hasName() ? device.name : device.address);
        Ui.Progress dialog = new Ui.Progress(this, title, getString(R.string.scan_pin_note));
        dialog.update(getString(R.string.scan_running));
        app.printers().connectNew(device, dialog::update, new PrinterManager.Callback<PrinterInfo>() {
            @Override
            public void onSuccess(PrinterInfo info) {
                connecting = false;
                dialog.dismiss();
                // Переподключение уже известного принтера не сбрасывает его настройки этикетки.
                PrinterInfo previous = app.printerStore().get(info.address);
                if (previous != null) {
                    info.label = previous.label;
                    info.lastPrintAt = previous.lastPrintAt;
                    if (info.name == null) info.name = previous.name;
                }
                app.printerStore().save(info);
                app.sync().enqueue(HelperEvents.printerConnected(info, System.currentTimeMillis()));
                Toast.makeText(ScanActivity.this, R.string.scan_connected, Toast.LENGTH_SHORT).show();
                finish();
            }

            @Override
            public void onError(String message) {
                connecting = false;
                dialog.dismiss();
                if (isFinishing() || isDestroyed()) return;
                new MaterialAlertDialogBuilder(ScanActivity.this)
                        .setTitle(R.string.scan_failed_title)
                        .setMessage(message)
                        .setPositiveButton(R.string.scan_retry, (d, w) -> withBluetooth(false, () -> connect(device)))
                        .setNeutralButton(R.string.scan_bt_settings, (d, w) -> openBluetoothSettings())
                        .setNegativeButton(R.string.cancel, null)
                        .show();
            }
        });
    }
}
