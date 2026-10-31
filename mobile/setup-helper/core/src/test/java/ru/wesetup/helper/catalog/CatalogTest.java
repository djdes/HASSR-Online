package ru.wesetup.helper.catalog;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

public class CatalogTest {

    private static final String JSON = "{\"version\":\"abc123\","
            + "\"products\":[{\"name\":\"Молоко 3,2%\",\"shelfLifeHours\":120,\"storage\":\"+2…+6 °C\",\"supplier\":\"ООО «Агро»\"},"
            + "{\"name\":\"  Котлеты   куриные \",\"shelfLifeHours\":null,\"storage\":null},"
            + "{\"name\":\"\"},{\"shelfLifeHours\":5},\"не объект\",{\"name\":\"Каша овсяная\",\"shelfLifeHours\":0}],"
            + "\"dishes\":[\"Каша овсяная\",\"Компот\",\"\"],"
            + "\"suppliers\":[\"ООО «Агро»\"],"
            + "\"staff\":[\"Иванова Мария\",\"Петрова Анна\"]}";

    @Test
    public void testParsesSiteCatalogAndSkipsBrokenEntries() {
        Catalog catalog = Catalog.parse(JSON);
        assertEquals("abc123", catalog.version);
        assertEquals(3, catalog.products.size());
        Catalog.Product milk = catalog.products.get(0);
        assertEquals("Молоко 3,2%", milk.name);
        assertEquals(Integer.valueOf(120), milk.shelfLifeHours);
        assertEquals("+2…+6 °C", milk.storage);
        assertEquals("ООО «Агро»", milk.supplier);
        Catalog.Product cutlets = catalog.products.get(1);
        assertEquals("Котлеты куриные", cutlets.name);
        assertNull(cutlets.shelfLifeHours);
        assertNull(cutlets.storage);
        assertNull("нулевой срок — не срок", catalog.products.get(2).shelfLifeHours);
        assertEquals(Arrays.asList("Каша овсяная", "Компот"), catalog.dishes);
        assertFalse(catalog.isEmpty());
        assertTrue(Catalog.EMPTY.isEmpty());
    }

    @Test
    public void testNamesForFieldSourceMergeListsWithoutRepeats() {
        Catalog catalog = Catalog.parse(JSON);
        assertEquals(Arrays.asList("Молоко 3,2%", "Котлеты куриные", "Каша овсяная", "Компот"),
                catalog.names("products,dishes"));
        assertEquals(Arrays.asList("Каша овсяная", "Компот", "Молоко 3,2%", "Котлеты куриные"),
                catalog.names("dishes, products"));
        assertEquals(Arrays.asList("Иванова Мария", "Петрова Анна"), catalog.names("staff"));
        assertEquals(Collections.emptyList(), catalog.names(""));
        assertEquals(Collections.emptyList(), catalog.names("recipes"));
    }

    @Test
    public void testProductLookupIgnoresCaseAndSpaces() {
        Catalog catalog = Catalog.parse(JSON);
        assertEquals("Молоко 3,2%", catalog.product("  молоко  3,2% ").name);
        assertEquals("Котлеты куриные", catalog.product("КОТЛЕТЫ КУРИНЫЕ").name);
        assertNull(catalog.product("Компот"));
        assertNull(catalog.product(null));
    }

    @Test
    public void testKnownSourcesAndBrokenJson() {
        assertTrue(Catalog.isKnownSource("products"));
        assertTrue(Catalog.isKnownSource("dishes,products"));
        assertFalse(Catalog.isKnownSource("products,recipes"));
        assertFalse(Catalog.isKnownSource(""));
        try {
            Catalog.parse("<html>");
            fail("не JSON");
        } catch (IllegalArgumentException e) {
            assertTrue(e.getMessage().contains("не разобран"));
        }
    }
}
