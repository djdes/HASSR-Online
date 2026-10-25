package ru.wesetup.helper.update;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Правила автообновления — без Android, чтобы проверить их на JVM.
 *
 * <ul>
 *     <li>Сайт спрашиваем при открытии приложения не чаще раза в 30 минут
 *     (фоновое задание и так ходит раз в 6 часов), без сети — никогда.</li>
 *     <li>После неудачи (нет ответа, файл битый, установка не прошла) —
 *     пауза 1 ч, 4 ч, 12 ч, дальше раз в сутки: без бесконечного цикла
 *     загрузок по мобильному интернету.</li>
 *     <li>«Проверить обновления» в меню паузу не ждёт.</li>
 * </ul>
 */
public final class UpdatePolicy {

    public static final long CHECK_INTERVAL_MS = 30 * 60_000L;
    static final long[] BACKOFF_MS = {
            60 * 60_000L,
            4 * 60 * 60_000L,
            12 * 60 * 60_000L,
            24 * 60 * 60_000L,
    };

    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private UpdatePolicy() {
    }

    public static boolean isNewer(UpdateInfo info, int installedVersionCode) {
        return info != null && info.versionCode > installedVersionCode;
    }

    /** Пауза после {@code failures} неудач подряд. */
    public static long backoffMs(int failures) {
        if (failures <= 0) return 0;
        return BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1];
    }

    /** Пора ли спрашивать сайт. Часы на телефоне перевели назад — проверяем. */
    public static boolean shouldCheck(long now, long lastCheckAt, long retryAfter, boolean force) {
        if (force) return true;
        if (now < retryAfter) return false;
        return lastCheckAt <= 0 || now < lastCheckAt || now - lastCheckAt >= CHECK_INTERVAL_MS;
    }

    /** SHA-256 файла в нижнем регистре — как в {@code version.json}. */
    public static String sha256(File file) throws IOException {
        try (InputStream in = new FileInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) digest.update(buffer, 0, read);
            StringBuilder hex = new StringBuilder(64);
            for (byte b : digest.digest()) hex.append(HEX[(b >> 4) & 0xF]).append(HEX[b & 0xF]);
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
    }

    /** Файл — ровно тот, что описан в манифесте. */
    public static boolean matches(File file, UpdateInfo info) throws IOException {
        return file.isFile() && file.length() == info.size && info.sha256.equals(sha256(file));
    }
}
