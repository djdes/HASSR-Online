package ru.wesetup.helper.auth;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.Key;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Шифрование ключа входа ключом из Android Keystore (AES-256-GCM).
 *
 * <p>Сам ключ шифрования живёт в защищённом хранилище телефона и наружу не
 * выдаётся: даже если вытащить файлы приложения, ключ входа из них не
 * прочитать, а на другом телефоне они бесполезны.
 */
final class KeystoreCipher implements TokenCipher {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS = "setup_helper_session_v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int TAG_BITS = 128;

    @Override
    public String encrypt(String plain) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":"
                + Base64.encodeToString(encrypted, Base64.NO_WRAP);
    }

    @Override
    public String decrypt(String stored) throws GeneralSecurityException {
        int split = stored.indexOf(':');
        if (split <= 0) throw new GeneralSecurityException("Повреждённые данные входа");
        byte[] iv = Base64.decode(stored.substring(0, split), Base64.NO_WRAP);
        byte[] encrypted = Base64.decode(stored.substring(split + 1), Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    private SecretKey key() throws GeneralSecurityException {
        try {
            KeyStore store = KeyStore.getInstance(KEYSTORE);
            store.load(null);
            Key existing = store.getKey(ALIAS, null);
            if (existing instanceof SecretKey) return (SecretKey) existing;
        } catch (java.io.IOException e) {
            throw new GeneralSecurityException(e);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }
}
