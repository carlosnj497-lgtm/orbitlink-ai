library;

final _codePattern = RegExp(r'^[A-F0-9]{4}-[A-F0-9]{4}$');

String normalizePairingCode(String value) => value.trim().toUpperCase();

bool isValidPairingCode(String value) =>
    _codePattern.hasMatch(normalizePairingCode(value));

/// Extrai um código impresso sozinho ou em um link `astryon://pair?code=...`.
String? parsePairingCode(String rawValue) {
  final value = rawValue.trim();
  if (isValidPairingCode(value)) return normalizePairingCode(value);

  final uri = Uri.tryParse(value);
  if (uri == null) return null;

  for (final key in const ['code', 'pairing_code']) {
    final parameter = uri.queryParameters[key];
    if (parameter != null && isValidPairingCode(parameter)) {
      return normalizePairingCode(parameter);
    }
  }
  return null;
}
