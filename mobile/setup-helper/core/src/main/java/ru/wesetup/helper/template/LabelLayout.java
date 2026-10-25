package ru.wesetup.helper.template;

import java.util.Collections;
import java.util.List;

/** Разложенная этикетка: размер в точках и команды рисования по порядку. */
public final class LabelLayout {

    public final int widthDots;
    public final int heightDots;
    public final List<DrawOp> ops;

    LabelLayout(int widthDots, int heightDots, List<DrawOp> ops) {
        this.widthDots = widthDots;
        this.heightDots = heightDots;
        this.ops = Collections.unmodifiableList(ops);
    }
}
