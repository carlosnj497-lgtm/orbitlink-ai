import 'package:workmanager/workmanager.dart';

import 'api_service.dart';
import 'starlink_service.dart';

/// Nome da tarefa periódica registrada no Workmanager.
const String telemetryTaskName = 'astryon_telemetry_periodic';

/// Callback executado em background.
/// Precisa ser uma função top-level com @pragma('vm:entry-point').
@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    try {
      final reachable = await StarlinkService.isReachable();
      if (!reachable) {
        return true; // Sem antena na rede, não há o que enviar.
      }

      final telemetry = StarlinkService.readTelemetryStub();
      await ApiService.sendTelemetry(telemetry);
      return true;
    } catch (_) {
      return false;
    }
  });
}

class BackgroundService {
  /// Inicializa o Workmanager. Chame uma vez no main().
  static Future<void> init() async {
    await Workmanager().initialize(callbackDispatcher);
  }

  /// Registra a coleta periódica.
  ///
  /// No Android, a frequência mínima é de 15 minutos.
  static Future<void> startPeriodic({
    Duration frequency = const Duration(minutes: 15),
  }) async {
    await Workmanager().registerPeriodicTask(
      'astryon-periodic',
      telemetryTaskName,
      frequency: frequency,
      constraints: Constraints(networkType: NetworkType.connected),
      existingWorkPolicy: ExistingPeriodicWorkPolicy.update,
    );
  }

  /// Cancela a coleta periódica.
  static Future<void> stop() async {
    await Workmanager().cancelByUniqueName('astryon-periodic');
  }
}
