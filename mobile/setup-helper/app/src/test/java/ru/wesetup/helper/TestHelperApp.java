package ru.wesetup.helper;

import ru.wesetup.helper.update.FakeUpdateSource;
import ru.wesetup.helper.update.UpdateSource;

/**
 * Приложение для Robolectric: обновления — подделка сайта, в сеть тесты не ходят.
 */
public class TestHelperApp extends HelperApp {

    public final FakeUpdateSource updates = new FakeUpdateSource();

    @Override
    protected UpdateSource createUpdateSource() {
        return updates;
    }
}
