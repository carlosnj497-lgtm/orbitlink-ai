import 'package:flutter_test/flutter_test.dart';

import 'package:astryon_mobile/services/app_config.dart';

void main() {
  group('normalizeApiBaseUrl', () {
    test('mantém URL https válida e remove barras finais', () {
      expect(
        normalizeApiBaseUrl(' https://servidor.local/api/v1/ '),
        'https://servidor.local/api/v1',
      );
    });

    test('aceita http na rede local', () {
      expect(
        normalizeApiBaseUrl('http://192.168.1.100:8000/api/v1'),
        'http://192.168.1.100:8000/api/v1',
      );
    });

    test('rejeita esquema ausente ou não suportado', () {
      expect(normalizeApiBaseUrl('192.168.1.100:8000/api/v1'), '');
      expect(normalizeApiBaseUrl('ftp://servidor/api'), '');
    });

    test('rejeita vazio e host ausente', () {
      expect(normalizeApiBaseUrl('   '), '');
      expect(normalizeApiBaseUrl('http://'), '');
    });
  });

  group('isValidApiBaseUrl', () {
    test('acompanha a normalização', () {
      expect(isValidApiBaseUrl('https://a/api/v1'), isTrue);
      expect(isValidApiBaseUrl('não é url'), isFalse);
    });
  });
}
