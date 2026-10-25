package ru.wesetup.helper.auth;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import java.util.Locale;
import java.util.UUID;

import ru.wesetup.helper.BuildConfig;

/**
 * Сохранённый вход — то, что в браузере делает кука.
 *
 * <p>После входа сервер выдаёт приложению долгоживущий ключ (как программе
 * «Онлайн принтер»). Он лежит здесь зашифрованным ключом Android Keystore, а
 * рядом — имя, организация и адрес сервера. На запуске приложение читает
 * всё это с телефона и никуда не ходит: печать работает без интернета.
 * Ключ уходит на сервер только с событиями для сайта, когда есть сеть.
 */
@SuppressLint("ApplySharedPref") // вход пишем сразу на диск: процесс могут убить сразу после входа
public final class SessionStore {

    private static final String TAG = "SetupHelper";

    public static final class Session {
        public final String token;
        public final String deviceId;
        public final String userName;
        public final String email;
        public final String orgName;
        public final String server;
        public final long createdAt;

        public Session(String token, String deviceId, String userName, String email, String orgName,
                       String server, long createdAt) {
            this.token = token;
            this.deviceId = deviceId;
            this.userName = userName;
            this.email = email;
            this.orgName = orgName;
            this.server = server;
            this.createdAt = createdAt;
        }
    }

    private final SharedPreferences prefs;
    private final SharedPreferences install;
    private final TokenCipher cipher;
    private Session cached;
    private boolean loaded;

    public SessionStore(Context context) {
        this(context, new KeystoreCipher());
    }

    public SessionStore(Context context, TokenCipher cipher) {
        this.cipher = cipher;
        prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE);
        install = context.getSharedPreferences("install", Context.MODE_PRIVATE);
    }

    public synchronized Session load() {
        if (loaded) return cached;
        loaded = true;
        String encrypted = prefs.getString("token", null);
        if (encrypted == null) return null;
        try {
            cached = new Session(
                    cipher.decrypt(encrypted),
                    prefs.getString("deviceId", ""),
                    prefs.getString("userName", ""),
                    prefs.getString("email", ""),
                    prefs.getString("orgName", ""),
                    prefs.getString("server", BuildConfig.DEFAULT_SERVER),
                    prefs.getLong("createdAt", 0L));
        } catch (Exception e) {
            // Ключ Keystore пропал (сброс телефона, перенос данных) — вход заново.
            Log.w(TAG, "Сохранённый вход не расшифрован", e);
            prefs.edit().clear().commit();
            cached = null;
        }
        return cached;
    }

    public synchronized void save(Session session) throws java.security.GeneralSecurityException {
        prefs.edit()
                .putString("token", cipher.encrypt(session.token))
                .putString("deviceId", session.deviceId)
                .putString("userName", session.userName)
                .putString("email", session.email)
                .putString("orgName", session.orgName)
                .putString("server", session.server)
                .putLong("createdAt", session.createdAt)
                .commit();
        cached = session;
        loaded = true;
    }

    public synchronized void clear() {
        prefs.edit().clear().commit();
        cached = null;
        loaded = true;
    }

    /**
     * Случайный id установки. Переживает выход из аккаунта, чтобы повторный
     * вход отозвал прежний ключ на сервере, а не оставил «призрака».
     */
    public synchronized String installationId() {
        String id = install.getString("installationId", null);
        if (id == null) {
            id = UUID.randomUUID().toString();
            install.edit().putString("installationId", id).apply();
        }
        return id;
    }

    public String serverUrl() {
        return install.getString("server", BuildConfig.DEFAULT_SERVER);
    }

    public void setServerUrl(String url) {
        install.edit().putString("server", normalizeServer(url)).apply();
    }

    /** «wesetup.ru/» → «https://wesetup.ru»; не https (кроме локального) — null. */
    public static String normalizeServer(String raw) {
        if (raw == null) return null;
        String value = raw.trim();
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        if (value.isEmpty()) return null;
        if (!value.contains("://")) value = "https://" + value;
        String lower = value.toLowerCase(Locale.ROOT);
        boolean local = lower.startsWith("http://10.0.2.2") || lower.startsWith("http://localhost")
                || lower.startsWith("http://127.0.0.1");
        if (!lower.startsWith("https://") && !local) return null;
        return value;
    }
}
