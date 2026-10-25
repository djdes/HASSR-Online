package ru.wesetup.helper.bt;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * Разрешения и состояние Bluetooth на разных версиях Android.
 *
 * <p>Android 12+: {@code BLUETOOTH_SCAN} для поиска и {@code BLUETOOTH_CONNECT}
 * для подключения. До 12: поиск требует геолокации и включённого
 * определения местоположения, подключение — только манифеста.
 */
public final class BtSupport {

    private BtSupport() {
    }

    public static BluetoothAdapter adapter(Context context) {
        BluetoothManager manager = context.getSystemService(BluetoothManager.class);
        return manager == null ? null : manager.getAdapter();
    }

    public static String[] requiredPermissions(boolean scanning) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return scanning
                    ? new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT}
                    : new String[]{Manifest.permission.BLUETOOTH_CONNECT};
        }
        return scanning ? new String[]{Manifest.permission.ACCESS_FINE_LOCATION} : new String[0];
    }

    public static String[] missingPermissions(Context context, boolean scanning) {
        List<String> missing = new ArrayList<>();
        for (String permission : requiredPermissions(scanning)) {
            if (ContextCompat.checkSelfPermission(context, permission) != PackageManager.PERMISSION_GRANTED) {
                missing.add(permission);
            }
        }
        return missing.toArray(new String[0]);
    }

    /** До Android 12 поиск без включённой геолокации молча ничего не находит. */
    public static boolean locationServicesOff(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return false;
        LocationManager manager = context.getSystemService(LocationManager.class);
        if (manager == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return !manager.isLocationEnabled();
        return !manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
                && !manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }
}
