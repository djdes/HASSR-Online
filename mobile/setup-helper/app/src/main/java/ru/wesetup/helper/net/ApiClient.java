package ru.wesetup.helper.net;

import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
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
import ru.wesetup.helper.update.UpdateInfo;
import ru.wesetup.helper.update.UpdateSource;

/**
 * Запросы к сайту: вход, отправка событий, выход, обновления
 * ({@code /api/setup-helper/*}).
 *
 * <p>Без сторонних библиотек: {@code HttpURLConnection} и {@code org.json}
 * есть в самом Android. Вызывать только не из главного потока.
 */
public final class ApiClient implements UpdateSource {

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
            super(cause instanceof SSLException
                    // Сеть есть, но защищённое соединение не сложилось: чаще всего
                    // неверные дата и время на телефоне или сеть подменяет сертификат.
                    ? "Не удалось установить защищённое соединение с сервером. Проверьте дату и время на телефоне и попробуйте ещё раз."
                    : "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.", cause);
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

    /** Фирменная шапка этикеток: название, сайт и готовый к печати логотип (1 бит). */
    public static final class BrandingResult {
        public final String version;
        public final String orgName;
        public final String site;
        public final int logoWidth;
        public final int logoHeight;
        /** PNG логотипа или null, если у организации его нет. */
        public final byte[] logoPng;

        public BrandingResult(String version, String orgName, String site, int logoWidth, int logoHeight,
                              byte[] logoPng) {
            this.version = version;
            this.orgName = orgName;
            this.site = site;
            this.logoWidth = logoWidth;
            this.logoHeight = logoHeight;
            this.logoPng = logoPng;
        }

        static BrandingResult fromJson(JSONObject json) throws IOException {
            String version = json.optString("version", "");
            if (version.isEmpty()) throw new IOException("Сервер не прислал версию оформления");
            JSONObject logo = json.optJSONObject("logo");
            byte[] png = null;
            int width = 0;
            int height = 0;
            if (logo != null) {
                try {
                    png = android.util.Base64.decode(logo.optString("png", ""), android.util.Base64.DEFAULT);
                } catch (IllegalArgumentException e) {
                    png = null;
                }
                width = logo.optInt("widthDots", 0);
                height = logo.optInt("heightDots", 0);
                if (png == null || png.length == 0 || width <= 0 || height <= 0) png = null;
            }
            return new BrandingResult(version, json.optString("orgName", ""), json.optString("site", ""),
                    png == null ? 0 : width, png == null ? 0 : height, png);
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
    /** APK качается дольше JSON: медленный мобильный интернет на кухне. */
    private static final int DOWNLOAD_READ_TIMEOUT_MS = 60_000;

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

    /** Фирменная шапка организации (название, сайт, логотип) — {@code GET /api/setup-helper/branding}. */
    public BrandingResult fetchBranding(String server, String token) throws IOException {
        HttpURLConnection connection = null;
        try {
            connection = open(server + "/api/setup-helper/branding", "GET", token);
            return BrandingResult.fromJson(readJson(connection));
        } catch (UnknownHostException | ConnectException | NoRouteToHostException | SocketTimeoutException
                 | SSLException e) {
            throw new OfflineException(e);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /**
     * Справочники для полей этикеток — {@code GET /api/setup-helper/catalog}:
     * JSON целиком или null, если у телефона та же версия ({@code knownVersion}).
     */
    public String fetchCatalog(String server, String token, String knownVersion) throws IOException {
        HttpURLConnection connection = null;
        try {
            String query = knownVersion == null || knownVersion.isEmpty() ? ""
                    : "?version=" + java.net.URLEncoder.encode(knownVersion, "UTF-8");
            connection = open(server + "/api/setup-helper/catalog" + query, "GET", token);
            JSONObject json = readJson(connection);
            if (json.optBoolean("unchanged", false)) return null;
            if (json.optString("version", "").isEmpty()) throw new IOException("Сервер не прислал версию справочника");
            return json.toString();
        } catch (UnknownHostException | ConnectException | NoRouteToHostException | SocketTimeoutException
                 | SSLException e) {
            throw new OfflineException(e);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    public void logout(String server, String token) throws IOException {
        post(server + "/api/setup-helper/logout", new JSONObject(), token);
    }

    @Override
    public UpdateInfo fetchUpdate(String server) throws IOException {
        HttpURLConnection connection = null;
        try {
            connection = open(server + "/api/setup-helper/version", "GET", null);
            JSONObject json = readJson(connection);
            try {
                return UpdateInfo.parse(json.toString());
            } catch (IllegalArgumentException e) {
                throw new IOException(e.getMessage(), e);
            }
        } catch (UnknownHostException | ConnectException | NoRouteToHostException | SocketTimeoutException
                 | SSLException e) {
            throw new OfflineException(e);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    @Override
    public void downloadUpdate(String server, UpdateInfo info, File target) throws IOException {
        HttpURLConnection connection = null;
        try {
            // ?v= — только от кешей по пути: файл всё равно сверяется по SHA-256.
            connection = open(server + "/api/setup-helper/download?v=" + info.versionCode, "GET", null);
            connection.setReadTimeout(DOWNLOAD_READ_TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                throw new ApiException(status, "сайт не отдал файл (" + status + ")", null);
            }
            long written = 0;
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(target)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    written += read;
                    if (written > info.size) throw new IOException("файл больше заявленного");
                    out.write(buffer, 0, read);
                }
            }
            if (written != info.size) throw new IOException("файл скачался не полностью");
        } catch (UnknownHostException | ConnectException | NoRouteToHostException | SocketTimeoutException
                 | SSLException e) {
            throw new OfflineException(e);
        } finally {
            if (connection != null) connection.disconnect();
        }
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
            connection = open(url, "POST", bearer);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(payload.length);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(payload);
            }
            return readJson(connection);
        } catch (UnknownHostException | ConnectException | NoRouteToHostException | SocketTimeoutException
                 | SSLException e) {
            throw new OfflineException(e);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static HttpURLConnection open(String url, String method, String bearer) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestMethod(method);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", userAgent());
        if (bearer != null) connection.setRequestProperty("Authorization", "Bearer " + bearer);
        return connection;
    }

    private static JSONObject readJson(HttpURLConnection connection) throws IOException {
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
