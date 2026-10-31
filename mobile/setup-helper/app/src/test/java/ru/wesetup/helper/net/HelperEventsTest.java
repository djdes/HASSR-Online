package ru.wesetup.helper.net;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.TimeZone;

import ru.wesetup.helper.bt.PrinterInfo;
import ru.wesetup.helper.template.LabelRecord;
import ru.wesetup.helper.template.LabelTemplate;
import ru.wesetup.helper.template.TemplateParser;
import ru.wesetup.helper.template.TemplateValues;

public class HelperEventsTest {

    private static final long NOW = 1792927800000L; // 25.10.2026 14:30 МСК

    private static LabelTemplate template(String file) throws Exception {
        File path = new File("src/main/assets/templates/" + file);
        return TemplateParser.parse(new String(Files.readAllBytes(path.toPath()), StandardCharsets.UTF_8));
    }

    @Test
    public void testLabelPrintedCarriesTheLabelAsPrinted() throws Exception {
        PrinterInfo printer = new PrinterInfo("DC:0D:30:12:34:56");
        LabelTemplate semi = template("21-semi-finished.json");
        TemplateValues values = new TemplateValues(TimeZone.getTimeZone("Europe/Moscow"))
                .text("product", "Котлеты куриные")
                .time("madeAt", NOW)
                .duration("shelfLife", 24 * 60)
                .text("storage", "+2…+6 °C")
                .text("amount", "40 шт.")
                .text("employee", "Белова Елена");
        JSONObject event = HelperEvents.labelPrinted(printer, semi, LabelRecord.of(semi, values), 2, NOW + 60_000);

        assertEquals(HelperEvents.LABEL_PRINTED, event.getString("type"));
        assertTrue(event.getString("id").matches("[0-9a-f-]{36}"));
        assertEquals("2026-10-25T11:31:00.000Z", event.getString("at"));
        assertEquals("DC:0D:30:12:34:56", event.getJSONObject("printer").getString("address"));
        assertEquals("semi-finished", event.getString("template"));
        assertEquals("Полуфабрикат", event.getString("title"));
        assertEquals(2, event.getInt("copies"));
        JSONObject label = event.getJSONObject("label");
        assertEquals("Котлеты куриные", label.getString("item"));
        assertEquals("2026-10-25T11:30:00.000Z", label.getString("startAt"));
        assertEquals("Изготовлено", label.getString("startLabel"));
        assertEquals("2026-10-26T11:30:00.000Z", label.getString("until"));
        assertEquals("Годен до", label.getString("untilLabel"));
        assertFalse(label.getBoolean("dateOnly"));
        assertEquals("Белова Елена", label.getString("by"));
        assertEquals("Изготовил", label.getString("byLabel"));
        JSONArray fields = label.getJSONArray("fields");
        assertEquals(2, fields.length());
        assertEquals("Условия хранения", fields.getJSONObject(0).getString("label"));
        assertEquals("40 шт.", fields.getJSONObject(1).getString("value"));
    }

    @Test
    public void testLabelWithoutDatesHasNoDateKeys() throws Exception {
        PrinterInfo printer = new PrinterInfo("DC:0D:30:12:34:56");
        LabelTemplate reject = template("28-reject.json");
        TemplateValues values = new TemplateValues(TimeZone.getTimeZone("Europe/Moscow"))
                .text("product", "Сметана 20%")
                .text("reason", "Истёк срок годности")
                .time("markedAt", NOW)
                .text("employee", "");
        JSONObject label = HelperEvents.labelPrinted(printer, reject, LabelRecord.of(reject, values), 1, NOW)
                .getJSONObject("label");
        assertFalse(label.has("until"));
        assertFalse("пустое «кто» не отправляется", label.has("by"));
        assertTrue(label.has("startAt"));
    }
}
