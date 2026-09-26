<?php
// api/upload_csv.php — YOLO -> traffic_interval (bucket dinamico via interval_s) con snap alla griglia e skip duplicati
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

function json_error(string $m, int $code = 200): never {
  http_response_code($code);
  echo json_encode(['status'=>'error','message'=>$m], JSON_UNESCAPED_UNICODE);
  exit;
}
function json_ok(array $p): never {
  http_response_code(200);
  echo json_encode($p, JSON_UNESCAPED_UNICODE);
  exit;
}
function pdo(): PDO {
  return new PDO('mysql:host=127.0.0.1;dbname=traffico;charset=utf8mb4','root','',[
    PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,
  ]);
}
// gg[._-]mm[._-]aa -> YYYY-MM-DD
function date_from_filename(string $name): ?string {
  if (preg_match('/(\d{1,2})[._-](\d{1,2})[._-](\d{2})/', $name, $m)) {
    $d=(int)$m[1]; $mo=(int)$m[2]; $y2=(int)$m[3];
    $y = $y2 >= 70 ? 1900 + $y2 : 2000 + $y2;
    if (checkdate($mo,$d,$y)) return sprintf('%04d-%02d-%02d', $y,$mo,$d);
  }
  return null;
}
function osm_meta(float $lat, float $lon): array {
  $url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2'
       . '&lat='.rawurlencode((string)$lat)
       . '&lon='.rawurlencode((string)$lon)
       . '&zoom=14&addressdetails=1&accept-language=it';
  $ctx = stream_context_create(['http'=>[
    'method'=>'GET',
    'header'=>"User-Agent: traffic-uploader/1.0 (+mailto:you@example.com)\r\n",
    'timeout'=>8
  ]]);
  $raw = @file_get_contents($url,false,$ctx);
  $j = $raw ? json_decode($raw,true) : null;
  $a = is_array($j) ? ($j['address'] ?? []) : [];
  return [
    'country_iso2' => isset($a['country_code']) ? strtoupper($a['country_code']) : null,
    'city'         => $a['city'] ?? $a['town'] ?? $a['village'] ?? $a['municipality'] ?? $a['hamlet'] ?? $a['suburb'] ?? null,
    'province'     => $a['province'] ?? $a['county'] ?? $a['state_district'] ?? null,
    'region'       => $a['state'] ?? null,
  ];
}

