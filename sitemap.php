<?php
header("Content-Type: application/xml; charset=utf-8");

@ini_set('memory_limit', '256M');

$domain = 'https://pixistech.store';
if (isset($_SERVER['HTTP_HOST'])) {
    $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? "https://" : "http://";
    $domain = $protocol . $_SERVER['HTTP_HOST'];
}

function get_slug($text) {
    $unwanted_array = array(
        'Š'=>'S', 'š'=>'s', 'Ž'=>'Z', 'ž'=>'z', 'À'=>'A', 'Á'=>'A', 'Â'=>'A', 'Ã'=>'A', 'Ä'=>'A', 'Å'=>'A', 'Æ'=>'A', 'Ç'=>'C',
        'È'=>'E', 'É'=>'E', 'Ê'=>'E', 'Ë'=>'E', 'Ì'=>'I', 'Í'=>'I', 'Î'=>'I', 'Ï'=>'I', 'Ñ'=>'N', 'Ò'=>'O', 'Ó'=>'O', 'Ô'=>'O',
        'Õ'=>'O', 'Ö'=>'O', 'Ø'=>'O', 'Ù'=>'U', 'Ú'=>'U', 'Û'=>'U', 'Ü'=>'U', 'Ý'=>'Y', 'Þ'=>'B', 'ß'=>'Ss', 'à'=>'a', 'á'=>'a',
        'â'=>'a', 'ã'=>'a', 'ä'=>'a', 'å'=>'a', 'æ'=>'a', 'ç'=>'c', 'è'=>'e', 'é'=>'e', 'ê'=>'e', 'ë'=>'e', 'ì'=>'i', 'í'=>'i',
        'î'=>'i', 'ï'=>'i', 'ð'=>'o', 'ñ'=>'n', 'ò'=>'o', 'ó'=>'o', 'ô'=>'o', 'õ'=>'o', 'ö'=>'o', 'ø'=>'o', 'ù'=>'u', 'ú'=>'u',
        'û'=>'u', 'ý'=>'y', 'þ'=>'b', 'ÿ'=>'y'
    );
    $text = strtr($text, $unwanted_array);
    $text = mb_strtolower($text, 'UTF-8');
    $text = preg_replace('/[^a-z0-9\s-]/', '', $text);
    $text = preg_replace('/[\s-]+/', '-', $text);
    return trim($text, '-');
}

$products_file = __DIR__ . '/data/products.json';
$lastmod = date('c');
if (file_exists($products_file)) {
    $lastmod = date('c', filemtime($products_file));
}

echo '<?xml version="1.0" encoding="UTF-8"?>' . PHP_EOL;
echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . PHP_EOL;

// Home Page
echo '  <url>' . PHP_EOL;
echo '    <loc>' . htmlspecialchars($domain) . '/</loc>' . PHP_EOL;
echo '    <lastmod>' . htmlspecialchars($lastmod) . '</lastmod>' . PHP_EOL;
echo '    <priority>1.00</priority>' . PHP_EOL;
echo '  </url>' . PHP_EOL;

$generated_urls = [];

if (file_exists($products_file) && is_readable($products_file)) {
    $raw_json = @file_get_contents($products_file);
    if ($raw_json !== false && $raw_json !== '') {
        if (substr($raw_json, 0, 3) === "\xEF\xBB\xBF") {
            $raw_json = substr($raw_json, 3);
        }
        $products_data = json_decode($raw_json, true, 512, JSON_BIGINT_AS_STRING);
        if (is_array($products_data)) {
            foreach ($products_data as $p) {
                if (!is_array($p)) continue;
                if (isset($p['excludeFromExport']) && $p['excludeFromExport'] === true) {
                    continue;
                }
                
                $id = isset($p['id']) ? trim($p['id']) : '';
                $slug = isset($p['slug']) ? trim($p['slug']) : '';
                
                $prod_param = '';
                if ($slug !== '') {
                    $prod_param = $slug;
                } elseif ($id !== '') {
                    $prod_param = $id;
                } elseif (isset($p['title'])) {
                    $prod_param = get_slug($p['title']);
                }
                
                if ($prod_param !== '') {
                    $prod_id = isset($p['id']) ? trim((string)$p['id']) : '';
                    if ($prod_id !== '') {
                        $prod_url = $domain . '/' . rawurlencode($prod_param) . '--id-' . rawurlencode($prod_id);
                    } else {
                        $prod_url = $domain . '/?producto=' . rawurlencode($prod_param);
                    }
                    $lower_url = strtolower($prod_url);
                    if (!isset($generated_urls[$lower_url])) {
                        $generated_urls[$lower_url] = true;
                        echo '  <url>' . PHP_EOL;
                        echo '    <loc>' . htmlspecialchars($prod_url) . '</loc>' . PHP_EOL;
                        echo '    <lastmod>' . htmlspecialchars($lastmod) . '</lastmod>' . PHP_EOL;
                        echo '    <changefreq>weekly</changefreq>' . PHP_EOL;
                        echo '    <priority>0.80</priority>' . PHP_EOL;
                        echo '  </url>' . PHP_EOL;
                    }
                }
            }
        }
    }
}

echo '</urlset>' . PHP_EOL;
?>
