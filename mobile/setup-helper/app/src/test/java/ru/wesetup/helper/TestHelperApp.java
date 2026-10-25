package ru.wesetup.helper;

import ru.wesetup.helper.auth.SessionStore;
import ru.wesetup.helper.auth.TokenCipher;

/** Приложение для Robolectric: Android Keystore там нет, шифрование — заглушка. */
public class TestHelperApp extends HelperApp {

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
