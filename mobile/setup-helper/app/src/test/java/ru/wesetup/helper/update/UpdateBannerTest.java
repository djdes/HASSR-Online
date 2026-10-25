package ru.wesetup.helper.update;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.content.Intent;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.widget.TextView;

import com.google.android.material.button.MaterialButton;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import ru.wesetup.helper.BuildConfig;
import ru.wesetup.helper.HelperApp;
import ru.wesetup.helper.MainActivity;
import ru.wesetup.helper.R;
import ru.wesetup.helper.TestHelperApp;
import ru.wesetup.helper.auth.SessionStore;

/** Плашка обновления на главном экране: что написано и куда ведёт кнопка. */
@RunWith(RobolectricTestRunner.class)
@Config(application = TestHelperApp.class, sdk = 36)
public class UpdateBannerTest {

    private HelperApp app;

    @Before
    public void setUp() throws Exception {
        app = (HelperApp) RuntimeEnvironment.getApplication();
        app.sessions().save(new SessionStore.Session("token-123", "device-1", "Иван Петров", "chef@example.com",
                "Кафе «Ромашка»", "https://wesetup.ru", 1L));
    }

    /** На сайте — сборка новее установленной, уже скачанная и проверенная. */
    private UpdateInfo downloadedUpdate() throws Exception {
        byte[] apk = "PK\u0003\u0004 banner".getBytes(StandardCharsets.ISO_8859_1);
        StringBuilder hex = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(apk)) hex.append(String.format("%02x", b & 0xFF));
        UpdateInfo info = new UpdateInfo(BuildConfig.VERSION_CODE + 1, "9.9.9", hex.toString(), apk.length,
                "Шаблоны для пищевого производства");
        File dir = new File(app.getFilesDir(), "updates");
        assertTrue(dir.isDirectory() || dir.mkdirs());
        File file = new File(dir, "setup-helper-" + info.versionCode + ".apk");
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(apk);
        }
        UpdateStore store = app.updater().store();
        store.checked(System.currentTimeMillis(), info);
        store.ready(info.versionCode, file.getPath());
        return info;
    }

    @Test
    public void testNoBannerWithoutUpdate() {
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).setup().get();
        assertEquals(View.GONE, activity.findViewById(R.id.main_update).getVisibility());
    }

    @Test
    public void testBannerAsksForInstallPermissionOnceThenUpdatesItself() throws Exception {
        downloadedUpdate();
        shadowOf(app.getPackageManager()).setCanRequestPackageInstalls(false);
        ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup();
        MainActivity activity = controller.get();
        shadowOf(Looper.getMainLooper()).idle();

        assertEquals(View.VISIBLE, activity.findViewById(R.id.main_update).getVisibility());
        String text = ((TextView) activity.findViewById(R.id.main_update_text)).getText().toString();
        assertTrue(text, text.contains("9.9.9") && text.contains("Разрешите"));
        assertEquals("Что нового: Шаблоны для пищевого производства",
                ((TextView) activity.findViewById(R.id.main_update_notes)).getText().toString());
        MaterialButton action = activity.findViewById(R.id.main_update_action);
        assertEquals("Разрешить", action.getText().toString());
        action.performClick();
        Intent next = shadowOf(activity).getNextStartedActivity();
        assertNotNull(next);
        assertEquals(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, next.getAction());
        assertEquals("package:" + app.getPackageName(), String.valueOf(next.getData()));

        // Разрешили и вернулись: дальше обновление ставится само, кнопка — по желанию.
        shadowOf(app.getPackageManager()).setCanRequestPackageInstalls(true);
        controller.pause().resume();
        text = ((TextView) activity.findViewById(R.id.main_update_text)).getText().toString();
        assertTrue(text, text.contains("Установится сама"));
        assertEquals("Установить сейчас", action.getText().toString());
    }
}
