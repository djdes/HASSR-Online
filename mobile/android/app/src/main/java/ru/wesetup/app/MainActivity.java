package ru.wesetup.app;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Logger;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Локальные плагины регистрируются до super.onCreate: там создаётся мост.
        registerPlugin(WebPrintPlugin.class);
        super.onCreate(savedInstanceState);
        if (bridge == null) {
            return;
        }
        WebView webView = bridge.getWebView();
        // «Камера или галерея» для полей с фото (см. WeSetupWebChromeClient).
        webView.setWebChromeClient(new WeSetupWebChromeClient(bridge));
        // Запасной путь для файлов: обычно сайт в приложении сам открывает отчёты
        // через «Поделиться»; если же WebView всё-таки получил файл (ссылка с
        // Content-Disposition: attachment), без этого слушателя нажатие молча
        // ничего не делает. Скачиваем системным загрузчиком с куками сессии.
        webView.setDownloadListener(this::downloadFile);
    }

    private void downloadFile(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            // blob: и data: системный загрузчик не умеет — их обрабатывает сайт.
            Logger.warn("WeSetupDownload", "Пропущена загрузка не по http(s): " + url);
            return;
        }
        try {
            String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) {
                request.addRequestHeader("Cookie", cookies);
            }
            request.addRequestHeader("User-Agent", userAgent);
            request.setTitle(fileName);
            request.setMimeType(mimeType);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            } else {
                // До Android 10 общая папка «Загрузки» требует разрешения на память.
                request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, fileName);
            }
            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            manager.enqueue(request);
            Toast.makeText(this, "Скачиваем файл: " + fileName, Toast.LENGTH_SHORT).show();
        } catch (Exception ex) {
            Logger.error("WeSetupDownload", "Не удалось скачать файл", ex);
            Toast.makeText(this, "Не удалось скачать файл", Toast.LENGTH_LONG).show();
        }
    }
}
