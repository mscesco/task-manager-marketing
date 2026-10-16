"""Toda rota de ESCRITA tem linha na matriz de permissoes -- ou um motivo.

Auditoria de testes de 16/10. A matriz HTTP (`integration/test_matriz_de_
permissoes_http_db.py`) roda cada rota com os seis papeis, e e ela que pega a
familia do defeito de setembro (o reset de senha que chegou a producao: regra
no SERVICO, rota que ninguem chamava por HTTP com cada papel). Mas nada
obrigava rota NOVA a ganhar linha: em 16/10, 42 das 93 rotas de escrita
estavam fora -- entre elas importar e exportar a Base, lancadas no mesmo dia.

Este teste e o portao. Toda rota POST/PUT/PATCH/DELETE do app tem de estar:

    - na `MATRIZ`; ou
    - em `FORA_POR_DESENHO`, com o motivo (a prosa "O QUE ESTA TABELA NAO
      COBRE" do topo da matriz, agora como dado); ou
    - em `PENDENTE` -- a divida medida em 16/10. Essa lista SO ENCOLHE: quem
      escreve a linha da matriz tira a rota daqui (o teste cobra).

E o contrario tambem: entrada de lista que nao bate com rota nenhuma (rota
renomeada ou apagada) derruba o teste, para a lista nao virar lixo.

Puro: monta o app e le as rotas, sem banco.
"""

from __future__ import annotations

import re

from fastapi.routing import APIRoute

from app.main import create_app
from tests.integration.test_matriz_de_permissoes_http_db import MATRIZ

_ESCRITA = {"POST", "PUT", "PATCH", "DELETE"}

#: Fora da matriz de proposito. O motivo e obrigatorio.
FORA_POR_DESENHO: dict[tuple[str, str], str] = {
    # A propria conta: nao ha papel, ha "quem esta logado".
    ("post", "/api/v1/auth/login"): "publica; freios por IP e conta (test_account_rate_limit_db)",
    ("post", "/api/v1/auth/refresh"): "token assinado; test_session_revocation_db",
    ("post", "/api/v1/auth/logout"): "a propria sessao",
    ("post", "/api/v1/auth/change-password"): "a propria senha; test_password_lifecycle_db",
    ("patch", "/api/v1/auth/me"): "o proprio nome (Spec 051, decisao 8)",
    # Publicas, sem login.
    ("post", "/api/v1/client-errors"): "publica; freio por IP (test_abuso_negativo_db)",
    ("post", "/api/v1/solicitacoes/publico"): "publica (test_solicitation_form_publico_db)",
    # n8n, por token de sistema.
    ("post", "/api/v1/system/bases/purge"): "token de sistema (test_system_auth)",
    ("post", "/api/v1/system/tasks/archive-stale"): "token de sistema (test_system_auth)",
    ("post", "/api/v1/system/tasks/notify-deadlines"): "token de sistema (test_system_auth)",
    # Os proprios avisos: o recorte e "meus", nao papel.
    ("post", "/api/v1/notifications/read-all"): "os proprios avisos",
    ("post", "/api/v1/notifications/{}/read"): "os proprios avisos",
    ("put", "/api/v1/me/notification-preferences"): "as proprias preferencias",
    # Ja anotados no topo da matriz.
    ("post", "/api/v1/bases/{}/redo"): "depende da pilha da pessoa, nao do papel (fatia C)",
    ("patch", "/api/v1/tasks/{}/comments/{}"): "autoria, nao permissao (Spec 050 §4.5)",
    ("post", "/api/v1/tasks/{}/watchers"): "o servico decide 'eu' contra 'terceiro'",
    ("delete", "/api/v1/tasks/{}/watchers/{}"): "o servico decide 'eu' contra 'terceiro'",
}

#: ⚠️ A DIVIDA DE 16/10. So encolhe: escreveu a linha na matriz, tira daqui.
PENDENTE: frozenset[tuple[str, str]] = frozenset({
    # Formulario: secoes e perguntas.
    ("post", "/api/v1/solicitacoes/formularios/{}/secoes"),
    ("post", "/api/v1/solicitacoes/formularios/{}/secoes/ordem"),
    ("patch", "/api/v1/solicitacoes/secoes/{}"),
    ("delete", "/api/v1/solicitacoes/secoes/{}"),
    ("post", "/api/v1/solicitacoes/secoes/{}/resumo"),
    ("post", "/api/v1/solicitacoes/secoes/{}/perguntas"),
    ("post", "/api/v1/solicitacoes/secoes/{}/perguntas/ordem"),
    ("patch", "/api/v1/solicitacoes/perguntas/{}"),
    ("delete", "/api/v1/solicitacoes/perguntas/{}"),
    ("post", "/api/v1/solicitacoes/perguntas/{}/condicional"),
    # Fila de solicitacoes.
    ("post", "/api/v1/solicitacoes/{}/andamento"),
    ("post", "/api/v1/solicitacoes/{}/criar-tarefa"),
    ("post", "/api/v1/solicitacoes/{}/rejeitar"),
    # Tarefa.
    ("post", "/api/v1/tasks/{}/move"),
    ("post", "/api/v1/tasks/{}/duplicate"),
    ("post", "/api/v1/tasks/{}/unarchive"),
    ("delete", "/api/v1/tasks/{}/assignees/{}"),
    ("post", "/api/v1/tasks/{}/comments"),
    ("put", "/api/v1/tasks/{}/comments/{}/reaction"),
    ("delete", "/api/v1/tasks/{}/comments/{}/reaction"),
    # Times.
    ("post", "/api/v1/workspaces/current/teams/{}/esvaziar-e-remover"),
})


def _norm(caminho: str) -> str:
    """`/bases/{base_id}` e `/bases/{base_mkt}` sao a mesma rota."""
    return re.sub(r"\{[^}]+\}", "{}", caminho.split("?")[0])


def _rotas_de_escrita() -> set[tuple[str, str]]:
    return {
        (m.lower(), _norm(r.path))
        for r in create_app().routes
        if isinstance(r, APIRoute)
        for m in r.methods & _ESCRITA
    }


def _na_matriz() -> set[tuple[str, str]]:
    return {(linha.metodo.lower(), _norm(linha.caminho)) for linha in MATRIZ}


def test_toda_rota_de_escrita_tem_linha_na_matriz_ou_motivo() -> None:
    sem_dono = _rotas_de_escrita() - _na_matriz() - set(FORA_POR_DESENHO) - PENDENTE
    assert not sem_dono, (
        "Rota de escrita sem linha na matriz de permissoes. Escreva a linha em "
        "`test_matriz_de_permissoes_http_db.py` (o esperado de cada papel) ou, "
        f"se ela nao depende de papel, ponha em FORA_POR_DESENHO com o motivo: {sorted(sem_dono)}"
    )


def test_as_listas_nao_guardam_rota_que_nao_existe() -> None:
    sobra = (set(FORA_POR_DESENHO) | PENDENTE) - _rotas_de_escrita()
    assert not sobra, f"Rota renomeada ou apagada -- tire da lista: {sorted(sobra)}"


def test_pendente_so_encolhe() -> None:
    """Escreveu a linha na matriz? Tire a rota de `PENDENTE` -- senao ninguem
    sabe que a divida diminuiu."""
    ja_cobertas = PENDENTE & _na_matriz()
    assert not ja_cobertas, f"Ja tem linha na matriz -- tire de PENDENTE: {sorted(ja_cobertas)}"
    assert not (PENDENTE & set(FORA_POR_DESENHO)), "Uma rota nao e divida e desenho ao mesmo tempo."
