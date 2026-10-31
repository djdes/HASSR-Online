package ru.wesetup.helper;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.content.Intent;
import android.os.Looper;
import android.provider.Settings;
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
import java.lang.reflect.Constructor;
import java.time.Duration;
import java.util.HashSet;
import java.util.Set;

import ru.wesetup.helper.auth.SessionStore;
import ru.wesetup.helper.catalog.Catalog;
import ru.wesetup.helper.bt.BtSupport;
import ru.wesetup.helper.bt.PrinterInfo;
import ru.wesetup.helper.print.LabelRenderer;
import ru.wesetup.helper.print.MonoBitmap;
import ru.wesetup.helper.template.Durations;
import ru.wesetup.helper.template.LabelTemplate;
import ru.wesetup.helper.template.TemplateField;
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
            fillFields(values, template);
            MonoBitmap image = PrintJobs.render(app, template, printer.label, values);
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

    /** Поля шаблона, которым не задали пример, — умолчаниями или первым вариантом. */
    private static void fillFields(TemplateValues values, LabelTemplate template) {
        for (TemplateField field : template.fields) {
            switch (field.type) {
                case DATETIME:
                    if (values.time(field.key) == null) values.time(field.key, TemplateValues.defaultTime(field.defaultValue, NOW));
                    break;
                case DURATION:
                    if (values.duration(field.key) == null) values.duration(field.key, Durations.parseMinutes(field.defaultValue));
                    break;
                default:
                    if (values.text(field.key).isEmpty()) {
                        values.text(field.key, field.options.isEmpty() ? "Котлеты куриные рубленые" : field.options.get(0));
                    }
            }
        }
    }

    /** Класс устройства Bluetooth: конструктор скрыт в SDK, но есть в Android. */
    private static BluetoothClass bluetoothClass(int value) throws Exception {
        Constructor<BluetoothClass> constructor = BluetoothClass.class.getDeclaredConstructor(int.class);
        constructor.setAccessible(true);
        return constructor.newInstance(value);
    }

    private BluetoothAdapter bluetoothReady() {
        shadowOf(app).grantPermissions(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT);
        BluetoothAdapter adapter = BtSupport.adapter(app);
        shadowOf(adapter).setEnabled(true);
        return adapter;
    }

    private static int visibleRows(LinearLayout list) {
        return list.getChildCount();
    }

    @Test
    public void testUnnamedPrinterFoundByBluetoothClassIsShownOthersBehindButton() throws Exception {
        signIn();
        BluetoothAdapter adapter = bluetoothReady();
        BluetoothDevice speaker = adapter.getRemoteDevice("00:11:22:33:44:55");
        shadowOf(speaker).setName("JBL Flip 5");
        Set<BluetoothDevice> bonded = new HashSet<>();
        bonded.add(speaker);
        shadowOf(adapter).setBondedDevices(bonded);
        ScanActivity activity = Robolectric.buildActivity(ScanActivity.class).setup().get();

        // Классический поиск нашёл два устройства без имени: принтер (Imaging/Printer) и наушники.
        BluetoothDevice printer = adapter.getRemoteDevice("DC:0D:30:12:34:56");
        BluetoothDevice headphones = adapter.getRemoteDevice("66:77:88:99:AA:BB");
        app.sendBroadcast(new Intent(BluetoothDevice.ACTION_FOUND)
                .putExtra(BluetoothDevice.EXTRA_DEVICE, printer)
                .putExtra(BluetoothDevice.EXTRA_CLASS, bluetoothClass(0x0680)));
        app.sendBroadcast(new Intent(BluetoothDevice.ACTION_FOUND)
                .putExtra(BluetoothDevice.EXTRA_DEVICE, headphones)
                .putExtra(BluetoothDevice.EXTRA_CLASS, bluetoothClass(0x0418)));
        shadowOf(Looper.getMainLooper()).idle();

        LinearLayout list = activity.findViewById(R.id.scan_list);
        assertEquals(2, visibleRows(list));
        View first = list.getChildAt(0);
        assertEquals("Без имени", ((TextView) first.findViewById(R.id.device_name)).getText().toString());
        assertEquals("DC:0D:30:12:34:56", ((TextView) first.findViewById(R.id.device_address)).getText().toString());
        assertEquals("Похоже на принтер", ((TextView) first.findViewById(R.id.device_badges)).getText().toString());
        assertEquals("JBL Flip 5", ((TextView) list.getChildAt(1).findViewById(R.id.device_name)).getText().toString());

        MaterialButton showAll = activity.findViewById(R.id.scan_show_all);
        assertEquals(View.VISIBLE, showAll.getVisibility());
        assertEquals("Показать все устройства (ещё 1)", showAll.getText().toString());
        showAll.performClick();
        assertEquals(3, visibleRows(list));
        assertEquals("Скрыть устройства без имени", showAll.getText().toString());
        // Принтер нашёлся — подсказка «не нашёлся?» не нужна даже после конца поиска.
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(41));
        assertEquals(View.GONE, activity.findViewById(R.id.scan_help).getVisibility());
    }

    @Test
    public void testHelpWithBluetoothSettingsAppearsWhenScanEndsWithoutPrinter() throws Exception {
        signIn();
        BluetoothAdapter adapter = bluetoothReady();
        BluetoothDevice speaker = adapter.getRemoteDevice("00:11:22:33:44:55");
        shadowOf(speaker).setName("JBL Flip 5");
        Set<BluetoothDevice> bonded = new HashSet<>();
        bonded.add(speaker);
        shadowOf(adapter).setBondedDevices(bonded);
        ScanActivity activity = Robolectric.buildActivity(ScanActivity.class).setup().get();

        View help = activity.findViewById(R.id.scan_help);
        assertEquals("пока ищем — подсказки нет", View.GONE, help.getVisibility());
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(41));
        assertEquals(View.VISIBLE, help.getVisibility());
        assertEquals("Поиск закончен", ((TextView) activity.findViewById(R.id.scan_status)).getText().toString());

        activity.findViewById(R.id.scan_help_settings).performClick();
        Intent next = shadowOf(activity).getNextStartedActivity();
        assertNotNull(next);
        assertEquals(Settings.ACTION_BLUETOOTH_SETTINGS, next.getAction());

        // «Искать снова» прячет подсказку до конца нового поиска.
        activity.findViewById(R.id.scan_again).performClick();
        assertEquals(View.GONE, help.getVisibility());
    }

    @Test
    public void testCatalogFromTheSiteSuggestsProductsAndFillsShelfLifeAndStorage() throws Exception {
        signIn();
        PrinterInfo printer = savePrinter();
        app.catalog().replaceForTest(Catalog.parse("{\"version\":\"v1\","
                + "\"products\":[{\"name\":\"Котлеты куриные (п/ф)\",\"shelfLifeHours\":36,\"storage\":\"0…+4 °C\"}],"
                + "\"dishes\":[\"Суп гороховый\"],\"suppliers\":[],\"staff\":[\"Белова Елена\",\"Иван Петров\"]}"));
        Intent intent = new Intent(app, PrintActivity.class)
                .putExtra(PrintActivity.EXTRA_ADDRESS, printer.address)
                .putExtra(PrintActivity.EXTRA_TEMPLATE, "semi-finished");
        PrintActivity activity = Robolectric.buildActivity(PrintActivity.class, intent).setup().get();
        LinearLayout fields = activity.findViewById(R.id.print_fields);
        // Наименование, изготовлено, срок, хранение, количество, изготовил.
        TextInputLayout product = (TextInputLayout) fields.getChildAt(0);
        View productInput = product.findViewById(R.id.field_input);
        assertTrue("у продукта — список из справочника",
                productInput instanceof com.google.android.material.textfield.MaterialAutoCompleteTextView);
        android.widget.ListAdapter suggestions =
                ((com.google.android.material.textfield.MaterialAutoCompleteTextView) productInput).getAdapter();
        assertEquals(2, suggestions.getCount());
        assertEquals("Котлеты куриные (п/ф)", String.valueOf(suggestions.getItem(0)));
        assertEquals("Суп гороховый", String.valueOf(suggestions.getItem(1)));
        TextInputLayout employee = (TextInputLayout) fields.getChildAt(5);
        assertEquals(2, ((com.google.android.material.textfield.MaterialAutoCompleteTextView)
                employee.findViewById(R.id.field_input)).getAdapter().getCount());

        ((android.widget.EditText) productInput).setText("Котлеты куриные (п/ф)");
        activity.applyProduct("Котлеты куриные (п/ф)", product);
        TextInputLayout shelfLife = (TextInputLayout) fields.getChildAt(2);
        assertEquals(Durations.format(36 * 60),
                String.valueOf(((android.widget.EditText) shelfLife.findViewById(R.id.field_input)).getText()));
        TextInputLayout storage = (TextInputLayout) fields.getChildAt(3);
        assertEquals("0…+4 °C", String.valueOf(((android.widget.EditText) storage.findViewById(R.id.field_input)).getText()));
        assertEquals(activity.getString(R.string.print_catalog_filled), String.valueOf(product.getHelperText()));
        // Блюдо без срока в справочнике ничего не подставляет.
        activity.applyProduct("Суп гороховый", product);
        assertEquals("0…+4 °C", String.valueOf(((android.widget.EditText) storage.findViewById(R.id.field_input)).getText()));
        app.catalog().clear();
    }

    @Test
    public void testProductionTemplateOffersOptionsAndDateOnlyFields() throws Exception {
        signIn();
        PrinterInfo printer = savePrinter();
        Intent intent = new Intent(app, PrintActivity.class)
                .putExtra(PrintActivity.EXTRA_ADDRESS, printer.address)
                .putExtra(PrintActivity.EXTRA_TEMPLATE, "incoming");
        PrintActivity activity = Robolectric.buildActivity(PrintActivity.class, intent).setup().get();
        LinearLayout fields = activity.findViewById(R.id.print_fields);
        // Продукт, поставщик, партия, поступило, годен до, хранение, принял.
        assertEquals(7, fields.getChildCount());
        TextInputLayout expires = (TextInputLayout) fields.getChildAt(4);
        assertEquals("Годен до (по документам)", expires.getHint().toString());
        String date = String.valueOf(((TextInputEditText) expires.findViewById(R.id.field_input)).getText());
        assertTrue("только дата, без времени: " + date, date.matches("\\d{2}\\.\\d{2}\\.\\d{4}"));
        TextInputLayout storage = (TextInputLayout) fields.getChildAt(5);
        assertEquals("Условия хранения", storage.getHint().toString());
        View storageInput = storage.findViewById(R.id.field_input);
        assertTrue(storageInput instanceof com.google.android.material.textfield.MaterialAutoCompleteTextView);
        assertEquals("+2…+6 °C", String.valueOf(((android.widget.EditText) storageInput).getText()));
        // Своё значение вписать можно — это подсказки, а не жёсткий список.
        ((android.widget.EditText) storageInput).setText("+1…+3 °C");
        assertEquals("+1…+3 °C", String.valueOf(((android.widget.EditText) storageInput).getText()));
    }
}
