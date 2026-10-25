package ru.wesetup.helper;

import android.bluetooth.BluetoothAdapter;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.google.android.material.checkbox.MaterialCheckBox;
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
 */
public final class ScanActivity extends BaseActivity implements DeviceScanner.Listener {

    private HelperApp app;
    private DeviceScanner scanner;
    private TextView statusText;
    private LinearProgressIndicator progress;
    private MaterialCheckBox showUnnamed;
    private TextView empty;
    private LinearLayout list;
    private List<FoundDevice> devices = new ArrayList<>();
    private boolean connecting;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        app = HelperApp.get(this);
        setContentView(R.layout.activity_scan);
        Ui.applySystemBarInsets(this, findViewById(R.id.scan_root));

        statusText = findViewById(R.id.scan_status);
        progress = findViewById(R.id.scan_progress);
        showUnnamed = findViewById(R.id.scan_show_unnamed);
        empty = findViewById(R.id.scan_empty);
        list = findViewById(R.id.scan_list);

        findViewById(R.id.scan_back).setOnClickListener(v -> finish());
        findViewById(R.id.scan_again).setOnClickListener(v -> withBluetooth(true, this::startScan));
        showUnnamed.setOnCheckedChangeListener((button, checked) -> renderList());
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
        renderList();
    }

    private void renderList() {
        list.removeAllViews();
        LayoutInflater inflater = LayoutInflater.from(this);
        int shown = 0;
        for (FoundDevice device : devices) {
            if (!device.hasName() && !showUnnamed.isChecked()) continue;
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
                        .setNegativeButton(R.string.cancel, null)
                        .show();
            }
        });
    }
}
