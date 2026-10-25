package ru.wesetup.helper.template;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.TimeZone;

public class TemplateValuesTest {

    private static final TimeZone MOSCOW = TimeZone.getTimeZone("Europe/Moscow");
    /** 25.10.2026 14:30 по Москве. */
    private static final long MADE_AT = 1792927800000L;

    private TemplateValues values() {
        return new TemplateValues(MOSCOW)
                .text("product", "Салат «Цезарь»")
                .text("user.name", "Иван Петров")
                .time("madeAt", MADE_AT)
                .duration("shelfLife", 24 * 60);
    }

    @Test
    public void testPlaceholdersAndFilters() {
        TemplateValues v = values();
        assertEquals("Салат «Цезарь»", v.resolve("{{product}}"));
        assertEquals("САЛАТ «ЦЕЗАРЬ»", v.resolve("{{ product | upper }}"));
        assertEquals("Изг.: 25.10.2026 14:30", v.resolve("Изг.: {{madeAt}}"));
        assertEquals("25.10.2026", v.resolve("{{madeAt|date}}"));
        assertEquals("14:30", v.resolve("{{madeAt|time}}"));
        assertEquals("Срок: 1 сут.", v.resolve("Срок: {{shelfLife}}"));
        assertEquals("Отв.: Иван Петров", v.resolve("Отв.: {{user.name}}"));
    }

    @Test
    public void testDatePlusDurationGivesExpiry() {
        assertEquals("Годен до: 26.10.2026 14:30", values().resolve("Годен до: {{madeAt+shelfLife|datetime}}"));
        assertEquals("27.10.2026", values().duration("shelfLife", 2 * 24 * 60).resolve("{{madeAt + shelfLife|date}}"));
    }

    @Test
    public void testMissingValuesBecomeEmptyNotBraces() {
        TemplateValues v = values();
        assertEquals("[]", v.resolve("[{{nope}}]"));
        assertEquals("[]", v.resolve("[{{madeAt+nope}}]"));
        assertEquals("[]", v.resolve("[{{product+shelfLife}}]"));
        assertEquals("", v.resolve(null));
        assertEquals("plain text", v.resolve("plain text"));
    }

    @Test
    public void testReplacementTextIsLiteral() {
        TemplateValues v = new TemplateValues(MOSCOW).text("price", "$5 \\ 10%");
        assertEquals("Цена: $5 \\ 10%", v.resolve("Цена: {{price}}"));
    }

    @Test
    public void testDefaultTimeExpressions() {
        long now = 1_000_000_000L;
        assertEquals(now, TemplateValues.defaultTime("now", now));
        assertEquals(now + 24 * 3_600_000L, TemplateValues.defaultTime("now+24h", now));
        assertEquals(now - 30 * 60_000L, TemplateValues.defaultTime("now-30m", now));
        assertEquals(now, TemplateValues.defaultTime("tomorrow", now));
        assertEquals(now, TemplateValues.defaultTime(null, now));
    }

    @Test
    public void testDurations() {
        assertEquals(30, Durations.parseMinutes("30m"));
        assertEquals(360, Durations.parseMinutes("6h"));
        assertEquals(7 * 24 * 60, Durations.parseMinutes("7D"));
        assertEquals(-1, Durations.parseMinutes("6x"));
        assertEquals(-1, Durations.parseMinutes("h"));
        assertEquals(-1, Durations.parseMinutes(null));
        assertEquals("45 мин", Durations.format(45));
        assertEquals("6 ч", Durations.format(360));
        assertEquals("36 ч", Durations.format(36 * 60));
        assertEquals("1 ч 30 мин", Durations.format(90));
        assertEquals("3 сут.", Durations.format(3 * 24 * 60));
    }
}
