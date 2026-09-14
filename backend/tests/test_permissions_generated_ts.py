"""Spec 049, fatia A -- o tipo de permissao do front esta em dia com o mapa?

⚠️ ESTE TESTE E O GUARDIAO DO ARQUIVO GERADO, e mora no BACKEND de proposito:
o job `front` do CI nao tem Python, e o job `backend` faz checkout do
repositorio inteiro -- entao `../web/lib/` existe la.

⚠️ E ELE FALHA, E NAO PULA, quando a pasta nao existe. Um `skip` aqui seria o
mesmo verde de mentira do `TEST_DATABASE_URL` ausente: na maquina da Camila o
container `api-dev` so enxerga `web/lib` porque o `docker-compose.yml` monta a
pasta -- e quem rodar sem a montagem precisa saber, e nao ver "passed".
"""

from __future__ import annotations

from scripts.gen_permissions_ts import TARGET, render


def test_o_arquivo_gerado_esta_em_dia_com_o_mapa() -> None:
    assert TARGET.parent.is_dir(), (
        f"{TARGET.parent} nao existe. No container `api-dev`, o "
        "`docker-compose.yml` precisa montar `./web/lib:/web/lib`; no CI, o "
        "checkout e do repositorio inteiro."
    )
    assert TARGET.is_file(), (
        f"{TARGET} nao existe. Gere com: "
        "docker compose run --rm api-dev python -m scripts.gen_permissions_ts"
    )
    no_disco = TARGET.read_text(encoding="utf-8")
    assert no_disco == render(), (
        "web/lib/permissions.generated.ts esta ATRASADO em relacao ao mapa "
        "de permissoes. Regenere com: "
        "docker compose run --rm api-dev python -m scripts.gen_permissions_ts "
        "-- e rode o `tsc` do front, que vai apontar cada tela com nome velho."
    )
