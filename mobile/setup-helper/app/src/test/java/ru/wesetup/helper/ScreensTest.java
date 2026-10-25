package ru.wesetup.helper;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.drawable.BitmapDrawable;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.chip.Chip;
import com.google.android.material.chip.ChipGroup;
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

import java.io.File;
import java.io.FileOutputStream;
import java.util.HashSet;
import java.util.Set;

import ru.wesetup.helper.auth.SessionStore;
import ru.wesetup.helper.bt.BtSupport;
import ru.wesetup.helper.bt.PrinterInfo;
import ru.wesetup.helper.print.LabelRenderer;
import ru.wesetup.helper.print.MonoBitmap;
import ru.wesetup.helper.template.LabelTemplate;
import ru.wesetup.helper.template.TemplateValues;

/**
 * Экраны на Robolectric: разметка и тема собираются, переходы и проверки
 * работают, этикетки рисуются настоящим Android Canvas (native graphics).
 * Bluetooth и сеть — тени Robolectric, без реального принтера.
 */
@RunWith(RobolectricTestRunner.class)
@Config(application = TestHelperApp.class, sdk = 36)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class ScreensTest {

    private static final long NOW = 1792927800000L; // 25.10.2026 14:30 МСК

    private HelperApp app;

    @Before
    public void setUp() {
        app = (HelperApp) RuntimeEnvironment.getApplication();
    }

    private void signIn() throws Exception {
        app.sessions().save(new SessionStore.Session("token-123", "device-1", "Иван Петров", "chef@example.com",
                "Кафе «Ромашка»", "https://wesetup.ru", 1L));
    }

    private PrinterInfo savePrinter() {
        PrinterInfo printer = new PrinterInfo("DC:0D:30:12:34:56");
        printer.name = "IP-802BT";
        printer.model = "AIYIN IP-802BT";
        printer.transport = PrinterInfo.TRANSPORT_CLASSIC;
        app.printerStore().save(printer);
        return printer;
    }

    @Test
    public void testWithoutSessionTheAppAsksToSignIn() {
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).setup().get();
        Intent next = shadowOf(activity).getNextStartedActivity();
        assertNotNull(next);
        assertEquals(LoginActivity.class.getName(), next.getComponent().getClassName());
        assertTrue(activity.isFinishing());
    }

    @Test
    public void testLoginScreenValidatesInputAndShowsServer() {
        LoginActivity activity = Robolectric.buildActivity(LoginActivity.class).setup().get();
        assertEquals("Сервер: wesetup.ru", ((TextView) activity.findViewById(R.id.login_server)).getText().toString());
        activity.findViewById(R.id.login_submit).performClick();
        TextView error = activity.findViewById(R.id.login_error);
        assertEquals(View.VISIBLE, error.getVisibility());
        assertEquals("Введите почту и пароль", error.getText().toString());
    }

    @Test
    public void testRevokedSessionMessageIsShownOnLogin() {
        Intent intent = new Intent(app, LoginActivity.class)
                .putExtra(LoginActivity.EXTRA_MESSAGE, app.getString(R.string.login_revoked));
        LoginActivity activity = Robolectric.buildActivity(LoginActivity.class, intent).setup().get();
        TextView error = activity.findViewById(R.id.login_error);
        assertEquals(View.VISIBLE, error.getVisibility());
        assertTrue(error.getText().toString().contains("отключено"));
    }

    @Test
    public void testSavedSessionOpensMainScreenWithPrinterWithoutNetwork() throws Exception {
        signIn();
        savePrinter();
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).setup().get();
        assertEquals("Кафе «Ромашка»", ((TextView) activity.findViewById(R.id.main_org)).getText().toString());
        assertEquals("Иван Петров · chef@example.com", ((TextView) activity.findViewById(R.id.main_user)).getText().toString());
        assertEquals("Добавить оборудование", ((MaterialButton) activity.findViewById(R.id.main_add)).getText().toString());
        assertEquals(View.GONE, activity.findViewById(R.id.main_empty).getVisibility());
        LinearLayout printers = activity.findViewById(R.id.main_printers);
        assertEquals(1, printers.getChildCount());
        View item = printers.getChildAt(0);
        assertEquals("IP-802BT", ((TextView) item.findViewById(R.id.printer_name)).getText().toString());
        assertEquals("AIYIN IP-802BT · Bluetooth", ((TextView) item.findViewById(R.id.printer_details)).getText().toString());
        assertEquals("Этикетка 58×40 мм, зазор 2 мм", ((TextView) item.findViewById(R.id.printer_label)).getText().toString());
        assertEquals("Пробная этикетка 58×40", ((MaterialButton) item.findViewById(R.id.printer_test)).getText().toString());
    }

    @Test
    public void testEmptyMainScreenInvitesToAddEquipment() throws Exception {
        signIn();
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).setup().get();
        assertEquals(View.VISIBLE, activity.findViewById(R.id.main_empty).getVisibility());
        assertEquals(0, ((LinearLayout) activity.findViewById(R.id.main_printers)).getChildCount());
    }

    @Test
    public void testPrintScreenRendersEveryTemplateWithAndroidCanvas() throws Exception {
        signIn();
        PrinterInfo printer = savePrinter();
        Intent intent = new Intent(app, PrintActivity.class).putExtra(PrintActivity.EXTRA_ADDRESS, printer.address);
        PrintActivity activity = Robolectric.buildActivity(PrintActivity.class, intent).setup().get();
        ChipGroup chips = activity.findViewById(R.id.print_templates);
        assertEquals(app.templates().all().size(), chips.getChildCount());
        for (int i = 0; i < chips.getChildCount(); i++) {
            chips.getChildAt(i).performClick();
            Bitmap preview = ((BitmapDrawable) ((ImageView) activity.findViewById(R.id.print_preview)).getDrawable()).getBitmap();
            assertEquals(464, preview.getWidth());
            assertEquals(320, preview.getHeight());
        }

        File out = new File("build/android-label-previews");
        //noinspection ResultOfMethodCallIgnored
        out.mkdirs();
        for (LabelTemplate template : app.templates().all()) {
            TemplateValues values = PrintJobs.baseValues(app, printer, NOW)
                    .text("product", "Салат «Цезарь» с курицей")
                    .time("madeAt", NOW).duration("shelfLife", 24 * 60)
                    .time("openedAt", NOW).duration("useWithin", 72 * 60)
                    .text("employee", "Иван Петров")
                    .text("text", "Только для персонала");
            MonoBitmap image = PrintJobs.render(template, printer.label, values);
            assertEquals(464, image.width);
            assertEquals(320, image.height);
            assertTrue(template.id + ": на этикетке почти ничего нет", image.blackCount() > 500);
            try (FileOutputStream stream = new FileOutputStream(new File(out, template.id + ".png"))) {
                LabelRenderer.preview(image).compress(Bitmap.CompressFormat.PNG, 100, stream);
            }
        }
    }

    @Test
    public void testRequiredFieldBlocksPrinting() throws Exception {
        signIn();
        PrinterInfo printer = savePrinter();
        Intent intent = new Intent(app, PrintActivity.class)
                .putExtra(PrintActivity.EXTRA_ADDRESS, printer.address)
                .putExtra(PrintActivity.EXTRA_TEMPLATE, "product");
        PrintActivity activity = Robolectric.buildActivity(PrintActivity.class, intent).setup().get();
        ChipGroup chips = activity.findViewById(R.id.print_templates);
        assertEquals("Маркировка продукта", ((Chip) chips.findViewById(chips.getCheckedChipId())).getText().toString());
        LinearLayout fields = activity.findViewById(R.id.print_fields);
        TextInputLayout product = (TextInputLayout) fields.getChildAt(0);
        assertEquals("Продукт", product.getHint().toString());
        ((TextInputEditText) product.findViewById(R.id.field_input)).setText("");
        activity.findViewById(R.id.print_submit).performClick();
        assertEquals("Заполните «Продукт»", String.valueOf(product.getError()));
        // Ответственный подставлен из входа.
        TextInputLayout employee = (TextInputLayout) fields.getChildAt(3);
        assertEquals("Иван Петров", String.valueOf(((TextInputEditText) employee.findViewById(R.id.field_input)).getText()));
    }

    @Test
    public void testScanListsTheAiyinPrinterFirst() throws Exception {
        signIn();
        shadowOf(app).grantPermissions(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT);
        BluetoothAdapter adapter = BtSupport.adapter(app);
        shadowOf(adapter).setEnabled(true);
        BluetoothDevice speaker = adapter.getRemoteDevice("00:11:22:33:44:55");
        shadowOf(speaker).setName("JBL Flip 5");
        BluetoothDevice printer = adapter.getRemoteDevice("DC:0D:30:12:34:56");
        shadowOf(printer).setName("IP-802BT");
        Set<BluetoothDevice> bonded = new HashSet<>();
        bonded.add(speaker);
        bonded.add(printer);
        shadowOf(adapter).setBondedDevices(bonded);

        ScanActivity activity = Robolectric.buildActivity(ScanActivity.class).setup().get();
        LinearLayout list = activity.findViewById(R.id.scan_list);
        assertEquals(2, list.getChildCount());
        View first = list.getChildAt(0);
        assertEquals("IP-802BT", ((TextView) first.findViewById(R.id.device_name)).getText().toString());
        assertEquals("Похоже на принтер · Сопряжён", ((TextView) first.findViewById(R.id.device_badges)).getText().toString());
        assertEquals("JBL Flip 5", ((TextView) list.getChildAt(1).findViewById(R.id.device_name)).getText().toString());
    }
}
