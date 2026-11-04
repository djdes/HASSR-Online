package ru.wesetup.helper.catalog;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Локальный справочник подсказок на телефоне (продукты, блюда, поставщики,
 * сотрудники) — подсказки в полях этикеток без подключения к интернету.
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

    /** Подставить справочник без сети — для тестов экранов. */
    public synchronized void replaceForTest(Catalog value) {
        catalog = value;
        loaded = true;
    }

    /** Сбросить сохранённую копию справочника. */
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
