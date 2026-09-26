<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

$DB_DSN  = "mysql:host=127.0.0.1;dbname=traffico;charset=utf8mb4";
$DB_USER = "root";
$DB_PASS = "";

// --- Parametri ------------------------------------------------------------
$date       = isset($_GET['date'])        ? trim($_GET['date'])        : '';
$dateFrom   = isset($_GET['date_from'])   ? trim($_GET['date_from'])   : '';
$dateTo     = isset($_GET['date_to'])     ? trim($_GET['date_to'])     : '';
$place      = isset($_GET['place'])       ? trim($_GET['place'])       : '';
$qflag      = isset($_GET['min_quality']) ? (int)$_GET['min_quality']  : 0;
$limit_cam  = isset($_GET['limit_cam'])   ? max(1,(int)$_GET['limit_cam']) : 200;
$seriesFlag = isset($_GET['series'])      ? (int)$_GET['series']       : 0; // 0=no, 1=sì (serie intervalli)
$dailyFlag  = isset($_GET['daily'])       ? (int)$_GET['daily']        : 0; // 0=no, 1=sì (serie giornaliera aggregata)
$metrics    = isset($_GET['metrics'])     ? strtolower(trim($_GET['metrics'])) : 'both'; // total|classes|both
$tzParam    = isset($_GET['tz'])          ? trim($_GET['tz'])          : 'Europe/Rome'; // timezone IANA

// --- Validazioni ----------------------------------------------------------
$haveSingle = preg_match('/^\d{4}-\d{2}-\d{2}$/', $date);
$haveFrom   = preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateFrom);
$haveTo     = preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateTo);
$haveRange  = $haveFrom && $haveTo;

if (!in_array($metrics, ['total','classes','both'], true)) $metrics = 'both';
if (!preg_match('#^[A-Za-z]+(?:/[A-Za-z0-9_\-+]+)+$#', $tzParam)) $tzParam = 'Europe/Rome';

// Fallback: se è arrivato solo from o solo to, usalo per entrambi (range di 1 giorno)
if (!$haveSingle && !$haveRange) {
  if ($haveFrom && !$haveTo) { $dateTo = $dateFrom; $haveRange = true; }
  if ($haveTo   && !$haveFrom) { $dateFrom = $dateTo; $haveRange = true; }
}

// Ultimo controllo: se ancora nessuna data valida → 400
if (!$haveSingle && !$haveRange) {
  http_response_code(400);
  echo json_encode(['error'=>'Fornisci "date" (YYYY-MM-DD) OPPURE "date_from" e "date_to" (YYYY-MM-DD).'], JSON_UNESCAPED_UNICODE);
  exit;
}

// swap se invertito
if ($haveRange && $dateFrom > $dateTo) { $tmp = $dateFrom; $dateFrom = $dateTo; $dateTo = $tmp; }

function label_of($country, $road, $city): string {
  $country = strtoupper(trim((string)$country));
  $road = trim((string)$road); $city = trim((string)$city);
  if ($road && $city && $country) return "$road, $city ($country)";
  if ($road && $city) return "$road, $city";
  if ($road && $country) return "$road ($country)";
  if ($city && $country) return "$city ($country)";
  return $road ?: $city ?: ($country ?: 'Senza nome');
}