try {
  // ----- Input minimi
  if (empty($_FILES['file']['tmp_name'])) json_error('File mancante', 400);
  foreach (['lat','lon','t0_iso'] as $k) if (!isset($_POST[$k])) json_error('lat/lon/t0_iso mancanti', 400);

  $fileName = $_FILES['file']['name'] ?? 'file.txt';
  $lat = (float)str_replace(',','.', (string)$_POST['lat']);
  $lon = (float)str_replace(',','.', (string)$_POST['lon']);
  if ($lat<-90 || $lat>90 || $lon<-180 || $lon>180) json_error('Coordinate fuori intervallo', 400);

  // --- path_m: lunghezza tratto in metri -------------------------------
  $path_m = null;
  if (isset($_POST['path_m']) && $_POST['path_m'] !== '') {
    $path_m = (float)str_replace(',', '.', (string)$_POST['path_m']);
    if (!($path_m > 0)) {
      json_error('path_m deve essere un numero positivo (metri).', 400);
    }
  }

  // timezone (solo per upload.tz)
  $tzName = (function($in){
    $in = trim((string)($in ?? ''));
    return ($in && preg_match('/^[A-Za-z]+(?:\/[A-Za-z0-9_\-+]+)+$/',$in)) ? $in : 'Europe/Rome';
  })($_POST['timezone'] ?? null);
  $tz = new DateTimeZone($tzName);

  // --- DATA IMPORT migliorata: usa $_POST['date'] se presente ---
  $rawT0 = (string)$_POST['t0_iso'];
  $importDate = trim((string)($_POST['date'] ?? ''));
  if ($importDate === '') $importDate = date_from_filename($fileName);
  if (!$importDate) {
    try { $importDate = (new DateTime($rawT0))->setTimezone($tz)->format('Y-m-d'); }
    catch (\Throwable) { $importDate = (new DateTime('now', $tz))->format('Y-m-d'); }
  }

  // Interpreta ora esplicita (no placeholder tipo --:--)
  $placeholder = (strpos($rawT0,'--:--') !== false) || (strpos($rawT0,'__:__') !== false);
  $hhmmValid   = (bool)preg_match('/T(?!00:00)(\d{2}):(\d{2})/', $rawT0);
  $t0Explicit  = (($_POST['t0_explicit'] ?? '0') === '1') && $hhmmValid && !$placeholder;

  // Costruisci t0 locale (poi la DATA viene forzata a $importDate)
  try { $t0 = new DateTime($rawT0); }
  catch (\Throwable) { $t0 = new DateTime($importDate.' 00:00:00', $tz); }
  $t0_local = (clone $t0)->setTimezone($tz);
  [$iy,$im,$id] = array_map('intval', explode('-', $importDate));
  $t0_local->setDate($iy,$im,$id);

  $dayStart = new DateTime("$importDate 00:00:00", $tz);
  $dayEnd   = (clone $dayStart)->modify('+1 day');

  // Metadati camera SOLO dal form (OSM lo usiamo solo se la camera è nuova)
  $road = trim((string)($_POST['road'] ?? '')) ?: null;
  $city = trim((string)($_POST['city'] ?? '')) ?: null;
  $prov = trim((string)($_POST['province'] ?? '')) ?: null;
  $reg  = trim((string)($_POST['region'] ?? '')) ?: null;
  $iso2 = strtoupper(trim((string)($_POST['country_iso2'] ?? ''))) ?: null;
  if ($iso2 !== null && !preg_match('/^[A-Z]{2}$/', $iso2)) $iso2 = null;

  // DEBUG container per metadati/OSM
  $geo_debug = [
    'phase'   => 'pre-camera-lookup',
    'from_form' => [
      'iso2'    => $iso2,
      'city'    => $city,
      'province'=> $prov,
      'region'  => $reg,
      'road'    => $road,
      'path_m'  => $path_m,
    ],
    'osm_called'  => false,
    'osm_result'  => null,
    'final_meta'  => null,
  ];

  // ====== Bucket dinamico dall'input ======
  $bucket = isset($_POST['interval_s']) ? (int)$_POST['interval_s'] : 60;
  if ($bucket < 1)    $bucket = 1;
  if ($bucket > 3600) $bucket = 3600;

  $db = pdo();

  // ====== 1) Cerca camera esistente SOLO per lat/lon ======================
  $camera_id = null;

  $s = $db->prepare('SELECT camera_id FROM camera WHERE lat=? AND lon=? LIMIT 1');
  $s->execute([$lat,$lon]);
  if ($r = $s->fetch()) {
    $camera_id = (int)$r['camera_id'];

    // Camera esistente:
    // - aggiorna coord
    // - riempie i campi SOLO se arrivano dal form
    // - path_m viene scritto SOLO se in DB è ancora NULL
    $upd = $db->prepare(
      'UPDATE camera
       SET lat = ?,
           lon = ?,
           country_iso2 = COALESCE(?, country_iso2),
           city         = COALESCE(?, city),
           province     = COALESCE(?, province),
           region       = COALESCE(?, region),
           road         = COALESCE(?, road),
           path_m       = IF(path_m IS NULL, ?, path_m)
       WHERE camera_id = ?'
    );
    $upd->execute([$lat,$lon,$iso2,$city,$prov,$reg,$road,$path_m,$camera_id]);

    $geo_debug['phase'] = 'existing_camera';
    $geo_debug['final_meta'] = [
      'iso2'    => $iso2,
      'city'    => $city,
      'province'=> $prov,
      'region'  => $reg,
      'road'    => $road,
      'path_m'  => $path_m,
    ];
  }

  // ====== 2) Nessuna camera trovata → NUOVA camera ========================
  if ($camera_id === null) {

    $geo_debug['phase'] = 'new_camera_pre_osm';

    // Se mancano metadati, prova da OSM (SOLO per camera nuova)
    if ($iso2===null || $city===null || $prov===null || $reg===null) {
      $geo = osm_meta($lat,$lon);
      $geo_debug['osm_called'] = true;
      $geo_debug['osm_result'] = $geo;

      if ($iso2 === null && !empty($geo['country_iso2'])) $iso2 = $geo['country_iso2'];
      if ($city === null && !empty($geo['city']))         $city = $geo['city'];
      if ($prov === null && !empty($geo['province']))     $prov = $geo['province'];
      if ($reg === null && !empty($geo['region']))        $reg  = $geo['region'];
    }

    $geo_debug['final_meta'] = [
      'iso2'    => $iso2,
      'city'    => $city,
      'province'=> $prov,
      'region'  => $reg,
      'road'    => $road,
      'path_m'  => $path_m,
    ];

    // Per camera nuova path_m è OBBLIGATORIO
    if ($path_m === null) {
      json_error('Per una nuova camera devi indicare la lunghezza del tratto in metri (path_m).', 400);
    }

    $name = mb_substr(pathinfo($fileName, PATHINFO_FILENAME), 0, 255);
    $road = $road ? mb_substr($road, 0, 255) : null;

    $ins = $db->prepare(
      'INSERT INTO camera (name,lat,lon,country_iso2,city,province,region,road,path_m,active)
       VALUES (?,?,?,?,?,?,?,?,?,1)'
    );
    $ins->execute([$name,$lat,$lon,$iso2,$city,$prov,$reg,$road,$path_m]);
    $camera_id = (int)$db->lastInsertId();
  }

  // ---- Primo import del giorno: se non c'è ora esplicita -> ERRORE
  $q = $db->prepare('SELECT COUNT(*) c FROM traffic_interval WHERE camera_id=? AND ts_start>=? AND ts_start<?');
  $q->execute([$camera_id, $dayStart->format('Y-m-d H:i:s'), $dayEnd->format('Y-m-d H:i:s')]);
  $hasAnyThisDay = ((int)$q->fetch()['c']) > 0;
  if (!$hasAnyThisDay && !$t0Explicit) {
    json_error("Per il primo import del giorno $importDate è obbligatoria l’ora di inizio (HH:MM).");
  }

  // ---- Lettura file + FPS
  $raw = file_get_contents($_FILES['file']['tmp_name']);
  if ($raw===false) json_error('Lettura file fallita', 400);
  $raw = preg_replace("/\r\n?/", "\n", $raw);

  $fps = null;
  if (isset($_POST['fps'])) $fps = (float)str_replace(',','.', (string)$_POST['fps']);
  if (!$fps && preg_match('/(?:frame\s*rate|fps)\s*[:=]\s*([\d.]+)/i',$raw,$mmatch)) $fps=(float)$mmatch[1];
  if (!$fps) {
    foreach (preg_split('/\R+/', $raw) as $ln) {
      $t=trim($ln); if($t==='') continue;
      if (preg_match('/^\d+(?:\.\d+)?$/', $t)) { $fps=(float)$t; break; }
    }
  }
  if (!($fps>0)) json_error('FPS non trovato (usa "frame rate: <num>" o passa fps nel form)');

  // ---- Parse YOLO + dedup
  $first = []; $maxF = 0;
  foreach (preg_split('/\R+/', $raw) as $ln) {
    $t = trim($ln); if ($t==='') continue;
    if (!preg_match('/^\d+\s+\d+\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+\d+$/', $t)) continue;
    $p = preg_split('/\s+/', $t);
    $frame = (int)$p[0]; $cid=(int)$p[1]; $tid=(int)$p[6];
    if ($frame<0 || !in_array($cid,[2,3,5,7],true)) continue;
    if (!isset($first[$tid]) || $frame < $first[$tid][0]) $first[$tid] = [$frame,$cid];
    if ($frame > $maxF) $maxF = $frame;
  }
  if (!$first) json_error('Nessuna detection valida nel file');

  $events = count($first);
  $duration_s = (int)round($maxF / $fps);

  // ---- SHA-256 DUPLICATO
  $sha256 = hash_file('sha256', $_FILES['file']['tmp_name']) ?: str_repeat('0',64);
  $chk = $db->prepare('SELECT upload_id FROM upload WHERE sha256=? LIMIT 1');
  $chk->execute([$sha256]);
  if ($chk->fetch()) json_error('Questo file è già stato importato (duplicato SHA-256).');

  // ---- OVERLAP / AUTO-ACCODA
  $newStart = (clone $t0_local);
  $newEnd   = (clone $t0_local)->add(new DateInterval('PT'.max(1,$duration_s).'S'));

  $autoAccoda = false;
  $accodaBase = null;   // DateTime prima dello snap (last_end+1s) se usato
  $snapped    = false;  // se abbiamo effettuato lo snap alla griglia

  if ($t0Explicit) {
    $ov = $db->prepare('SELECT 1 FROM traffic_interval
                        WHERE camera_id=? AND ts_start<? AND TIMESTAMPADD(SECOND,duration_s,ts_start)>?
                        LIMIT 1');
    $ov->execute([$camera_id, $newEnd->format('Y-m-d H:i:s'), $newStart->format('Y-m-d H:i:s')]);
    if ($ov->fetch()) json_error('Sovrapposizione con intervalli esistenti: cambia l’ora di inizio o lascia vuoto per auto-accodare.');
    // Se esplicito, almeno azzera i secondi per mantenere allineamento ragionevole
    $t0_local->setTime((int)$t0_local->format('H'), (int)$t0_local->format('i'), 0);
  } else {
    if ($hasAnyThisDay) {
      $last = $db->prepare('SELECT MAX(TIMESTAMPADD(SECOND,duration_s,ts_start)) last_end
                            FROM traffic_interval
                            WHERE camera_id=? AND ts_start>=? AND ts_start<?');
      $last->execute([$camera_id, $dayStart->format('Y-m-d H:i:s'), $dayEnd->format('Y-m-d H:i:s')]);
      $r = $last->fetch();
      if (!empty($r['last_end'])) {
        $lastEnd = new DateTime($r['last_end'], $tz);
        if ($lastEnd > $t0_local) {
          // auto-accodo: prendi lastEnd+1s, poi SNAP alla griglia del bucket
          $t0_local = (clone $lastEnd)->add(new DateInterval('PT1S'));
          $autoAccoda = true;
          $accodaBase = clone $t0_local; // salva prima dello snap
        }
      }
    }
    // SNAP alla griglia del bucket, secondi = 00 (es. 00:00, 00:10, 00:20, …)
    $t0_local->setTime((int)$t0_local->format('H'), (int)$t0_local->format('i'), 0);
    $delta = $t0_local->getTimestamp() - $dayStart->getTimestamp();
    if ($delta < 0) $delta = 0;
    $aligned = (int)ceil($delta / $bucket) * $bucket; // prossimo scalino
    $t0_local = (clone $dayStart)->add(new DateInterval('PT'.$aligned.'S'));
    $snapped = true;
  }

  // ---- INSERT in transazione (con bucket dinamico + skip duplicati)
  $db->beginTransaction();
  try {
    $stmtUp = $db->prepare('INSERT INTO upload (camera_id, original_name, tz, duration_s, row_count, sha256)
                            VALUES (?,?,?,?,?,?)');
    $stmtUp->execute([$camera_id, $fileName, $tz->getName(), $duration_s, $events, $sha256]);
    $upload_id = (int)$db->lastInsertId();

    // Costruzione bins secondo $bucket (secondi)
    $bins = [];
    foreach ($first as [$f,$cid]) {
      $sec = (int)floor($f / $fps);
      $idx = intdiv($sec, $bucket);
      $bins[$idx] = $bins[$idx] ?? ['cars'=>0,'motos'=>0,'buses'=>0,'trucks'=>0];
      if     ($cid===2) ++$bins[$idx]['cars'];
      elseif ($cid===3) ++$bins[$idx]['motos'];
      elseif ($cid===5) ++$bins[$idx]['buses'];
      elseif ($cid===7) ++$bins[$idx]['trucks'];
    }

    $ins = $db->prepare('INSERT INTO traffic_interval (camera_id,upload_id,ts_start,duration_s,cars,motos,buses,trucks)
                         VALUES (?,?,?,?,?,?,?,?)');

    $skipped = 0;
    foreach ($bins as $idx=>$c) {
      $startSec  = $idx * $bucket;
      $remaining = $duration_s - $startSec;
      if ($remaining <= 0) continue;

      // durata bin = intero bucket, tranne l’ultimo che può essere parziale
      $dur = max(1, min($bucket, $remaining));
      $ts = (clone $t0_local)->add(new DateInterval('PT'.$startSec.'S'));

      try {
        $ins->execute([
          $camera_id,$upload_id,
          $ts->format('Y-m-d H:i:s'),
          $dur,
          (int)$c['cars'],(int)$c['motos'],(int)$c['buses'],(int)$c['trucks']
        ]);
      } catch (PDOException $e) {
        // 23000 = duplicate key -> salta SOLO quell’intervallo
        if ($e->getCode() === '23000') { $skipped++; continue; }
        throw $e;
      }
    }

    $db->commit();
    json_ok([
      'status'            => 'ok',
      'message'           => 'Import intervalli completato',
      'camera_id'         => $camera_id,
      'upload_id'         => $upload_id,
      'fps'               => $fps,
      'events'            => $events,
      'duration_s'        => $duration_s,
      'intervals'         => max(0, count($bins) - $skipped),
      'skipped'           => $skipped,
      'bucket_s'          => $bucket,
      // --- campi extra di debug/telemetria ---
      'has_any_this_day'  => $hasAnyThisDay,
      't0_effective_iso'  => $t0_local->format('Y-m-d H:i:s'),
      't0_effective'      => $t0_local->format('H:i:s'),
      'accoda_base_iso'   => $accodaBase ? $accodaBase->format('Y-m-d H:i:s') : null,
      'accoda_base'       => $accodaBase ? $accodaBase->format('H:i:s')       : null,
      'snapped_to_bucket' => $snapped,

      // 🔍 DEBUG GEO / METADATI
      'meta' => [
        'country_iso2' => $iso2,
        'city'         => $city,
        'province'     => $prov,
        'region'       => $reg,
        'road'         => $road,
        'path_m'       => $path_m,
      ],
      'geo_debug' => $geo_debug,
    ]);

  } catch (Throwable $ex) {
    if ($db->inTransaction()) $db->rollBack();
    json_error('Errore durante il salvataggio degli intervalli: '.$ex->getMessage());
  }
} catch (Throwable $e) {
  json_error($e->getMessage());
}
