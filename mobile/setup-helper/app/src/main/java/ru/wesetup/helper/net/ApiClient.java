package ru.wesetup.helper.net;

import android.os.Build;

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

import javax.net.ssl.SSLException;

import ru.wesetup.helper.BuildConfig;
import ru.wesetup.helper.update.UpdateInfo;
import ru.wesetup.helper.update.UpdateSource;

/**
 * Неавторизованная проверка и загрузка обновлений для варианта {@code site}
 * ({@code /api/setup-helper/version} и {@code /api/setup-helper/download}).
 * В варианте {@code play} не вызывается: обновления доставляет Google Play.
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
                    ? "Не удалось установить защищённое соединение с сервером. Проверьте дату и время на телефоне и попробуйте ещё раз."
                    : "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.", cause);
        }
    }

    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 20_000;
    /** APK качается дольше JSON: медленный мобильный интернет на кухне. */
    private static final int DOWNLOAD_READ_TIMEOUT_MS = 60_000;

    @Override
    public UpdateInfo fetchUpdate(String server) throws IOException {
        HttpURLConnection connection = null;
        try {
            connection = open(server + "/api/setup-helper/version");
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
            connection = open(server + "/api/setup-helper/download?v=" + info.versionCode);
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

    public static String userAgent() {
        return "WeSetupHelper/" + BuildConfig.VERSION_NAME + " (Android " + Build.VERSION.RELEASE + ")";
    }

    private static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestMethod("GET");
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", userAgent());
        return connection;
    }

    private static JSONObject readJson(HttpURLConnection connection) throws IOException {
        int status = connection.getResponseCode();
        String text = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
        JSONObject json;
        try {
            json = text.isEmpty() ? new JSONObject() : new JSONObject(text);
        } catch (JSONException e) {
            if (status >= 400) throw new ApiException(status, "Сервер ответил ошибкой " + status, null);
            throw new OfflineException(e);
        }
        if (status >= 400) {
            throw new ApiException(status, json.optString("error", "Сервер ответил ошибкой " + status),
                    json.isNull("code") ? null : json.optString("code", null));
        }
        return json;
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
}
