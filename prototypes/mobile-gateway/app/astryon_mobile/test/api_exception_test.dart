import 'package:flutter_test/flutter_test.dart';

import 'package:astryon_mobile/services/api_exception.dart';

void main() {
  test('isUnauthorized reconhece 401 e 403', () {
    expect(ApiException('x', statusCode: 401).isUnauthorized, isTrue);
    expect(ApiException('x', statusCode: 403).isUnauthorized, isTrue);
    expect(ApiException('x', statusCode: 404).isUnauthorized, isFalse);
  });

  test('toString inclui o código quando presente', () {
    expect(ApiException('falha', statusCode: 500).toString(), 'Erro 500: falha');
    expect(ApiException('falha').toString(), 'falha');
  });

  test('rede e timeout são ApiException', () {
    expect(ApiTimeoutException(), isA<ApiException>());
    expect(ApiNetworkException(), isA<ApiException>());
  });
}
