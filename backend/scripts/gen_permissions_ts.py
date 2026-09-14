"""Gera `web/lib/permissions.generated.ts` a partir do mapa de permissoes.

Spec 049, fatia A (§4.8). O front consultava permissao por STRING solta
(`me.permissions.includes("team.manage")`), e renomear uma permissao no backend
fazia o botao sumir sem erro nenhum -- com os quatro portoes verdes. Com o
arquivo gerado, `permissions` passa a ser `Permission[]` e o `tsc` recusa o
nome que nao existe mais.

Uso (de `backend/`):

    docker compose run --rm api-dev python -m scripts.gen_permissions_ts

⚠️ O ARQUIVO E COMMITADO, e nao gerado no build: o job `front` do CI nao tem
Python, e o `next build` do dev dela nao deve depender do backend. Quem garante
que ele esta em dia e `tests/test_permissions_generated_ts.py`, que compara o
que este script geraria com o que esta no disco.
"""

from __future__ import annotations

from pathlib import Path

from app.modules.auth.domain.permissions import ALL_PERMISSIONS

#: `backend/scripts/` -> raiz do repositorio -> `web/lib/`.
#: ⚠️ No container `api-dev` o backend e `/app`, e o `docker-compose.yml` monta
#: `./web/lib` em `/web/lib` -- o mesmo caminho relativo que no CI.
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
