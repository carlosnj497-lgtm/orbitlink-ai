import 'dart:async';

import 'package:shared_preferences/shared_preferences.dart';

/// URL do backend por padrão, substituível em tempo de build:
///
///   flutter build apk --dart-define=ASTRYON_API_BASE_URL=https://meu.servidor/api/v1
const String defaultApiBaseUrl = String.fromEnvironment(
  'ASTRYON_API_BASE_URL',
  defaultValue: 'http://192.168.1.100:8000/api/v1',
);

const String _apiBaseUrlKey = 'api_base_url';
const String _backgroundKey = 'background_enabled';

/// Normaliza a URL base do backend.
///
/// Aceita apenas `http` ou `https`, exige host e remove barras finais.
/// Devolve `''` quando a entrada não serve.
String normalizeApiBaseUrl(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return '';

  final uri = Uri.tryParse(trimmed);
  if (uri == null || !uri.hasScheme || uri.host.isEmpty) return '';
  if (uri.scheme != 'http' && uri.scheme != 'https') return '';

  var result = trimmed;
  while (result.endsWith('/')) {
    result = result.substring(0, result.length - 1);
  }
  return result;
}

/// Indica se a entrada é uma URL base aceitável.
bool isValidApiBaseUrl(String value) => normalizeApiBaseUrl(value).isNotEmpty;

/// Configuração local do app, persistida em `SharedPreferences`.
class AppConfig {
  /// URL base efetiva: a salva pelo usuário ou a padrão.
  static Future<String> apiBaseUrl() async {
    final prefs = await SharedPreferences.getInstance();
    final normalized =
        normalizeApiBaseUrl(prefs.getString(_apiBaseUrlKey) ?? '');
    return normalized.isEmpty ? defaultApiBaseUrl : normalized;
  }

  /// Salva a URL base. Uma entrada vazia restaura o padrão.
  static Future<void> setApiBaseUrl(String value) async {
    final prefs = await SharedPreferences.getInstance();
    final normalized = normalizeApiBaseUrl(value);
    if (normalized.isEmpty) {
      await prefs.remove(_apiBaseUrlKey);
    } else {
      await prefs.setString(_apiBaseUrlKey, normalized);
    }
  }

  static Future<bool> backgroundEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_backgroundKey) ?? false;
  }

  static Future<void> setBackgroundEnabled(bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_backgroundKey, value);
  }
}
