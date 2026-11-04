package ru.wesetup.helper;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.drawable.BitmapDrawable;
import android.os.Looper;
import android.provider.Settings;
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

import ru.wesetup.helper.bt.BtSupport;
import ru.wesetup.helper.bt.PrinterInfo;
import ru.wesetup.helper.catalog.Catalog;
import ru.wesetup.helper.print.LabelRenderer;
import ru.wesetup.helper.print.MonoBitmap;
import ru.wesetup.helper.template.Durations;
import ru.wesetup.helper.template.LabelTemplate;
import ru.wesetup.helper.template.TemplateField;
import ru.wesetup.helper.template.TemplateValues;

/**
 * Экраны на Robolectric: разметка и тема собираются, переходы и проверки
 * работают без авторизации, этикетки рисуются настоящим Android Canvas.
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

    private PrinterInfo savePrinter() {
        PrinterInfo printer = new PrinterInfo("DC:0D:30:12:34:56");
        printer.name = "IP-802BT";
        printer.model = "AIYIN IP-802BT";
        printer.transport = PrinterInfo.TRANSPORT_CLASSIC;
        app.printerStore().save(printer);
        return printer;
    }

    @Test
    public void testColdStartOpensMainScreenDirectlyWithoutLogin() {
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).setup().get();
        assertFalse("главный экран открывается сразу без входа", activity.isFinishing());
        assertNull("редиректа на вход нет", shadowOf(activity).getNextStartedActivity());
        assertEquals(View.VISIBLE, activity.findViewById(R.id.main_templates).getVisibility());
        assertEquals(View.VISIBLE, activity.findViewById(R.id.main_empty).getVisibility());
        assertEquals(0, ((LinearLayout) activity.findViewById(R.id.main_printers)).getChildCount());
        assertEquals("Печать этикеток маркировки", ((TextView) activity.findViewById(R.id.main_org)).getText().toString());
        assertEquals("Автономный режим · всё хранится на устройстве",
                ((TextView) activity.findViewById(R.id.main_status_text)).getText().toString());

        activity.editLabelProfile();
        androidx.appcompat.app.AlertDialog dialog = (androidx.appcompat.app.AlertDialog) org.robolectric.shadows.ShadowDialog.getLatestDialog();
        assertNotNull(dialog);
        ((android.widget.EditText) dialog.findViewById(R.id.profile_org)).setText("Бистро «Север»");
        ((android.widget.EditText) dialog.findViewById(R.id.profile_site)).setText("sever.bistro");
        ((android.widget.EditText) dialog.findViewById(R.id.profile_user)).setText("Ольга Иванова");
        dialog.getButton(android.content.DialogInterface.BUTTON_POSITIVE).performClick();
        shadowOf(Looper.getMainLooper()).idle();

        assertEquals("Бистро «Север»", ((TextView) activity.findViewById(R.id.main_org)).getText().toString());
        assertEquals("Ольга Иванова · sever.bistro", ((TextView) activity.findViewById(R.id.main_user)).getText().toString());
    }

    @Test
    public void testPrintScreenOpensDirectlyWithoutSession() {
        Intent intent = new Intent(app, PrintActivity.class);
        PrintActivity activity = Robolectric.buildActivity(PrintActivity.class, intent).setup().get();
        assertFalse("экран шаблонов открывается без входа", activity.isFinishing());
        ChipGroup chips = activity.findViewById(R.id.print_templates);
        assertEquals(app.templates().all().size(), chips.getChildCount());
    }

    @Test
    public void testMainScreenOpensWithPrinterWithoutLogin() {
        savePrinter();
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).setup().get();
        assertFalse(activity.isFinishing());
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
    public void testPrintScreenRendersEveryTemplateWithAndroidCanvas() throws Exception {
        PrinterInfo printer = savePrinter();
        Intent intent = new Intent(app, PrintActivity.class).putExtra(PrintActivity.EXTRA_ADDRESS, printer.address);
        PrintActivity activity = Robolectric.buildActivity(PrintActivity.class, intent).setup().get();
        assertFalse(activity.isFinishing());
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
    public void testRequiredFieldBlocksPrinting() {
        PrinterInfo printer = savePrinter();
        Intent intent = new Intent(app, PrintActivity.class)
                .putExtra(PrintActivity.EXTRA_ADDRESS, printer.address)
                .putExtra(PrintActivity.EXTRA_TEMPLATE, "product");
        PrintActivity activity = Robolectric.buildActivity(PrintActivity.class, intent).setup().get();
        assertFalse(activity.isFinishing());
        ChipGroup chips = activity.findViewById(R.id.print_templates);
        assertEquals("Маркировка продукта", ((Chip) chips.findViewById(chips.getCheckedChipId())).getText().toString());
        LinearLayout fields = activity.findViewById(R.id.print_fields);
        TextInputLayout product = (TextInputLayout) fields.getChildAt(0);
        assertEquals("Продукт", product.getHint().toString());
        ((TextInputEditText) product.findViewById(R.id.field_input)).setText("");
        activity.findViewById(R.id.print_submit).performClick();
        assertEquals("Заполните «Продукт»", String.valueOf(product.getError()));
    }

    @Test
    public void testScanListsTheAiyinPrinterFirst() {
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
        BluetoothAdapter adapter = bluetoothReady();
        BluetoothDevice speaker = adapter.getRemoteDevice("00:11:22:33:44:55");
        shadowOf(speaker).setName("JBL Flip 5");
        Set<BluetoothDevice> bonded = new HashSet<>();
        bonded.add(speaker);
        shadowOf(adapter).setBondedDevices(bonded);
        ScanActivity activity = Robolectric.buildActivity(ScanActivity.class).setup().get();

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
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(41));
        assertEquals(View.GONE, activity.findViewById(R.id.scan_help).getVisibility());
    }

    @Test
    public void testHelpWithBluetoothSettingsAppearsWhenScanEndsWithoutPrinter() {
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

        activity.findViewById(R.id.scan_again).performClick();
        assertEquals(View.GONE, help.getVisibility());
    }

    @Test
    public void testCatalogSuggestsProductsAndFillsShelfLifeAndStorage() {
        PrinterInfo printer = savePrinter();
        app.catalog().replaceForTest(Catalog.parse("{\"version\":\"v1\","
                + "\"products\":[{\"name\":\"Котлеты куриные (п/ф)\",\"shelfLifeHours\":36,\"storage\":\"0…+4 °C\"}],"
                + "\"dishes\":[\"Суп гороховый\"],\"suppliers\":[],\"staff\":[\"Белова Елена\",\"Иван Петров\"]}"));
        Intent intent = new Intent(app, PrintActivity.class)
                .putExtra(PrintActivity.EXTRA_ADDRESS, printer.address)
                .putExtra(PrintActivity.EXTRA_TEMPLATE, "semi-finished");
        PrintActivity activity = Robolectric.buildActivity(PrintActivity.class, intent).setup().get();
        LinearLayout fields = activity.findViewById(R.id.print_fields);
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
        activity.applyProduct("Суп гороховый", product);
        assertEquals("0…+4 °C", String.valueOf(((android.widget.EditText) storage.findViewById(R.id.field_input)).getText()));
        app.catalog().clear();
    }

    @Test
    public void testProductionTemplateOffersOptionsAndDateOnlyFields() {
        PrinterInfo printer = savePrinter();
        Intent intent = new Intent(app, PrintActivity.class)
                .putExtra(PrintActivity.EXTRA_ADDRESS, printer.address)
                .putExtra(PrintActivity.EXTRA_TEMPLATE, "incoming");
        PrintActivity activity = Robolectric.buildActivity(PrintActivity.class, intent).setup().get();
        LinearLayout fields = activity.findViewById(R.id.print_fields);
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
        ((android.widget.EditText) storageInput).setText("+1…+3 °C");
        assertEquals("+1…+3 °C", String.valueOf(((android.widget.EditText) storageInput).getText()));
    }
}
