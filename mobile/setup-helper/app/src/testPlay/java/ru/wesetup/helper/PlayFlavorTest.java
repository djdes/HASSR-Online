package ru.wesetup.helper;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

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

/**
 * Вариант для Google Play: ни самообновления, ни сетевых разрешений, ни экрана
 * входа — открывается сразу главный экран, все шаблоны доступны офлайн.
 */
@RunWith(RobolectricTestRunner.class)
@Config(application = TestHelperApp.class, sdk = 36)
public class PlayFlavorTest {

    @Test
    public void testNoSelfUpdateOrNetworkPermissionsOrJob() throws Exception {
        assertFalse(BuildConfig.SELF_UPDATE);
        HelperApp app = (HelperApp) RuntimeEnvironment.getApplication();
        PackageInfo info = app.getPackageManager().getPackageInfo(app.getPackageName(), PackageManager.GET_PERMISSIONS);
        List<String> permissions = info.requestedPermissions == null
                ? Collections.emptyList() : Arrays.asList(info.requestedPermissions);
        assertFalse(permissions.contains("android.permission.REQUEST_INSTALL_PACKAGES"));
        assertFalse(permissions.contains("android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION"));
        assertFalse(permissions.contains("android.permission.RECEIVE_BOOT_COMPLETED"));
        assertFalse(permissions.contains("android.permission.INTERNET"));
        assertFalse(permissions.contains("android.permission.ACCESS_NETWORK_STATE"));
        assertTrue(permissions.contains("android.permission.BLUETOOTH_CONNECT"));

        JobScheduler scheduler = app.getSystemService(JobScheduler.class);
        assertTrue(scheduler.getAllPendingJobs().isEmpty());
    }

    @Test
    public void testMainScreenOpensWithoutSessionAndHasNoUpdateCard() {
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).setup().get();
        assertFalse("главный экран не должен закрываться без сессии", activity.isFinishing());
        assertNull("редиректа на вход быть не должно", shadowOf(activity).getNextStartedActivity());
        assertEquals(View.GONE, activity.findViewById(R.id.main_update).getVisibility());
    }
}
