/// Compara versões numéricas simples (estilo semver).
///
/// Devolve `> 0` se [a] for mais nova que [b], `< 0` se mais antiga e `0` se
/// iguais. Ignora metadados de build (`+1`) e pré-lançamento (`-beta`).
int compareVersions(String a, String b) {
  final pa = _parse(a);
  final pb = _parse(b);
  final length = pa.length > pb.length ? pa.length : pb.length;
  for (var i = 0; i < length; i++) {
    final va = i < pa.length ? pa[i] : 0;
    final vb = i < pb.length ? pb[i] : 0;
    if (va != vb) return va.compareTo(vb);
  }
  return 0;
}

List<int> _parse(String value) {
  final core = value.split('+').first;
  final main = core.split('-').first;
  return main
      .split('.')
      .map((part) => int.tryParse(part.replaceAll(RegExp(r'[^0-9]'), '')) ?? 0)
      .toList();
}
