import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../models/telemetry.dart';
import 'api_exception.dart';
import 'app_config.dart';
import 'starlink_service.dart';
import 'token_store.dart';

/// Cliente HTTP do backend ASTRYON.
///
/// A URL base vem de [AppConfig] (configurável em Configurações ou via
/// `--dart-define=ASTRYON_API_BASE_URL=...`). O token do dispositivo fica no
/// armazenamento seguro ([TokenStore]) e nunca é exposto à interface.
class ApiService {
  static final http.Client _client = http.Client();
  static const Duration _timeout = Duration(seconds: 20);

  /// Registra o dispositivo e guarda o token no armazenamento seguro.
  static Future<Map<String, dynamic>> registerDevice({
    required String pairingCode,
    required String deviceName,
  }) async {
    final base = await AppConfig.apiBaseUrl();
    final response = await _post(
      '$base/devices/register',
      {
        'pairing_code': pairingCode,
        'device_name': deviceName,
        'starlink_ip': StarlinkService.defaultStarlinkIp,
        'starlink_model': 'unknown',
      },
    );
    final data = _decode(response);
    await TokenStore.save(
      token: data['device_token'] as String,
      deviceId: data['device_id'] as String,
    );
    return data;
  }

  /// Envia uma amostra de telemetria com a origem explícita.
  ///
  /// A origem (`real`, `demo`, `unavailable`) acompanha o payload para que o
  /// backend e a interface nunca tratem um dado fictício como real.
  static Future<Map<String, dynamic>> sendTelemetry(
    TelemetrySample sample,
  ) async {
    final token = await TokenStore.readToken();
    if (token == null) {
      throw ApiException('Dispositivo não registrado.', statusCode: 401);
    }

    final base = await AppConfig.apiBaseUrl();
    final isDemo = sample.origin == TelemetryOrigin.demo;
    final response = await _post(
      '$base/telemetry',
      {
        'timestamp': DateTime.now().toUtc().toIso8601String(),
        'source': isDemo ? 'mobile_gateway_demo' : 'mobile_gateway',
        'origin': sample.origin.name,
        'data': sample.data,
      },
      headers: {'X-Device-Token': token},
    );
    return _decode(response);
  }

  /// Apaga o token e o identificador do dispositivo.
  static Future<void> clearCredentials() => TokenStore.clear();

  static Future<http.Response> _post(
    String url,
    Map<String, dynamic> body, {
    Map<String, String>? headers,
  }) async {
    try {
      return await _client
          .post(
            Uri.parse(url),
            headers: {
              'Content-Type': 'application/json',
              ...?headers,
            },
            body: jsonEncode(body),
          )
          .timeout(_timeout);
    } on TimeoutException {
      throw ApiTimeoutException();
    } on SocketException {
      throw ApiNetworkException();
    } on http.ClientException {
      throw ApiNetworkException();
    }
  }

  static Map<String, dynamic> _decode(http.Response response) {
    Map<String, dynamic>? json;
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) json = decoded;
    } on FormatException {
      json = null;
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return json ?? <String, dynamic>{};
    }

    final detail = json?['detail'];
    throw ApiException(
      detail is String ? detail : 'Falha na comunicação com o servidor.',
      statusCode: response.statusCode,
    );
  }
}
