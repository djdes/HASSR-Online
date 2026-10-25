package ru.wesetup.helper.auth;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class SessionStoreTest {

    @Test
    public void testServerAddressIsNormalisedAndHttpsOnly() {
        assertEquals("https://wesetup.ru", SessionStore.normalizeServer("wesetup.ru"));
        assertEquals("https://wesetup.ru", SessionStore.normalizeServer(" https://wesetup.ru/ "));
        assertEquals("https://staging.wesetup.ru:8443", SessionStore.normalizeServer("https://staging.wesetup.ru:8443//"));
        assertEquals("http://10.0.2.2:3000", SessionStore.normalizeServer("http://10.0.2.2:3000"));
        assertNull(SessionStore.normalizeServer("http://wesetup.ru"));
        assertNull(SessionStore.normalizeServer("ftp://wesetup.ru"));
        assertNull(SessionStore.normalizeServer("   "));
        assertNull(SessionStore.normalizeServer(null));
    }
}
