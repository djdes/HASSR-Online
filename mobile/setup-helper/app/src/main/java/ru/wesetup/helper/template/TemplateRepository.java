package ru.wesetup.helper.template;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/** Шаблоны из {@code assets/templates}: порядок — по имени файла («10-…», «20-…»). */
public final class TemplateRepository {

    private static final String TAG = "SetupHelper";
    private static final String FOLDER = "templates";

    private final List<LabelTemplate> templates;

    public TemplateRepository(Context context) {
        templates = Collections.unmodifiableList(load(context.getAssets()));
    }

    public List<LabelTemplate> all() {
        return templates;
    }

    public LabelTemplate byId(String id) {
        for (LabelTemplate template : templates) {
            if (template.id.equals(id)) return template;
        }
        return null;
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
