package ru.wesetup.helper.print;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import org.junit.Test;

public class LabelSettingsTest {

    @Test
    public void testDefaultsMatchAiyinIp802btDriver() {
        LabelSettings s = new LabelSettings();
        assertEquals(58, s.widthMm);
        assertEquals(40, s.heightMm);
        assertEquals(2f, s.gapMm, 0f);
        assertEquals(8, s.density);
        assertFalse(s.rotate180);
        assertEquals(464, s.widthDots());
        assertEquals(320, s.heightDots());
        assertEquals("58×40", s.sizeLabel());
    }

    @Test
    public void testNormalizedKeepsValuesInPrinterLimits() {
        LabelSettings s = new LabelSettings();
        s.widthMm = 120;
        s.heightMm = 2;
        s.gapMm = 2.3f;
        s.density = -3;
        s.speed = 1;
        s.shiftXmm = 40f;
        s.shiftYmm = Float.NaN;
        LabelSettings n = s.normalized();
        assertEquals(72, n.widthMm);
        assertEquals(10, n.heightMm);
        assertEquals(2.5f, n.gapMm, 0f);
        assertEquals(0, n.density);
        assertEquals(2, n.speed);
        assertEquals(5f, n.shiftXmm, 0f);
        assertEquals(-5f, n.shiftYmm, 0f);
        // Исходные настройки не меняются.
        assertEquals(120, s.widthMm);
    }
}
