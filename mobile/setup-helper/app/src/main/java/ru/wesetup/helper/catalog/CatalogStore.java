package ru.wesetup.helper.catalog;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

import ru.wesetup.helper.net.ApiClient;

/**
 * Копия справочников сайта на телефоне (продукты, блюда, поставщики,
 * сотрудники) — подсказки в полях этикеток.
 *
 * <p>Как и фирменная шапка: скачивается при входе, при открытии приложения и
 * когда появляется сеть, и только если на сайте новее; без сети подсказывает
 * последняя копия. Выход из аккаунта её стирает. Сеть — вне блокировки:
 * экран печати читает справочник, пока идёт загрузка.
 */
public final class CatalogStore {

    private static final String TAG = "SetupHelper";

    private final File file;
    private Catalog catalog = Catalog.EMPTY;
    private boolean loaded;

    public CatalogStore(Context context) {
        File dir = new File(context.getFilesDir(), "catalog");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        file = new File(dir, "catalog.json");
    }

    /** Справочник для подсказок; нет копии — пустой. */
    public synchronized Catalog catalog() {
        if (!loaded) {
            loaded = true;
            if (file.isFile()) {
                try (InputStream in = new FileInputStream(file)) {
                    catalog = Catalog.parse(readAll(in));
                } catch (IOException | IllegalArgumentException e) {
                    Log.w(TAG, "Справочник на телефоне не прочитан: " + e.getMessage());
                    catalog = Catalog.EMPTY;
                }
            }
        }
        return catalog;
    }

    /** Скачать, если на сайте новее. Вызывать не из главного потока. */
    public boolean refresh(ApiClient api, String server, String token) throws IOException {
        String json = api.fetchCatalog(server, token, catalog().version);
        if (json == null) return false;
        Catalog parsed;
        try {
            parsed = Catalog.parse(json);
        } catch (IllegalArgumentException e) {
            throw new IOException(e.getMessage(), e);
        }
        synchronized (this) {
            File temp = new File(file.getParentFile(), "catalog.json.tmp");
            try (OutputStream out = new FileOutputStream(temp)) {
                out.write(json.getBytes(StandardCharsets.UTF_8));
            }
            //noinspection ResultOfMethodCallIgnored
            file.delete();
            if (!temp.renameTo(file)) throw new IOException("Справочник не сохранён");
            catalog = parsed;
            loaded = true;
        }
        Log.i(TAG, "Справочник обновлён: " + parsed.version);
        return true;
    }

    /** Подставить справочник без сети — для тестов экранов. */
    public synchronized void replaceForTest(Catalog value) {
        catalog = value;
        loaded = true;
    }

    /** Выход из аккаунта: продукты и сотрудники заведения на телефоне не остаются. */
    public synchronized void clear() {
        //noinspection ResultOfMethodCallIgnored
        file.delete();
        catalog = Catalog.EMPTY;
        loaded = true;
    }

    private static String readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        int read;
        while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
        return out.toString("UTF-8");
    }
}
