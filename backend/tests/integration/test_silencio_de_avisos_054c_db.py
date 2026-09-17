"""Spec 054, fatia C -- a regra de silencio nas leituras, e as preferencias.

Pelo HTTP: o que importa aqui e o que a TELA ve. Um teste de repositorio nao
pegaria uma rota que esqueceu de passar `muted` adiante.

O QUE ESTE ARQUIVO PRENDE:
  - ⚠️⚠️ O GUARDIAO DAS QUATRO LEITURAS (§6.4): desligar um toggle tem de
    mudar, ao mesmo tempo, a lista comum, a aba "Silenciadas", o contador do
    sino e o "marcar todas". Se uma delas usar outra regra, ele cai -- e era
    exatamente isso que aconteceria com quatro consultas escritas a mao;
  - UM PAPEL LIGADO BASTA (D4): desligar "como seguidor" nao cala o que a
    pessoa recebe por ser responsavel;
  - `roles` vazio NUNCA silencia (D13) -- e o caso dos avisos antigos;
  - travado nao silencia nunca, e a rota recusa 422 (D3);
  - os grupos que governam dois tipos desligam os dois juntos (§6.1);
  - tudo nasce ligado, e a rota e idempotente (D11, §6.5).

SABOTAGENS (medidas):
  A. Em `NotificationRepository.count_unread`, tirar o `filtro_de_silencio`.
     Deve cair `test_as_quatro_leituras_concordam`.
  B. Em `filtro_de_silencio`, trocar o `NOT EXISTS (... WHERE NOT EXISTS ...)`
     por um `EXISTS` simples (silenciar quando QUALQUER papel esta desligado).
     Deve cair `test_um_papel_ligado_basta_para_aparecer`.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select

from app.db.models import Notification, NotificationMute
from app.modules.notifications.domain.notification import NotificationType
from app.modules.notifications.domain.preferences import GRUPOS
from tests.integration.test_tela_de_notificacoes_053e_db import _cliente, _mundo

pytestmark = pytest.mark.integration

PREFS = "/api/v1/me/notification-preferences"


async def _aviso(db, m, *, tipo, task, minuto, roles=(), lida=False):
    """Um aviso ja no banco, com os papeis explicitos.

    A emissao tem os proprios arquivos (fatia B); aqui o assunto e a LEITURA.
    """
    quando = datetime(2026, 9, 17, 12, minuto, tzinfo=UTC)
    n = Notification(
        workspace_id=m["ws"],
        recipient_id=m["eu"],
        actor_id=m["ator"],
        type=tipo,
        task_id=task.id if task is not None else None,
        payload={"actor_name": "Ator", "task_title": task.title if task else None},
        roles=list(roles),
        created_at=quando,
        updated_at=quando,
        read_at=quando if lida else None,
    )
    db.add(n)
    await db.flush()
    return n


async def _desligar(cli, *, grupo: str, papel: str):
    r = await cli.put(
        PREFS, json={"type_group": grupo, "role": papel, "enabled": False}
    )
    assert r.status_code == 200, r.text
    return r


def _tipos(resposta) -> list[str]:
    return [n["type"] for n in resposta.json()["items"]]


# ------------------------------------------------- ⚠️⚠️ o guardiao das quatro
async def test_as_quatro_leituras_concordam(db) -> None:
    """⚠️⚠️ O GUARDIAO DA §6.4. Um aviso silenciado e um nao, e as QUATRO
    leituras afirmadas no mesmo teste:

      1. a lista comum esconde a silenciada;
      2. `muted=true` mostra SO ela;
      3. o contador do sino nao a conta;
      4. o "marcar todas" do sino nao a toca, e o da aba marca so ela.

    Separar isso em quatro testes deixaria passar justamente o erro que
    importa: cada leitura com a sua propria ideia de silencio.
    """
    m = await _mundo(db)
    await _aviso(
        db, m, tipo="TASK_COMMENTED", task=m["acai"], minuto=1, roles=("watcher",)
    )
    await _aviso(
        db, m, tipo="TASK_COLUMN_CHANGED", task=m["acai"], minuto=2, roles=("watcher",)
    )
    await db.commit()

    async with _cliente(db, m["ctx"]) as cli:
        await _desligar(cli, grupo="comment", papel="watcher")

        comuns = await cli.get("/api/v1/notifications")
        silenciadas = await cli.get("/api/v1/notifications", params={"muted": "true"})
        sino = await cli.get("/api/v1/notifications/unread-count")
        na_aba = await cli.get(
            "/api/v1/notifications/unread-count", params={"muted": "true"}
        )

        # 1 e 2: cada aviso aparece em UMA aba
        assert _tipos(comuns) == ["TASK_COLUMN_CHANGED"]
        assert _tipos(silenciadas) == ["TASK_COMMENTED"]
        assert comuns.json()["total"] == 1 and silenciadas.json()["total"] == 1
        # 3: o numero do sino e o da lista comum
        assert sino.json()["count"] == 1
        assert na_aba.json()["count"] == 1

        # 4: o "marcar todas" do sino nao toca a silenciada
        marcou = await cli.post("/api/v1/notifications/read-all")
        assert marcou.json()["updated"] == 1
        ainda = await cli.get(
            "/api/v1/notifications/unread-count", params={"muted": "true"}
        )
        assert ainda.json()["count"] == 1

        # ... e o da aba "Silenciadas" marca so ela
        marcou_aba = await cli.post(
            "/api/v1/notifications/read-all", params={"muted": "true"}
        )
        assert marcou_aba.json()["updated"] == 1
        zerou = await cli.get(
            "/api/v1/notifications/unread-count", params={"muted": "true"}
        )
        assert zerou.json()["count"] == 0


# ------------------------------------------------------------ a regra de papel
async def test_um_papel_ligado_basta_para_aparecer(db) -> None:
    """D4: o aviso chegou como seguidor E como responsavel. Desligar so
    "seguidor" nao o esconde -- ele tambem diz algo que ela pediu para saber.
    Desligar os dois esconde.
    """
    m = await _mundo(db)
    await _aviso(
        db,
        m,
        tipo="TASK_COMMENTED",
        task=m["acai"],
        minuto=1,
        roles=("watcher", "assignee"),
    )
    await db.commit()

    async with _cliente(db, m["ctx"]) as cli:
        await _desligar(cli, grupo="comment", papel="watcher")
        so_um = await cli.get("/api/v1/notifications")
        assert _tipos(so_um) == ["TASK_COMMENTED"]

        await _desligar(cli, grupo="comment", papel="assignee")
        os_dois = await cli.get("/api/v1/notifications")
        na_aba = await cli.get("/api/v1/notifications", params={"muted": "true"})

    assert _tipos(os_dois) == []
    assert _tipos(na_aba) == ["TASK_COMMENTED"]


async def test_papel_vazio_nunca_silencia(db) -> None:
    """D13: aviso antigo cujo papel nao deu para reconstruir. Com os TRES
    papeis desligados ele continua aparecendo -- na duvida, aparece."""
    m = await _mundo(db)
    await _aviso(db, m, tipo="TASK_COMMENTED", task=m["acai"], minuto=1, roles=())
    await db.commit()

    async with _cliente(db, m["ctx"]) as cli:
        for papel in ("watcher", "assignee", "creator"):
            await _desligar(cli, grupo="comment", papel=papel)
        comuns = await cli.get("/api/v1/notifications")
        silenciadas = await cli.get("/api/v1/notifications", params={"muted": "true"})

    assert _tipos(comuns) == ["TASK_COMMENTED"]
    assert _tipos(silenciadas) == []


async def test_papel_unico_silencia_pelo_tipo(db) -> None:
    """Reacao e por/tirar como seguidor nao tem papel: uma linha com
    `role = none` cala o tipo inteiro."""
    m = await _mundo(db)
    await _aviso(db, m, tipo="TASK_COMMENT_REACTED", task=m["acai"], minuto=1)
    await _aviso(db, m, tipo="TASK_WATCH_ADDED", task=m["acai"], minuto=2)
    await db.commit()

    async with _cliente(db, m["ctx"]) as cli:
        await _desligar(cli, grupo="reaction", papel="none")
        comuns = await cli.get("/api/v1/notifications")
        silenciadas = await cli.get("/api/v1/notifications", params={"muted": "true"})

    assert _tipos(comuns) == ["TASK_WATCH_ADDED"]
    assert _tipos(silenciadas) == ["TASK_COMMENT_REACTED"]


async def test_grupo_de_dois_tipos_desliga_os_dois(db) -> None:
    """§6.1: arquivar e desarquivar sao um toggle so. Desligar um lado sem o
    outro deixaria a pessoa sabendo que a tarefa voltou sem saber que ela
    tinha ido."""
    m = await _mundo(db)
    await _aviso(
        db, m, tipo="TASK_ARCHIVED", task=m["acai"], minuto=1, roles=("creator",)
    )
    await _aviso(
        db, m, tipo="TASK_UNARCHIVED", task=m["acai"], minuto=2, roles=("creator",)
    )
    await db.commit()

    async with _cliente(db, m["ctx"]) as cli:
        await _desligar(cli, grupo="archive", papel="creator")
        comuns = await cli.get("/api/v1/notifications")
        silenciadas = await cli.get("/api/v1/notifications", params={"muted": "true"})

    assert _tipos(comuns) == []
    assert set(_tipos(silenciadas)) == {"TASK_ARCHIVED", "TASK_UNARCHIVED"}


async def test_travado_nunca_silencia(db) -> None:
    """D3: mencao, designacao e perda de acesso sempre aparecem. Nem existe
    toggle para elas -- e o teste seguinte prende a recusa da rota."""
    m = await _mundo(db)
    await _aviso(
        db, m, tipo="TASK_MENTIONED", task=m["acai"], minuto=1, roles=("watcher",)
    )
    await _aviso(db, m, tipo="TASK_ASSIGNED", task=m["acai"], minuto=2)
    await _aviso(db, m, tipo="ACCESS_LOST", task=None, minuto=3)
    await db.commit()

    async with _cliente(db, m["ctx"]) as cli:
        # desliga TUDO o que a rota aceita
        for grupo in GRUPOS:
            if grupo.locked:
                continue
            for papel in grupo.papeis:
                await _desligar(cli, grupo=grupo.key, papel=papel)
        comuns = await cli.get("/api/v1/notifications")
        sino = await cli.get("/api/v1/notifications/unread-count")

    assert set(_tipos(comuns)) == {"TASK_MENTIONED", "TASK_ASSIGNED", "ACCESS_LOST"}
    assert sino.json()["count"] == 3


# ---------------------------------------------------------------- a rota /me
async def test_tudo_nasce_ligado_e_travado_vem_marcado(db) -> None:
    """D11: quem nunca mexeu nao tem linha nenhuma, e a rota mostra tudo
    ligado. Sao 24 toggles + 3 travados (§5)."""
    m = await _mundo(db)
    await db.commit()

    async with _cliente(db, m["ctx"]) as cli:
        r = await cli.get(PREFS)
    assert r.status_code == 200, r.text
    itens = r.json()["items"]

    assert len(itens) == 27
    assert all(i["enabled"] for i in itens)
    assert sum(1 for i in itens if i["locked"]) == 3
    assert sum(1 for i in itens if not i["locked"]) == 24
    travados = {i["type_group"] for i in itens if i["locked"]}
    assert travados == {"mention", "assigned", "access_lost"}


async def test_desligar_e_religar_e_idempotente(db) -> None:
    """§6.5: o PUT repetido nao duplica linha nem quebra, e religar apaga.

    A tela grava a cada clique (D7): dois cliques rapidos, ou dois
    dispositivos, batem na rota quase juntos.
    """
    m = await _mundo(db)
    await db.commit()

    async def _linhas() -> int:
        return (
            await db.execute(
                select(func.count()).select_from(NotificationMute).where(
                    NotificationMute.user_id == m["eu"]
                )
            )
        ).scalar_one()

    async with _cliente(db, m["ctx"]) as cli:
        primeiro = await _desligar(cli, grupo="archive", papel="creator")
        assert await _linhas() == 2  # arquivar + desarquivar
        segundo = await _desligar(cli, grupo="archive", papel="creator")
        assert await _linhas() == 2
        # a resposta traz a lista inteira, e as duas vezes diz a mesma coisa
        desligado = [
            i
            for i in segundo.json()["items"]
            if i["type_group"] == "archive" and i["role"] == "creator"
        ]
        assert desligado == [
            {
                "type_group": "archive",
                "role": "creator",
                "enabled": False,
                "locked": False,
            }
        ]
        assert primeiro.json() == segundo.json()

        religou = await cli.put(
            PREFS,
            json={"type_group": "archive", "role": "creator", "enabled": True},
        )
        assert religou.status_code == 200, religou.text
        assert await _linhas() == 0
        assert all(i["enabled"] for i in religou.json()["items"])


async def test_rota_recusa_travado_papel_invalido_e_grupo_desconhecido(db) -> None:
    """422 nos tres casos. O travado recusa em vez de ignorar: uma tela que
    tentasse desligar mencao precisa descobrir que nao deu (D3)."""
    m = await _mundo(db)
    await db.commit()

    async with _cliente(db, m["ctx"]) as cli:
        travado = await cli.put(
            PREFS, json={"type_group": "mention", "role": "none", "enabled": False}
        )
        # prazo nao tem coluna de seguidor (§5)
        papel = await cli.put(
            PREFS, json={"type_group": "due_soon", "role": "watcher", "enabled": False}
        )
        grupo = await cli.put(
            PREFS, json={"type_group": "nao_existe", "role": "none", "enabled": False}
        )
        lista = await cli.get(PREFS)

    assert travado.status_code == 422, travado.text
    assert travado.json()["error"]["details"]["locked"] is True
    assert papel.status_code == 422, papel.text
    assert grupo.status_code == 422, grupo.text
    # nenhuma das recusas gravou nada
    assert all(i["enabled"] for i in lista.json()["items"])


# -------------------------------------------------------------- o catalogo
def test_todo_tipo_de_aviso_esta_em_um_grupo() -> None:
    """⚠️ GUARDIAO DO CATALOGO: um tipo de aviso novo TEM de entrar na tela.

    Sem isto, criar um tipo e esquecer o grupo passaria calado: o aviso
    chegaria para todo mundo, sem toggle nenhum, e ninguem descobriria ate
    alguem pedir para desligar. E um tipo em dois grupos faria dois toggles
    disputarem o mesmo aviso.
    """
    de_grupo = [t for g in GRUPOS for t in g.tipos]
    assert sorted(de_grupo) == sorted({t.value for t in NotificationType})
    assert len(de_grupo) == len(set(de_grupo))
