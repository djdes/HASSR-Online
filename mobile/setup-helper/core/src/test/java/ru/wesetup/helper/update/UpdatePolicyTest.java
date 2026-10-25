package ru.wesetup.helper.update;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

public class UpdatePolicyTest {

    private static final long HOUR = 60 * 60_000L;

    @Test
    public void testOnlyANewerBuildIsAnUpdate() {
        UpdateInfo info = new UpdateInfo(2, "1.1.0", "a", 1, "");
        assertTrue(UpdatePolicy.isNewer(info, 1));
        assertFalse(UpdatePolicy.isNewer(info, 2));
        assertFalse("старую версию поверх новой не ставим", UpdatePolicy.isNewer(info, 3));
        assertFalse(UpdatePolicy.isNewer(null, 1));
    }

    @Test
    public void testFailuresBackOffWithoutEndlessLoop() {
        assertEquals(0, UpdatePolicy.backoffMs(0));
        assertEquals(HOUR, UpdatePolicy.backoffMs(1));
        assertEquals(4 * HOUR, UpdatePolicy.backoffMs(2));
        assertEquals(12 * HOUR, UpdatePolicy.backoffMs(3));
        assertEquals(24 * HOUR, UpdatePolicy.backoffMs(4));
        assertEquals(24 * HOUR, UpdatePolicy.backoffMs(40));
    }

    @Test
    public void testCheckIsThrottledButForceAndClockChangesWin() {
        long now = 100 * HOUR;
        assertTrue("ни разу не проверяли", UpdatePolicy.shouldCheck(now, 0, 0, false));
        assertFalse("проверяли 10 минут назад", UpdatePolicy.shouldCheck(now, now - 10 * 60_000L, 0, false));
        assertTrue(UpdatePolicy.shouldCheck(now, now - 31 * 60_000L, 0, false));
        assertFalse("пауза после неудачи", UpdatePolicy.shouldCheck(now, now - 2 * HOUR, now + HOUR, false));
        assertTrue("«Проверить обновления» паузу не ждёт", UpdatePolicy.shouldCheck(now, now - 60_000L, now + HOUR, true));
        assertTrue("часы перевели назад", UpdatePolicy.shouldCheck(now, now + 5 * HOUR, 0, false));
    }

    @Test
    public void testFileIsVerifiedBySizeAndSha256() throws IOException {
        File file = File.createTempFile("update", ".apk");
        file.deleteOnExit();
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write("abc".getBytes(StandardCharsets.US_ASCII));
        }
        String sha = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assertEquals(sha, UpdatePolicy.sha256(file));
        assertTrue(UpdatePolicy.matches(file, new UpdateInfo(2, "1.1.0", sha, 3, "")));
        assertFalse("размер другой", UpdatePolicy.matches(file, new UpdateInfo(2, "1.1.0", sha, 4, "")));
        assertFalse("хеш другой", UpdatePolicy.matches(file, new UpdateInfo(2, "1.1.0", sha.replace('b', 'c'), 3, "")));
        assertFalse(UpdatePolicy.matches(new File(file.getPath() + ".missing"), new UpdateInfo(2, "1.1.0", sha, 3, "")));
    }
}
