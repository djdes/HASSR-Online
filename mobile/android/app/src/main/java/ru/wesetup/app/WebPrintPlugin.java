package ru.wesetup.app;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.Settings;
import android.webkit.WebView;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Печать страницы и переход в настройки приложения.
 *
 * Во встроенном браузере Android window.print() ничего не делает, поэтому сайт
 * в приложении зовёт WebPrint.print() — открывается системное окно печати
 * (принтер или «Сохранить как PDF») с текущей страницей и её стилями @media print.
 * WebPrint.printFile({ path, jobName }) — системное окно печати готового PDF
 * (бланк журнала с сервера): кнопка «Распечатать» раньше открывала в
 * приложении лист «Поделиться», где принтера нет.
 * WebPrint.openSettings() открывает экран приложения в настройках телефона —
 * туда ведём, если человек запретил камеру, микрофон или уведомления.
 */
@CapacitorPlugin(name = "WebPrint")
public class WebPrintPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        String jobName = call.getString("jobName", "WeSetup");
        getActivity().runOnUiThread(() -> {
            try {
                WebView webView = getBridge().getWebView();
                PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                if (webView == null || printManager == null) {
                    call.reject("Печать недоступна на этом телефоне");
                    return;
                }
                PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(jobName);
                PrintAttributes attributes = new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build();
                printManager.print(jobName, adapter, attributes);
                call.resolve();
            } catch (Exception ex) {
                call.reject("Не удалось открыть печать", ex);
            }
        });
    }

    @PluginMethod
    public void printFile(PluginCall call) {
        String path = call.getString("path");
        String jobName = call.getString("jobName", "WeSetup");
        if (path == null || path.isEmpty()) {
            call.reject("Нет файла для печати");
            return;
        }
        Uri uri = Uri.parse(path);
        File file = new File(uri.getScheme() == null ? path : uri.getPath());
        if (!file.isFile()) {
            call.reject("Нет файла для печати");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                if (printManager == null) {
                    call.reject("Печать недоступна на этом телефоне");
                    return;
                }
                PrintAttributes attributes = new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build();
                printManager.print(jobName, new PdfFileAdapter(file, jobName), attributes);
                call.resolve();
            } catch (Exception ex) {
                call.reject("Не удалось открыть печать", ex);
            }
        });
    }

    /** Отдаёт системе печати готовый PDF как есть. */
    private static final class PdfFileAdapter extends PrintDocumentAdapter {

        private final File file;
        private final String name;

        PdfFileAdapter(File file, String name) {
            this.file = file;
            this.name = name.endsWith(".pdf") ? name : name + ".pdf";
        }

        @Override
        public void onLayout(
            PrintAttributes oldAttributes,
            PrintAttributes newAttributes,
            CancellationSignal cancellationSignal,
            LayoutResultCallback callback,
            Bundle extras
        ) {
            if (cancellationSignal.isCanceled()) {
                callback.onLayoutCancelled();
                return;
            }
            PrintDocumentInfo info = new PrintDocumentInfo.Builder(name)
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                .build();
            callback.onLayoutFinished(info, true);
        }

        @Override
        public void onWrite(
            PageRange[] pages,
            ParcelFileDescriptor destination,
            CancellationSignal cancellationSignal,
            WriteResultCallback callback
        ) {
            try (InputStream in = new FileInputStream(file); OutputStream out = new FileOutputStream(destination.getFileDescriptor())) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = in.read(buffer)) > 0) {
                    if (cancellationSignal.isCanceled()) {
                        callback.onWriteCancelled();
                        return;
                    }
                    out.write(buffer, 0, read);
                }
                callback.onWriteFinished(new PageRange[] { PageRange.ALL_PAGES });
            } catch (IOException ex) {
                callback.onWriteFailed(ex.getMessage());
            }
        }
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", getContext().getPackageName(), null)
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException ex) {
            call.reject("Не удалось открыть настройки", ex);
        }
    }
}
