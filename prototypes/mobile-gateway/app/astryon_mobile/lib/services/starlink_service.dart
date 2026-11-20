import 'dart:async';
import 'dart:io';

import '../models/telemetry.dart';

/// Acesso à antena Starlink na rede local.
///
/// No protótipo, há a verificação TCP de alcance e uma amostra de
/// demonstração. A leitura real via gRPC depende da geração dos protobufs
/// (`tool/gen_protos.sh`) e da integração do `StarlinkGrpcService`.
class StarlinkService {
  static const String defaultStarlinkIp = '192.168.100.1';
  static const int defaultGrpcPort = 9200;
  static const Duration timeout = Duration(seconds: 5);

  /// Abre uma conexão TCP na porta gRPC da antena.
  static Future<bool> isReachable() async {
    try {
      final socket = await Socket.connect(
        defaultStarlinkIp,
        defaultGrpcPort,
        timeout: timeout,
      );
      await socket.close();
      return true;
    } on SocketException {
      return false;
    } on TimeoutException {
      return false;
    } catch (_) {
      return false;
    }
  }

  /// Lê a telemetria real da antena.
  ///
  /// Enquanto a leitura gRPC não estiver integrada, devolve `null`: preferimos
  /// uma lacuna explícita a um dado inventado. Troque o corpo por
  /// `StarlinkGrpcService.readStatus()` ao gerar os protobufs.
  static Future<TelemetrySample?> readTelemetry() async {
    return null;
  }

  /// Amostra fictícia, usada apenas para validar o pipeline de ponta a ponta.
  ///
  /// Sempre marcada como [TelemetryOrigin.demo] — nunca é enviada como real.
  static TelemetrySample readDemoTelemetry() {
    return const TelemetrySample(
      origin: TelemetryOrigin.demo,
      data: {
        'reachable': true,
        'snr': 42.0,
        'download_mbps': 120.5,
        'upload_mbps': 15.2,
        'latency_ms': 38.0,
        'pop_ping_latency_ms': 37.0,
        'percent_packet_loss': 0.0,
        'seconds_to_first_nonempty_slot': 0.0,
      },
    );
  }
}
