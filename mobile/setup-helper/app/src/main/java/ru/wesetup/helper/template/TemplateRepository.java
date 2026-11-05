package ru.wesetup.helper.template;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Макеты этикеток: встроенные из {@code assets/templates} (порядок — по имени
 * файла: «10-…», «20-…») и изменённые на телефоне.
 *
 * <p>Изменённый встроенный макет и свои макеты лежат JSON-файлами того же
 * формата во внутренней папке приложения {@code files/layouts}: без сети,
 * аккаунта и разрешений. Файл с {@code id} встроенного подменяет его, «Вернуть
 * как было» этот файл удаляет. Свои макеты ({@code my-…}) идут после встроенных.
 */
public final class TemplateRepository {

    private static final String TAG = "SetupHelper";
    private static final String FOLDER = "templates";
    static final String LAYOUTS_DIR = "layouts";
    public static final String CUSTOM_PREFIX = "my-";

    private final List<LabelTemplate> builtIn;
    private final File dir;
    private List<LabelTemplate> templates = Collections.emptyList();
    private final Map<String, Boolean> edited = new LinkedHashMap<>();
    /** Растёт при каждом изменении — экран печати по нему понимает, что ленту пора обновить. */
    private int version;

    public TemplateRepository(Context context) {
        builtIn = Collections.unmodifiableList(load(context.getAssets()));
        dir = new File(context.getFilesDir(), LAYOUTS_DIR);
        reload();
    }

    public synchronized List<LabelTemplate> all() {
        return templates;
    }

    public synchronized LabelTemplate byId(String id) {
        for (LabelTemplate template : templates) {
            if (template.id.equals(id)) return template;
        }
        return null;
    }

    /** Встроенный макет как в приложении — без правок на телефоне. */
    public LabelTemplate original(String id) {
        for (LabelTemplate template : builtIn) {
            if (template.id.equals(id)) return template;
        }
        return null;
    }

    public boolean isBuiltIn(String id) {
        return original(id) != null;
    }

    /** Встроенный, но изменён на телефоне. */
    public synchronized boolean isModified(String id) {
        return isBuiltIn(id) && Boolean.TRUE.equals(edited.get(id));
    }

    public synchronized int version() {
        return version;
    }

    /** Сохранить макет; ошибка записи — {@link IOException}, прежний файл не портится. */
    public synchronized void save(LabelTemplate template) throws IOException {
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Нет папки " + dir);
        File target = file(template.id);
        File temp = new File(dir, template.id + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temp)) {
            out.write(TemplateWriter.write(template).getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        }
        if (target.exists() && !target.delete()) {
            //noinspection ResultOfMethodCallIgnored
            temp.delete();
            throw new IOException("Не удалось заменить " + target);
        }
        if (!temp.renameTo(target)) throw new IOException("Не удалось сохранить " + target);
        reload();
    }

    /** Встроенный — вернуть как в приложении; свой — удалить. */
    public synchronized void reset(String id) {
        File target = file(id);
        if (target.exists() && !target.delete()) Log.w(TAG, "Не удалён " + target);
        reload();
    }

    /** Свободный код для нового макета: {@code my-<время>}. */
    public synchronized String newId() {
        String base = CUSTOM_PREFIX + Long.toString(System.currentTimeMillis(), 36);
        String id = base;
        for (int i = 2; byId(id) != null || file(id).exists(); i++) id = base + "-" + i;
        return id;
    }

    private File file(String id) {
        return new File(dir, id + ".json");
    }

    private synchronized void reload() {
        Map<String, LabelTemplate> saved = new LinkedHashMap<>();
        File[] files = dir.listFiles((d, name) -> name.endsWith(".json"));
        if (files != null) {
            Arrays.sort(files);
            for (File f : files) {
                try (InputStream in = new FileInputStream(f)) {
                    LabelTemplate template = TemplateParser.parse(read(in));
                    String expected = f.getName().substring(0, f.getName().length() - ".json".length());
                    if (!template.id.equals(expected)) {
                        Log.e(TAG, "Макет " + f.getName() + " пропущен: внутри код " + template.id);
                        continue;
                    }
                    saved.put(template.id, template);
                } catch (IOException | IllegalArgumentException e) {
                    // Битый файл не роняет приложение: встроенный макет остаётся как был.
                    Log.e(TAG, "Макет " + f.getName() + " пропущен: " + e.getMessage());
                }
            }
        }
        List<LabelTemplate> result = new ArrayList<>();
        edited.clear();
        for (LabelTemplate template : builtIn) {
            LabelTemplate replaced = saved.remove(template.id);
            edited.put(template.id, replaced != null);
            result.add(replaced != null ? replaced : template);
        }
        List<LabelTemplate> own = new ArrayList<>(saved.values());
        Collections.sort(own, (a, b) -> a.id.toLowerCase(Locale.ROOT).compareTo(b.id.toLowerCase(Locale.ROOT)));
        result.addAll(own);
        templates = Collections.unmodifiableList(result);
        version++;
    }

    private static List<LabelTemplate> load(AssetManager assets) {
        List<LabelTemplate> result = new ArrayList<>();
        try {
            String[] files = assets.list(FOLDER);
            if (files == null) return result;
            Arrays.sort(files);
            for (String file : files) {
                if (!file.endsWith(".json")) continue;
                try (InputStream in = assets.open(FOLDER + "/" + file)) {
                    result.add(TemplateParser.parse(read(in)));
                } catch (IllegalArgumentException e) {
                    Log.e(TAG, "Шаблон " + file + " пропущен: " + e.getMessage());
                }
            }
        } catch (IOException e) {
            Log.e(TAG, "Шаблоны не прочитаны", e);
        }
        return result;
    }

    private static String read(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int read;
        while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }
}
