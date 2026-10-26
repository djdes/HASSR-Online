package ru.wesetup.helper;

import static org.junit.Assert.assertNotNull;

import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.view.View;
import android.widget.LinearLayout;

import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.shadows.ShadowDialog;
import org.robolectric.shadows.ShadowLooper;

import java.io.File;
import java.io.FileOutputStream;
import java.util.LinkedHashMap;
import java.util.Map;

import ru.wesetup.helper.auth.SessionStore;
import ru.wesetup.helper.bt.PrinterInfo;

/**
 * Скриншоты для карточки Google Play: настоящие экраны приложения,
 * нарисованные Android Canvas в Robolectric, 1080×1920 (9:16). Кладутся в
 * {@code app/build/store-screenshots/}, CI выгружает их артефактом; в
 * карточку — после оформления подписями (store/google-play/).
 */
@RunWith(RobolectricTestRunner.class)
@Config(application = TestHelperApp.class, sdk = 36, qualifiers = "w360dp-h640dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class StoreScreenshotsTest {

    private static final long NOW = 1792927800000L; // 25.10.2026 14:30 МСК
    /** Размер кадра — из экрана Robolectric (qualifiers): телефон 1080×1920, планшеты 1200×1920 и 1600×2560. */
    private int width;
    private int height;

    private HelperApp app;
    private File out;

    @Before
    public void setUp() {
        app = (HelperApp) RuntimeEnvironment.getApplication();
        android.util.DisplayMetrics metrics = app.getResources().getDisplayMetrics();
        width = metrics.widthPixels;
        height = metrics.heightPixels;
    }

    private void signIn() throws Exception {
        app.sessions().save(new SessionStore.Session("token-123", "device-1", "Иван Петров", "chef@kafe-romashka.ru",
                "Кафе «Ромашка»", "https://wesetup.ru", 1L));
    }

    private PrinterInfo savePrinter() {
        PrinterInfo printer = new PrinterInfo("DC:0D:30:12:34:56");
        printer.name = "IP-802BT";
        printer.model = "AIYIN IP-802BT";
        printer.transport = PrinterInfo.TRANSPORT_CLASSIC;
        printer.lastPrintAt = NOW;
        app.printerStore().save(printer);
        return printer;
    }

    private Bitmap draw(View root) {
        root.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
        root.layout(0, 0, width, height);
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.WHITE);
        root.draw(canvas);
        return bitmap;
    }

    private Bitmap screen(Activity activity) {
        ShadowLooper.idleMainLooper();
        return draw(activity.getWindow().getDecorView());
    }

    /** Окно поверх экрана: затемнение и диалог по центру, как на телефоне. */
    private Bitmap withDialog(Bitmap base, Dialog dialog) {
        View decor = dialog.getWindow().getDecorView();
        int side = Math.max(72, (width - 1100) / 2);
        int dialogWidth = width - 2 * side;
        decor.measure(View.MeasureSpec.makeMeasureSpec(dialogWidth, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(height - 400, View.MeasureSpec.AT_MOST));
        decor.layout(0, 0, dialogWidth, decor.getMeasuredHeight());
        Bitmap result = base.copy(Bitmap.Config.ARGB_8888, true);
        Canvas canvas = new Canvas(result);
        canvas.drawColor(Color.argb(140, 0, 0, 0));
        canvas.save();
        canvas.translate(side, (height - decor.getMeasuredHeight()) / 2f);
        decor.draw(canvas);
        canvas.restore();
        return result;
    }

    private void save(Bitmap bitmap, String name) throws Exception {
        try (FileOutputStream stream = new FileOutputStream(new File(out, name))) {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream);
        }
    }

    private static void setText(LinearLayout fields, int index, String value) {
        TextInputLayout layout = (TextInputLayout) fields.getChildAt(index);
        ((TextInputEditText) layout.findViewById(R.id.field_input)).setText(value);
    }

    @Test
    public void testPhoneScreenshots() throws Exception {
        render("phone");
    }

    @Test
    @Config(qualifiers = "w600dp-h960dp-xhdpi")
    public void testTablet7Screenshots() throws Exception {
        render("tablet-7");
    }

    @Test
    @Config(qualifiers = "w800dp-h1280dp-xhdpi")
    public void testTablet10Screenshots() throws Exception {
        render("tablet-10");
    }

    private void render(String device) throws Exception {
        out = new File("build/store-screenshots/" + device);
        //noinspection ResultOfMethodCallIgnored
        out.mkdirs();
        LoginActivity login = Robolectric.buildActivity(LoginActivity.class).setup().get();
        save(screen(login), "1-login.png");

        signIn();
        PrinterInfo printer = savePrinter();
        MainActivity main = Robolectric.buildActivity(MainActivity.class).setup().get();
        save(screen(main), "2-main.png");

        Intent intent = new Intent(app, PrintActivity.class)
                .putExtra(PrintActivity.EXTRA_ADDRESS, printer.address)
                .putExtra(PrintActivity.EXTRA_TEMPLATE, "product");
        PrintActivity print = Robolectric.buildActivity(PrintActivity.class, intent).setup().get();
        setText(print.findViewById(R.id.print_fields), 0, "Салат «Цезарь» с курицей");
        ShadowLooper.idleMainLooper(300, java.util.concurrent.TimeUnit.MILLISECONDS);
        save(screen(print), "3-print.png");

        PrintHistory history = new PrintHistory(app);
        history.add(entry("product", "Маркировка продукта", "Борщ украинский", 2, NOW - 3 * 3600_000L));
        history.add(entry("defrost", "Разморозка", "Филе куриное", 1, NOW - 3600_000L));
        history.add(entry("product", "Маркировка продукта", "Салат «Цезарь» с курицей", 4, NOW));
        Bitmap printScreen = screen(print);
        print.findViewById(R.id.print_history).performClick();
        ShadowLooper.idleMainLooper();
        Dialog dialog = ShadowDialog.getLatestDialog();
        assertNotNull(dialog);
        save(withDialog(printScreen, dialog), "4-history.png");
    }

    private static PrintHistory.Entry entry(String template, String title, String product, int copies, long at) {
        Map<String, String> texts = new LinkedHashMap<>();
        texts.put("product", product);
        texts.put("employee", "Иван Петров");
        Map<String, Long> times = new LinkedHashMap<>();
        times.put("madeAt", at);
        return new PrintHistory.Entry(template, title, copies, at, texts, times, new LinkedHashMap<>());
    }
}
