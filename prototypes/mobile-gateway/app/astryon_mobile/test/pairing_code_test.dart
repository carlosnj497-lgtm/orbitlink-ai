import 'package:flutter_test/flutter_test.dart';

import 'package:astryon_mobile/pairing_code.dart';

void main() {
  group('parsePairingCode', () {
    test('normaliza código impresso', () {
      expect(parsePairingCode('  a3b7-x9k2  '), 'A3B7-X9K2');
    });

    test('extrai código de um link ASTRYON', () {
      expect(
        parsePairingCode('astryon://pair?code=a3b7-x9k2'),
        'A3B7-X9K2',
      );
    });

    test('extrai código de uma URL HTTPS', () {
      expect(
        parsePairingCode('https://painel.local/parear?pairing_code=A3B7-X9K2'),
        'A3B7-X9K2',
      );
    });

    test('rejeita conteúdo sem código válido', () {
      expect(parsePairingCode('https://example.com'), isNull);
      expect(parsePairingCode('A3B7-X9K2-EXTRA'), isNull);
      expect(parsePairingCode('A3B7-X9K'), isNull);
      expect(parsePairingCode('A3B7_X9K2'), isNull);
    });
  });
}
