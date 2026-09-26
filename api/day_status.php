<?php
// api/day_status.php — verifica se esistono intervalli per camera+giorno
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

try{
  // Input: preferisci lat/lon (+ road opzionale) e date=YYYY-MM-DD (locale)
  $lat  = isset($_POST['lat'])  ? (float)str_replace(',', '.', (string)$_POST['lat']) : null;
  $lon  = isset($_POST['lon'])  ? (float)str_replace(',', '.', (string)$_POST['lon']) : null;
  $road = isset($_POST['road']) ? trim((string)$_POST['road']) : null;
  $date = isset($_POST['date']) ? trim((string)$_POST['date']) : '';

  if (!$date || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    throw new RuntimeException('Parametro "date" mancante o invalido (YYYY-MM-DD).');
  }

  $pdo = new PDO('mysql:host=127.0.0.1;dbname=traffico;charset=utf8mb4','root','',[
    PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,
  ]);

  // Risolvi camera_id:
  // 1) per road, 2) per lat/lon. Se entrambi dati, road ha precedenza.
  $camera_id = null;
  if ($road) {
    $s = $pdo->prepare('SELECT camera_id, lat, lon FROM camera WHERE road = ? LIMIT 1');
    $s->execute([$road]);
    if ($r = $s->fetch()) {
      $camera_id = (int)$r['camera_id'];
      $lat = $lat ?? (float)$r['lat'];
      $lon = $lon ?? (float)$r['lon'];
    }
  }
  if ($camera_id === null && $lat !== null && $lon !== null) {
    $s = $pdo->prepare('SELECT camera_id FROM camera WHERE lat = ? AND lon = ? LIMIT 1');
    $s->execute([$lat, $lon]);
    if ($r = $s->fetch()) {
      $camera_id = (int)$r['camera_id'];
    }
  }
  if ($camera_id === null) {
    echo json_encode(['status'=>'ok','has_intervals'=>false,'camera_id'=>null,'lat'=>$lat,'lon'=>$lon]);
    exit;
  }

  // Giorno locale Europe/Rome (coerente con ts_start)
  $tz = new DateTimeZone('Europe/Rome');
  $dayStart = (new DateTime($date.' 00:00:00', $tz))->format('Y-m-d H:i:s');
  $dayEnd   = (new DateTime($date.' 00:00:00', $tz))->modify('+1 day')->format('Y-m-d H:i:s');

  $q = $pdo->prepare('
    SELECT COUNT(*) AS c
      FROM traffic_interval
     WHERE camera_id = ?
       AND ts_start >= ?
       AND ts_start < ?
  ');
  $q->execute([$camera_id, $dayStart, $dayEnd]);
  $has = ((int)$q->fetch()['c']) > 0;

  echo json_encode([
    'status'        => 'ok',
    'has_intervals' => $has,
    'camera_id'     => $camera_id,
    'lat'           => $lat,
    'lon'           => $lon,
  ]);
}catch(Throwable $e){
  http_response_code(500);
  echo json_encode(['status'=>'error','message'=>$e->getMessage()]);
}
