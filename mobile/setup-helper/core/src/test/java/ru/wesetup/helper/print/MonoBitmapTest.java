package ru.wesetup.helper.print;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class MonoBitmapTest {

    @Test
    public void testNewImageIsWhiteWithTsplPolarity() {
        MonoBitmap image = new MonoBitmap(16, 2);
        assertEquals(2, image.bytesPerRow);
        assertArrayEquals(new byte[]{(byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF}, image.tsplData());
        assertEquals(0, image.blackCount());
    }

    @Test
    public void testBlackDotClearsBitMsbFirst() {
        MonoBitmap image = new MonoBitmap(16, 1);
        image.set(0, 0, true);
        image.set(9, 0, true);
        // Точка 0 — старший бит первого байта, точка 9 — второй бит второго.
        assertArrayEquals(new byte[]{(byte) 0x7F, (byte) 0xBF}, image.tsplData());
        assertTrue(image.isBlack(0, 0));
        assertTrue(image.isBlack(9, 0));
        assertFalse(image.isBlack(1, 0));
        image.set(0, 0, false);
        assertEquals((byte) 0xFF, image.tsplData()[0]);
    }

    @Test
    public void testRowTailIsPaddedWithWhite() {
        MonoBitmap image = new MonoBitmap(10, 1);
        assertEquals(2, image.bytesPerRow);
        for (int x = 0; x < 10; x++) image.set(x, 0, true);
        // 10 чёрных точек, остальные 6 бит второго байта — белые (1).
        assertArrayEquals(new byte[]{0x00, (byte) 0x3F}, image.tsplData());
    }

    @Test
    public void testOutOfRangeIsIgnored() {
        MonoBitmap image = new MonoBitmap(8, 1);
        image.set(-1, 0, true);
        image.set(8, 0, true);
        image.set(0, 1, true);
        assertEquals(0, image.blackCount());
        assertFalse(image.isBlack(100, 100));
    }

    @Test
    public void testFromArgbThresholdAndTransparency() {
        int[] pixels = {
                0xFF000000, // чёрный
                0xFFFFFFFF, // белый
                0xFF808080, // серый 128 < 150 → чёрный
                0xFFB4B4B4, // светло-серый 180 → белый
                0x00000000, // прозрачный → белая бумага
                0x80000000, // полупрозрачный чёрный ≈ 127 → чёрный
        };
        MonoBitmap image = MonoBitmap.fromArgb(pixels, 6, 1, 150);
        assertTrue(image.isBlack(0, 0));
        assertFalse(image.isBlack(1, 0));
        assertTrue(image.isBlack(2, 0));
        assertFalse(image.isBlack(3, 0));
        assertFalse(image.isBlack(4, 0));
        assertTrue(image.isBlack(5, 0));
    }

    @Test
    public void testToArgbRoundTrip() {
        MonoBitmap image = new MonoBitmap(3, 1);
        image.set(1, 0, true);
        assertArrayEquals(new int[]{0xFFFFFFFF, 0xFF000000, 0xFFFFFFFF}, image.toArgb());
    }

    @Test(expected = IllegalArgumentException.class)
    public void testEmptyImageIsRejected() {
        new MonoBitmap(0, 10);
    }
}
