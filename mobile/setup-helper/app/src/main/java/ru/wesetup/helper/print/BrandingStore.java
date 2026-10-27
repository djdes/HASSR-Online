package ru.wesetup.helper.print;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

import ru.wesetup.helper.net.ApiClient;

/**
 * Фирменная шапка этикеток организации: сайт, название и логотип.
 *
 * <p>Логотип сервер уже перевёл в 1 бит (дизеринг), здесь он лежит файлом
 * PNG в хранилище приложения, рядом в настройках — версия, сайт и название.
 * Последняя удачная копия живёт и без сети; новая скачивается, когда
 * изменилась {@code version}. Без логотипа в шапке печатается название.
 */
public final class BrandingStore {

    private static final String TAG = "SetupHelper";
    /** Сайт в шапке, пока организация свой не указала или копии ещё нет. */
    public static final String DEFAULT_SITE = "wesetup.ru";

    private final SharedPreferences prefs;
    private final File logoFile;
    private Bitmap logo;
    private boolean logoLoaded;

    public BrandingStore(Context context) {
        prefs = context.getSharedPreferences("branding", Context.MODE_PRIVATE);
        File dir = new File(context.getFilesDir(), "branding");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        logoFile = new File(dir, "logo.png");
    }

    public synchronized String version() {
        return prefs.getString("version", "");
    }

    public synchronized String site() {
        String site = prefs.getString("site", "");
        return site.isEmpty() ? DEFAULT_SITE : site;
    }

    /** Логотип для печати или null. */
    public synchronized Bitmap logo() {
        if (!logoLoaded) {
            logoLoaded = true;
            if (logoFile.isFile()) {
                BitmapFactory.Options options = new BitmapFactory.Options();
                // Точка в точку: без подгонки под плотность экрана.
                options.inScaled = false;
                options.inPreferredConfig = Bitmap.Config.ARGB_8888;
                logo = BitmapFactory.decodeFile(logoFile.getPath(), options);
            }
        }
        return logo;
    }

    /** Скачать шапку, если на сайте она новее. Вызывать не из главного потока. */
    public synchronized boolean refresh(ApiClient api, String server, String token) throws IOException {
        ApiClient.BrandingResult result = api.fetchBranding(server, token);
        if (result.version.equals(prefs.getString("version", null))) return false;
        if (result.logoPng == null) {
            //noinspection ResultOfMethodCallIgnored
            logoFile.delete();
        } else {
            File temp = new File(logoFile.getParentFile(), "logo.png.tmp");
            try (FileOutputStream out = new FileOutputStream(temp)) {
                out.write(result.logoPng);
            }
            //noinspection ResultOfMethodCallIgnored
            logoFile.delete();
            if (!temp.renameTo(logoFile)) throw new IOException("Логотип не сохранён");
        }
        logo = null;
        logoLoaded = false;
        prefs.edit()
                .putString("version", result.version)
                .putString("site", result.site)
                .putString("orgName", result.orgName)
                .commit();
        Log.i(TAG, "Оформление этикеток обновлено: " + result.version);
        return true;
    }

    /** Выход из аккаунта: логотип и сайт организации на телефоне не остаются. */
    public synchronized void clear() {
        prefs.edit().clear().commit();
        //noinspection ResultOfMethodCallIgnored
        logoFile.delete();
        logo = null;
        logoLoaded = false;
    }
}
