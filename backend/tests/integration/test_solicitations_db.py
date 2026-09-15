"""Integracao do modulo de Solicitacoes (formulario publico FazAe).

Cobre as regras que valem dinheiro se quebrarem:
    - criacao publica resolve workspace por SLUG e nasce PENDING;
    - honeypot descarta silenciosamente (nada persistido);
    - categoria invalida e slug desconhecido sao rejeitados;
    - fila e escopada por tenant (solicitacao do WS A invisivel no WS B);
    - filtro por status da fila;
    - aprovar registra revisor/quando; rejeitar EXIGE justificativa;
    - solicitacao ja triada nao pode ser triada de novo;
    - HTTP: rota publica sem auth (201), honeypot indistinguivel (201),
      OPERATOR recebe 403 no aprovar, rejeicao sem nota vira 422,
      rate limit por IP devolve 429 no estouro.

Nivel de servico usa o harness padrao (db + acting_as + UnitOfWork(db));
nivel HTTP usa ASGITransport com overrides de sessao/UoW (e de auth,
quando a rota exige) -- mesmo desenho de test_http_status_db.py.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models import Workspace
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_roles
from app.modules.solicitations.application.service import (
    CreatePublicCommand,
    MarkTaskCommand,
    ReviewCommand,
    SolicitationItem,
    SolicitationService,
)
from app.shared.exceptions.base import (
    BusinessRuleError,
    EntityNotFoundError,
    ValidationError,
)
from app.shared.pagination import PageParams
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship

pytestmark = pytest.mark.integration


# --------------------------------------------------------
# Helpers
# --------------------------------------------------------
async def _make_ws_with_slug(db) -> tuple[uuid.UUID, str]:
    """Workspace com slug conhecido (a rota publica resolve por slug)."""
    slug = f"ws-{uuid.uuid4().hex[:8]}"
    ws = Workspace(id=uuid.uuid4(), name="WS Solicitacoes", slug=slug)
    db.add(ws)
    await db.flush()
    return ws.id, slug


def _item(category: str = "arte", summary: str = "Banner do processo seletivo") -> SolicitationItem:
    return SolicitationItem(
        category=category,
        summary=summary,
        answers=[
            {"label": "Formato da arte", "value": "Digital"},
            {"label": "Para que sera utilizada?", "value": "Divulgar PS"},
        ],
    )


def _cmd(slug: str, **overrides) -> CreatePublicCommand:
    """Envio padrao: UM item (categoria 'arte'). Use items=[...] pra lote."""
    base = dict(
        workspace_slug=slug,
        requester_name="Maria do Polo",
        requester_email="Maria@Polo.Ex",
        requester_phone="11 99999-0000",
        requester_department="Coordenacao",
        requester_polo="Taboao",
        items=[_item()],
        honeypot="",
    )
    base.update(overrides)
    return CreatePublicCommand(**base)


async def _criar_uma(db, slug: str, **overrides):
    """Envio de 1 item; devolve a unica solicitacao criada.

    create_public agora retorna LISTA (um envio pode ter N categorias).
    """
    async with UnitOfWork(db) as uow:
        criadas = await SolicitationService(db).create_public(
            uow, _cmd(slug, **overrides)
        )
    assert criadas is not None and len(criadas) == 1
    return criadas[0]


async def _reviewer(db, ws: uuid.UUID, *, role: str = "MANAGER"):
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=user, team_id=team, role=role)
    return team, user


# --------------------------------------------------------
# Criacao publica (nivel de servico)
# --------------------------------------------------------
async def test_create_public_persiste_pending_no_workspace_do_slug(db) -> None:
    ws, slug = await _make_ws_with_slug(db)
    s = await _criar_uma(db, slug)

    row = (
        await db.execute(
            text(
                "SELECT workspace_id, status, requester_email, "
                "batch_seq, batch_total FROM solicitation WHERE id=:i"
            ),
            {"i": s.id},
        )
    ).one()
    assert row.workspace_id == ws
    assert row.status == "PENDING"
    # normalizacao: e-mail gravado em minusculas
    assert row.requester_email == "maria@polo.ex"
    # envio de 1 categoria e um lote de 1
    assert (row.batch_seq, row.batch_total) == (1, 1)


async def test_create_public_honeypot_descarta_sem_persistir(db) -> None:
    _, slug = await _make_ws_with_slug(db)
    async with UnitOfWork(db) as uow:
        s = await SolicitationService(db).create_public(
            uow, _cmd(slug, honeypot="http://spam.example")
        )
    assert s is None
    total = (
        await db.execute(text("SELECT count(*) FROM solicitation"))
    ).scalar_one()
    assert total == 0


async def test_create_public_categoria_invalida_rejeitada(db) -> None:
    _, slug = await _make_ws_with_slug(db)
    async with UnitOfWork(db) as uow:
        with pytest.raises(ValidationError):
            await SolicitationService(db).create_public(
                uow, _cmd(slug, items=[_item(category="hackear-o-mainframe")])
            )


async def test_create_public_slug_desconhecido_404(db) -> None:
    async with UnitOfWork(db) as uow:
        with pytest.raises(EntityNotFoundError):
            await SolicitationService(db).create_public(
                uow, _cmd("slug-que-nao-existe")
            )


# --------------------------------------------------------
# Fila (tenant + filtro)
# --------------------------------------------------------
async def test_fila_escopada_por_tenant(db) -> None:
    """Solicitacao do WS A NAO aparece na fila lida como WS B."""
    ws_a, slug_a = await _make_ws_with_slug(db)
    await _criar_uma(db, slug_a)

    ws_b, _ = await _make_ws_with_slug(db)
    team_b, user_b = await _reviewer(db, ws_b)
    with acting_as(
        workspace_id=ws_b, user_id=user_b, memberships=(mship(team_b, "MANAGER"),)
    ):
        lotes, total = await SolicitationService(db).list_batches(
            params=PageParams(size=100), filtro=None, team_id=None)
    assert (lotes, total) == ([], 0)

    team_a, user_a = await _reviewer(db, ws_a)
    with acting_as(
        workspace_id=ws_a, user_id=user_a, memberships=(mship(team_a, "MANAGER"),)
    ):
        lotes_a, total_a = await SolicitationService(db).list_batches(
            params=PageParams(size=100), filtro=None, team_id=None)
    assert total_a == 1
    assert len(lotes_a[0].items) == 1


async def test_fila_filtra_por_status_e_conta_pendentes(db) -> None:
    """Filtro por status conta ENVIOS; pending_total conta DEMANDAS.

    Duas unidades diferentes na mesma tela (Spec 025, R5) -- por isso os
    dois numeros sao verificados juntos aqui.
    """
    ws, slug = await _make_ws_with_slug(db)
    svc = SolicitationService(db)
    s1 = await _criar_uma(db, slug)
    await _criar_uma(db, slug, items=[_item(summary="Outra")])

    team, user = await _reviewer(db, ws)
    with acting_as(
        workspace_id=ws, user_id=user, memberships=(mship(team, "MANAGER"),)
    ):
        async with UnitOfWork(db) as uow:
            await svc.review(
                uow, ReviewCommand(solicitation_id=s1.id, approve=True, note=None)
            )
        _, pend = await svc.list_batches(
            params=PageParams(size=100), filtro="PENDING", team_id=None)
        _, aprov = await svc.list_batches(
            params=PageParams(size=100), filtro="APPROVED", team_id=None)
        assert pend == 1  # envios com ao menos uma pendente
        assert aprov == 1
        assert await svc.count_pending(None) == 1  # demandas pendentes

        with pytest.raises(ValidationError):
            await svc.list_batches(params=PageParams(size=100), filtro="QUALQUER", team_id=None)


# --------------------------------------------------------
# Triagem (aprovar / rejeitar)
# --------------------------------------------------------
async def test_aprovar_registra_revisor_e_momento(db) -> None:
    ws, slug = await _make_ws_with_slug(db)
    svc = SolicitationService(db)
    s = await _criar_uma(db, slug)

    team, user = await _reviewer(db, ws)
    with acting_as(
        workspace_id=ws, user_id=user, memberships=(mship(team, "MANAGER"),)
    ):
        async with UnitOfWork(db) as uow:
            out = await svc.review(
                uow, ReviewCommand(solicitation_id=s.id, approve=True, note=None)
            )
    assert out.status == "APPROVED"
    assert out.reviewed_by_user_id == user
    assert out.reviewed_at is not None


async def test_rejeitar_sem_justificativa_falha(db) -> None:
    ws, slug = await _make_ws_with_slug(db)
    svc = SolicitationService(db)
    s = await _criar_uma(db, slug)
    # Guarda o id ANTES da tentativa que vai rolar back: o __aexit__ do UoW
    # faz rollback quando o caso de uso nao commita, e session.rollback()
    # EXPIRA todos os objetos da sessao. Ler `s.id` depois disso dispararia
    # um lazy-load sincrono fora do greenlet (MissingGreenlet).
    sid = s.id

    team, user = await _reviewer(db, ws)
    with acting_as(
        workspace_id=ws, user_id=user, memberships=(mship(team, "MANAGER"),)
    ):
        async with UnitOfWork(db) as uow:
            with pytest.raises(ValidationError):
                await svc.review(
                    uow,
                    ReviewCommand(solicitation_id=sid, approve=False, note="  "),
                )

    # Segue PENDING. Leitura por SQL puro de proposito: prova o estado REAL
    # da linha, sem passar pelo identity map (que acabou de ser expirado).
    status_atual = (
        await db.execute(
            text("SELECT status FROM solicitation WHERE id=:i"), {"i": sid}
        )
    ).scalar_one()
    assert status_atual == "PENDING"


async def test_rejeitar_com_justificativa_persiste_nota(db) -> None:
    ws, slug = await _make_ws_with_slug(db)
    svc = SolicitationService(db)
    s = await _criar_uma(db, slug)

    team, user = await _reviewer(db, ws)
    with acting_as(
        workspace_id=ws, user_id=user, memberships=(mship(team, "MANAGER"),)
    ):
        async with UnitOfWork(db) as uow:
            out = await svc.review(
                uow,
                ReviewCommand(
                    solicitation_id=s.id,
                    approve=False,
                    note="Prazo insuficiente pro porte da demanda.",
                ),
            )
    assert out.status == "REJECTED"
    assert out.review_note == "Prazo insuficiente pro porte da demanda."


async def test_triagem_dupla_bloqueada(db) -> None:
    """Solicitacao ja triada nao pode ser aprovada/rejeitada de novo."""
    ws, slug = await _make_ws_with_slug(db)
    svc = SolicitationService(db)
    s = await _criar_uma(db, slug)

    team, user = await _reviewer(db, ws)
    with acting_as(
        workspace_id=ws, user_id=user, memberships=(mship(team, "MANAGER"),)
    ):
        async with UnitOfWork(db) as uow:
            await svc.review(
                uow, ReviewCommand(solicitation_id=s.id, approve=True, note=None)
            )
        async with UnitOfWork(db) as uow:
            with pytest.raises(BusinessRuleError):
                await svc.review(
                    uow,
                    ReviewCommand(solicitation_id=s.id, approve=False, note="x"),
                )


async def test_review_de_outro_tenant_e_404(db) -> None:
    """Revisor do WS B nao enxerga (logo nao tria) solicitacao do WS A."""
    _ws_a, slug_a = await _make_ws_with_slug(db)
    svc = SolicitationService(db)
    s = await _criar_uma(db, slug_a)

    ws_b, _ = await _make_ws_with_slug(db)
    team_b, user_b = await _reviewer(db, ws_b)
    with acting_as(
        workspace_id=ws_b, user_id=user_b, memberships=(mship(team_b, "MANAGER"),)
    ):
        async with UnitOfWork(db) as uow:
            with pytest.raises(EntityNotFoundError):
                await svc.review(
                    uow,
                    ReviewCommand(solicitation_id=s.id, approve=True, note=None),
                )


# --------------------------------------------------------
# HTTP (rota publica + autorizacao + rate limit)
# --------------------------------------------------------
def _http(db, ctx: TenantContext | None = None) -> AsyncClient:
    """App real com sessao/UoW do teste; auth so quando ctx e passado."""
    app = create_app()

    async def _session() -> AsyncIterator:
        yield db

    async def _uow() -> AsyncIterator[UnitOfWork]:
        async with UnitOfWork(db) as uow:
            yield uow

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    if ctx is not None:
        async def _ctx() -> TenantContext:
            set_tenant(ctx)
            return ctx

        app.dependency_overrides[get_tenant_context] = _ctx
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


def _payload(slug: str, **overrides) -> dict:
    base = {
        "workspace_slug": slug,
        "requester_name": "Joao da Sede",
        "requester_email": "joao@teste.dev",
        "requester_phone": "11 98888-7777",
        "requester_department": "RH",
        "requester_polo": "Sede",
        "items": [
            {
                "category": "email",
                "summary": "Comunicado de recesso",
                "answers": [
                    {"label": "O que deseja comunicar?", "value": "Recesso"}
                ],
            }
        ],
        "website": "",
    }
    base.update(overrides)
    return base


def _ip() -> dict:
    """XFF unico por chamada: cada teste ganha um balde proprio no limiter
    (singleton de modulo -- sem isso, os testes disputariam a mesma janela)."""
    return {"X-Forwarded-For": f"10.0.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"}


async def test_http_publico_cria_sem_auth(db) -> None:
    _, slug = await _make_ws_with_slug(db)
    async with _http(db) as client:
        r = await client.post(
            "/api/v1/solicitacoes/publico", json=_payload(slug), headers=_ip()
        )
    assert r.status_code == 201
    assert r.json()["protocol"]


async def test_http_honeypot_responde_201_indistinguivel(db) -> None:
    _, slug = await _make_ws_with_slug(db)
    async with _http(db) as client:
        r = await client.post(
            "/api/v1/solicitacoes/publico",
            json=_payload(slug, website="http://spam.example"),
            headers=_ip(),
        )
    assert r.status_code == 201
    assert r.json()["protocol"]  # protocolo falso, mesmo formato
    total = (
        await db.execute(text("SELECT count(*) FROM solicitation"))
    ).scalar_one()
    assert total == 0


async def test_http_rate_limit_429_no_estouro(db) -> None:
    """Mesmo IP alem do limite configurado -> 429 com Retry-After."""
    from app.core.config import settings

    _, slug = await _make_ws_with_slug(db)
    ip = _ip()  # UM ip fixo pra este teste
    async with _http(db) as client:
        for _ in range(settings.public_form_rate_limit_max):
            ok = await client.post(
                "/api/v1/solicitacoes/publico", json=_payload(slug), headers=ip
            )
            assert ok.status_code == 201
        bloqueada = await client.post(
            "/api/v1/solicitacoes/publico", json=_payload(slug), headers=ip
        )
    assert bloqueada.status_code == 429


async def test_http_fila_sem_token_401(db) -> None:
    async with _http(db) as client:
        r = await client.get("/api/v1/solicitacoes")
    assert r.status_code == 401


@pytest.mark.parametrize("role", ["OPERATOR", "SUPERVISOR"])
async def test_http_sem_permissao_403_em_tudo_inclusive_leitura(db, role) -> None:
    """Criterios 17-18: a ABA inteira e fechada, nao so as acoes.

    Ate a Spec 025 qualquer autenticado LIA a fila e so as acoes eram
    travadas. Agora o GET tambem exige `solicitation.review` -- e o
    SUPERVISOR, que tinha a permissao, a PERDEU (D11).
    """
    ws, slug = await _make_ws_with_slug(db)
    s = await _criar_uma(db, slug)

    team, usuario = await _reviewer(db, ws, role=role)
    ctx = TenantContext(
        workspace_id=ws,
        user_id=usuario,
        roles=frozenset({role}),
        permissions=permissions_for_roles(frozenset({role})),
        memberships=(Membership(team_id=team, role=role),),
    )
    async with _http(db, ctx) as client:
        assert (await client.get("/api/v1/solicitacoes")).status_code == 403
        assert (
            await client.get(f"/api/v1/solicitacoes/{s.id}")
        ).status_code == 403
        assert (
            await client.post(
                f"/api/v1/solicitacoes/{s.id}/aprovar", json={"note": None}
            )
        ).status_code == 403
        assert (
            await client.post(
                f"/api/v1/solicitacoes/{s.id}/rejeitar", json={"note": "x"}
            )
        ).status_code == 403
        assert (
            await client.post(
                f"/api/v1/solicitacoes/{s.id}/tarefa", json={"created": True}
            )
        ).status_code == 403


@pytest.mark.parametrize("role", ["ADMIN", "MANAGER"])
async def test_http_admin_e_manager_acessam_a_fila(db, role) -> None:
    """Criterio 19: o outro lado da trava -- quem deve entrar, entra."""
    ws, slug = await _make_ws_with_slug(db)
    await _criar_uma(db, slug)

    team, usuario = await _reviewer(db, ws, role=role)
    ctx = TenantContext(
        workspace_id=ws,
        user_id=usuario,
        roles=frozenset({role}),
        permissions=permissions_for_roles(frozenset({role})),
        memberships=(Membership(team_id=team, role=role),),
    )
    async with _http(db, ctx) as client:
        lista = await client.get("/api/v1/solicitacoes")
    assert lista.status_code == 200
    assert lista.json()["total"] == 1


async def test_http_rota_publica_segue_aberta_apos_a_trava(db) -> None:
    """Criterio 21: travar a fila NAO pode fechar a porta de entrada.

    A rota publica e como a demanda chega. Se a Spec 025/D11 vazasse pra
    ela, o formulario pararia de funcionar em silencio.
    """
    _, slug = await _make_ws_with_slug(db)
    async with _http(db) as client:  # sem contexto de auth
        r = await client.post(
            "/api/v1/solicitacoes/publico", json=_payload(slug), headers=_ip()
        )
    assert r.status_code == 201


async def test_http_rejeicao_sem_nota_422(db) -> None:
    ws, slug = await _make_ws_with_slug(db)
    s = await _criar_uma(db, slug)

    team, manager = await _reviewer(db, ws, role="MANAGER")
    ctx = TenantContext(
        workspace_id=ws,
        user_id=manager,
        roles=frozenset({"MANAGER"}),
        permissions=permissions_for_roles(frozenset({"MANAGER"})),
        memberships=(Membership(team_id=team, role="MANAGER"),),
    )
    async with _http(db, ctx) as client:
        r = await client.post(
            f"/api/v1/solicitacoes/{s.id}/rejeitar", json={"note": ""}
        )
    assert r.status_code == 422


# --------------------------------------------------------
# Lote (multi-selecao de categorias num unico envio)
# --------------------------------------------------------
async def test_lote_cria_uma_linha_por_categoria_na_ordem_selecionada(db) -> None:
    """3 categorias -> 3 linhas irmas, batch_seq na ordem de selecao."""
    ws, slug = await _make_ws_with_slug(db)
    async with UnitOfWork(db) as uow:
        criadas = await SolicitationService(db).create_public(
            uow,
            _cmd(
                slug,
                items=[
                    _item(category="arte", summary="Banner"),
                    _item(category="divulgacao", summary="Post do PS"),
                    _item(category="impressao", summary="Cartaz A3"),
                ],
            ),
        )
    assert criadas is not None and len(criadas) == 3

    linhas = (
        await db.execute(
            text(
                "SELECT category, batch_id, batch_seq, batch_total, status "
                "FROM solicitation WHERE workspace_id=:w ORDER BY batch_seq"
            ),
            {"w": ws},
        )
    ).all()
    assert [r.category for r in linhas] == ["arte", "divulgacao", "impressao"]
    assert [r.batch_seq for r in linhas] == [1, 2, 3]
    assert {r.batch_total for r in linhas} == {3}
    # mesmo lote -> mesmo protocolo pro solicitante
    assert len({r.batch_id for r in linhas}) == 1
    assert {r.status for r in linhas} == {"PENDING"}


async def test_lote_triagem_independente_por_irma(db) -> None:
    """Aprovar a arte e rejeitar a divulgacao do MESMO envio."""
    ws, slug = await _make_ws_with_slug(db)
    svc = SolicitationService(db)
    async with UnitOfWork(db) as uow:
        criadas = await svc.create_public(
            uow,
            _cmd(
                slug,
                items=[
                    _item(category="arte", summary="Banner"),
                    _item(category="divulgacao", summary="Post do PS"),
                ],
            ),
        )
    assert criadas is not None
    arte, divulgacao = criadas[0].id, criadas[1].id

    team, user = await _reviewer(db, ws)
    with acting_as(
        workspace_id=ws, user_id=user, memberships=(mship(team, "MANAGER"),)
    ):
        async with UnitOfWork(db) as uow:
            await svc.review(
                uow, ReviewCommand(solicitation_id=arte, approve=True, note=None)
            )
        async with UnitOfWork(db) as uow:
            await svc.review(
                uow,
                ReviewCommand(
                    solicitation_id=divulgacao,
                    approve=False,
                    note="Prazo de 10 dias uteis nao atendido.",
                ),
            )

    estados = dict(
        (
            await db.execute(
                text("SELECT id, status FROM solicitation WHERE workspace_id=:w"),
                {"w": ws},
            )
        ).all()
    )
    assert estados[arte] == "APPROVED"
    assert estados[divulgacao] == "REJECTED"


async def test_lote_categoria_repetida_rejeitada(db) -> None:
    """Mesma categoria duas vezes no envio e erro de UI, nao pedido real."""
    _, slug = await _make_ws_with_slug(db)
    async with UnitOfWork(db) as uow:
        with pytest.raises(ValidationError):
            await SolicitationService(db).create_public(
                uow,
                _cmd(slug, items=[_item(category="arte"), _item(category="arte")]),
            )


async def test_lote_invalido_nao_grava_nenhuma_linha(db) -> None:
    """Tudo-ou-nada: categoria ruim no meio aborta o envio inteiro."""
    _, slug = await _make_ws_with_slug(db)
    async with UnitOfWork(db) as uow:
        with pytest.raises(ValidationError):
            await SolicitationService(db).create_public(
                uow,
                _cmd(
                    slug,
                    items=[
                        _item(category="arte"),
                        _item(category="categoria-invalida"),
                        _item(category="evento"),
                    ],
                ),
            )
    total = (
        await db.execute(text("SELECT count(*) FROM solicitation"))
    ).scalar_one()
    assert total == 0


async def test_lote_vazio_rejeitado(db) -> None:
    _, slug = await _make_ws_with_slug(db)
    async with UnitOfWork(db) as uow:
        with pytest.raises(ValidationError):
            await SolicitationService(db).create_public(uow, _cmd(slug, items=[]))


async def test_http_lote_um_post_um_protocolo(db) -> None:
    """Multi-selecao NAO vira N requests: um POST so (o rate limit e por IP)."""
    _, slug = await _make_ws_with_slug(db)
    payload = _payload(
        slug,
        items=[
            {
                "category": "arte",
                "summary": "Banner",
                "answers": [{"label": "Formato", "value": "Digital"}],
            },
            {
                "category": "evento",
                "summary": "Aula inaugural",
                "answers": [{"label": "Nome do evento", "value": "Aula"}],
            },
        ],
    )
    async with _http(db) as client:
        r = await client.post(
            "/api/v1/solicitacoes/publico", json=payload, headers=_ip()
        )
    assert r.status_code == 201
    assert r.json()["created"] == 2
    assert r.json()["protocol"]

    total = (
        await db.execute(text("SELECT count(*) FROM solicitation"))
    ).scalar_one()
    assert total == 2


# --------------------------------------------------------
# Fila AGRUPADA por envio (criterios 9, 11, 12, 16)
# --------------------------------------------------------
async def _envio(db, slug: str, *categorias: str):
    """Cria um envio com N categorias e devolve as linhas."""
    async with UnitOfWork(db) as uow:
        criadas = await SolicitationService(db).create_public(
            uow, _cmd(slug, items=[_item(category=c) for c in categorias])
        )
    assert criadas is not None
    return criadas


async def test_fila_agrupa_um_card_por_envio(db) -> None:
    """Criterio 9: envio de 3 categorias = UM lote com 3 itens em ordem."""
    ws, slug = await _make_ws_with_slug(db)
    await _envio(db, slug, "arte", "video", "evento")

    team, user = await _reviewer(db, ws)
    with acting_as(
        workspace_id=ws, user_id=user, memberships=(mship(team, "MANAGER"),)
    ):
        lotes, total = await SolicitationService(db).list_batches(
            params=PageParams(size=100), filtro=None, team_id=None)
    assert total == 1  # UM envio, nao tres demandas
    assert len(lotes[0].items) == 3
    assert [i.batch_seq for i in lotes[0].items] == [1, 2, 3]
    assert [i.category for i in lotes[0].items] == ["arte", "video", "evento"]
    # dados do solicitante sobem pro cabecalho do card
    assert lotes[0].requester_name == "Maria do Polo"


async def test_paginacao_por_envio_nao_parte_lote_ao_meio(db) -> None:
    """Criterio 11: `total` conta ENVIOS e nenhum vem incompleto.

    Paginar por LINHA traria 2 das 3 demandas de um envio na pagina 1 e a
    terceira na 2 -- o card apareceria com secoes faltando.
    """
    ws, slug = await _make_ws_with_slug(db)
    await _envio(db, slug, "arte", "video", "evento")  # 3 demandas
    await _envio(db, slug, "site", "email")            # 2 demandas
    await _envio(db, slug, "impressao")                # 1 demanda

    team, user = await _reviewer(db, ws)
    with acting_as(
        workspace_id=ws, user_id=user, memberships=(mship(team, "MANAGER"),)
    ):
        svc = SolicitationService(db)
        pg1, total = await svc.list_batches(
            params=PageParams(page=1, size=2), filtro=None, team_id=None)
        pg2, _ = await svc.list_batches(
            params=PageParams(page=2, size=2), filtro=None, team_id=None)

    assert total == 3          # ENVIOS, nao as 6 demandas
    assert len(pg1) == 2
    assert len(pg2) == 1
    # cada lote veio INTEIRO (batch_total bate com o que chegou)
    for lote in pg1 + pg2:
        assert len(lote.items) == lote.items[0].batch_total
    # e nenhum envio aparece nas duas paginas
    assert not ({b.batch_id for b in pg1} & {b.batch_id for b in pg2})


async def test_filtro_traz_envio_inteiro_mesmo_com_status_misto(db) -> None:
    """Criterio 12 (D7 -- HAVING, nao WHERE).

    Envio com 1 pendente + 2 aprovadas aparece em "Pendentes" com as TRES
    secoes visiveis. Esconder as aprovadas mostraria um card mutilado.
    """
    ws, slug = await _make_ws_with_slug(db)
    criadas = await _envio(db, slug, "arte", "video", "evento")

    team, user = await _reviewer(db, ws)
    with acting_as(
        workspace_id=ws, user_id=user, memberships=(mship(team, "MANAGER"),)
    ):
        svc = SolicitationService(db)
        for alvo in criadas[:2]:  # aprova 2 das 3
            async with UnitOfWork(db) as uow:
                await svc.review(
                    uow,
                    ReviewCommand(solicitation_id=alvo.id, approve=True, note=None),
                )
        lotes, total = await svc.list_batches(
            params=PageParams(size=100), filtro="PENDING", team_id=None)

    assert total == 1
    assert len(lotes[0].items) == 3  # o card vem COMPLETO
    status = sorted(i.status for i in lotes[0].items)
    assert status == ["APPROVED", "APPROVED", "PENDING"]


async def test_filtro_aprovadas_sem_tarefa(db) -> None:
    """Criterio 16: o filtro que existe pra demanda aprovada nao sumir."""
    ws, slug = await _make_ws_with_slug(db)
    criadas = await _envio(db, slug, "arte", "video")

    team, user = await _reviewer(db, ws)
    with acting_as(
        workspace_id=ws, user_id=user, memberships=(mship(team, "MANAGER"),)
    ):
        svc = SolicitationService(db)
        for alvo in criadas:
            async with UnitOfWork(db) as uow:
                await svc.review(
                    uow,
                    ReviewCommand(solicitation_id=alvo.id, approve=True, note=None),
                )
        # duas aprovadas, nenhuma virou tarefa ainda
        assert await svc.count_approved_without_task(None) == 2
        _, total = await svc.list_batches(
            params=PageParams(size=100), filtro="SEM_TAREFA", team_id=None)
        assert total == 1

        # marca uma -> some da contagem
        async with UnitOfWork(db) as uow:
            await svc.mark_task(
                uow,
                MarkTaskCommand(
                    solicitation_id=criadas[0].id,
                    created=True,
                    task_ref="https://quadro/tarefa/1",
                ),
            )
        assert await svc.count_approved_without_task(None) == 1

        # marca a outra -> o envio inteiro sai do filtro
        async with UnitOfWork(db) as uow:
            await svc.mark_task(
                uow,
                MarkTaskCommand(solicitation_id=criadas[1].id, created=True),
            )
        assert await svc.count_approved_without_task(None) == 0
        _, total_final = await svc.list_batches(
            params=PageParams(size=100), filtro="SEM_TAREFA", team_id=None)
        assert total_final == 0


# --------------------------------------------------------
# Marcacao de tarefa (criterio 15)
# --------------------------------------------------------
async def test_marcar_tarefa_exige_aprovada(db) -> None:
    """PENDING e REJECTED nunca podem ter tarefa (guard + CHECK no banco)."""
    ws, slug = await _make_ws_with_slug(db)
    pendente = await _criar_uma(db, slug)
    rejeitada = await _criar_uma(db, slug, items=[_item(category="video")])

    team, user = await _reviewer(db, ws)
    with acting_as(
        workspace_id=ws, user_id=user, memberships=(mship(team, "MANAGER"),)
    ):
        svc = SolicitationService(db)
        async with UnitOfWork(db) as uow:
            await svc.review(
                uow,
                ReviewCommand(
                    solicitation_id=rejeitada.id, approve=False, note="fora do prazo"
                ),
            )
        for alvo in (pendente.id, rejeitada.id):
            async with UnitOfWork(db) as uow:
                with pytest.raises(BusinessRuleError):
                    await svc.mark_task(
                        uow, MarkTaskCommand(solicitation_id=alvo, created=True)
                    )


async def test_marcar_e_desmarcar_tarefa_registra_quem_e_quando(db) -> None:
    ws, slug = await _make_ws_with_slug(db)
    s = await _criar_uma(db, slug)

    team, user = await _reviewer(db, ws)
    with acting_as(
        workspace_id=ws, user_id=user, memberships=(mship(team, "MANAGER"),)
    ):
        svc = SolicitationService(db)
        async with UnitOfWork(db) as uow:
            await svc.review(
                uow, ReviewCommand(solicitation_id=s.id, approve=True, note=None)
            )
        async with UnitOfWork(db) as uow:
            marcada = await svc.mark_task(
                uow,
                MarkTaskCommand(
                    solicitation_id=s.id, created=True, task_ref="  quadro/42  "
                ),
            )
        assert marcada.task_created_at is not None
        assert marcada.task_marked_by_user_id == user
        assert marcada.task_ref == "quadro/42"  # trim aplicado

        # desmarcar limpa os tres campos (erro de marcacao acontece)
        async with UnitOfWork(db) as uow:
            limpa = await svc.mark_task(
                uow, MarkTaskCommand(solicitation_id=s.id, created=False)
            )
        assert limpa.task_created_at is None
        assert limpa.task_marked_by_user_id is None
        assert limpa.task_ref is None
