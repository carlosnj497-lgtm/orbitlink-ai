import 'dart:async';
import 'dart:io';

/// Serviço responsável por verificar se a antena Starlink está acessível
/// na rede local do celular.
///
/// No protótipo, faz apenas uma conexão TCP na porta 9200.
/// A leitura real dos dados via gRPC requer a integração com grpc-dart e os
/// arquivos .proto da antena Starlink.
class StarlinkService {
  static const String defaultStarlinkIp = '192.168.100.1';
  static const int defaultGrpcPort = 9200;
  static const Duration timeout = Duration(seconds: 5);

  /// Verifica se conseguimos abrir uma conexão TCP na porta gRPC da antena.
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

  /// Retorna dados simulados da antena para o protótipo.
  /// Substituir pela leitura gRPC real quando integrar os protobufs.
  static Map<String, dynamic> readTelemetryStub() {
    return {
      'reachable': true,
      'snr': 42.0,
      'download_mbps': 120.5,
      'upload_mbps': 15.2,
      'latency_ms': 38.0,
      'pop_ping_latency_ms': 37.0,
      'percent_packet_loss': 0.0,
      'seconds_to_first_nonempty_slot': 0.0,
    };
  }
}
