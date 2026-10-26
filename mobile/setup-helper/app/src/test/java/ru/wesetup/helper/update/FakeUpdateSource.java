package ru.wesetup.helper.update;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/** Сайт для тестов: в сеть не ходит, отдаёт то, что задали. */
public final class FakeUpdateSource implements UpdateSource {

    /** null — «сайт не ответил». */
    public volatile UpdateInfo info;
    public volatile byte[] apk = new byte[0];
    public volatile int fetches;
    public volatile int downloads;

    @Override
    public UpdateInfo fetchUpdate(String server) throws IOException {
        fetches++;
        if (info == null) throw new IOException("сайт недоступен в тестах");
        return info;
    }

    @Override
    public void downloadUpdate(String server, UpdateInfo info, File target) throws IOException {
        downloads++;
        try (FileOutputStream out = new FileOutputStream(target)) {
            out.write(apk);
        }
    }
}
