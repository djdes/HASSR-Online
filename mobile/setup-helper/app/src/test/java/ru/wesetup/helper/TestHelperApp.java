package ru.wesetup.helper;

import ru.wesetup.helper.auth.SessionStore;
import ru.wesetup.helper.auth.TokenCipher;
import ru.wesetup.helper.update.FakeUpdateSource;
import ru.wesetup.helper.update.UpdateSource;

/**
 * Приложение для Robolectric: Android Keystore там нет, шифрование —
 * заглушка; обновления — подделка сайта, в сеть тесты не ходят.
 */
public class TestHelperApp extends HelperApp {

    public final FakeUpdateSource updates = new FakeUpdateSource();

    @Override
    protected UpdateSource createUpdateSource() {
        return updates;
    }

    @Override
    protected boolean siteDataRefreshEnabled() {
        return false;
    }

    @Override
    protected SessionStore createSessionStore() {
        return new SessionStore(this, new TokenCipher() {
            @Override
            public String encrypt(String plain) {
                return "test:" + plain;
            }

            @Override
            public String decrypt(String stored) {
                return stored.substring("test:".length());
            }
        });
    }
}
