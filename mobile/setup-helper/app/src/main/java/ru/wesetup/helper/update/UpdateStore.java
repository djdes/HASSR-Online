package ru.wesetup.helper.update;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Состояние автообновления на телефоне: когда спрашивали сайт, что там
 * лежит, скачано ли и проверено ли обновление, сколько было неудач.
 *
 * <p>Переживает выход из аккаунта: обновляется приложение, а не вход.
 */
public final class UpdateStore {

    /** Установка ждёт: человека («Установить»), разрешения или того, что приложение свернут. */
    public static final String INSTALL_IDLE = "idle";
    public static final String INSTALL_RUNNING = "running";
    public static final String INSTALL_NEEDS_CONFIRMATION = "needs_confirmation";

    private final SharedPreferences prefs;

    public UpdateStore(Context context) {
        this(context, "updates");
    }

    /** Отдельный файл настроек — для тестов, чтобы не делить состояние с приложением. */
    UpdateStore(Context context, String name) {
        prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE);
    }

    public synchronized long lastCheckAt() {
        return prefs.getLong("lastCheckAt", 0L);
    }

    public synchronized long retryAfter() {
        return prefs.getLong("retryAfter", 0L);
    }

    public synchronized int failures() {
        return prefs.getInt("failures", 0);
    }

    public synchronized String lastError() {
        return prefs.getString("lastError", null);
    }

    /** Что лежит на сайте (новее установленного), или null. */
    public synchronized UpdateInfo available() {
        String json = prefs.getString("available", null);
        if (json == null) return null;
        try {
            return UpdateInfo.parse(json);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** Номер сборки скачанного и проверенного APK (0 — ничего не готово). */
    public synchronized int readyCode() {
        return prefs.getInt("readyCode", 0);
    }

    public synchronized String readyPath() {
        return prefs.getString("readyPath", null);
    }

    public synchronized String installState() {
        return prefs.getString("installState", INSTALL_IDLE);
    }

    /** Сборка, которую Android отказался ставить (другая подпись, битый файл), — её не качаем снова. */
    public synchronized int rejectedCode() {
        return prefs.getInt("rejectedCode", 0);
    }

    /** Какая сборка запускалась прошлый раз — чтобы один раз сказать «обновлено до…». */
    public synchronized int lastRunCode() {
        return prefs.getInt("lastRunCode", 0);
    }

    public synchronized void setLastRunCode(int code) {
        prefs.edit().putInt("lastRunCode", code).apply();
    }

    synchronized void checked(long now, UpdateInfo newer) {
        SharedPreferences.Editor editor = prefs.edit().putLong("lastCheckAt", now);
        if (newer == null) {
            editor.remove("available").remove("readyCode").remove("readyPath")
                    .putString("installState", INSTALL_IDLE).remove("lastError")
                    .putInt("failures", 0).putLong("retryAfter", 0L);
        } else {
            editor.putString("available", newer.toJson());
        }
        editor.apply();
    }

    synchronized void ready(int versionCode, String path) {
        prefs.edit()
                .putInt("readyCode", versionCode)
                .putString("readyPath", path)
                .putInt("failures", 0)
                .putLong("retryAfter", 0L)
                .remove("lastError")
                .apply();
    }

    synchronized void setInstallState(String state) {
        prefs.edit().putString("installState", state).apply();
    }

    public synchronized long installStartedAt() {
        return prefs.getLong("installStartedAt", 0L);
    }

    synchronized void installStarted(long now) {
        prefs.edit().putString("installState", INSTALL_RUNNING).putLong("installStartedAt", now).apply();
    }

    /** Неудача: текст для плашки и пауза перед следующей попыткой. */
    synchronized void failed(long now, String message) {
        int failures = prefs.getInt("failures", 0) + 1;
        prefs.edit()
                .putInt("failures", failures)
                .putLong("retryAfter", now + UpdatePolicy.backoffMs(failures))
                .putString("lastError", message)
                .putString("installState", INSTALL_IDLE)
                .apply();
    }

    /** Android эту сборку не поставит — забыть её, ждать следующую. */
    synchronized void rejected(int versionCode, long now, String message) {
        prefs.edit()
                .putInt("rejectedCode", versionCode)
                .remove("readyCode")
                .remove("readyPath")
                .putString("installState", INSTALL_IDLE)
                .putString("lastError", message)
                .putLong("retryAfter", now + UpdatePolicy.backoffMs(1))
                .apply();
    }

    /** Установленная версия догнала скачанную — очистить. */
    synchronized void clearReady() {
        prefs.edit()
                .remove("available")
                .remove("readyCode")
                .remove("readyPath")
                .remove("lastError")
                .putInt("failures", 0)
                .putLong("retryAfter", 0L)
                .putString("installState", INSTALL_IDLE)
                .apply();
    }
}
