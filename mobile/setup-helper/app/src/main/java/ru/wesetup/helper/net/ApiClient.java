package ru.wesetup.helper.net;

import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import javax.net.ssl.SSLException;

import ru.wesetup.helper.BuildConfig;

/**
 * Запросы к сайту: вход, отправка событий, выход ({@code /api/setup-helper/*}).
 *
 * <p>Без сторонних библиотек: {@code HttpURLConnection} и {@code org.json}
 * есть в самом Android. Вызывать только не из главного потока.
 */
public final class ApiClient {

    /** Ответ сервера с ошибкой: статус и текст для человека. */
    public static final class ApiException extends IOException {
        public final int status;
        public final String code;

        public ApiException(int status, String message, String code) {
            super(message);
            this.status = status;
            this.code = code;
        }
    }

    /** До сервера не достучались: нет сети, не тот адрес, перехват Wi-Fi. */
    public static final class OfflineException extends IOException {
        public OfflineException(Throwable cause) {
            super("Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.", cause);
        }
    }

    public static final class LoginResult {
        public final boolean requiresCode;
        public final String challengeId;
        public final String token;
        public final String deviceId;
        public final String userName;
        public final String email;
        public final String orgName;

        private LoginResult(boolean requiresCode, String challengeId, String token, String deviceId,
                            String userName, String email, String orgName) {
            this.requiresCode = requiresCode;
            this.challengeId = challengeId;
            this.token = token;
            this.deviceId = deviceId;
            this.userName = userName;
            this.email = email;
            this.orgName = orgName;
        }

        static LoginResult fromJson(JSONObject json) throws IOException {
            if (json.optBoolean("requiresCode", false)) {
                String challengeId = json.optString("challengeId", "");
                if (challengeId.isEmpty()) throw new IOException("Сервер не прислал код подтверждения");
                return new LoginResult(true, challengeId, null, null, null, null, null);
            }
            String token = json.optString("token", "");
            if (token.isEmpty()) throw new IOException("Сервер не выдал ключ входа");
            JSONObject user = json.optJSONObject("user");
            JSONObject org = json.optJSONObject("organization");
            return new LoginResult(false, null, token, json.optString("deviceId", ""),
                    user == null ? "" : user.optString("name", ""),
                    user == null ? "" : user.optString("email", ""),
                    org == null ? "" : org.optString("name", ""));
        }
    }

    public static final class SyncResult {
        public final List<String> accepted;
        public final List<String> rejected;

        private SyncResult(List<String> accepted, List<String> rejected) {
            this.accepted = accepted;
            this.rejected = rejected;
        }

        static SyncResult fromJson(JSONObject json) {
            return new SyncResult(strings(json.optJSONArray("accepted")), strings(json.optJSONArray("rejected")));
        }
    }

    /** Что приложение сообщает о себе при входе. */
    public static final class ClientInfo {
        public final String deviceName;
        public final String installationId;

        public ClientInfo(String deviceName, String installationId) {
            this.deviceName = deviceName;
            this.installationId = installationId;
        }
    }

    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 20_000;

    public LoginResult login(String server, String email, String password, ClientInfo client) throws IOException {
        JSONObject body = clientJson(client);
        put(body, "email", email);
        put(body, "password", password);
        return LoginResult.fromJson(post(server + "/api/setup-helper/auth", body, null));
    }

    public LoginResult confirmCode(String server, String challengeId, String code, ClientInfo client) throws IOException {
        JSONObject body = clientJson(client);
        put(body, "challengeId", challengeId);
        put(body, "code", code);
        return LoginResult.fromJson(post(server + "/api/setup-helper/auth/code", body, null));
    }

    public SyncResult sync(String server, String token, List<JSONObject> events) throws IOException {
        JSONArray array = new JSONArray();
        for (JSONObject event : events) array.put(event);
        JSONObject body = new JSONObject();
        put(body, "appVersion", BuildConfig.VERSION_NAME);
        put(body, "events", array);
        return SyncResult.fromJson(post(server + "/api/setup-helper/sync", body, token));
    }

    public void logout(String server, String token) throws IOException {
        post(server + "/api/setup-helper/logout", new JSONObject(), token);
    }

    /** «WeSetupHelper/1.0.0 (Android 14; samsung SM-A515F)» — сайт видит это в журнале входов. */
    public static String userAgent() {
        return "WeSetupHelper/" + BuildConfig.VERSION_NAME + " (Android " + Build.VERSION.RELEASE + "; "
                + Build.MANUFACTURER + " " + Build.MODEL + ")";
    }

    /** «Samsung SM-A515F» — так телефон называется в списке на сайте. */
    public static String deviceName() {
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        String model = Build.MODEL == null ? "" : Build.MODEL.trim();
        String name = model.toLowerCase(Locale.ROOT).startsWith(manufacturer.toLowerCase(Locale.ROOT))
                ? model : manufacturer + " " + model;
        name = name.trim();
        if (name.isEmpty()) return "Android";
        return Character.toUpperCase(name.charAt(0)) + name.substring(1);
    }

    private JSONObject post(String url, JSONObject body, String bearer) throws IOException {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setUseCaches(false);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", userAgent());
            if (bearer != null) connection.setRequestProperty("Authorization", "Bearer " + bearer);
            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(payload.length);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(payload);
            }
            int status = connection.getResponseCode();
            String text = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
            JSONObject json;
            try {
                json = text.isEmpty() ? new JSONObject() : new JSONObject(text);
            } catch (JSONException e) {
                // Вместо JSON — страница nginx или Wi-Fi с авторизацией.
                if (status >= 400) throw new ApiException(status, "Сервер ответил ошибкой " + status, null);
                throw new OfflineException(e);
            }
            if (status >= 400) {
                throw new ApiException(status, json.optString("error", "Сервер ответил ошибкой " + status),
                        json.isNull("code") ? null : json.optString("code", null));
            }
            return json;
        } catch (UnknownHostException | ConnectException | NoRouteToHostException | SocketTimeoutException
                 | SSLException e) {
            throw new OfflineException(e);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static JSONObject clientJson(ClientInfo client) {
        JSONObject body = new JSONObject();
        put(body, "deviceName", client.deviceName);
        put(body, "installationId", client.installationId);
        put(body, "appVersion", BuildConfig.VERSION_NAME);
        return body;
    }

    private static void put(JSONObject json, String key, Object value) {
        try {
            json.put(key, value);
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String read(InputStream in) throws IOException {
        if (in == null) return "";
        try (InputStream stream = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while ((read = stream.read(buffer)) != -1) out.write(buffer, 0, read);
            return out.toString("UTF-8").trim();
        }
    }

    private static List<String> strings(JSONArray array) {
        List<String> values = new ArrayList<>();
        if (array == null) return values;
        for (int i = 0; i < array.length(); i++) {
            String value = array.optString(i, "");
            if (!value.isEmpty()) values.add(value);
        }
        return values;
    }
}
