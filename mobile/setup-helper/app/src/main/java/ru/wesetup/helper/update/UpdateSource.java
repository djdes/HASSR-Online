package ru.wesetup.helper.update;

import java.io.File;
import java.io.IOException;

/** Откуда берутся обновления: сайт ({@code ApiClient}), в тестах — подделка. */
public interface UpdateSource {

    /** {@code GET /api/setup-helper/version}. */
    UpdateInfo fetchUpdate(String server) throws IOException;

    /** {@code GET /api/setup-helper/download} в {@code target}; не больше {@code info.size} байт. */
    void downloadUpdate(String server, UpdateInfo info, File target) throws IOException;
}