try {
  $pdo = new PDO($DB_DSN, $DB_USER, $DB_PASS, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  ]);
  $pdo->exec("SET NAMES utf8mb4");
  $pdo->exec("SET time_zone = '+00:00'"); // lavoriamo sempre in UTC a livello SQL

  // --- Finestra temporale in base alla TZ richiesta -----------------------
  $tz  = new DateTimeZone($tzParam);
  $utc = new DateTimeZone('UTC');

  if ($haveSingle) {
    $startLocal = new DateTime($date.' 00:00:00', $tz);
    $endLocal   = (clone $startLocal)->modify('+1 day'); // esclusivo
  } else {
    $startLocal = new DateTime($dateFrom.' 00:00:00', $tz);
    $endLocal   = (new DateTime($dateTo.' 00:00:00', $tz))->modify('+1 day'); // esclusivo
  }
  $startUtc = (clone $startLocal)->setTimezone($utc)->format('Y-m-d H:i:s');
  $endUtc   = (clone $endLocal)->setTimezone($utc)->format('Y-m-d H:i:s');

  // --- 1) Selezione telecamere con totali nella finestra ------------------
  $limit_cam = min($limit_cam, 1000);

  $selectDay = [];
  if ($metrics === 'classes' || $metrics === 'both') {
    $selectDay[] = 'SUM(COALESCE(ti.cars,0))   AS day_cars';
    $selectDay[] = 'SUM(COALESCE(ti.motos,0))  AS day_motos';
    $selectDay[] = 'SUM(COALESCE(ti.buses,0))  AS day_buses';
    $selectDay[] = 'SUM(COALESCE(ti.trucks,0)) AS day_trucks';
  }
  if ($metrics === 'total' || $metrics === 'both') {
    $selectDay[] = 'SUM(COALESCE(ti.total,0))  AS day_total';
  }

  $sql_cam = "
    SELECT
      c.camera_id AS id,
      c.lat, c.lon,
      c.country_iso2, c.city, c.road,
      c.path_m AS path_m
      ".(empty($selectDay) ? '' : ",\n      ".implode(",\n      ", $selectDay))."
    FROM camera c
    JOIN traffic_interval ti ON ti.camera_id = c.camera_id
    WHERE c.active = 1
      AND ti.ts_start >= :s
      AND ti.ts_start  < :e
      AND COALESCE(ti.quality_flag, 0) >= :q
  ";

  $params = [':s'=>$startUtc, ':e'=>$endUtc, ':q'=>$qflag];

  if ($place !== '') {
    $sql_cam .= " AND (
          c.country_iso2 LIKE :p
      OR  c.city         LIKE :p
      OR  c.province     LIKE :p
      OR  c.region       LIKE :p
      OR  c.road         LIKE :p
    ) ";
    $params[':p'] = '%' . $place . '%';
  }

  $orderExpr = ($metrics === 'total' || $metrics === 'both')
    ? 'day_total'
    : '(SUM(COALESCE(ti.cars,0))+SUM(COALESCE(ti.motos,0))+SUM(COALESCE(ti.buses,0))+SUM(COALESCE(ti.trucks,0)))';

  $sql_cam .= "
    GROUP BY c.camera_id, c.lat, c.lon, c.country_iso2, c.city, c.road, c.path_m
    ORDER BY {$orderExpr} DESC, c.camera_id ASC
    LIMIT {$limit_cam}
  ";

  $st = $pdo->prepare($sql_cam);
  $st->execute($params);
  $cams = $st->fetchAll();

  if (!$cams) {
    echo json_encode([
      'items'=>[],
      'stats'=>['count'=>0,'min'=>0,'max'=>0],
      'options'=>['series'=>(bool)$seriesFlag,'daily'=>(bool)$dailyFlag,'metrics'=>$metrics,'tz'=>$tzParam],
      'window'=>['start_utc'=>$startUtc,'end_utc'=>$endUtc,'mode'=>$haveSingle?'single':'range']
    ], JSON_UNESCAPED_UNICODE);
    exit;
  }

  // --- 2) Serie intervalli (sempre da traffic_interval.ts_start) ----------
  //     - series: lista piatta (ISO UTC + valori)
  //     - series_by_day: mappa YYYY-MM-DD (nella TZ richiesta) → array intervalli
  $seriesFlatById  = []; // id => [ {...} ]
  $seriesByDayById = []; // id => [ 'YYYY-MM-DD' => [ {...}, ... ] ]

  if ($seriesFlag) {
    $ids = array_column($cams, 'id');
    $in  = implode(',', array_fill(0, count($ids), '?'));

    $selectTs = [];
    if ($metrics === 'classes' || $metrics === 'both') {
      $selectTs[] = 'COALESCE(ti.cars,0)   AS cars';
      $selectTs[] = 'COALESCE(ti.motos,0)  AS motos';
      $selectTs[] = 'COALESCE(ti.buses,0)  AS buses';
      $selectTs[] = 'COALESCE(ti.trucks,0) AS trucks';
    }
    if ($metrics === 'total' || $metrics === 'both') {
      $selectTs[] = 'COALESCE(ti.total,0)  AS total';
    }

    $sql_ts = "
      SELECT
        ti.camera_id AS id,
        ti.ts_start,
        COALESCE(
          DATE(CONVERT_TZ(ti.ts_start, '+00:00', ?)),
          DATE(ti.ts_start)
        ) AS d
        ".(empty($selectTs) ? '' : ",\n        ".implode(",\n        ", $selectTs)).",
        ti.duration_s,
        COALESCE(ti.quality_flag,0) AS qf
      FROM traffic_interval ti
      WHERE ti.camera_id IN ($in)
        AND ti.ts_start >= ?
        AND ti.ts_start  < ?
        AND COALESCE(ti.quality_flag, 0) >= ?
      ORDER BY ti.camera_id ASC, ti.ts_start ASC
    ";

    $args = array_values($ids);
    array_unshift($args, $tzParam); // per CONVERT_TZ
    $args[] = $startUtc; $args[] = $endUtc; $args[] = $qflag;

    $st2 = $pdo->prepare($sql_ts);
    $st2->execute($args);

    while ($r = $st2->fetch()) {
      $id = (string)$r['id'];

      $row = [
        'ts'         => gmdate('c', strtotime($r['ts_start'])), // ISO UTC
        'date'       => (string)$r['d'],                        // giorno locale nella TZ richiesta
        'duration_s' => (int)$r['duration_s'],
        'qf'         => (int)$r['qf'],
      ];
      if (isset($r['cars']))   $row['cars']   = (int)$r['cars'];
      if (isset($r['motos']))  $row['motos']  = (int)$r['motos'];
      if (isset($r['buses']))  $row['buses']  = (int)$r['buses'];
      if (isset($r['trucks'])) $row['trucks'] = (int)$r['trucks'];
      if (isset($r['total']))  $row['total']  = (int)$r['total'];
      if (!isset($row['total'])) {
        $row['total'] = ($row['cars'] ?? 0) + ($row['motos'] ?? 0) + ($row['buses'] ?? 0) + ($row['trucks'] ?? 0);
      }

      $seriesFlatById[$id][] = $row;
      $seriesByDayById[$id][$row['date']][] = $row;
    }
  }

  // --- 2bis) Serie giornaliera aggregata (opzionale) ----------------------
  $dailyById = [];
  if ($dailyFlag) {
    $ids = array_column($cams, 'id');
    if (!empty($ids)) {
      $in = implode(',', array_fill(0, count($ids), '?'));

      $selDaily = [];
      if ($metrics === 'classes' || $metrics === 'both') {
        $selDaily[] = 'SUM(COALESCE(ti.cars,0))   AS cars';
        $selDaily[] = 'SUM(COALESCE(ti.motos,0))  AS motos';
        $selDaily[] = 'SUM(COALESCE(ti.buses,0))  AS buses';
        $selDaily[] = 'SUM(COALESCE(ti.trucks,0)) AS trucks';
      }
      if ($metrics === 'total' || $metrics === 'both') {
        $selDaily[] = 'SUM(COALESCE(ti.total,0))  AS total';
      }

      $sql_daily = "
        SELECT
          ti.camera_id AS id,
          COALESCE(
            DATE(CONVERT_TZ(ti.ts_start, '+00:00', ?)),
            DATE(ti.ts_start)
          ) AS d
          ".(empty($selDaily) ? '' : ",\n          ".implode(",\n          ", $selDaily))."
        FROM traffic_interval ti
        WHERE ti.camera_id IN ($in)
          AND ti.ts_start >= ?
          AND ti.ts_start  < ?
          AND COALESCE(ti.quality_flag,0) >= ?
        GROUP BY ti.camera_id, d
        ORDER BY ti.camera_id, d
      ";

      $args = array_values($ids);
      array_unshift($args, $tzParam);
      $args[] = $startUtc; $args[] = $endUtc; $args[] = $qflag;

      $stD = $pdo->prepare($sql_daily);
      $stD->execute($args);

      while ($r = $stD->fetch()) {
        $id = (string)$r['id'];
        $row = ['date' => (string)$r['d']];
        if (isset($r['cars']))   $row['cars']   = (int)$r['cars'];
        if (isset($r['motos']))  $row['motos']  = (int)$r['motos'];
        if (isset($r['buses']))  $row['buses']  = (int)$r['buses'];
        if (isset($r['trucks'])) $row['trucks'] = (int)$r['trucks'];
        if (isset($r['total']))  $row['total']  = (int)$r['total'];
        if (!isset($row['total'])) {
          $row['total'] = ($row['cars'] ?? 0) + ($row['motos'] ?? 0) + ($row['buses'] ?? 0) + ($row['trucks'] ?? 0);
        }
        $dailyById[$id][] = $row;
      }
    }
  }

  // --- 3) Output + stats ---------------------------------------------------
  $items = [];
  $min = null; $max = null;

  foreach ($cams as $c) {
    $lat = (float)$c['lat']; $lon = (float)$c['lon'];
    if (!is_numeric($c['lat']) || !is_numeric($c['lon']) || abs($lat) > 90 || abs($lon) > 180) continue;

    $label  = label_of($c['country_iso2'] ?? '', $c['road'] ?? '', $c['city'] ?? '');
    $path_m = isset($c['path_m']) ? (int)$c['path_m'] : null;

    $day = [];
    if ($metrics === 'classes' || $metrics === 'both') {
      $day['cars']   = (int)($c['day_cars']   ?? 0);
      $day['motos']  = (int)($c['day_motos']  ?? 0);
      $day['buses']  = (int)($c['day_buses']  ?? 0);
      $day['trucks'] = (int)($c['day_trucks'] ?? 0);
    }
    if ($metrics === 'total' || $metrics === 'both') {
      $day['total']  = (int)($c['day_total']  ?? 0);
    }
    if (!isset($day['total'])) {
      $day['total'] = ($day['cars'] ?? 0) + ($day['motos'] ?? 0) + ($day['buses'] ?? 0) + ($day['trucks'] ?? 0);
    }

    $id = (string)$c['id'];

    $items[] = [
      'id'            => $id,
      'lat'           => $lat,
      'lon'           => $lon,
      'label'         => $label,
      'path_m'        => $path_m,
      'day'           => $day,                                      // totali finestra
      'series'        => $seriesFlag ? ($seriesFlatById[$id] ?? []) : null,   // intervalli piatti
      'series_by_day' => $seriesFlag ? ($seriesByDayById[$id] ?? []) : null,  // mappa giorno → intervalli
      'daily'         => $dailyFlag  ? ($dailyById[$id] ?? []) : null,        // aggregati per giorno
    ];

    $v = $day['total'];
    $min = is_null($min) ? $v : min($min, $v);
    $max = is_null($max) ? $v : max($max, $v);
  }

  echo json_encode([
    'items'   => $items,
    'stats'   => ['count' => count($items), 'min' => $min ?? 0, 'max' => $max ?? 0],
    'options' => ['series' => (bool)$seriesFlag, 'daily' => (bool)$dailyFlag, 'metrics' => $metrics, 'tz'=>$tzParam],
    'window'  => ['start_utc'=>$startUtc,'end_utc'=>$endUtc,'mode'=>$haveSingle?'single':'range']
  ], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);

} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode(['error'=>'Server error','detail'=>$e->getMessage()], JSON_UNESCAPED_UNICODE);
}

