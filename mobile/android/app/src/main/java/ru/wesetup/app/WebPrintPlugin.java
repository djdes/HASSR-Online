package ru.wesetup.app;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.Settings;
import android.webkit.WebView;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Печать страницы и переход в настройки приложения.
 *
 * Во встроенном браузере Android window.print() ничего не делает, поэтому сайт
 * в приложении зовёт WebPrint.print() — открывается системное окно печати
 * (принтер или «Сохранить как PDF») с текущей страницей и её стилями @media print.
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
