package ru.wesetup.helper;

import android.graphics.Bitmap;

import java.util.HashMap;
import java.util.Map;
import java.util.TimeZone;

import ru.wesetup.helper.auth.SessionStore;
import ru.wesetup.helper.bt.PrinterConnector;
import ru.wesetup.helper.bt.PrinterInfo;
import ru.wesetup.helper.bt.PrinterManager;
import ru.wesetup.helper.net.HelperEvents;
import ru.wesetup.helper.print.LabelRenderer;
import ru.wesetup.helper.print.LabelSettings;
import ru.wesetup.helper.print.MonoBitmap;
import ru.wesetup.helper.print.Tspl;
import ru.wesetup.helper.template.LabelTemplate;
import ru.wesetup.helper.template.LayoutEngine;
import ru.wesetup.helper.template.TemplateValues;

/**
 * Печать по шаблону: значения → разметка → картинка → TSPL → принтер, и
 * отметка для сайта о печати. Сеть для печати не нужна.
 */
final class PrintJobs {

    /** Последние введённые тексты по шаблонам — чтобы не набирать заново. */
    static final String VALUES_PREFS = "template_values";

    private static final LabelRenderer.AndroidMeasurer MEASURER = new LabelRenderer.AndroidMeasurer();

    private PrintJobs() {
    }

    /** Общие значения шаблонов: кто, где, каким принтером, когда. */
    static TemplateValues baseValues(HelperApp app, PrinterInfo printer, long now) {
        SessionStore.Session session = app.sessions().load();
        TemplateValues values = new TemplateValues(TimeZone.getDefault())
                .text("user.name", session == null ? "" : session.userName)
                .text("org.name", session == null ? "" : session.orgName)
                .text("org.site", app.branding().site())
                .text("printer.name", printer.displayName())
                .text("printer.model", printer.model == null ? "" : printer.model)
                .text("label.size", printer.label.sizeLabel())
                .text("app.version", BuildConfig.VERSION_NAME)
                .time("now", now);
        Bitmap logo = app.branding().logo();
        if (logo != null) values.image(LOGO_KEY, logo.getWidth(), logo.getHeight());
        return values;
    }

    /** Ключ логотипа организации в шаблонах: {@code "src": "org.logo"}. */
    static final String LOGO_KEY = "org.logo";

    static MonoBitmap render(HelperApp app, LabelTemplate template, LabelSettings settings, TemplateValues values) {
        Map<String, Bitmap> images = new HashMap<>();
        Bitmap logo = app.branding().logo();
        if (logo != null) images.put(LOGO_KEY, logo);
        return LabelRenderer.toMono(LabelRenderer.draw(LayoutEngine.layout(template, settings, values, MEASURER),
                images));
    }

    static void print(HelperApp app, PrinterInfo printer, LabelTemplate template, TemplateValues values, int copies,
                      PrinterConnector.Progress progress, PrinterManager.Callback<Void> callback) {
        LabelSettings settings = printer.label.copy();
        app.printers().send(printer, () -> Tspl.labelJob(settings, render(app, template, settings, values), copies),
                progress, new PrinterManager.Callback<Void>() {
                    @Override
                    public void onSuccess(Void value) {
                        long now = System.currentTimeMillis();
                        PrinterInfo saved = app.printerStore().get(printer.address);
                        if (saved != null) {
                            saved.lastPrintAt = now;
                            app.printerStore().save(saved);
                        }
                        app.sync().enqueue(HelperEvents.printerPrinted(printer, template.id, copies, now));
                        callback.onSuccess(null);
                    }

                    @Override
                    public void onError(String message) {
                        callback.onError(message);
                    }
                });
    }

    /** Служебная команда: калибровка, самотест. */
    static void command(HelperApp app, PrinterInfo printer, byte[] command, PrinterConnector.Progress progress,
                        PrinterManager.Callback<Void> callback) {
        app.printers().send(printer, () -> command, progress, callback);
    }
}
