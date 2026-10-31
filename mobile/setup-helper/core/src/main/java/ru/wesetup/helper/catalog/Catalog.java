package ru.wesetup.helper.catalog;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Справочники с сайта ({@code GET /api/setup-helper/catalog}): подсказки в
 * полях этикеток.
 *
 * <p>Продукты (со сроком годности и условиями хранения), блюда бракеражного
 * журнала, поставщики и имена сотрудников. Копия лежит на телефоне: печать
 * работает без сети с последним полученным справочником. Битые записи
 * пропускаются — справочник целиком из-за одной строки не теряется.
 */
public final class Catalog {

    /** Списки для поля шаблона: {@code "source": "products"} или {@code "products,dishes"}. */
    public static final String PRODUCTS = "products";
    public static final String DISHES = "dishes";
    public static final String SUPPLIERS = "suppliers";
    public static final String STAFF = "staff";

    public static final Catalog EMPTY = new Catalog("", Collections.<Product>emptyList(),
            Collections.<String>emptyList(), Collections.<String>emptyList(), Collections.<String>emptyList());

    private static final Locale RU = Locale.forLanguageTag("ru");

    /** Продукт из справочника. Пустые свойства — null. */
    public static final class Product {
        public final String name;
        /** Срок годности, часы. */
        public final Integer shelfLifeHours;
        /** Условия хранения: «+2…+6 °C». */
        public final String storage;
        public final String supplier;

        public Product(String name, Integer shelfLifeHours, String storage, String supplier) {
            this.name = name;
            this.shelfLifeHours = shelfLifeHours;
            this.storage = storage;
            this.supplier = supplier;
        }
    }

    public final String version;
    public final List<Product> products;
    public final List<String> dishes;
    public final List<String> suppliers;
    public final List<String> staff;
    private final Map<String, Product> byName = new HashMap<>();

    public Catalog(String version, List<Product> products, List<String> dishes, List<String> suppliers,
                   List<String> staff) {
        this.version = version == null ? "" : version;
        this.products = Collections.unmodifiableList(new ArrayList<>(products));
        this.dishes = Collections.unmodifiableList(new ArrayList<>(dishes));
        this.suppliers = Collections.unmodifiableList(new ArrayList<>(suppliers));
        this.staff = Collections.unmodifiableList(new ArrayList<>(staff));
        for (Product product : this.products) byName.put(key(product.name), product);
    }

    public boolean isEmpty() {
        return products.isEmpty() && dishes.isEmpty() && suppliers.isEmpty() && staff.isEmpty();
    }

    /**
     * Имена для поля с {@code source}: списки через запятую, по порядку, без
     * повторов. Неизвестный список — пусто.
     */
    public List<String> names(String source) {
        Set<String> seen = new LinkedHashSet<>();
        List<String> out = new ArrayList<>();
        if (source == null || source.isEmpty()) return out;
        for (String part : source.split(",")) {
            for (String name : list(part.trim())) {
                if (seen.add(key(name))) out.add(name);
            }
        }
        return out;
    }

    private List<String> list(String source) {
        switch (source) {
            case PRODUCTS: {
                List<String> names = new ArrayList<>();
                for (Product product : products) names.add(product.name);
                return names;
            }
            case DISHES:
                return dishes;
            case SUPPLIERS:
                return suppliers;
            case STAFF:
                return staff;
            default:
                return Collections.emptyList();
        }
    }

    /** Продукт по имени без учёта регистра и лишних пробелов, или null. */
    public Product product(String name) {
        if (name == null) return null;
        return byName.get(key(name));
    }

    private static String key(String name) {
        return name.replaceAll("\\s+", " ").trim().toLowerCase(RU);
    }

    /** Какие списки бывают в {@code source} поля шаблона. */
    public static boolean isKnownSource(String source) {
        if (source == null || source.isEmpty()) return false;
        for (String part : source.split(",")) {
            String value = part.trim();
            if (!PRODUCTS.equals(value) && !DISHES.equals(value) && !SUPPLIERS.equals(value)
                    && !STAFF.equals(value)) {
                return false;
            }
        }
        return true;
    }

    /** Разбор ответа сайта. Негодный JSON — {@link IllegalArgumentException}. */
    public static Catalog parse(String json) {
        try {
            JSONObject root = new JSONObject(json);
            List<Product> products = new ArrayList<>();
            JSONArray rawProducts = root.optJSONArray("products");
            if (rawProducts != null) {
                for (int i = 0; i < rawProducts.length(); i++) {
                    JSONObject raw = rawProducts.optJSONObject(i);
                    String name = raw == null ? null : text(raw, "name");
                    if (name == null) continue;
                    Integer hours = null;
                    if (raw.has("shelfLifeHours") && !raw.isNull("shelfLifeHours")) {
                        int value = raw.optInt("shelfLifeHours", 0);
                        if (value > 0) hours = value;
                    }
                    products.add(new Product(name, hours, text(raw, "storage"), text(raw, "supplier")));
                }
            }
            return new Catalog(root.optString("version", ""), products, strings(root, "dishes"),
                    strings(root, "suppliers"), strings(root, "staff"));
        } catch (JSONException e) {
            throw new IllegalArgumentException("Справочник не разобран: " + e.getMessage(), e);
        }
    }

    private static String text(JSONObject raw, String key) {
        if (!raw.has(key) || raw.isNull(key)) return null;
        String value = raw.optString(key, "").replaceAll("\\s+", " ").trim();
        return value.isEmpty() ? null : value;
    }

    private static List<String> strings(JSONObject root, String key) {
        List<String> out = new ArrayList<>();
        JSONArray array = root.optJSONArray(key);
        if (array == null) return out;
        for (int i = 0; i < array.length(); i++) {
            String value = array.optString(i, "").replaceAll("\\s+", " ").trim();
            if (!value.isEmpty()) out.add(value);
        }
        return out;
    }
}
