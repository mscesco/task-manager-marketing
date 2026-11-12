"""Guarda estrutural: a duplicacao de tarefa nao commita por dentro."""

from __future__ import annotations

import inspect

from app.modules.tasks.application.task_service import TaskService


def test_duplicacao_nao_commita_por_dentro() -> None:
    """Os metodos da duplicacao nao contem `commit`; quem commita e o router.

    ⚠️ Le o codigo-fonte porque nenhum teste de comportamento pega: no harness
    de integracao (`join_transaction_mode="create_savepoint"`) o `commit()` vira
    RELEASE SAVEPOINT e nao chega no banco. Um commit no laco de filhos deixaria
    meia arvore no quadro quando a duplicacao falhasse no meio.
    Renomear um destes metodos exige atualizar a lista.
    """
    for metodo in (
        TaskService.duplicate,
        TaskService._copiar_subarvore,
        TaskService._herdados_da_filha,
        TaskService._validar_mapa_de_subtarefas,
    ):
        fonte = inspect.getsource(metodo)
        # Tira as linhas de comentario/docstring: elas FALAM de commit.
        codigo = "\n".join(
            linha
            for linha in fonte.splitlines()
            if not linha.strip().startswith("#")
        )
        corpo = codigo.split('"""')
        # Indices impares sao docstrings; junta so o codigo de verdade.
        codigo_sem_doc = "".join(corpo[::2])
        assert "commit" not in codigo_sem_doc, (
            f"{metodo.__name__} commita por dentro: a duplicacao deixa de ser "
            "atomica e nenhum teste de comportamento pega (ver docstring)."
        )
