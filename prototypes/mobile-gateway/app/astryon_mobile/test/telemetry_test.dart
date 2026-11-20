import 'package:flutter_test/flutter_test.dart';

import 'package:astryon_mobile/models/telemetry.dart';
import 'package:astryon_mobile/services/starlink_service.dart';

void main() {
  test('a amostra de demonstração é marcada como demo', () {
    final sample = StarlinkService.readDemoTelemetry();
    expect(sample.origin, TelemetryOrigin.demo);
    expect(sample.origin.label, 'demonstração');
    expect(sample.data, isNotEmpty);
  });

  test('sem leitura real, devolve nulo em vez de inventar dados', () async {
    expect(await StarlinkService.readTelemetry(), isNull);
  });
}
