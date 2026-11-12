"""As colunas padrao do quadro: a lista do servico e a das migrations
concordam. Sem banco: le os arquivos de migration."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from app.modules.tasks.domain.board_defaults import COLUNAS_PADRAO


def test_a_lista_do_SERVICO_e_a_da_MIGRATION_concordam() -> None:
    """⚠️ O teste que justifica a duplicacao.

    `board_defaults.COLUNAS_PADRAO` (servico) e `COLUNAS` da migration `0008`
    sao duas copias da mesma verdade, de proposito: migration que importa
    codigo de aplicacao passa a significar coisas diferentes conforme o codigo
    evolui, e migration ja aplicada tem de continuar significando o que
    significava. O preco da copia e este teste.

    Sem ele, o dia em que as duas divergirem produz um workspace novo com
    quadro diferente do migrado -- e a diferenca so aparece quando a tela ficar
    diferente para uns e nao para outros.
    """
    versoes = Path(__file__).resolve().parents[1] / "alembic" / "versions"

    def _colunas_da(arquivo: str):
        caminho = versoes / arquivo
        assert caminho.exists(), f"migration nao encontrada: {caminho}"
        spec = importlib.util.spec_from_file_location(caminho.stem, caminho)
        assert spec is not None and spec.loader is not None
        modulo = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(modulo)
        return [tuple(linha) for linha in modulo.COLUNAS]

    # (status, rotulo, cor, semantica, avisa_prazo, e_destino)
    do_servico = [
        (
            c.legacy_status.value,
            c.nome,
            c.cor,
            c.semantica.value,
            c.notify_deadline,
            c.is_default_target,
        )
        for c in COLUNAS_PADRAO
    ]

    # ⚠️ TRES copias: a `0008` criou o quadro dos workspaces que ja existiam, a
    # `0011` o dos que tinham nascido sem quadro, e o servico cria o dos novos.
    # As tres tem de concordar, senao o quadro depende de QUANDO o workspace
    # nasceu.
    for arquivo in ("0008_boards_and_columns.py", "0011_task_board_not_null.py"):
        assert do_servico == _colunas_da(arquivo), (
            f"board_defaults.COLUNAS_PADRAO divergiu de {arquivo}. O quadro "
            "passaria a depender de quando o workspace nasceu."
        )
