package ru.wesetup.helper.template;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.IOException;
import java.util.List;
import java.util.TimeZone;

public class LabelRecordTest {

    private static final TimeZone MSK = TimeZone.getTimeZone("Europe/Moscow");
    private static final long NOW = 1792927800000L; // 25.10.2026 14:30 МСК
    private static final long HOUR = 60L * 60 * 1000;

    private static LabelTemplate template(String id) throws IOException {
        for (LabelTemplate t : TemplateParserTest.bundled()) if (t.id.equals(id)) return t;
        throw new AssertionError("Нет шаблона " + id);
    }

    @Test
    public void testSemiFinishedRecordIsWhatThePrinterPrints() throws IOException {
        TemplateValues values = new TemplateValues(MSK)
                .text("product", "  Котлеты   куриные ")
                .time("madeAt", NOW)
                .duration("shelfLife", 24 * 60)
                .text("storage", "+2…+6 °C")
                .text("amount", "")
                .text("employee", "Белова Елена");
        LabelRecord record = LabelRecord.of(template("semi-finished"), values);
        assertEquals("Котлеты куриные", record.item);
        assertEquals(Long.valueOf(NOW), record.startAt);
        assertEquals("Изготовлено", record.startLabel);
        assertEquals(Long.valueOf(NOW + 24 * HOUR), record.until);
        assertEquals("Годен до", record.untilLabel);
        assertFalse(record.dateOnly);
        assertEquals("Белова Елена", record.by);
        assertEquals("Изготовил", record.byLabel);
        // Пустая «масса» не нужна, «что» и «кто» — не в полях.
        assertEquals(1, record.fields.size());
        assertEquals("Условия хранения", record.fields.get(0).label);
        assertEquals("+2…+6 °C", record.fields.get(0).value);
        // На этикетке — та же дата.
        assertEquals(values.formatTime(record.until, "datetime"), values.resolve("{{madeAt+shelfLife|datetime}}"));
    }

    @Test
    public void testDateOnlyLabelIsGoodUntilTheEndOfThatDay() throws IOException {
        TemplateValues values = new TemplateValues(MSK)
                .text("product", "Молоко 3,2%")
                .text("supplier", "ООО «Агро»")
                .time("receivedAt", NOW)
                .time("expiresAt", NOW + 3 * 24 * HOUR)
                .text("employee", "Иван Петров");
        LabelRecord record = LabelRecord.of(template("incoming"), values);
        assertTrue(record.dateOnly);
        assertEquals("28.10.2026 23:59", values.formatTime(record.until, "datetime"));
        assertEquals("Поступило", record.startLabel);
        assertEquals("Принял", record.byLabel);
        assertEquals("Поставщик", record.fields.get(0).label);
    }

    @Test
    public void testRejectHasNoDateAndEmptyItemMeansNoRecord() throws IOException {
        TemplateValues values = new TemplateValues(MSK)
                .text("product", "Сметана 20%")
                .text("reason", "Истёк срок годности")
                .time("markedAt", NOW)
                .text("employee", "Иван Петров");
        LabelRecord reject = LabelRecord.of(template("reject"), values);
        assertNull(reject.until);
        assertEquals("", reject.untilLabel);
        assertEquals("Причина", reject.fields.get(0).label);
        assertNull(LabelRecord.of(template("reject"), values.text("product", "   ")));
        assertNull("у пробной этикетки записи нет", LabelRecord.of(template("test-58x40"), values));
    }

    @Test
    public void testLongValuesAreClippedToSiteLimits() throws IOException {
        StringBuilder longText = new StringBuilder();
        for (int i = 0; i < 300; i++) longText.append('я');
        TemplateValues values = new TemplateValues(MSK)
                .text("product", longText.toString())
                .text("allergens", longText.toString())
                .time("madeAt", NOW)
                .text("employee", longText.toString());
        LabelRecord record = LabelRecord.of(template("allergens"), values);
        assertEquals(LabelRecord.ITEM_MAX, record.item.length());
        assertEquals(LabelRecord.BY_MAX, record.by.length());
        List<LabelRecord.Field> fields = record.fields;
        assertEquals(LabelRecord.VALUE_MAX, fields.get(0).value.length());
        assertEquals("😀😀", LabelRecord.clip("😀😀😀", 5));
    }
}
