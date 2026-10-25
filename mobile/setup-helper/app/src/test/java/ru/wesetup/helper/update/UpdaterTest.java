package ru.wesetup.helper.update;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.app.Application;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.NetworkCapabilities;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.io.File;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;

import ru.wesetup.helper.TestHelperApp;

/**
 * Автообновление: без сети — ни одного запроса; новее — скачать и сверить;
 * поставить само только когда можно (Android 12+, приложение свёрнуто, не
 * печатает), иначе — попросить; неудачи — с паузой, без бесконечного цикла.
 */
@RunWith(RobolectricTestRunner.class)
@Config(application = TestHelperApp.class, sdk = 36)
public class UpdaterTest {

    private static final long NOW = 1792927800000L;
    private static final byte[] APK = "PK\u0003\u0004 fake apk for tests".getBytes(StandardCharsets.ISO_8859_1);

    /** Телефон для теста: всё задаётся полями. */
    static final class FakeEnv implements Updater.Env {
        boolean online = true;
        boolean visible;
        boolean busy;
        long now = NOW;
        int installed = 1;
        int sdk = 36;
        boolean canInstall = true;

        public boolean online() { return online; }
        public boolean appVisible() { return visible; }
        public boolean printerBusy() { return busy; }
        public String server() { return "https://wesetup.ru"; }
        public long now() { return now; }
        public int installedVersionCode() { return installed; }
        public int sdk() { return sdk; }
        public boolean canInstallPackages() { return canInstall; }
    }

    static final class FakeInstaller implements Updater.Installer {
        final List<Boolean> silent = new ArrayList<>();
        File last;

        @Override
        public void install(File apk, UpdateInfo info, boolean silentInstall) {
            last = apk;
            silent.add(silentInstall);
        }
    }

    private Application app;
    private FakeEnv env;
    private FakeUpdateSource site;
    private FakeInstaller installer;
    private UpdateStore store;
    private Updater updater;
    private File dir;

    @Before
    public void setUp() throws Exception {
        app = RuntimeEnvironment.getApplication();
        env = new FakeEnv();
        site = new FakeUpdateSource();
        installer = new FakeInstaller();
        app.getSharedPreferences("updates-test", 0).edit().clear().commit();
        store = new UpdateStore(app, "updates-test");
        dir = new File(app.getFilesDir(), "updates-test");
        updater = new Updater(app, store, site, installer, env, dir);
        site.info = release(2, APK);
        site.apk = APK;
    }

