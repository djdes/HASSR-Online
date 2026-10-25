package ru.wesetup.helper.bt;

import java.util.ArrayDeque;

/**
 * Сколько раз можно запустить BLE-поиск.
 *
 * <p>Android 7+ молча — без {@code onScanFailed} — перестаёт отдавать
 * результаты приложению, которое запускало BLE-поиск больше 5 раз за 30
 * секунд. Каждый показ экрана поиска и «Искать снова» раньше перезапускали
 * BLE, и принтер с одним только BLE мог «пропасть». Держимся с запасом: не
 * чаще раза в 6 секунд и не больше 4 запусков за 30 секунд.
 */
final class ScanThrottle {

    static final long MIN_GAP_MS = 6_000;
    static final long WINDOW_MS = 30_000;
    static final int MAX_IN_WINDOW = 4;

    private final ArrayDeque<Long> starts = new ArrayDeque<>();

    /** true — запускать можно (запуск записан), false — пропустить этот раз. */
    synchronized boolean tryStart(long nowMs) {
        while (!starts.isEmpty() && nowMs - starts.peekFirst() >= WINDOW_MS) starts.pollFirst();
        if (!starts.isEmpty() && nowMs - starts.peekLast() < MIN_GAP_MS) return false;
        if (starts.size() >= MAX_IN_WINDOW) return false;
        starts.addLast(nowMs);
        return true;
    }
}
