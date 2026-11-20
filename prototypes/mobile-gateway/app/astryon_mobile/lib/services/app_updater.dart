import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:open_filex/open_filex.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import '../models/app_release.dart';
import 'api_exception.dart';
import 'app_config.dart';
import 'version_compare.dart';

/// Verifica, baixa e instala atualizações do app pelo backend ASTRYON.
///
/// O backend publica o manifesto em `GET /api/v1/app/latest` e o APK em
/// `GET /api/v1/app/download`. O APK só é instalado após a conferência do
/// sha256 informado no manifesto.
class AppUpdater {
  static final http.Client _client = http.Client();
  static const Duration _timeout = Duration(seconds: 30);

  /// Versão instalada, lida do build.
  static Future<String> currentVersion() async {
    final info = await PackageInfo.fromPlatform();
    return info.version;
  }

  /// Busca a versão publicada e devolve a atualização se for mais nova.
  static Future<AppRelease?> checkForUpdate() async {
    final base = await AppConfig.apiBaseUrl();
    final response = await _get('$base/app/latest');
    final release = AppRelease.fromJson(_decode(response));
    if (release == null) {
      throw ApiException('Resposta de atualização inválida.');
    }
    final current = await currentVersion();
    return compareVersions(release.version, current) > 0 ? release : null;
  }

  /// Baixa o APK, confere o sha256 e abre o instalador do Android.
  static Future<void> downloadAndInstall(
    AppRelease release, {
    void Function(double progress)? onProgress,
  }) async {
    final directory = await getTemporaryDirectory();
    final file = File('${directory.path}/${release.filename}');

    final request = http.Request('GET', Uri.parse(release.url));
    final response = await _client.send(request).timeout(_timeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(
        'Falha ao baixar a atualização.',
        statusCode: response.statusCode,
      );
    }

    final total = response.contentLength ?? release.size;
    final sink = file.openWrite();
    var received = 0;
    try {
      await for (final chunk in response.stream) {
        sink.add(chunk);
        received += chunk.length;
        if (total > 0) onProgress?.call(received / total);
      }
    } finally {
      await sink.close();
    }

    final digest = await _sha256OfFile(file);
    if (digest != release.sha256) {
      await file.delete();
      throw ApiException('O arquivo baixado está corrompido (sha256 diferente).');
    }

    final result = await OpenFilex.open(
      file.path,
      type: 'application/vnd.android.package-archive',
    );
    if (result.type != ResultType.done) {
      throw ApiException('Não foi possível abrir o instalador: ${result.message}');
    }
  }

  static Future<http.Response> _get(String url) async {
    try {
      return await _client.get(Uri.parse(url)).timeout(_timeout);
    } on TimeoutException {
      throw ApiTimeoutException();
    } on SocketException {
      throw ApiNetworkException();
    } on http.ClientException {
      throw ApiNetworkException();
    }
  }

  static Map<String, dynamic> _decode(http.Response response) {
    if (response.statusCode == 404) {
      throw ApiException(
        'O servidor ainda não publicou nenhuma versão.',
        statusCode: 404,
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(
        'Falha ao consultar a atualização.',
        statusCode: response.statusCode,
      );
    }
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) return decoded;
    } on FormatException {
      // cai no erro abaixo
    }
    throw ApiException('Resposta de atualização inválida.');
  }

  static Future<String> _sha256OfFile(File file) async {
    final digest = await sha256.bind(file.openRead()).first;
    return digest.toString();
  }
}
