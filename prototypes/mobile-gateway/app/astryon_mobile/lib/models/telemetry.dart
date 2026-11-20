/// Origem de um dado coletado, no mesmo vocabulário do agente ASTRYON.
///
/// Um dado nunca é apresentado como real quando não é: `demo` cobre as
/// amostras fictícias usadas para validar o pipeline, e `unavailable` marca o
/// que o firmware ainda não informa.
enum TelemetryOrigin { real, demo, unavailable }

extension TelemetryOriginLabel on TelemetryOrigin {
  /// Rótulo legível, em português, para exibir na interface.
  String get label => switch (this) {
        TelemetryOrigin.real => 'real',
        TelemetryOrigin.demo => 'demonstração',
        TelemetryOrigin.unavailable => 'indisponível',
      };
}

/// Uma leitura da antena com a origem explícita dos dados.
class TelemetrySample {
  const TelemetrySample({required this.origin, required this.data});

  final TelemetryOrigin origin;
  final Map<String, dynamic> data;
}
