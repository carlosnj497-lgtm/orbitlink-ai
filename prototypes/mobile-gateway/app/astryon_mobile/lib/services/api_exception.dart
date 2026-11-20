/// Erro de comunicação com o backend, carregando o código HTTP quando houver.
class ApiException implements Exception {
  ApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  /// Token ausente, inválido ou revogado — o aparelho precisa parear de novo.
  bool get isUnauthorized => statusCode == 401 || statusCode == 403;

  @override
  String toString() =>
      statusCode == null ? message : 'Erro $statusCode: $message';
}

/// O servidor demorou demais para responder.
class ApiTimeoutException extends ApiException {
  ApiTimeoutException()
      : super(
          'O servidor demorou para responder. '
          'Verifique a conexão e tente novamente.',
        );
}

/// Não foi possível abrir conexão com o servidor.
class ApiNetworkException extends ApiException {
  ApiNetworkException()
      : super(
          'Não foi possível alcançar o servidor. '
          'Confira a URL configurada e a rede do ASTRYON.',
        );
}
