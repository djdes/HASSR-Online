package ru.wesetup.helper.bt;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public class PrinterNamesTest {

    @Test
    public void testAiyinIp802IsRecognisedInAllSpellings() {
        for (String name : new String[]{"IP-802BT", "ip802bt", "AiYin IP-802", "IP 802 BT", "IP_802"}) {
            assertEquals(name, 100, PrinterNames.score(name));
            assertEquals(name, "AIYIN IP-802BT", PrinterNames.modelFor(name));
        }
        assertEquals(90, PrinterNames.score("IP-486BT"));
        assertEquals("AIYIN IP-486BT", PrinterNames.modelFor("IP-486BT"));
        assertEquals("AIYIN IP-348", PrinterNames.modelFor("IP-348"));
        assertEquals(90, PrinterNames.score("AIYIN-PRINTER"));
    }

    @Test
    public void testGenericPrintersAndOtherDevices() {
        assertTrue(PrinterNames.isLikelyPrinter("Printer_A1B2"));
        assertTrue(PrinterNames.isLikelyPrinter("XP-P323B"));
        assertTrue(PrinterNames.isLikelyPrinter("BT-58"));
        assertFalse(PrinterNames.isLikelyPrinter("JBL Flip 5"));
        assertFalse(PrinterNames.isLikelyPrinter("Galaxy Buds"));
        assertFalse(PrinterNames.isLikelyPrinter("iPhone"));
        assertEquals(0, PrinterNames.score(null));
        assertEquals(0, PrinterNames.score("  "));
        assertNull(PrinterNames.modelFor("Printer_A1B2"));
        assertNull(PrinterNames.modelFor(null));
    }

    @Test
    public void testSearchOrderPutsPrinterFirst() {
        FoundDevice speaker = new FoundDevice("00:00:00:00:00:01");
        speaker.name = "JBL Flip 5";
        speaker.rssi = -40;
        speaker.bonded = true;
        FoundDevice printer = new FoundDevice("00:00:00:00:00:02");
        printer.name = "IP-802BT";
        printer.rssi = -80;
        FoundDevice unnamed = new FoundDevice("00:00:00:00:00:03");
        unnamed.rssi = -30;
        FoundDevice tv = new FoundDevice("00:00:00:00:00:04");
        tv.name = "[TV] Samsung";
        tv.rssi = -50;
        List<FoundDevice> list = new ArrayList<>(Arrays.asList(unnamed, tv, speaker, printer));
        Collections.sort(list, FoundDevice.ORDER);
        assertEquals(Arrays.asList(printer, speaker, tv, unnamed), list);
    }

    @Test
    public void testSavedPrinterRoundTripsAndNormalizesLabel() throws Exception {
        PrinterInfo info = new PrinterInfo("DC:0D:30:12:34:56");
        info.name = "IP-802BT";
        info.model = "AIYIN IP-802BT";
        info.transport = PrinterInfo.TRANSPORT_CLASSIC;
        info.addedAt = 1L;
        info.lastPrintAt = 2L;
        info.label.gapMm = 3f;
        info.label.rotate180 = true;
        PrinterInfo copy = PrinterInfo.fromJson(new JSONObject(info.toJson().toString()));
        assertEquals(info.address, copy.address);
        assertEquals("IP-802BT", copy.displayName());
        assertEquals("AIYIN IP-802BT", copy.model);
        assertNull(copy.bleService);
        assertEquals(2L, copy.lastPrintAt);
        assertEquals(3f, copy.label.gapMm, 0f);
        assertTrue(copy.label.rotate180);

        JSONObject broken = info.toJson();
        broken.getJSONObject("label").put("widthMm", 300);
        assertEquals(72, PrinterInfo.fromJson(broken).label.widthMm);

        PrinterInfo unnamed = new PrinterInfo("AA:BB:CC:DD:EE:FF");
        assertEquals("AA:BB:CC:DD:EE:FF", unnamed.displayName());
    }
}
