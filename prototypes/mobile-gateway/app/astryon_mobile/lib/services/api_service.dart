import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// URL base do backend.
/// No protótipo, aponte para o IP da máquina onde o FastAPI está rodando.
/// Para testar com celular físico, não use localhost — use o IP da rede local.
// ignore: constant_identifier_names
const String API_BASE_URL = 'http://192.168.1.100:8000/api/v1';

class ApiService {
  static final http.Client _client = http.Client();

  /// Cria um código de pareamento (normalmente chamado pelo servidor/web).
  static Future<Map<String, dynamic>> createPairingCode(String userId) async {
    final response = await _client.post(
      Uri.parse('$API_BASE_URL/auth/pairing'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'user_id': userId}),
    );
    return _handleResponse(response);
  }

  /// Registra o dispositivo mobile usando o código de pareamento.
  static Future<Map<String, dynamic>> registerDevice({
    required String pairingCode,
    required String deviceName,
  }) async {
    final response = await _client.post(
      Uri.parse('$API_BASE_URL/devices/register'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'pairing_code': pairingCode,
        'device_name': deviceName,
        'starlink_ip': '192.168.100.1',
        'starlink_model': 'unknown',
      }),
    );
    final data = _handleResponse(response);

    // Salva o token localmente.
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('device_token', data['device_token']);
    await prefs.setString('device_id', data['device_id']);

    return data;
  }

  /// Envia um pacote de telemetria para o backend.
  static Future<Map<String, dynamic>> sendTelemetry(
    Map<String, dynamic> telemetryData,
  ) async {
    final token = await _getDeviceToken();
    if (token == null) {
      throw Exception('Dispositivo não registrado.');
    }

    final response = await _client.post(
      Uri.parse('$API_BASE_URL/telemetry'),
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': token,
      },
      body: jsonEncode({
        'timestamp': DateTime.now().toUtc().toIso8601String(),
        'source': 'mobile_gateway',
        'data': telemetryData,
      }),
    );
    return _handleResponse(response);
  }

  /// Lista dispositivos cadastrados (útil para debug).
  static Future<List<dynamic>> listDevices() async {
    final response = await _client.get(Uri.parse('$API_BASE_URL/devices'));
    final data = _handleResponse(response);
    return data['devices'] as List<dynamic>;
  }

  static Future<String?> _getDeviceToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('device_token');
  }

  static Map<String, dynamic> _handleResponse(http.Response response) {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw HttpException(
      'Erro ${response.statusCode}: ${response.body}',
      uri: response.request?.url,
    );
  }
}
