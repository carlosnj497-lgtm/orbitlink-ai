import 'dart:async';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Guarda o token do dispositivo no armazenamento seguro do Android
/// (Keystore), em vez de texto claro.
class TokenStore {
  // O padrão do plugin já cifra via Keystore do Android.
  static const FlutterSecureStorage _storage = FlutterSecureStorage();

  static const String _tokenKey = 'device_token';
  static const String _deviceIdKey = 'device_id';

  static Future<void> save({
    required String token,
    required String deviceId,
  }) async {
    await _storage.write(key: _tokenKey, value: token);
    await _storage.write(key: _deviceIdKey, value: deviceId);
  }

  static Future<String?> readToken() => _storage.read(key: _tokenKey);

  static Future<String?> readDeviceId() => _storage.read(key: _deviceIdKey);

  static Future<bool> hasToken() async => (await readToken()) != null;

  static Future<void> clear() => _storage.deleteAll();
}
