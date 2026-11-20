#!/usr/bin/env bash
#
# Gera o código Dart a partir dos arquivos .proto da Starlink.
#
# Pré-requisitos:
#   - protoc instalado (https://github.com/protocolbuffers/protobuf/releases)
#   - Flutter/Dart instalado
#
# Uso:
#   bash tool/gen_protos.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v protoc >/dev/null 2>&1; then
  echo "Erro: protoc não encontrado. Instale o Protocol Buffers compiler." >&2
  exit 1
fi

if ! command -v dart >/dev/null 2>&1; then
  echo "Erro: dart não encontrado. Instale o Flutter/Dart." >&2
  exit 1
fi

# Instala o plugin Dart para protoc, se necessário.
if ! command -v protoc-gen-dart >/dev/null 2>&1; then
  dart pub global activate protoc_plugin
fi

export PATH="$PATH:$HOME/.pub-cache/bin"
mkdir -p lib/generated

find protos -name '*.proto' -print0 \
  | xargs -0 protoc --dart_out=grpc:lib/generated -I protos

echo "Código Dart gerado em lib/generated/"
echo "Agora importe lib/services/starlink_grpc_service.dart no dashboard."
