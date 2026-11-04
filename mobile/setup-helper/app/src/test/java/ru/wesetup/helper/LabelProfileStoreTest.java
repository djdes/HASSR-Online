package ru.wesetup.helper;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import ru.wesetup.helper.bt.PrinterInfo;
import ru.wesetup.helper.template.TemplateValues;

/** Локальная подпись этикеток: хранится на телефоне без входа и интернета. */
@RunWith(RobolectricTestRunner.class)
@Config(application = TestHelperApp.class, sdk = 36)
public class LabelProfileStoreTest {

    private HelperApp app;

    @Before
    public void setUp() {
        app = (HelperApp) RuntimeEnvironment.getApplication();
    }

    @Test
    public void testDefaultsFillLabelHeaderWithoutAccount() {
        LabelProfileStore store = new LabelProfileStore(app);
        assertFalse(store.hasCustomProfile());
        assertEquals("", store.orgName());
        assertEquals("", store.site());
        assertEquals("", store.userName());
        assertEquals("WeSetup", store.orgNameForLabel());
        assertEquals("wesetup.ru", store.siteForLabel());

        PrinterInfo printer = new PrinterInfo("DC:0D:30:12:34:56");
        TemplateValues values = PrintJobs.baseValues(app, printer, 1792927800000L);
        assertEquals("WeSetup", values.text("org.name"));
        assertEquals("wesetup.ru", values.text("org.site"));
        assertEquals("", values.text("user.name"));
    }

    @Test
    public void testCustomSignaturePersistsAndNormalizesSite() {
        LabelProfileStore store = app.labelProfile();
        store.save("  Кафе «Ромашка»  ", " https://romashka.cafe/ ", "  Анна Смирнова ");

        LabelProfileStore reloaded = new LabelProfileStore(app);
        assertTrue(reloaded.hasCustomProfile());
        assertEquals("Кафе «Ромашка»", reloaded.orgName());
        assertEquals("romashka.cafe", reloaded.site());
        assertEquals("Анна Смирнова", reloaded.userName());
        assertEquals("Кафе «Ромашка»", reloaded.orgNameForLabel());
        assertEquals("romashka.cafe", reloaded.siteForLabel());

        PrinterInfo printer = new PrinterInfo("DC:0D:30:12:34:56");
        TemplateValues values = PrintJobs.baseValues(app, printer, 1792927800000L);
        assertEquals("Кафе «Ромашка»", values.text("org.name"));
        assertEquals("romashka.cafe", values.text("org.site"));
        assertEquals("Анна Смирнова", values.text("user.name"));
    }
}
