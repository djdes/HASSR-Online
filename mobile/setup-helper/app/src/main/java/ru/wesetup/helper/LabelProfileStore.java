package ru.wesetup.helper;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Locale;

/**
 * Локальная подпись для шапки и полей этикеток: название заведения, сайт/подпись
 * справа в шапке и ответственный по умолчанию. Хранится только на устройстве в
 * {@link SharedPreferences}, без учётной записи и передачи по сети.
 */
public final class LabelProfileStore {

    public static final String PREFS = "label_profile";
    public static final String DEFAULT_ORG = "WeSetup";
    public static final String DEFAULT_SITE = "wesetup.ru";

    private static final String KEY_ORG = "org_name";
    private static final String KEY_SITE = "site";
    private static final String KEY_USER = "user_name";

    private final SharedPreferences prefs;

    public LabelProfileStore(Context context) {
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public String orgName() {
        return clean(prefs.getString(KEY_ORG, ""));
    }

    public String site() {
        return normalizeSite(prefs.getString(KEY_SITE, ""));
    }

    public String userName() {
        return clean(prefs.getString(KEY_USER, ""));
    }

    /** Текст для левого угла шапки этикетки ({@code {{org.name}}}). */
    public String orgNameForLabel() {
        String value = orgName();
        return value.isEmpty() ? DEFAULT_ORG : value;
    }

    /** Текст для правого угла шапки этикетки ({@code {{org.site}}}). */
    public String siteForLabel() {
        String value = site();
        return value.isEmpty() ? DEFAULT_SITE : value;
    }

    public boolean hasCustomProfile() {
        return !orgName().isEmpty() || !site().isEmpty() || !userName().isEmpty();
    }

    public void save(String orgName, String site, String userName) {
        prefs.edit()
                .putString(KEY_ORG, clean(orgName))
                .putString(KEY_SITE, normalizeSite(site))
                .putString(KEY_USER, clean(userName))
                .apply();
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }

    private static String normalizeSite(String raw) {
        String s = clean(raw);
        String lower = s.toLowerCase(Locale.ROOT);
        if (lower.startsWith("https://")) {
            s = s.substring("https://".length());
        } else if (lower.startsWith("http://")) {
            s = s.substring("http://".length());
        }
        while (s.endsWith("/")) {
            s = s.substring(0, s.length() - 1);
        }
        return s.trim();
    }
}
