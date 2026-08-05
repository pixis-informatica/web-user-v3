<?php
// Anti-cache headers first thing
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: Thu, 01 Jan 1970 00:00:00 GMT');

$domain = 'https://pixistech.store';
if (isset($_SERVER['HTTP_HOST'])) {
    $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? "https://" : "http://";
    $domain = $protocol . $_SERVER['HTTP_HOST'];
}

// Redirect real users to the frontend immediately if not a bot
$user_agent = isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '';
$is_bot = preg_match('/(WhatsApp|facebookexternalhit|Twitterbot|Discordbot|LinkedInBot|TelegramBot|Slackbot|Facebot)/i', $user_agent);
$is_facebook = (stripos($user_agent, 'facebookexternalhit') !== false || stripos($user_agent, 'Facebot') !== false);

$query_params = !empty($_SERVER['QUERY_STRING']) ? '?' . $_SERVER['QUERY_STRING'] : '';
$redirect_url = rtrim($domain, '/') . '/index.html' . $query_params;

// Deshabilitar redirección directa para que usuarios y bots carguen la SPA mediante share.php
// if (!$is_bot) {
//     header('Location: ' . $redirect_url, true, 302);
//     exit;
// }

// Helper: normalize and build absolute URL
// Convierte backslashes, elimina barras dobles y codifica cada segmento
// del path (espacios, acentos, etc.) para que la URL sea válida en redes sociales.
function build_absolute_url($domain, $path)
{
    if (empty($path))
        return '';

    // 1. Normalizar separadores: backslash Windows → forward slash
    $path = str_replace('\\', '/', $path);

    // 2. Eliminar barra inicial si existe
    $path = ltrim($path, '/');

    // 3. Colapsar barras dobles (ej: img//productos//)
    $path = preg_replace('#/+#', '/', $path);

    // 4. Codificar CADA segmento individualmente (preserva las barras /)
    //    rawurlencode() convierte espacios en %20, acentos, paréntesis, etc.
    //    NO se usa urlencode() porque este convierte espacios en + (inválido en rutas)
    $segments = explode('/', $path);
    $encoded = array_map('rawurlencode', $segments);
    $path = implode('/', $encoded);

    return rtrim($domain, '/') . '/' . $path;
}

// Helper: genera URL de og-image.php para imágenes de producto.
// og-image.php centra la imagen en un canvas 1200×630 sin recortar nada.
// Solo se usa para imágenes de producto (no banners ni fallback).
function build_og_image_url($domain, $raw_path)
{
    if (empty($raw_path))
        return '';

    // Normalizar separadores
    $raw_path = str_replace('\\', '/', $raw_path);
    $raw_path = ltrim($raw_path, '/');
    $raw_path = preg_replace('#/+#', '/', $raw_path);

    // Construir URL al generador con la ruta como parámetro src
    return rtrim($domain, '/') . '/og-image.php?src=' . rawurlencode($raw_path);
}

// Helper: format price
function format_price($price_val)
{
    if (is_numeric($price_val)) {
        return '$' . number_format((float) $price_val, 2, ',', '.');
    }
    return $price_val;
}

// Helper: clean description
function clean_description($desc)
{
    if (empty($desc))
        return '';
    $desc = strip_tags($desc);
    $desc = str_replace(array("\r", "\n"), ' ', $desc);
    $desc = preg_replace('/\s+/', ' ', $desc);
    $desc = trim($desc);
    if (mb_strlen($desc) > 160) {
        $desc = mb_substr($desc, 0, 157) . '...';
    }
    return $desc;
}

