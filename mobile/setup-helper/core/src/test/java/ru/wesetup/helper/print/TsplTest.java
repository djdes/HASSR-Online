package ru.wesetup.helper.print;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;

public class TsplTest {

    private static String ascii(byte[] bytes, int from, int to) {
        return new String(Arrays.copyOfRange(bytes, from, to), StandardCharsets.US_ASCII);
    }

    private static int indexOf(byte[] haystack, String needle) {
        byte[] n = needle.getBytes(StandardCharsets.US_ASCII);
        outer:
        for (int i = 0; i <= haystack.length - n.length; i++) {
            for (int j = 0; j < n.length; j++) if (haystack[i + j] != n[j]) continue outer;
            return i;
        }
        return -1;
    }

    @Test
    public void testLabelJobIsExactTspl2ForIp802bt() {
        LabelSettings settings = new LabelSettings(); // 58×40, зазор 2, плотность 8, скорость 3
        MonoBitmap image = new MonoBitmap(settings.widthDots(), settings.heightDots());
        image.set(0, 0, true);

        byte[] job = Tspl.labelJob(settings, image, 2);

        String header = "SIZE 58 mm,40 mm\r\n"
                + "GAP 2 mm,0 mm\r\n"
                + "DIRECTION 1\r\n"
                + "REFERENCE 0,0\r\n"
                + "DENSITY 8\r\n"
                + "SPEED 3\r\n"
                + "CLS\r\n"
                + "BITMAP 0,0,58,320,0,";
        assertEquals(header, ascii(job, 0, header.length()));
        // 58 мм × 8 точек = 464 точки = 58 байт в строке, 40 мм = 320 строк.
        int dataStart = header.length();
        int dataLength = 58 * 320;
        assertEquals((byte) 0x7F, job[dataStart]); // левая верхняя точка чёрная → старший бит 0
        assertEquals((byte) 0xFF, job[dataStart + 1]);
        String tail = "\r\nPRINT 2,1\r\n";
        assertEquals(tail, ascii(job, dataStart + dataLength, job.length));
        assertEquals(dataStart + dataLength + tail.length(), job.length);
    }

    @Test
    public void testNumbersDoNotDependOnPhoneLocale() {
        Locale previous = Locale.getDefault();
        try {
            Locale.setDefault(Locale.forLanguageTag("ru-RU"));
            LabelSettings settings = new LabelSettings();
            settings.gapMm = 2.5f;
            byte[] job = Tspl.labelJob(settings, new MonoBitmap(464, 320), 1);
            assertTrue(indexOf(job, "GAP 2.5 mm,0 mm\r\n") > 0);
            assertEquals(-1, indexOf(job, "2,5"));
        } finally {
            Locale.setDefault(previous);
        }
    }

    @Test
    public void testRotationAndCopiesAreClamped() {
        LabelSettings settings = new LabelSettings();
        settings.rotate180 = true;
        settings.density = 40;
        settings.speed = 9;
        byte[] job = Tspl.labelJob(settings, new MonoBitmap(464, 320), 500);
        assertTrue(indexOf(job, "DIRECTION 0\r\n") > 0);
        assertTrue(indexOf(job, "DENSITY 15\r\n") > 0);
        assertTrue(indexOf(job, "SPEED 4\r\n") > 0);
        assertTrue(indexOf(job, "PRINT 99,1\r\n") > 0);
        assertTrue(indexOf(Tspl.labelJob(new LabelSettings(), new MonoBitmap(464, 320), 0), "PRINT 1,1\r\n") > 0);
    }

    @Test(expected = IllegalArgumentException.class)
    public void testImageWiderThanPrintableAreaIsRejected() {
        Tspl.labelJob(new LabelSettings(), new MonoBitmap(72 * 8 + 1, 10), 1);
    }

    @Test
    public void testServiceCommands() {
        assertEquals("SIZE 58 mm,40 mm\r\nGAP 2 mm,0 mm\r\nAUTODETECT\r\n",
                new String(Tspl.calibrate(new LabelSettings()), StandardCharsets.US_ASCII));
        assertEquals("SELFTEST\r\n", new String(Tspl.selfTest(), StandardCharsets.US_ASCII));
        assertArrayEquals(new byte[]{0x1B, '!', '?'}, Tspl.STATUS_QUERY);
    }

    @Test
    public void testStatusByteExplainsProblems() {
        assertNull(Tspl.statusProblem(-1));
        assertNull(Tspl.statusProblem(0));
        assertNull(Tspl.statusProblem(Tspl.STATUS_PRINTING));
        assertTrue(Tspl.statusProblem(Tspl.STATUS_OUT_OF_PAPER).contains("закончились этикетки"));
        assertTrue(Tspl.statusProblem(Tspl.STATUS_HEAD_OPEN).contains("крышка"));
        assertTrue(Tspl.statusProblem(Tspl.STATUS_COVER_OPEN).contains("крышка"));
        assertTrue(Tspl.statusProblem(Tspl.STATUS_PAPER_JAM).contains("Замялась"));
        assertTrue(Tspl.statusProblem(Tspl.STATUS_PAUSE).contains("паузе"));
    }

    @Test
    public void testMmFormatting() {
        assertEquals("2", Tspl.mm(2f));
        assertEquals("2.5", Tspl.mm(2.5f));
        assertEquals("0", Tspl.mm(0f));
        assertEquals("1.3", Tspl.mm(1.25f + 0.01f));
    }
}
