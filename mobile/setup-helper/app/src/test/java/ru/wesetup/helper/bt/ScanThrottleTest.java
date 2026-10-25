package ru.wesetup.helper.bt;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ScanThrottleTest {

    @Test
    public void testBleScanStartsStayBelowAndroidLimit() {
        ScanThrottle throttle = new ScanThrottle();
        assertTrue(throttle.tryStart(0));
        assertFalse("чаще раза в 6 секунд нельзя", throttle.tryStart(1_000));
        assertTrue(throttle.tryStart(6_000));
        assertTrue(throttle.tryStart(12_000));
        assertTrue(throttle.tryStart(18_000));
        assertFalse("пятый запуск за 30 секунд — уже под ограничением Android", throttle.tryStart(24_000));
        // Первый запуск выпал из окна — снова можно.
        assertTrue(throttle.tryStart(30_000));
    }

    @Test
    public void testRefusedAttemptsDoNotCount() {
        ScanThrottle throttle = new ScanThrottle();
        assertTrue(throttle.tryStart(0));
        for (int t = 500; t < 6_000; t += 500) assertFalse(throttle.tryStart(t));
        assertTrue("отказы не съедают лимит", throttle.tryStart(6_000));
    }
}
