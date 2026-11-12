"""Gera `web/lib/permissions.generated.ts` a partir do mapa de permissoes,
para o `tsc` recusar nome de permissao que nao existe.

Uso (de `backend/`):

    docker compose run --rm api-dev python -m scripts.gen_permissions_ts

O arquivo e commitado (o CI do front nao tem Python);
`tests/test_permissions_generated_ts.py` acusa se ficar atrasado.
"""

from __future__ import annotations

from pathlib import Path

from app.modules.auth.domain.permissions import ALL_PERMISSIONS

#: No container `api-dev` o compose monta `./web/lib` em `/web/lib`: mesmo caminho relativo.
TARGET = Path(__file__).resolve().parents[2] / "web" / "lib" / "permissions.generated.ts"


def render() -> str:
    """O conteudo do arquivo, deterministico (ordem alfabetica)."""
    linhas = "\n".join(f'  "{p}",' for p in sorted(ALL_PERMISSIONS))
    return (
        "// ⚠️ GERADO por `backend/scripts/gen_permissions_ts.py` -- NAO EDITE A MAO.\n"
        "//\n"
        "// A lista vem de `ALL_PERMISSIONS` (backend/app/modules/auth/domain/\n"
        "// permissions.py). Mudou o mapa? Rode, de `backend/`:\n"
        "//\n"
        "//     docker compose run --rm api-dev python -m scripts.gen_permissions_ts\n"
        "//\n"
        "// e o `tsc` aponta cada tela que ainda usa um nome que saiu. O teste\n"
        "// `backend/tests/test_permissions_generated_ts.py` falha se este arquivo\n"
        "// estiver atrasado em relacao ao mapa.\n"
        "\n"
        "export const PERMISSIONS = [\n"
        f"{linhas}\n"
        "] as const;\n"
        "\n"
        "export type Permission = (typeof PERMISSIONS)[number];\n"
    )


def main() -> None:
    TARGET.write_text(render(), encoding="utf-8", newline="\n")
    print(f"escrito: {TARGET} ({len(ALL_PERMISSIONS)} permissoes)")


if __name__ == "__main__":
    main()
