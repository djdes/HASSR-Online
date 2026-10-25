package ru.wesetup.helper.update;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Автообновление через сайт.
 *
 * <ol>
 *     <li>Есть сеть — спросить сайт ({@code /api/setup-helper/version}); нет
 *     сети — ничего не делать: проверка повторится, когда сеть появится
 *     (сетевой колбэк приложения и задание JobScheduler с условием сети).</li>
 *     <li>На сайте сборка новее — скачать APK в память приложения и сверить
 *     размер и SHA-256 с манифестом.</li>
 *     <li>Поставить: на Android 12+ — само, когда приложение не на экране и
 *     не печатает; иначе — плашка «Установить» на главном экране.</li>
 * </ol>
 *
 * <p>Неудачи — с паузой ({@link UpdatePolicy#backoffMs}); сборку, которую
 * Android отказался ставить, второй раз не качаем.
 */
public final class Updater {

    private static final String TAG = "SetupHelper";
    /** «Устанавливается» дольше — значит, система промолчала: показать «Установить» снова. */
    static final long INSTALL_STALE_MS = 10 * 60_000L;
    /** Свернули приложение — подождать, вдруг вернутся через секунду. */
    static final long BACKGROUND_DELAY_MS = 3_000L;

    public enum State {
        /** Обновлений нет. */
        NONE,
        /** На сайте есть новее — скачаем, когда будет сеть (или после паузы). */
        PENDING,
        DOWNLOADING,
        /** Скачано; поставится само, как только приложение свернут. */
        READY_AUTO,
        /** Скачано; нужно нажать «Установить» (Android до 12 или человек отказался). */
        NEEDS_CONFIRMATION,
        /** Скачано; нужно разрешить приложению «Установку неизвестных приложений». */
        NEEDS_PERMISSION,
        INSTALLING,
        /** Не скачалось или не поставилось — текст в {@link UpdateStore#lastError()}. */
        FAILED,
    }

    public enum CheckResult { OFFLINE, NOT_DUE, UP_TO_DATE, READY, FAILED }

    public interface Listener {
        void onUpdateStateChanged();
    }

    public interface Installer {
        void install(File apk, UpdateInfo info, boolean silent) throws IOException;
    }

    public interface ResultCallback {
        void onResult(CheckResult result);
    }

    /** Что Updater знает о телефоне и приложении — в тестах подменяется. */
    public interface Env {
        boolean online();

        boolean appVisible();

        boolean printerBusy();

        String server();

        long now();

        int installedVersionCode();

        int sdk();

        /** Разрешена ли приложению «Установка неизвестных приложений» (до Android 8 — всегда). */
        boolean canInstallPackages();
    }

    private final Context context;
    private final UpdateStore store;
    private final UpdateSource source;
    private final Installer installer;
    private final Env env;
    private final File dir;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();
    private final Runnable backgroundInstall = () -> {
        if (!env().appVisible()) installAsync(false);
    };
    private volatile boolean downloading;
    private volatile String updatedTo;

    public Updater(Context context, UpdateStore store, UpdateSource source, Installer installer, Env env) {
        this(context, store, source, installer, env, new File(context.getApplicationContext().getFilesDir(), "updates"));
    }

    Updater(Context context, UpdateStore store, UpdateSource source, Installer installer, Env env, File dir) {
        this.context = context.getApplicationContext();
        this.store = store;
        this.source = source;
        this.installer = installer;
        this.env = env;
        this.dir = dir;
    }

    private Env env() {
        return env;
    }

    public UpdateStore store() {
        return store;
    }

    public void addListener(Listener listener) {
        listeners.addIfAbsent(listener);
    }

    public void removeListener(Listener listener) {
        listeners.remove(listener);
    }

    /** Состояние для плашки на главном экране. */
    public State state() {
        UpdateInfo available = store.available();
        if (available == null || !UpdatePolicy.isNewer(available, env.installedVersionCode())) return State.NONE;
        if (downloading) return State.DOWNLOADING;
        boolean ready = store.readyCode() == available.versionCode && readyFile() != null;
        if (ready) {
            String install = store.installState();
            if (UpdateStore.INSTALL_RUNNING.equals(install) && !installStale()) return State.INSTALLING;
            if (env.sdk() >= Build.VERSION_CODES.O && !env.canInstallPackages()) return State.NEEDS_PERMISSION;
            if (UpdateStore.INSTALL_NEEDS_CONFIRMATION.equals(install) || env.sdk() < Build.VERSION_CODES.S) {
                return State.NEEDS_CONFIRMATION;
            }
            // Скачано, но установка не прошла: показать причину и «Повторить».
            if (store.failures() > 0 && store.lastError() != null) return State.FAILED;
            return State.READY_AUTO;
        }
        return store.lastError() != null ? State.FAILED : State.PENDING;
    }

    /** Новая версия уже скачана и проверена — осталось поставить. */
    public boolean isDownloaded() {
        UpdateInfo available = store.available();
        return available != null && UpdatePolicy.isNewer(available, env.installedVersionCode())
                && store.readyCode() == available.versionCode && readyFile() != null;
    }

    /** Приложение запустилось: если только что обновилось — запомнить, чтобы сказать один раз. */
    public void onAppStarted() {
        int installed = env.installedVersionCode();
        int previous = store.lastRunCode();
        if (store.readyCode() != 0 && store.readyCode() <= installed) {
            store.clearReady();
            deleteFilesExcept(0);
        }
        if (previous > 0 && previous < installed) updatedTo = String.valueOf(installed);
        store.setLastRunCode(installed);
    }

    /** true — приложение обновилось с прошлого запуска (показать один раз). */
    public boolean takeJustUpdated() {
        boolean value = updatedTo != null;
        updatedTo = null;
        return value;
    }

    public void onAppBackgrounded() {
        main.removeCallbacks(backgroundInstall);
        main.postDelayed(backgroundInstall, BACKGROUND_DELAY_MS);
    }

    public void onAppForegrounded() {
        main.removeCallbacks(backgroundInstall);
    }

    public void checkAsync(boolean force, ResultCallback callback) {
        executor.execute(() -> {
            CheckResult result = check(force);
            if (result == CheckResult.READY && !env.appVisible()) install(false);
            if (callback != null) main.post(() -> callback.onResult(result));
        });
    }

    public void installAsync(boolean userAction) {
        executor.execute(() -> install(userAction));
    }

    /** Фоновое задание: проверить и, если можно, поставить. {@code done} — в любом случае. */
    public void runJob(Runnable done) {
        executor.execute(() -> {
            try {
                if (check(false) == CheckResult.READY || store.readyCode() > env.installedVersionCode()) install(false);
            } finally {
                done.run();
            }
        });
    }

    /** Спросить сайт и скачать, если есть новее. Только не из главного потока. */
    public CheckResult check(boolean force) {
        if (!env.online()) return CheckResult.OFFLINE;
        long now = env.now();
        if (!UpdatePolicy.shouldCheck(now, store.lastCheckAt(), store.retryAfter(), force)) return CheckResult.NOT_DUE;
        String server = env.server();
        UpdateInfo info;
        try {
            info = source.fetchUpdate(server);
        } catch (IOException e) {
            store.failed(now, "Не удалось проверить обновление: " + reason(e));
            notifyChanged();
            return CheckResult.FAILED;
        }
        boolean newer = UpdatePolicy.isNewer(info, env.installedVersionCode()) && info.versionCode != store.rejectedCode();
        store.checked(now, newer ? info : null);
        if (!newer) {
            deleteFilesExcept(0);
            notifyChanged();
            return CheckResult.UP_TO_DATE;
        }
        File apk = apkFile(info.versionCode);
        try {
            if (store.readyCode() == info.versionCode && UpdatePolicy.matches(apk, info)) {
                notifyChanged();
                return CheckResult.READY;
            }
            downloading = true;
            notifyChanged();
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Нет места для обновления");
            File part = new File(dir, apk.getName() + ".part");
            source.downloadUpdate(server, info, part);
            if (!UpdatePolicy.matches(part, info)) {
                delete(part);
                throw new IOException("файл повреждён — не совпала контрольная сумма");
            }
            delete(apk);
            if (!part.renameTo(apk)) throw new IOException("не удалось сохранить файл");
            deleteFilesExcept(info.versionCode);
            store.ready(info.versionCode, apk.getPath());
            return CheckResult.READY;
        } catch (IOException e) {
            store.failed(now, "Не удалось скачать обновление " + info.versionName + ": " + reason(e));
            return CheckResult.FAILED;
        } finally {
            downloading = false;
            notifyChanged();
        }
    }

    /**
     * Поставить скачанное. Само ({@code userAction == false}) — только когда
     * приложение не на экране и не печатает, чтобы не закрыть его посреди
     * работы. Только не из главного потока.
     */
    public boolean install(boolean userAction) {
        UpdateInfo info = store.available();
        if (info == null || !UpdatePolicy.isNewer(info, env.installedVersionCode())) return false;
        File apk = readyFile();
        if (store.readyCode() != info.versionCode || apk == null) return false;
        if (UpdateStore.INSTALL_RUNNING.equals(store.installState()) && !installStale()) return false;
        if (!userAction && (env.appVisible() || env.printerBusy())) return false;
        // Не прошла — повторяем сами только после паузы; по кнопке — сразу.
        if (!userAction && env.now() < store.retryAfter()) return false;
        if (env.sdk() >= Build.VERSION_CODES.O && !env.canInstallPackages()) {
            notifyChanged();
            return false;
        }
        boolean silent = env.sdk() >= Build.VERSION_CODES.S;
        if (!silent && !userAction) {
            store.setInstallState(UpdateStore.INSTALL_NEEDS_CONFIRMATION);
            notifyChanged();
            return false;
        }
        long now = env.now();
        try {
            if (!UpdatePolicy.matches(apk, info)) {
                delete(apk);
                store.failed(now, "Файл обновления повреждён — скачаем заново");
                notifyChanged();
                return false;
            }
            store.installStarted(now);
            notifyChanged();
            installer.install(apk, info, silent);
            return true;
        } catch (IOException | RuntimeException e) {
            Log.w(TAG, "Обновление не установилось", e);
            store.failed(now, "Обновление не установилось: " + reason(e));
            notifyChanged();
            return false;
        }
    }

    /** Ответ системы на установку (см. {@link UpdateStatusReceiver}). */
    public void onInstallStatus(Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        int versionCode = intent.getIntExtra(SessionInstaller.EXTRA_VERSION_CODE, store.readyCode());
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        long now = env.now();
        switch (status) {
            case PackageInstaller.STATUS_PENDING_USER_ACTION: {
                Intent confirm = confirmIntent(intent);
                if (confirm != null && env.appVisible()) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    try {
                        context.startActivity(confirm);
                        break;
                    } catch (RuntimeException e) {
                        Log.w(TAG, "Окно установки не открылось", e);
                    }
                }
                store.setInstallState(UpdateStore.INSTALL_NEEDS_CONFIRMATION);
                break;
            }
            case PackageInstaller.STATUS_SUCCESS:
                store.clearReady();
                break;
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                // Человек нажал «Отмена» — не навязываемся: плашка «Установить» останется.
                store.setInstallState(UpdateStore.INSTALL_NEEDS_CONFIRMATION);
                break;
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
            case PackageInstaller.STATUS_FAILURE_INVALID:
                // Другая подпись, старая версия, битый файл — та же сборка не встанет никогда.
                store.rejected(versionCode, now, "Android не принял обновление" + (message == null ? "" : ": " + message));
                deleteFilesExcept(0);
                break;
            default:
                store.failed(now, "Обновление не установилось" + (message == null ? "" : ": " + message));
        }
        notifyChanged();
    }

    private boolean installStale() {
        return env.now() - store.installStartedAt() > INSTALL_STALE_MS;
    }

    private File readyFile() {
        String path = store.readyPath();
        if (path == null) return null;
        File file = new File(path);
        return file.isFile() ? file : null;
    }

    private File apkFile(int versionCode) {
        return new File(dir, "setup-helper-" + versionCode + ".apk");
    }

    private void deleteFilesExcept(int keepVersionCode) {
        File[] files = dir.listFiles();
        if (files == null) return;
        String keep = keepVersionCode > 0 ? apkFile(keepVersionCode).getName() : null;
        for (File file : files) {
            if (!file.getName().equals(keep)) delete(file);
        }
    }

    private static void delete(File file) {
        if (file.exists() && !file.delete()) Log.w(TAG, "Не удалён " + file);
    }

    @SuppressWarnings("deprecation")
    private static Intent confirmIntent(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
        }
        return intent.getParcelableExtra(Intent.EXTRA_INTENT);
    }

    private static String reason(Exception e) {
        String message = e.getMessage();
        return message == null || message.isEmpty() ? e.getClass().getSimpleName() : message;
    }

    private void notifyChanged() {
        main.post(() -> {
            for (Listener listener : listeners) listener.onUpdateStateChanged();
        });
    }
}
