// Serviço gRPC real da antena Starlink.
//
// ⚠️ Este arquivo só compila depois que o código Dart dos protobufs for gerado:
//
//   bash tool/gen_protos.sh
//
// Depois, importe este serviço no dashboard e substitua o retorno de
// `StarlinkService.readTelemetry()` por `StarlinkGrpcService.readStatus()`.
//
// Enquanto os protobufs não forem gerados, o arquivo fica fora da análise
// estática (ver `analysis_options.yaml`); as linhas de ignore abaixo mantêm a
// análise limpa mesmo se o arquivo for reabilitado sem o código gerado.
//
// ignore_for_file: uri_does_not_exist, undefined_class, undefined_identifier
// ignore_for_file: undefined_method, undefined_getter, undefined_function
// ignore_for_file: undefined_setter, non_type_as_type_argument, not_a_type
// ignore_for_file: creation_with_non_type, extends_non_class

import 'package:grpc/grpc.dart';

import '../generated/spacex_api/device/device.pbgrpc.dart';
import '../generated/spacex_api/device/device.pb.dart';
import '../generated/spacex_api/device/dish.pb.dart';

class StarlinkGrpcService {
  static const String defaultIp = '192.168.100.1';
  static const int defaultPort = 9200;

  /// Lê o status atual da antena via gRPC.
  static Future<Map<String, dynamic>> readStatus({
    String ip = defaultIp,
    int port = defaultPort,
    Duration timeout = const Duration(seconds: 10),
  }) async {
    final channel = ClientChannel(
      ip,
      port: port,
      options: ChannelOptions(
        credentials: ChannelCredentials.insecure(),
        connectionTimeout: timeout,
      ),
    );

    final client = DeviceClient(channel);

    try {
      final response = await client.handle(
        Request(getStatus: GetStatusRequest()),
        options: CallOptions(timeout: timeout),
      );

      final status = response.dishGetStatus;

      return {
        'reachable': true,
        'dish_id': status.deviceInfo.id,
        'hardware_version': status.deviceInfo.hardwareVersion,
        'software_version': status.deviceInfo.softwareVersion,
        'country_code': status.deviceInfo.countryCode,
        'uptime_s': status.deviceState.uptimeS.toInt(),
        'downlink_throughput_bps': status.downlinkThroughputBps,
        'uplink_throughput_bps': status.uplinkThroughputBps,
        'pop_ping_latency_ms': status.popPingLatencyMs,
        'pop_ping_drop_rate': status.popPingDropRate,
        'obstruction_fraction': status.obstructionStats.fractionObstructed,
        'currently_obstructed': status.obstructionStats.currentlyObstructed,
        'stow_requested': status.stowRequested,
        'eth_speed_mbps': status.ethSpeedMbps,
        'is_snr_above_noise_floor': status.isSnrAboveNoiseFloor,
      };
    } finally {
      await channel.shutdown();
    }
  }

  /// Lê o histórico de curto prazo (~15 min a 1 Hz) e resume os dados.
  static Future<Map<String, dynamic>> readHistory({
    String ip = defaultIp,
    int port = defaultPort,
    Duration timeout = const Duration(seconds: 10),
  }) async {
    final channel = ClientChannel(
      ip,
      port: port,
      options: ChannelOptions(
        credentials: ChannelCredentials.insecure(),
        connectionTimeout: timeout,
      ),
    );

    final client = DeviceClient(channel);

    try {
      final response = await client.handle(
        Request(getHistory: GetHistoryRequest()),
        options: CallOptions(timeout: timeout),
      );

      final history = response.dishGetHistory;
      final down = history.downlinkThroughputBps;
      final up = history.uplinkThroughputBps;
      final latency = history.popPingLatencyMs;
      final drop = history.popPingDropRate;

      return {
        'samples': down.length,
        'downlink_avg_bps': _avg(down),
        'uplink_avg_bps': _avg(up),
        'latency_avg_ms': _avg(latency),
        'drop_rate_avg': _avg(drop),
      };
    } finally {
      await channel.shutdown();
    }
  }

  static double _avg(List<double> values) {
    if (values.isEmpty) return 0;
    final total = values.fold<double>(0, (sum, value) => sum + value);
    return total / values.length;
  }
}