// Helper: slugify
function get_slug($text)
{
    $unwanted_array = array(
        'Š' => 'S',
        'š' => 's',
        'Ž' => 'Z',
        'ž' => 'z',
        'À' => 'A',
        'Á' => 'A',
        'Â' => 'A',
        'Ã' => 'A',
        'Ä' => 'A',
        'Å' => 'A',
        'Æ' => 'A',
        'Ç' => 'C',
        'È' => 'E',
        'É' => 'E',
        'Ê' => 'E',
        'Ë' => 'E',
        'Ì' => 'I',
        'Í' => 'I',
        'Î' => 'I',
        'Ï' => 'I',
        'Ñ' => 'N',
        'Ò' => 'O',
        'Ó' => 'O',
        'Ô' => 'O',
        'Õ' => 'O',
        'Ö' => 'O',
        'Ø' => 'O',
        'Ù' => 'U',
        'Ú' => 'U',
        'Û' => 'U',
        'Ü' => 'U',
        'Ý' => 'Y',
        'Þ' => 'B',
        'ß' => 'Ss',
        'à' => 'a',
        'á' => 'a',
        'â' => 'a',
        'ã' => 'a',
        'ä' => 'a',
        'å' => 'a',
        'æ' => 'a',
        'ç' => 'c',
        'è' => 'e',
        'é' => 'e',
        'ê' => 'e',
        'ë' => 'e',
        'ì' => 'i',
        'í' => 'i',
        'î' => 'i',
        'ï' => 'i',
        'ð' => 'o',
        'ñ' => 'n',
        'ò' => 'o',
        'ó' => 'o',
        'ô' => 'o',
        'õ' => 'o',
        'ö' => 'o',
        'ø' => 'o',
        'ù' => 'u',
        'ú' => 'u',
        'û' => 'u',
        'ý' => 'y',
        'þ' => 'b',
        'ÿ' => 'y'
    );
    $text = strtr($text, $unwanted_array);
    $text = mb_strtolower($text, 'UTF-8');
    $text = preg_replace('/[^a-z0-9\s-]/', '', $text);
    $text = preg_replace('/[\s-]+/', '-', $text);
    return trim($text, '-');
}

// Default/fallback values
$fallback_title = "Pixis Informática | Especialistas N°1 en Santiago del Estero en Reparaciones y Servicio Técnico";
$fallback_description = "Especialistas N°1 en Santiago del Estero en reparaciones y servicio técnico de computadoras y laptops de oficina y gamer. Venta de insumos informáticos, accesorios y hardware de alto rendimiento.";
$fallback_image = build_absolute_url($domain, 'img/logo_pixis.png');

$og_title = null;
$og_description = null;
$og_image = null;

