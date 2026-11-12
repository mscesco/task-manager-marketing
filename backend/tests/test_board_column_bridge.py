"""`BoardColumn.is_status_bridge`, a `@property` de `BoardColumnResponse`."""

from app.db.models.boards import BoardColumn
from app.db.models.enums import TaskStatus


def test_is_status_bridge_e_derivado_do_legacy_status() -> None:
    """E so metade da trava da ponte: a outra e `board.is_default`, e o front
    so esconde o "x" quando as duas sao verdadeiras (`impedimentoDeExclusao`
    em `web/lib/edicaoDeColunas.ts`).

    ⚠️ As quatro colunas base de um quadro AVULSO tambem nascem com
    `legacy_status` (`board_defaults.py`), entao `is_status_bridge` e `True`
    nelas e elas PODEM ser apagadas. Ler este campo sozinho como "nao pode ser
    apagada" sumiria com o "x" de todo quadro avulso.
    """
    assert BoardColumn(legacy_status=TaskStatus.PLANNED).is_status_bridge is True
    assert BoardColumn(legacy_status=None).is_status_bridge is False