    private static UpdateInfo release(int code, byte[] apk) throws Exception {
        StringBuilder hex = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(apk)) hex.append(String.format("%02x", b & 0xFF));
        return new UpdateInfo(code, "1." + (code - 1) + ".0", hex.toString(), apk.length, "Шаблоны для производства");
    }

    @Test
    public void testOfflineMakesNoRequestAndWaits() {
        env.online = false;
        assertEquals(Updater.CheckResult.OFFLINE, updater.check(true));
        assertEquals(0, site.fetches);
        assertEquals(0L, store.lastCheckAt());
        assertEquals(Updater.State.NONE, updater.state());
    }

    @Test
    public void testNewerBuildIsDownloadedVerifiedAndThrottled() throws Exception {
        assertEquals(Updater.CheckResult.READY, updater.check(false));
        assertEquals(1, site.fetches);
        assertEquals(1, site.downloads);
        assertEquals(2, store.readyCode());
        File apk = new File(store.readyPath());
        assertTrue(UpdatePolicy.matches(apk, site.info));
        assertFalse("недокачанный файл убран", new File(dir, apk.getName() + ".part").exists());
        assertEquals(Updater.State.READY_AUTO, updater.state());

        // Открыли приложение через 10 минут — сайт не дёргаем.
        env.now += 10 * 60_000L;
        assertEquals(Updater.CheckResult.NOT_DUE, updater.check(false));
        assertEquals(1, site.fetches);
        // «Проверить обновления» спрашивает сайт, но уже скачанное не качает снова.
        assertEquals(Updater.CheckResult.READY, updater.check(true));
        assertEquals(2, site.fetches);
        assertEquals(1, site.downloads);
    }

    @Test
    public void testCorruptDownloadIsDroppedAndRetriedLater() throws Exception {
        site.apk = "PK broken".getBytes(StandardCharsets.ISO_8859_1);
        site.info = release(2, "PK broken!".getBytes(StandardCharsets.ISO_8859_1)); // хеш и размер от другого файла
        assertEquals(Updater.CheckResult.FAILED, updater.check(false));
        assertEquals(0, store.readyCode());
        assertEquals(1, store.failures());
        assertEquals(NOW + 60 * 60_000L, store.retryAfter());
        assertNotNull(store.lastError());
        File[] files = dir.listFiles();
        assertTrue("битый файл удалён", files == null || files.length == 0);
        assertEquals(Updater.State.FAILED, updater.state());

        // Через полчаса — ещё пауза; через час — снова.
        env.now += 31 * 60_000L;
        assertEquals(Updater.CheckResult.NOT_DUE, updater.check(false));
        env.now = NOW + 61 * 60_000L;
        site.apk = APK;
        site.info = release(2, APK);
        assertEquals(Updater.CheckResult.READY, updater.check(false));
        assertEquals(0, store.failures());
        assertNull(store.lastError());
    }

    @Test
    public void testSameOrOlderBuildIsNotAnUpdate() throws Exception {
        env.installed = 2;
        assertEquals(Updater.CheckResult.UP_TO_DATE, updater.check(false));
        assertEquals(0, site.downloads);
        assertEquals(Updater.State.NONE, updater.state());
        assertNull(store.available());
    }

    @Test
    public void testSilentInstallOnlyWhenAppIsAwayAndIdle() {
        updater.check(false);
        env.visible = true;
        assertFalse("приложение на экране — не закрываем его посреди работы", updater.install(false));
        env.visible = false;
        env.busy = true;
        assertFalse("идёт печать — ждём", updater.install(false));
        env.busy = false;
        assertTrue(updater.install(false));
        assertEquals(1, installer.silent.size());
        assertTrue("Android 12+: без вопроса", installer.silent.get(0));
        assertEquals(Updater.State.INSTALLING, updater.state());
        assertFalse("уже ставится — второй раз не запускаем", updater.install(false));
    }

    @Test
    public void testFailedInstallIsRetriedAfterPauseOrByButton() {
        updater.check(false);
        assertTrue(updater.install(false));
        updater.onInstallStatus(new Intent()
                .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE_STORAGE)
                .putExtra(PackageInstaller.EXTRA_STATUS_MESSAGE, "мало места"));
        assertEquals(Updater.State.FAILED, updater.state());
        assertTrue(updater.isDownloaded());
        assertTrue(store.lastError().contains("мало места"));
        // Свернули приложение сразу после ошибки — сами не повторяем (иначе цикл).
        assertFalse(updater.install(false));
        assertEquals(1, installer.silent.size());
        // Через час — пробуем снова сами.
        env.now += 61 * 60_000L;
        assertTrue(updater.install(false));
        assertEquals(2, installer.silent.size());
        // Опять не вышло: сами — только через 4 часа, по кнопке «Повторить» — сразу.
        updater.onInstallStatus(new Intent()
                .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE_STORAGE));
        assertEquals(2, store.failures());
        assertFalse(updater.install(false));
        assertTrue(updater.install(true));
        assertEquals(3, installer.silent.size());
    }

    @Test
    public void testOlderAndroidAsksAndPermissionIsRequested() {
        env.sdk = 30; // Android 11: без вопроса нельзя
        updater.check(false);
        assertFalse(updater.install(false));
        assertTrue(installer.silent.isEmpty());
        assertEquals(Updater.State.NEEDS_CONFIRMATION, updater.state());
        assertTrue("по кнопке «Установить»", updater.install(true));
        assertFalse(installer.silent.get(0));

        // Android 13, «Установка неизвестных приложений» не разрешена — просим разрешение.
        app.getSharedPreferences("updates-test-2", 0).edit().clear().commit();
        FakeEnv android13 = new FakeEnv();
        android13.sdk = 33;
        android13.canInstall = false;
        Updater other = new Updater(app, new UpdateStore(app, "updates-test-2"), site, installer, android13,
                new File(app.getFilesDir(), "updates-test-2"));
        other.check(true);
        assertEquals(Updater.State.NEEDS_PERMISSION, other.state());
        assertFalse(other.install(false));
        assertEquals("без разрешения не ставим", 1, installer.silent.size());
    }

    @Test
    public void testRejectedBuildIsNotDownloadedAgain() throws Exception {
        updater.check(false);
        updater.install(false);
        Intent conflict = new Intent()
                .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE_CONFLICT)
                .putExtra(PackageInstaller.EXTRA_STATUS_MESSAGE, "INSTALL_FAILED_UPDATE_INCOMPATIBLE")
                .putExtra(SessionInstaller.EXTRA_VERSION_CODE, 2);
        updater.onInstallStatus(conflict);
        assertEquals(2, store.rejectedCode());
        assertEquals(0, store.readyCode());
        assertTrue(store.lastError().contains("INSTALL_FAILED_UPDATE_INCOMPATIBLE"));

        env.now = NOW + 2 * 60 * 60_000L;
        assertEquals(Updater.CheckResult.UP_TO_DATE, updater.check(false));
        assertEquals("ту же сборку не качаем", 1, site.downloads);
        site.info = release(3, APK);
        env.now += 60 * 60_000L;
        assertEquals("следующую — качаем", Updater.CheckResult.READY, updater.check(false));
        assertEquals(3, store.readyCode());
    }

    @Test
    public void testConfirmationWaitsForTheUserWhenAppIsHidden() {
        updater.check(false);
        env.sdk = 30;
        updater.install(true);
        env.visible = false;
        updater.onInstallStatus(new Intent()
                .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_PENDING_USER_ACTION)
                .putExtra(Intent.EXTRA_INTENT, new Intent("android.content.pm.action.CONFIRM_INSTALL")));
        assertEquals(Updater.State.NEEDS_CONFIRMATION, updater.state());
        // Человек нажал «Отмена» — не навязываемся, остаётся кнопка.
        updater.onInstallStatus(new Intent().putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE_ABORTED));
        assertEquals(Updater.State.NEEDS_CONFIRMATION, updater.state());
        assertEquals(0, store.failures());
    }

    @Test
    public void testUpdatedMessageIsShownOnceAfterUpdate() {
        store.setLastRunCode(1);
        env.installed = 2;
        updater.onAppStarted();
        assertTrue(updater.takeJustUpdated());
        assertFalse(updater.takeJustUpdated());
        updater.onAppStarted();
        assertFalse("второй запуск той же версии — без сообщения", updater.takeJustUpdated());
    }

    @Test
    public void testSessionAllowsSilentSelfUpdateFromAndroid12() throws Exception {
        PackageInstaller.SessionParams silent = SessionInstaller.params("ru.wesetup.helper", 1234, true);
        PackageInstaller.SessionParams asked = SessionInstaller.params("ru.wesetup.helper", 1234, false);
        assertEquals(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED, field(silent, "requireUserAction"));
        assertEquals(PackageInstaller.SessionParams.USER_ACTION_UNSPECIFIED, field(asked, "requireUserAction"));
        assertEquals("ru.wesetup.helper", field(silent, "appPackageName"));
        assertEquals(1234L, field(silent, "sizeBytes"));
    }

    @Test
    public void testBackgroundCheckIsScheduledWithNetworkAndSurvivesReboot() {
        JobScheduler scheduler = app.getSystemService(JobScheduler.class);
        JobInfo job = null;
        for (JobInfo pending : scheduler.getAllPendingJobs()) {
            if (pending.getId() == UpdateJobService.JOB_ID) job = pending;
        }
        assertNotNull("задание ставится при запуске приложения", job);
        assertNotNull("нужна сеть", job.getRequiredNetwork());
        assertTrue(job.getRequiredNetwork().hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET));
        assertTrue(job.isPersisted());
        assertTrue(job.isPeriodic());
        assertEquals(6 * 60 * 60_000L, job.getIntervalMillis());
        // Повторный вызов не плодит задания.
        UpdateJobService.schedule(app);
        int count = 0;
        for (JobInfo pending : scheduler.getAllPendingJobs()) if (pending.getId() == UpdateJobService.JOB_ID) count++;
        assertEquals(1, count);
        assertNotNull(shadowOf(scheduler));
    }

    private static Object field(Object target, String name) throws Exception {
        Field field = target.getClass().getField(name);
        return field.get(target);
    }
}