// ============================================================
// Scenario 1: Product  (?producto=VALOR)
// Supports: ID exacto, slug guardado, o slug generado del título
// ============================================================
if (isset($_GET['producto'])) {

    // Normalizar el valor recibido:
    // urldecode() cubre casos donde Apache pasa %2D en vez de - etc.
    $producto_query = trim(urldecode($_GET['producto']));
    $found_product = null;

    if ($producto_query !== '') {

        // Generar también el slug del query por si el usuario comparte por título
        $producto_query_slug = get_slug($producto_query);

        // Aumentar memoria para parsear el archivo de 245 KB en hosting compartido
        @ini_set('memory_limit', '256M');

        $products_file = __DIR__ . '/data/products.json';

        if (file_exists($products_file) && is_readable($products_file)) {

            $raw_json = @file_get_contents($products_file);

            if ($raw_json !== false && $raw_json !== '') {

                // Strip BOM UTF-8 (EF BB BF) por si el archivo en el servidor lo tiene
                if (substr($raw_json, 0, 3) === "\xEF\xBB\xBF") {
                    $raw_json = substr($raw_json, 3);
                }

                // Decodificar: true = array asociativo
                // JSON_BIGINT_AS_STRING evita pérdida de precisión en IDs numéricos largos
                $products_data = json_decode($raw_json, true, 512, JSON_BIGINT_AS_STRING);

                // Aceptar tanto array plano como objeto (convertir objeto a array)
                if (is_object($products_data)) {
                    $products_data = (array) $products_data;
                }

                if (is_array($products_data) && json_last_error() === JSON_ERROR_NONE) {

                    foreach ($products_data as $p) {

                        // Saltar entradas que no sean arrays válidos
                        if (!is_array($p))
                            continue;

                        $p_id = isset($p['id']) ? trim((string) $p['id']) : '';
                        $p_slug = isset($p['slug']) ? trim((string) $p['slug']) : '';
                        $p_title_slug = isset($p['title']) ? get_slug($p['title']) : '';

                        // COINCIDENCIA TRIPLE — insensible a mayúsculas/minúsculas
                        // Normalizamos guiones y puntos para máxima compatibilidad
                        $p_id_norm = str_replace(['-', '.'], '', $p_id);
                        $p_slug_norm = str_replace(['-', '.'], '', $p_slug);
                        $p_title_slug_norm = str_replace(['-', '.'], '', $p_title_slug);
                        $query_norm = str_replace(['-', '.'], '', $producto_query);
                        $query_slug_norm = str_replace(['-', '.'], '', $producto_query_slug);

                        $match_id = ($p_id !== '' && (strcasecmp($p_id, $producto_query) === 0 || strcasecmp($p_id_norm, $query_norm) === 0));
                        $match_slug = ($p_slug !== '' && (strcasecmp($p_slug, $producto_query) === 0 || strcasecmp($p_slug_norm, $query_norm) === 0));
                        $match_title_slug = ($p_title_slug !== '' && (
                            strcasecmp($p_title_slug, $producto_query) === 0 ||
                            strcasecmp($p_title_slug, $producto_query_slug) === 0 ||
                            strcasecmp($p_title_slug_norm, $query_norm) === 0 ||
                            strcasecmp($p_title_slug_norm, $query_slug_norm) === 0
                        ));

                        if ($match_id || $match_slug || $match_title_slug) {
                            $found_product = $p;
                            break;
                        }
                    }
                }
            }
        }
    }

    if ($found_product) {

        $p_title = isset($found_product['title']) ? trim($found_product['title']) : '';

        // --- Extracción de precio con método de seguridad total ---
        $price_val = 0;
        
        // Prioridad absoluta a priceLocal
        if (isset($found_product['priceLocal']) && $found_product['priceLocal'] != 0) {
            // Limpiamos el valor de cualquier cosa que no sea número
            $price_raw = preg_replace('/[^0-9]/', '', (string)$found_product['priceLocal']);
            $price_val = (float)$price_raw;
        } elseif (isset($found_product['cashPrice']) && $found_product['cashPrice'] != 0) {
            $price_raw = preg_replace('/[^0-9]/', '', (string)$found_product['cashPrice']);
            $price_val = (float)$price_raw;
        }

        if ($price_val > 0) {
            $formatted_price = '$' . number_format($price_val, 0, '', '.');
        } elseif (!empty($found_product['priceVisible'])) {
            $formatted_price = trim((string)$found_product['priceVisible']);
        } else {
            $formatted_price = '';
        }

        // og:title - Formato premium restaurado (ahora que el bug del $ está arreglado)
        if ($formatted_price !== '') {
            $og_title = $p_title . ' — ' . $formatted_price . ' | Pixis Informática';
        } else {
            $og_title = $p_title . ' | Pixis Informática';
        }

        // og:description
        $og_description = (!empty($found_product['desc']))
            ? clean_description($found_product['desc'])
            : '';
        if ($og_description === '') {
            $og_description = 'Comprá ' . $p_title . ' al mejor precio en Pixis Informática. Hardware de alto rendimiento en Santiago del Estero.';
        }

        // og:image
        $p_image = '';
        if (!empty($found_product['img'])) {
            $img_parts = explode(',', (string) $found_product['img']);
            $p_image = trim($img_parts[0]);
        } elseif (!empty($found_product['gallery'])) {
            // Si no hay img pero hay gallery, extraemos la primera imagen de la galería
            $gallery_parts = explode(',', (string) $found_product['gallery']);
            foreach ($gallery_parts as $part) {
                $trimmed_part = trim($part);
                if ($trimmed_part !== '') {
                    $p_image = $trimmed_part;
                    break;
                }
            }
        }

        if ($p_image !== '') {
            if ($is_facebook) {
                // Facebook: canvas 1200×630 sin recortar
                $og_image = build_og_image_url($domain, $p_image);
            } else {
                // WhatsApp y otros bots: imagen original directa
                $og_image = build_absolute_url($domain, $p_image);
            }
        }
    }
}

// Scenario 2: Category
if (!$og_title && isset($_GET['categoria'])) {
    $categoria_query = trim($_GET['categoria']);
    $found_category = null;

    if ($categoria_query !== '') {
        $categories_file = __DIR__ . '/data/categories.json';
        if (file_exists($categories_file)) {
            $categories_data = json_decode(file_get_contents($categories_file), true);
            if (is_array($categories_data)) {
                foreach ($categories_data as $cat) {
                    $cat_id = isset($cat['id']) ? trim($cat['id']) : '';
                    $cat_name_slug = isset($cat['name']) ? get_slug($cat['name']) : '';

                    if (
                        ($cat_id !== '' && strcasecmp($cat_id, $categoria_query) === 0) ||
                        ($cat_name_slug !== '' && strcasecmp($cat_name_slug, $categoria_query) === 0)
                    ) {
                        $found_category = $cat;
                        break;
                    }
                }
            }
        }
    }

    if ($found_category) {
        $cat_name = isset($found_category['name']) ? trim($found_category['name']) : '';
        $og_title = $cat_name . " - Pixis Informática";
        $og_description = "Explorá nuestra categoría de " . $cat_name . " en Pixis Informática. Encontrá los mejores precios y hardware de alto rendimiento.";

        if (!empty($found_category['customIcon'])) {
            if ($is_facebook) {
                $og_image = build_og_image_url($domain, $found_category['customIcon']);
            } else {
                $og_image = build_absolute_url($domain, $found_category['customIcon']);
            }
        }
    }
}

