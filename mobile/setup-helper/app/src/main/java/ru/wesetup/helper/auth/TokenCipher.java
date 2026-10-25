package ru.wesetup.helper.auth;

import java.security.GeneralSecurityException;

/** Шифрование ключа входа на телефоне. На устройстве — {@link KeystoreCipher}. */
public interface TokenCipher {

    String encrypt(String plain) throws GeneralSecurityException;

    String decrypt(String stored) throws GeneralSecurityException;
}
