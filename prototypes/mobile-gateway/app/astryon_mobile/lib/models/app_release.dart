/// Manifesto da atualização do app, servido pelo backend ASTRYON em
/// `GET /api/v1/app/latest`.
class AppRelease {
  const AppRelease({
    required this.version,
    required this.url,
    required this.sha256,
    required this.size,
    required this.filename,
    this.notes,
  });

  /// Versão publicada (ex.: `0.3.0`).
  final String version;

  /// URL do APK para download.
  final String url;

  /// Hash sha256 do APK, conferido antes de instalar.
  final String sha256;

  /// Tamanho do APK em bytes (0 quando desconhecido).
  final int size;

  /// Nome sugerido do arquivo.
  final String filename;

  /// Notas da versão, quando informadas.
  final String? notes;

  /// Lê um [AppRelease] de um JSON; devolve `null` se faltar campo essencial.
  static AppRelease? fromJson(Map<String, dynamic> json) {
    final version = json['version'];
    final url = json['url'];
    final sha256 = json['sha256'];
    if (version is! String || url is! String || sha256 is! String) return null;
    if (version.isEmpty || url.isEmpty || sha256.isEmpty) return null;

    return AppRelease(
      version: version,
      url: url,
      sha256: sha256.toLowerCase(),
      size: json['size'] is int ? json['size'] as int : 0,
      filename: json['filename'] is String && (json['filename'] as String).isNotEmpty
          ? json['filename'] as String
          : 'astryon-mobile.apk',
      notes: json['notes'] is String && (json['notes'] as String).isNotEmpty
          ? json['notes'] as String
          : null,
    );
  }
}