// Scenario 3: Banner
if (!$og_title && isset($_GET['banner'])) {
    $banner_query = trim($_GET['banner']);
    $found_banner_info = null;
    $found_banner_img = '';
    $banner_key = null;

    if ($banner_query !== '') {
        $site_file = __DIR__ . '/data/site.json';
        if (file_exists($site_file)) {
            $site_data = json_decode(file_get_contents($site_file), true);
            if (is_array($site_data)) {
                if (isset($site_data['banners']) && is_array($site_data['banners'])) {
                    foreach ($site_data['banners'] as $b_id => $b_info) {
                        $b_title_slug = isset($b_info['t']) ? get_slug($b_info['t']) : '';
                        if (
                            strcasecmp($b_id, $banner_query) === 0 ||
                            get_slug($b_id) === get_slug($banner_query) ||
                            strcasecmp($b_title_slug, $banner_query) === 0
                        ) {
                            $found_banner_info = $b_info;
                            $banner_key = $b_id;
                            break;
                        }
                    }
                }

                $carousels = array_merge(
                    isset($site_data['carouselTop']) && is_array($site_data['carouselTop']) ? $site_data['carouselTop'] : array(),
                    isset($site_data['carouselBottom']) && is_array($site_data['carouselBottom']) ? $site_data['carouselBottom'] : array()
                );
                foreach ($carousels as $slide) {
                    if (isset($slide['bannerId']) && (strcasecmp($slide['bannerId'], $banner_query) === 0 || ($banner_key !== null && strcasecmp($slide['bannerId'], $banner_key) === 0))) {
                        if (!empty($slide['imgPc'])) {
                            $found_banner_img = $slide['imgPc'];
                            break;
                        }
                    }
                }
            }
        }
    }

    if ($found_banner_info) {
        $banner_title = isset($found_banner_info['t']) ? trim($found_banner_info['t']) : '';
        $og_title = "🔥 ¡Equipate Ya! " . $banner_title . " en Pixis Informática";
        $og_description = "¡No dejes pasar esta oportunidad! Descubrí los mejores productos en " . $banner_title . " con envíos a todo el país y el mejor precio local.";

        if ($found_banner_img !== '') {
            if ($is_facebook) {
                // Facebook: canvas 1200×630 sin recortar
                $og_image = build_og_image_url($domain, $found_banner_img);
            } else {
                // WhatsApp y otros: imagen original directa
                $og_image = build_absolute_url($domain, $found_banner_img);
            }
        }
    }
}

// Fallback logic
if (!$og_title) {
    $og_title = $fallback_title;
}
if (!$og_description) {
    $og_description = $fallback_description;
}
if (!$og_image) {
    $og_image = $fallback_image;
}

// Load index.html as template of SPA
$template = @file_get_contents(__DIR__ . '/index.html');
if ($template === false) {
    $template = '<!DOCTYPE html><html lang="es"><head><title>' . htmlspecialchars($og_title) . '</title></head><body></body></html>';
}

// Modify Title
$title_tag = '<title>' . htmlspecialchars($og_title) . '</title>';
$template = preg_replace('/<title>.*?<\/title>/is', $title_tag, $template);

// Modify Meta description
$template = preg_replace('/<meta\s+[^>]*?name="description"[^>]*?content="[^"]*"[^>]*?>/is', '<meta name="description" content="' . htmlspecialchars($og_description, ENT_QUOTES, 'UTF-8') . '">', $template);

// Determine canonical URL without 'cc' parameter
$canonical_url = $domain . '/';
if (isset($_GET['producto']) && isset($found_product)) {
    $canonical_slug = (!empty($found_product['slug'])) ? $found_product['slug'] : ((!empty($found_product['id'])) ? $found_product['id'] : get_slug($p_title));
    if (!empty($found_product['id'])) {
        $canonical_url = $domain . '/' . rawurlencode($canonical_slug) . '--id-' . rawurlencode((string)$found_product['id']);
    } else {
        $canonical_url = $domain . '/?producto=' . rawurlencode($canonical_slug);
    }
} elseif (isset($_GET['categoria']) && isset($found_category)) {
    $canonical_url = $domain . '/?categoria=' . rawurlencode($categoria_query);
} elseif (isset($_GET['banner']) && isset($found_banner_info)) {
    $canonical_url = $domain . '/?banner=' . rawurlencode($banner_query);
}

// Modify/Inject Canonical link before the body tag (index.html has no closing head tag)
$canonical_link = '<link rel="canonical" href="' . htmlspecialchars($canonical_url, ENT_QUOTES, 'UTF-8') . '">';
$template = preg_replace('/(<body[^>]*?>)/is', $canonical_link . PHP_EOL . '$1', $template, 1);

