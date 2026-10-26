package ru.wesetup.helper;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Intent;
import android.widget.LinearLayout;

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

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import ru.wesetup.helper.auth.SessionStore;
import ru.wesetup.helper.bt.PrinterInfo;
import ru.wesetup.helper.template.LabelTemplate;

/** История печати: хранение на телефоне и «Изменить» — поля из прошлой печати. */
@RunWith(RobolectricTestRunner.class)
@Config(application = TestHelperApp.class, sdk = 36)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class PrintHistoryTest {

    private static final long NOW = 1792927800000L; // 25.10.2026 14:30 МСК

    private HelperApp app;

    @Before
    public void setUp() {
        app = (HelperApp) RuntimeEnvironment.getApplication();
    }

    private static PrintHistory.Entry entry(String product, int copies, long at) {
        Map<String, String> texts = new LinkedHashMap<>();
        texts.put("product", product);
        texts.put("employee", "Иван Петров");
        Map<String, Long> times = new LinkedHashMap<>();
        times.put("madeAt", at);
        Map<String, Integer> durations = new LinkedHashMap<>();
        durations.put("shelfLife", 24 * 60);
        return new PrintHistory.Entry("product", "Маркировка продукта", copies, at, texts, times, durations);
    }

    @Test
    public void testNewestFirstAndValuesSurvive() {
        PrintHistory history = new PrintHistory(app);
        assertTrue(history.all().isEmpty());
        history.add(entry("Салат «Цезарь»", 3, NOW));
        history.add(entry("Борщ", 1, NOW + 60_000));

        List<PrintHistory.Entry> all = new PrintHistory(app).all();
        assertEquals(2, all.size());
        assertEquals("Борщ", all.get(0).summary());
        PrintHistory.Entry first = all.get(1);
        assertEquals("product", first.templateId);
        assertEquals(3, first.copies);
        assertEquals(NOW, first.printedAt);
        assertEquals("Салат «Цезарь»", first.texts.get("product"));
        assertEquals(Long.valueOf(NOW), first.times.get("madeAt"));
        assertEquals(Integer.valueOf(24 * 60), first.durations.get("shelfLife"));
    }

    @Test
    public void testKeepsOnlyTheLastPrints() {
        PrintHistory history = new PrintHistory(app);
        for (int i = 0; i < PrintHistory.MAX + 5; i++) history.add(entry("Продукт " + i, 1, NOW + i));
        List<PrintHistory.Entry> all = history.all();
        assertEquals(PrintHistory.MAX, all.size());
        assertEquals("Продукт " + (PrintHistory.MAX + 4), all.get(0).summary());
    }

    @Test
    public void testEditFromHistoryFillsTheForm() throws Exception {
        app.sessions().save(new SessionStore.Session("token-123", "device-1", "Иван Петров", "chef@example.com",
                "Кафе «Ромашка»", "https://wesetup.ru", 1L));
        PrinterInfo printer = new PrinterInfo("DC:0D:30:12:34:56");
        printer.name = "IP-802BT";
        printer.transport = PrinterInfo.TRANSPORT_CLASSIC;
        app.printerStore().save(printer);
        Intent intent = new Intent(app, PrintActivity.class).putExtra(PrintActivity.EXTRA_ADDRESS, printer.address);
        PrintActivity activity = Robolectric.buildActivity(PrintActivity.class, intent).setup().get();

        LabelTemplate product = app.templates().byId("product");
        activity.editFromHistory(product, entry("Салат «Цезарь»", 4, NOW));

        ChipGroup chips = activity.findViewById(R.id.print_templates);
        assertEquals("Маркировка продукта", ((Chip) chips.findViewById(chips.getCheckedChipId())).getText().toString());
        LinearLayout fields = activity.findViewById(R.id.print_fields);
        TextInputLayout first = (TextInputLayout) fields.getChildAt(0);
        assertEquals("Салат «Цезарь»",
                String.valueOf(((TextInputEditText) first.findViewById(R.id.field_input)).getText()));
        assertEquals("4", String.valueOf(((android.widget.TextView) activity.findViewById(R.id.print_copies)).getText()));
        assertTrue(activity.findViewById(R.id.print_templates_prev) != null);
        assertTrue(activity.findViewById(R.id.print_history) != null);
    }
}
