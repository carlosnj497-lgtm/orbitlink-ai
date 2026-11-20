import 'package:flutter_test/flutter_test.dart';

import 'package:astryon_mobile/services/version_compare.dart';

void main() {
  group('compareVersions', () {
    test('detecta versão mais nova, mais antiga e igual', () {
      expect(compareVersions('0.3.0', '0.2.0'), greaterThan(0));
      expect(compareVersions('0.2.0', '0.3.0'), lessThan(0));
      expect(compareVersions('0.2.0', '0.2.0'), 0);
    });

    test('compara por partes numéricas, não como texto', () {
      expect(compareVersions('0.10.0', '0.9.0'), greaterThan(0));
      expect(compareVersions('1.0.0', '0.99.99'), greaterThan(0));
    });

    test('ignora metadados de build e pré-lançamento', () {
      expect(compareVersions('0.2.0+1', '0.2.0'), 0);
      expect(compareVersions('0.2.0-beta', '0.2.0'), 0);
      expect(compareVersions('0.3.0-beta.1', '0.2.9'), greaterThan(0));
    });

    test('trata número de partes diferente', () {
      expect(compareVersions('1.2', '1.2.1'), lessThan(0));
      expect(compareVersions('1.2.0', '1.2'), 0);
    });
  });
}