// Robust Modify OG and Twitter Tags using htmlspecialchars and escaping $ for preg_replace
$safe_og_title = str_replace('$', '\\$', htmlspecialchars($og_title, ENT_QUOTES, 'UTF-8'));
$safe_og_description = str_replace('$', '\\$', htmlspecialchars($og_description, ENT_QUOTES, 'UTF-8'));
$safe_og_image = str_replace('$', '\\$', htmlspecialchars($og_image, ENT_QUOTES, 'UTF-8'));
$safe_canonical_url = str_replace('$', '\\$', htmlspecialchars($canonical_url, ENT_QUOTES, 'UTF-8'));

$template = preg_replace('/(<meta\s+[^>]*?id="meta-og-title"\s+[^>]*?content=")([^"]*)(")/is', '${1}' . $safe_og_title . '${3}', $template);
$template = preg_replace('/(<meta\s+[^>]*?id="meta-og-desc"\s+[^>]*?content=")([^"]*)(")/is', '${1}' . $safe_og_description . '${3}', $template);
$template = preg_replace('/(<meta\s+[^>]*?id="meta-og-image"\s+[^>]*?content=")([^"]*)(")/is', '${1}' . $safe_og_image . '${3}', $template);
$template = preg_replace('/(<meta\s+[^>]*?id="meta-og-url"\s+[^>]*?content=")([^"]*)(")/is', '${1}' . $safe_canonical_url . '${3}', $template);

$template = preg_replace('/(<meta\s+[^>]*?id="meta-twitter-title"\s+[^>]*?content=")([^"]*)(")/is', '${1}' . $safe_og_title . '${3}', $template);
$template = preg_replace('/(<meta\s+[^>]*?id="meta-twitter-desc"\s+[^>]*?content=")([^"]*)(")/is', '${1}' . $safe_og_description . '${3}', $template);
$template = preg_replace('/(<meta\s+[^>]*?id="meta-twitter-image"\s+[^>]*?content=")([^"]*)(")/is', '${1}' . $safe_og_image . '${3}', $template);

// Inject JSON-LD structured data for Product
$injection = '';
if (isset($_GET['producto']) && isset($found_product)) {
    $inStock = isset($found_product['inStock']) ? (bool) $found_product['inStock'] : true;
    $stockNum = isset($found_product['stockNum']) ? (int) $found_product['stockNum'] : null;

    $schema_availability = "https://schema.org/InStock";
    if ($inStock === false || $stockNum === 0) {
        $schema_availability = "https://schema.org/OutOfStock";
    }

    $brand_name = "Pixis Informática";
    if ($p_title !== '') {
        $known_brands = array(
            'MSI',
            'Raptor',
            'Logitech',
            'Corsair',
            'Nvidia',
            'AMD',
            'Asus',
            'Patriot',
            'Kelyx',
            'Adata',
            'Gigabyte',
            'Mercusys',
            'Thermaltake',
            'TP-Link',
            'Razer',
            'Hiksemi',
            'JBL',
            'Genius'
        );
        foreach ($known_brands as $kb) {
            if (stripos($p_title, $kb) !== false) {
                $brand_name = $kb;
                break;
            }
        }
    }

    $offers = [
        "@type" => "Offer",
        "url" => $canonical_url,
        "priceCurrency" => "ARS",
        "availability" => $schema_availability,
        "itemCondition" => "https://schema.org/NewCondition",
        "priceValidUntil" => date('Y-m-d', strtotime('+30 days')),
        "seller" => [
            "@type" => "Organization",
            "name" => "Pixis Informática"
        ]
    ];
    if ($price_val !== null && $price_val > 0) {
        $offers["price"] = (string) $price_val;
    }

    $schema = [
        "@context" => "https://schema.org",
        "@type" => "Product",
        "name" => $p_title,
        "description" => clean_description($found_product['desc'] ?? ''),
        "image" => [$og_image],
        "brand" => [
            "@type" => "Brand",
            "name" => $brand_name
        ],
        "offers" => $offers
    ];
    if (!empty($found_product['id'])) {
        $prod_sku = (string) $found_product['id'];
        $schema["sku"] = $prod_sku;
        $schema["productID"] = $prod_sku;
        $schema["mpn"] = $prod_sku;
        $schema["identifier"] = $prod_sku;
    }

    $injection .= '<script type="application/ld+json">' . PHP_EOL;
    $injection .= json_encode($schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . PHP_EOL;
    $injection .= '</script>' . PHP_EOL;
}

$template = str_replace('</body>', $injection . '</body>', $template);
echo $template;
