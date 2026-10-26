package ru.wesetup.helper;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.app.job.JobScheduler;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.view.View;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import ru.wesetup.helper.auth.SessionStore;

/**
 * Вариант для Google Play: самообновления нет совсем — ни разрешения на
 * установку пакетов, ни фонового задания, ни плашки (политика Play).
 * Запускается только в варианте play: {@code testPlayDebugUnitTest}.
 */
@RunWith(RobolectricTestRunner.class)
@Config(application = TestHelperApp.class, sdk = 36)
public class PlayFlavorTest {

    @Test
    public void testNoSelfUpdatePermissionsOrJob() throws Exception {
        assertFalse(BuildConfig.SELF_UPDATE);
        HelperApp app = (HelperApp) RuntimeEnvironment.getApplication();
        PackageInfo info = app.getPackageManager().getPackageInfo(app.getPackageName(), PackageManager.GET_PERMISSIONS);
        List<String> permissions = info.requestedPermissions == null
                ? Collections.emptyList() : Arrays.asList(info.requestedPermissions);
        assertFalse(permissions.contains("android.permission.REQUEST_INSTALL_PACKAGES"));
        assertFalse(permissions.contains("android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION"));
        assertFalse(permissions.contains("android.permission.RECEIVE_BOOT_COMPLETED"));
        // Bluetooth и сеть — на месте.
        assertTrue(permissions.contains("android.permission.BLUETOOTH_CONNECT"));
        assertTrue(permissions.contains("android.permission.INTERNET"));

        // Ни одного фонового задания: в site-варианте это проверка обновлений.
        JobScheduler scheduler = app.getSystemService(JobScheduler.class);
        assertTrue(scheduler.getAllPendingJobs().isEmpty());
    }

    @Test
    public void testMainScreenHasNoUpdateCard() throws Exception {
        HelperApp app = (HelperApp) RuntimeEnvironment.getApplication();
        app.sessions().save(new SessionStore.Session("token-123", "device-1", "Иван Петров", "chef@example.com",
                "Кафе «Ромашка»", "https://wesetup.ru", 1L));
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).setup().get();
        assertEquals(View.GONE, activity.findViewById(R.id.main_update).getVisibility());
    }
}
