package ru.wesetup.helper.net;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import ru.wesetup.helper.bt.PrinterInfo;

public class OutboxTest {

    /** Очередь в памяти вместо SharedPreferences. */
    static final class MemoryStorage implements Outbox.Storage {
        String value;

        @Override
        public String read() {
            return value;
        }

        @Override
        public void write(String value) {
            this.value = value;
        }
    }

    private static PrinterInfo printer(String address) {
        PrinterInfo info = new PrinterInfo(address);
        info.name = "IP-802BT";
        info.model = "AIYIN IP-802BT";
        info.transport = PrinterInfo.TRANSPORT_CLASSIC;
        return info;
    }

    @Test
    public void testEventsMatchServerSchema() throws Exception {
        PrinterInfo p = printer("DC:0D:30:12:34:56");
        JSONObject connected = HelperEvents.printerConnected(p, 1792927800000L);
        UUID.fromString(connected.getString("id"));
        assertEquals("printer_connected", connected.getString("type"));
        assertEquals("2026-10-25T11:30:00.000Z", connected.getString("at"));
        JSONObject details = connected.getJSONObject("printer");
        assertEquals("DC:0D:30:12:34:56", details.getString("address"));
        assertEquals("IP-802BT", details.getString("name"));
        assertEquals("AIYIN IP-802BT", details.getString("model"));
        assertEquals("classic", details.getString("transport"));

        JSONObject printed = HelperEvents.printerPrinted(p, "test-58x40", 3, 1792927800000L);
        assertEquals("printer_printed", printed.getString("type"));
        assertEquals("test-58x40", printed.getString("template"));
        assertEquals(3, printed.getInt("copies"));
        assertEquals("DC:0D:30:12:34:56", printed.getJSONObject("printer").getString("address"));

        JSONObject removed = HelperEvents.printerRemoved(p, 0L);
        assertEquals("printer_removed", removed.getString("type"));
        assertEquals("1970-01-01T00:00:00.000Z", removed.getString("at"));
        // id — как ждёт сервер: латиница, цифры и дефис, 8–64 знака.
        assertTrue(Pattern.matches("[A-Za-z0-9-]{8,64}", removed.getString("id")));
    }

    @Test
    public void testQueueKeepsOrderAndRemovesAccepted() {
        Outbox outbox = new Outbox(new MemoryStorage());
        PrinterInfo p = printer("DC:0D:30:12:34:56");
        JSONObject a = HelperEvents.printerConnected(p, 1);
        JSONObject b = HelperEvents.printerPrinted(p, "product", 1, 2);
        JSONObject c = HelperEvents.printerRemoved(p, 3);
        outbox.add(a);
        outbox.add(b);
        outbox.add(c);
        assertEquals(3, outbox.size());
        List<JSONObject> first = outbox.peek(2);
        assertEquals(a.optString("id"), first.get(0).optString("id"));
        assertEquals(b.optString("id"), first.get(1).optString("id"));
        outbox.remove(Arrays.asList(a.optString("id"), "unknown-id"));
        assertEquals(2, outbox.size());
        assertEquals(b.optString("id"), outbox.peek(10).get(0).optString("id"));
        outbox.remove(Collections.<String>emptyList());
        assertEquals(2, outbox.size());
        outbox.clear();
        assertEquals(0, outbox.size());
    }

    @Test
    public void testOnlyLatestPrintPerPrinterIsKept() {
        Outbox outbox = new Outbox(new MemoryStorage());
        PrinterInfo one = printer("DC:0D:30:12:34:56");
        PrinterInfo two = printer("DC:0D:30:00:00:02");
        outbox.add(HelperEvents.printerConnected(one, 1));
        for (int i = 0; i < 50; i++) outbox.add(HelperEvents.printerPrinted(one, "product", 1, 10 + i));
        outbox.add(HelperEvents.printerPrinted(two, "opened", 2, 100));
        JSONObject last = HelperEvents.printerPrinted(one, "free-text", 1, 200);
        outbox.add(last);
        List<JSONObject> events = outbox.peek(10);
        assertEquals(3, events.size());
        assertEquals("printer_connected", events.get(0).optString("type"));
        assertEquals("opened", events.get(1).optString("template"));
        assertEquals(last.optString("id"), events.get(2).optString("id"));
    }

    @Test
    public void testQueueIsCappedAndSurvivesCorruption() {
        MemoryStorage storage = new MemoryStorage();
        Outbox outbox = new Outbox(storage);
        for (int i = 0; i < Outbox.MAX_EVENTS + 20; i++) {
            outbox.add(HelperEvents.printerConnected(printer(String.format("DC:0D:30:00:%02X:%02X", i / 256, i % 256)), i));
        }
        assertEquals(Outbox.MAX_EVENTS, outbox.size());
        storage.value = "{not json";
        assertEquals(0, outbox.size());
        assertEquals("[]", storage.value);
        storage.value = null;
        assertEquals(0, outbox.size());
    }
}
