package ru.wesetup.helper.update;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;

/**
 * Выпуск приложения на сайте — ответ {@code GET /api/setup-helper/version}
 * (файл {@code resources/setup-helper/version.json} на сервере).
 *
 * <p>Ставим обновление, только если {@link #versionCode} больше своего, а
 * SHA-256 скачанного файла совпал с {@link #sha256}. Остальное Android
 * проверит сам: APK, подписанный другим ключом, поверх не встанет.
 */
public final class UpdateInfo {

    /** Больше APK приложения не бывает — защита от бесконечной загрузки. */
    public static final long MAX_SIZE = 200L * 1024 * 1024;

    public final int versionCode;
    public final String versionName;
    public final String sha256;
    public final long size;
    /** «Что нового» — коротко, для плашки на главном экране; может быть пустым. */
    public final String notes;

    public UpdateInfo(int versionCode, String versionName, String sha256, long size, String notes) {
        this.versionCode = versionCode;
        this.versionName = versionName;
        this.sha256 = sha256;
        this.size = size;
        this.notes = notes == null ? "" : notes;
    }

    /** Разбор ответа сайта; непонятный ответ — {@link IllegalArgumentException} с причиной. */
    public static UpdateInfo parse(String json) {
        try {
            JSONObject root = new JSONObject(json);
            int versionCode = root.getInt("versionCode");
            if (versionCode < 1) throw new IllegalArgumentException("Номер сборки должен быть больше нуля");
            String versionName = root.getString("versionName").trim();
            if (versionName.isEmpty() || versionName.length() > 40 || !versionName.matches("[0-9A-Za-z.+-]+")) {
                throw new IllegalArgumentException("Непонятное имя версии: " + versionName);
            }
            String sha256 = root.getString("sha256").trim().toLowerCase(Locale.ROOT);
            if (!sha256.matches("[0-9a-f]{64}")) throw new IllegalArgumentException("Непонятная контрольная сумма");
            long size = root.getLong("size");
            if (size < 1 || size > MAX_SIZE) throw new IllegalArgumentException("Непонятный размер файла: " + size);
            String notes = root.optString("notes", "").trim();
            if (notes.length() > 2000) notes = notes.substring(0, 2000);
            return new UpdateInfo(versionCode, versionName, sha256, size, notes);
        } catch (JSONException e) {
            throw new IllegalArgumentException("Ответ о версии не разобран: " + e.getMessage(), e);
        }
    }

    /** Для хранения на телефоне — тот же формат, что у сайта. */
    public String toJson() {
        try {
            return new JSONObject()
                    .put("versionCode", versionCode)
                    .put("versionName", versionName)
                    .put("sha256", sha256)
                    .put("size", size)
                    .put("notes", notes)
                    .toString();
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }
}
