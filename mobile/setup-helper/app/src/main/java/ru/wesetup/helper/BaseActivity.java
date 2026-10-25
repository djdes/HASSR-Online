package ru.wesetup.helper;

import android.bluetooth.BluetoothAdapter;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import ru.wesetup.helper.bt.BtSupport;

/**
 * Общее для экранов с Bluetooth: перед действием проверить разрешения,
 * включён ли Bluetooth и (на Android до 12, для поиска) геолокация — и
 * попросить недостающее по-человечески.
 */
abstract class BaseActivity extends AppCompatActivity {

    private Runnable pendingAction;
    private boolean pendingScanning;

    private final ActivityResultLauncher<String[]> permissionLauncher = registerForActivityResult(
            new ActivityResultContracts.RequestMultiplePermissions(), result -> afterPermissions());

    private final ActivityResultLauncher<Intent> enableLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(), result -> afterEnable());

    /** Выполнить {@code action}, когда Bluetooth готов. {@code scanning} — нужен поиск устройств. */
    protected void withBluetooth(boolean scanning, Runnable action) {
        BluetoothAdapter adapter = BtSupport.adapter(this);
        if (adapter == null) {
            Ui.message(this, getString(R.string.app_name), getString(R.string.main_no_bluetooth));
            return;
        }
        String[] missing = BtSupport.missingPermissions(this, scanning);
        if (missing.length > 0) {
            pendingAction = action;
            pendingScanning = scanning;
            permissionLauncher.launch(missing);
            return;
        }
        if (!adapter.isEnabled()) {
            pendingAction = action;
            pendingScanning = scanning;
            try {
                enableLauncher.launch(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE));
            } catch (SecurityException e) {
                Toast.makeText(this, R.string.bt_enable_needed, Toast.LENGTH_LONG).show();
            }
            return;
        }
        if (scanning && BtSupport.locationServicesOff(this)) {
            new MaterialAlertDialogBuilder(this)
                    .setMessage(R.string.bt_location_needed)
                    .setPositiveButton(R.string.bt_location_settings,
                            (d, w) -> startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)))
                    .setNegativeButton(R.string.cancel, null)
                    .show();
            return;
        }
        action.run();
    }

    private void afterPermissions() {
        Runnable action = pendingAction;
        pendingAction = null;
        if (action == null) return;
        if (BtSupport.missingPermissions(this, pendingScanning).length > 0) {
            new MaterialAlertDialogBuilder(this)
                    .setMessage(R.string.bt_permission_needed)
                    .setPositiveButton(R.string.bt_open_settings, (d, w) -> startActivity(
                            new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                    Uri.fromParts("package", getPackageName(), null))))
                    .setNegativeButton(R.string.cancel, null)
                    .show();
            return;
        }
        withBluetooth(pendingScanning, action);
    }

    private void afterEnable() {
        Runnable action = pendingAction;
        pendingAction = null;
        if (action == null) return;
        BluetoothAdapter adapter = BtSupport.adapter(this);
        if (adapter != null && adapter.isEnabled()) {
            withBluetooth(pendingScanning, action);
        } else {
            Toast.makeText(this, R.string.bt_enable_needed, Toast.LENGTH_LONG).show();
        }
    }
}
