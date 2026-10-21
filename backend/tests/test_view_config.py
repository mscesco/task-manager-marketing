"""Auditoria de 21/10 -- o `config` da visao da Base tem teto de tamanho."""

import pytest

from app.modules.bases.application.view_service import CONFIG_MAX_BYTES, clean_config
from app.shared.exceptions.base import ValidationError


def test_config_de_visao_tem_teto() -> None:
    assert clean_config({"filters": ["a"]}) == {"filters": ["a"]}
    with pytest.raises(ValidationError) as erro:
        clean_config({"filters": ["x" * CONFIG_MAX_BYTES]})
    assert erro.value.details["field"] == "config"
