<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// evita che warning/notice inquinino il JSON
error_reporting(0);
ini_set('display_errors', '0');

try {
  $pdo = new PDO(
    'mysql:host=127.0.0.1;dbname=traffico;charset=utf8mb4',
    'root',
    '',
    [
      PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]
  );

  $action = isset($_GET['action']) ? trim($_GET['action']) : 'list';

  // 1) LIST COMPLETA (per metrics.loadEF): righe con fattori per veicolo
  if ($action === 'list') {
    $rows = $pdo->query("
      SELECT categoria, cars, motorcycles, heavy_duty_trucks, buses
      FROM emissioni_gkm
      ORDER BY categoria
    ")->fetchAll();

    echo json_encode($rows, JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
  }

  // 2) SOLO NOMI (se mai ti servisse altrove per un semplice select)
  if ($action === 'names') {
    $rows = $pdo->query("
      SELECT DISTINCT categoria
      FROM emissioni_gkm
      ORDER BY categoria
    ")->fetchAll(PDO::FETCH_COLUMN, 0);

    echo json_encode($rows, JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
  }

  // 3) DETTAGLIO DI UN INQUINANTE
  if ($action === 'get') {
    $pollutant = isset($_GET['pollutant']) ? trim($_GET['pollutant']) : '';
    if ($pollutant === '') {
      http_response_code(400);
      echo json_encode(['error' => 'missing pollutant']);
      exit;
    }

    $stmt = $pdo->prepare("
      SELECT categoria, cars, motorcycles, heavy_duty_trucks, buses
      FROM emissioni_gkm
      WHERE categoria = :cat
      LIMIT 1
    ");
    $stmt->execute([':cat' => $pollutant]);
    $row = $stmt->fetch();

    if (!$row) {
      http_response_code(404);
      echo json_encode(['error' => 'not found']);
      exit;
    }

    echo json_encode($row, JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
  }

  http_response_code(400);
  echo json_encode(['error' => 'unknown action']);
  exit;

} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode(['error' => 'server error']);
  exit;
}
