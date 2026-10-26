package ru.wesetup.helper.update;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

public class UpdateInfoTest {

    private static final String SHA = "9debdb0566bde027be776b0e91f213afa649317832cec933859aff156fc53dd1";

    @Test
    public void testSiteAnswerIsParsedAndRoundTrips() {
        String json = "{\"versionCode\":2,\"versionName\":\"1.1.0\",\"sha256\":\"" + SHA.toUpperCase() + "\","
                + "\"size\":1945901,\"publishedAt\":\"2026-10-25\",\"notes\":\"Шаблоны для производства\","
                + "\"downloadUrl\":\"https://wesetup.ru/api/setup-helper/download?v=2\"}";
        UpdateInfo info = UpdateInfo.parse(json);
        assertEquals(2, info.versionCode);
        assertEquals("1.1.0", info.versionName);
        assertEquals("контрольная сумма — в нижнем регистре", SHA, info.sha256);
        assertEquals(1945901L, info.size);
        assertEquals("Шаблоны для производства", info.notes);

        UpdateInfo copy = UpdateInfo.parse(info.toJson());
        assertEquals(info.versionCode, copy.versionCode);
        assertEquals(info.sha256, copy.sha256);
        assertEquals(info.notes, copy.notes);
        assertEquals("", UpdateInfo.parse("{\"versionCode\":3,\"versionName\":\"1.2\",\"sha256\":\"" + SHA
                + "\",\"size\":10}").notes);
    }

    @Test
    public void testNonsenseIsRejectedWithReason() {
        String ok = "\"versionName\":\"1.1.0\",\"sha256\":\"" + SHA + "\",\"size\":100";
        expectError("<html>nginx</html>", "не разобран");
        expectError("{\"versionCode\":0," + ok + "}", "больше нуля");
        expectError("{\"versionCode\":2,\"versionName\":\"1.1 <b>\",\"sha256\":\"" + SHA + "\",\"size\":100}", "имя версии");
        expectError("{\"versionCode\":2,\"versionName\":\"1.1.0\",\"sha256\":\"abc\",\"size\":100}", "контрольная сумма");
        expectError("{\"versionCode\":2,\"versionName\":\"1.1.0\",\"sha256\":\"" + SHA + "\",\"size\":0}", "размер");
        expectError("{\"versionCode\":2,\"versionName\":\"1.1.0\",\"sha256\":\"" + SHA + "\",\"size\":" + (UpdateInfo.MAX_SIZE + 1) + "}", "размер");
    }

    private static void expectError(String json, String fragment) {
        try {
            UpdateInfo.parse(json);
            fail("Ответ должен быть отклонён: " + json);
        } catch (IllegalArgumentException e) {
            assertTrue(e.getMessage() + " ≠ " + fragment, e.getMessage().contains(fragment));
        }
    }
}
