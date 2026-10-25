package ru.wesetup.helper.update;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Установка скачанного APK через {@link PackageInstaller} — системный
 * способ, без сторонних библиотек и без FileProvider.
 *
 * <p>С Android 12 приложение может обновить само себя без вопроса
 * человеку: сессия с {@code USER_ACTION_NOT_REQUIRED}, разрешение
 * {@code UPDATE_PACKAGES_WITHOUT_USER_ACTION} в манифесте и разрешённая
 * человеком «Установка неизвестных приложений». Иначе система покажет окно
 * подтверждения — его открывает {@link UpdateStatusReceiver}.
 */
public final class SessionInstaller implements Updater.Installer {

    static final String EXTRA_VERSION_CODE = "ru.wesetup.helper.update.VERSION_CODE";

    private final Context context;

    public SessionInstaller(Context context) {
        this.context = context.getApplicationContext();
    }

    @Override
    public void install(File apk, UpdateInfo info, boolean silent) throws IOException {
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        int sessionId = installer.createSession(params(context.getPackageName(), apk.length(), silent));
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            try (InputStream in = new FileInputStream(apk);
                 OutputStream out = session.openWrite("base.apk", 0, apk.length())) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                session.fsync(out);
            }
            Intent status = new Intent(context, UpdateStatusReceiver.class)
                    .putExtra(EXTRA_VERSION_CODE, info.versionCode);
            // Система дописывает в этот PendingIntent результат — он обязан быть изменяемым
            // (с targetSdk 35 неизменяемый commit() отвергает). Intent явный — только наш приёмник.
            int flags = PendingIntent.FLAG_UPDATE_CURRENT
                    | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pending = PendingIntent.getBroadcast(context, sessionId, status, flags);
            session.commit(pending.getIntentSender());
        } catch (IOException | RuntimeException e) {
            try {
                installer.abandonSession(sessionId);
            } catch (RuntimeException ignored) {
                // сессия уже закрыта
            }
            throw e instanceof IOException ? (IOException) e : new IOException(e.getMessage(), e);
        }
    }

    /** Параметры сессии: обновление этого же приложения, без вопроса — где Android это позволяет. */
    static PackageInstaller.SessionParams params(String packageName, long size, boolean silent) {
        PackageInstaller.SessionParams params =
                new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(packageName);
        params.setSize(size);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) params.setInstallReason(PackageManager.INSTALL_REASON_USER);
        if (silent && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        }
        return params;
    }
}
