"""Service de Solicitacoes.

Casos de uso:
    - create_public : entrada do formulario PUBLICO (sem auth).
    - list_batches  : fila de triagem AGRUPADA POR ENVIO (autenticado).
    - get           : detalhe (autenticado).
    - review        : aprovar/rejeitar (autenticado + permissao,
                      guard de permissao fica na rota).

SEGURANCA DA ROTA PUBLICA (alem do rate limit por IP na rota):
    - workspace resolvido por SLUG; slug invalido => 404 generico
      (nao confirma quais slugs existem).
    - categoria validada contra a lista do dominio;
    - limites de tamanho no schema Pydantic (anti-payload gigante);
    - honeypot: o campo `website` do form e invisivel pra humanos.
      Preenchido => bot. A service DESCARTA silenciosamente e
      responde como sucesso -- nao ensina o bot a se corrigir.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models import (
    Solicitation,
    SolicitationForm,
    SolicitationSection,
    Task,
    Team,
)
from app.db.unit_of_work import UnitOfWork
from app.modules.solicitations.domain.solicitation import (
    ACEITOS,
    CATEGORIES,
    SolicitationStatus,
    can_review,
    pode_andar,
)
from app.modules.solicitations.infrastructure import aviso_de_status
from app.modules.solicitations.infrastructure.aviso_de_status import (
    AvisoDeStatus,
)
from app.modules.solicitations.infrastructure.repository import (
    SolicitationRepository,
    get_workspace_by_slug,
    insert_public,
)
from app.shared.exceptions.base import (
    AuthorizationError,
    BusinessRuleError,
    EntityNotFoundError,
    ValidationError,
)
from app.modules.tasks.application.task_guards import TaskScopeGuards
from app.modules.solicitations.domain.briefing import (
    briefing,
    titulo_da_tarefa,
)
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
)
from app.shared.pagination import PageParams

# Maximo de categorias num unico envio: o menu tem 11. Teto = tamanho do
# menu (nao ha o que selecionar alem disso) e corta payload inflado.
MAX_ITENS_POR_LOTE = 11


@dataclass(frozen=True, slots=True)
class SolicitationItem:
    """Uma categoria preenchida dentro de um envio."""

    category: str
    summary: str
    answers: list[dict]


@dataclass(frozen=True, slots=True)
class CreatePublicCommand:
    """Um envio do formulario = N itens (multi-selecao de categorias).

    Os dados do solicitante sao do ENVIO (preenchidos uma vez) e ficam
    replicados em cada linha filha -- de proposito: cada solicitacao
    precisa ser autoexplicativa na fila, sem join.
    """

    workspace_slug: str
    requester_name: str
    requester_email: str
    #: ⚠️ OPCIONAIS DESDE A FATIA G: quem decide se sao exigidos e o
    #: FORMULARIO, e nao o schema. `None` = "este formulario nao perguntou".
    requester_phone: str | None
    requester_department: str | None
    requester_polo: str | None
    items: list[SolicitationItem]
    honeypot: str = ""
    #: Spec 043 (fatia B). De qual formulario veio o envio.
    #:
    #: ⚠️ NO FIM DA CLASSE E COM DEFAULT, e nao por estetica: `dataclass` recusa
    #: campo sem default depois de um com default, e eu o tinha posto no meio
    #: -- `CreatePublicCommand(**base)` dos testes existentes quebraria antes de
    #: qualquer regra ser exercitada.
    #:
    #: ⚠️ E O `None` E COMPATIBILIDADE: cliente que ainda nao conhece o campo
    #: continua enviando, e cai na validacao antiga contra `CATEGORIES`.
    form_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class RotuloDeCategoria:
    """Como uma categoria se APRESENTA na fila -- e nao o que ela e.

    ⚠️ A CHAVE E O `slug`, QUE FICA GRAVADO NO PEDIDO; isto aqui e a etiqueta,
    resolvida na hora de mostrar. Por isso o slug da secao nao pode mudar e o
    titulo pode: renomear arruma a fila inteira, inclusive o passado.
    """

    title: str
    emoji: str
    sla_text: str | None


@dataclass(frozen=True, slots=True)
class Batch:
    """Um envio agrupado: dados do solicitante + as demandas dele."""

    batch_id: uuid.UUID
    requester_name: str
    requester_email: str
    requester_phone: str
    requester_department: str
    requester_polo: str
    created_at: object
    items: list[Solicitation]


@dataclass(frozen=True, slots=True)
class MarkTaskCommand:
    solicitation_id: uuid.UUID
    created: bool
    task_ref: str | None = None
    #: A tarefa DE VERDADE (Spec 043, fatia E).
    #:
    #: ⚠️ NO FIM E COM DEFAULT -- `dataclass` recusa campo sem default depois
    #: de um com default, e todo `MarkTaskCommand(...)` que ja existe continua
    #: valendo.
    task_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class CriarTarefaCommand:
    """Criar a tarefa A PARTIR do pedido, ja vinculada (Spec 043, fatia E).

    ⚠️ O `board_id` E OPCIONAL e `None` significa o Quadro geral -- o mesmo
    contrato do `CreateTaskCommand`. O time NAO e parametro: ele vem do
    FORMULARIO por onde o pedido entrou, e deixar quem tria escolher abriria a
    porta para a tarefa nascer no time errado, longe de quem vai fazer.
    """

    solicitation_id: uuid.UUID
    board_id: uuid.UUID | None = None
    #: Quem fica responsavel. VAZIO = quem esta triando.
    #:
    #: ⚠️⚠️ TODA TAREFA PRECISA DE AO MENOS UM RESPONSAVEL neste produto
    #: (regra de 05/08, em `TaskService.create`) -- descobri isto com a criacao
    #: explodindo em `ValidationError`. O padrao ser quem tria e a unica opcao
    #: honesta: e a pessoa que acabou de aceitar o pedido, e portanto quem
    #: responde por ele ate repassar. Deixar sem dono faria a tarefa nascer
    #: invisivel em "Minhas tarefas" de todo mundo.
    assignee_ids: list[uuid.UUID] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class AndarCommand:
    """Mover um pedido ACEITO entre aprovada / em andamento / concluida."""

    solicitation_id: uuid.UUID
    novo_status: str


@dataclass(frozen=True, slots=True)
class ReviewCommand:
    solicitation_id: uuid.UUID
    approve: bool
    note: str | None


class SolicitationService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = SolicitationRepository(session)

    # ------------------------------------------------------------
    # Publico (sem tenant context)
    # ------------------------------------------------------------
    async def create_public(
        self, uow: UnitOfWork, command: CreatePublicCommand
    ) -> list[Solicitation] | None:
        """Cria UMA linha por categoria selecionada, todas no mesmo lote.

        Cada linha nasce PENDING e e triada de forma independente: o
        aprovador pode aceitar a arte e rejeitar a divulgacao do mesmo
        envio. O `batch_id` compartilhado gera o protocolo unico que o
        solicitante leva embora.

        Tudo-ou-nada na CRIACAO (um unico commit): se uma categoria for
        invalida, nenhuma linha e gravada -- o solicitante nao fica com
        meio pedido no ar.

        Retorna None quando o honeypot pegou um bot -- a rota responde
        201 mesmo assim (descarte silencioso).
        """
        if command.honeypot.strip():
            return None  # bot; finge sucesso, nao persiste

        if not command.items:
            raise ValidationError("Selecione ao menos um tipo de solicitacao.")
        if len(command.items) > MAX_ITENS_POR_LOTE:
            raise ValidationError(
                "Selecione no maximo "
                f"{MAX_ITENS_POR_LOTE} tipos de solicitacao por envio."
            )

        # ⚠️ A VALIDACAO DA CATEGORIA TEM DOIS CAMINHOS (Spec 043, fatia B),
        # e o segundo esta morrendo:
        #
        #   - COM `form_id`: as categorias validas sao as SECOES daquele
        #     formulario, lidas do banco. E o caminho novo, e o unico que sabe
        #     de formulario criado por gente.
        #   - SEM `form_id`: cai na lista fixa `CATEGORIES` do dominio, que e o
        #     comportamento de sempre. ⚠️ ISSO E COMPATIBILIDADE, e nao a
        #     regra: existe para a aba que ficou aberta durante o deploy nao
        #     receber 422 numa rota sem login. Quando o front antigo sumir de
        #     circulacao, este ramo e a `CATEGORIES` saem juntos -- e e por
        #     isso que o `frozenset` continua ali por enquanto.
        #
        # Valida TODAS antes de gravar QUALQUER uma.
        if command.form_id is None:
            for item in command.items:
                if item.category not in CATEGORIES:
                    raise ValidationError("Categoria de solicitacao invalida.")

        # Categoria repetida no mesmo envio e erro de UI, nao pedido real:
        # viraria duas linhas identicas na fila da triagem.
        categorias = [i.category for i in command.items]
        if len(set(categorias)) != len(categorias):
            raise ValidationError(
                "Cada tipo de solicitacao pode ser escolhido uma vez por envio."
            )

        workspace = await get_workspace_by_slug(
            self.session, command.workspace_slug
        )
        if workspace is None:
            # 404 generico de proposito (nao enumera slugs).
            raise EntityNotFoundError("Workspace", identifier=command.workspace_slug)

        # ⚠️⚠️ O FORMULARIO E CONFERIDO CONTRA O WORKSPACE DO SLUG, E TEM DE
        # ESTAR PUBLICADO. Sem as duas condicoes, um `form_id` copiado de outro
        # lugar penduraria a solicitacao no formulario de OUTRO cliente -- numa
        # rota sem credencial, onde nao ha usuario para culpar depois. E
        # aceitar rascunho deixaria entrar pedido por uma porta que ninguem
        # abriu ainda.
        #
        # ⚠️ E A RECUSA E A MESMA DE CATEGORIA INVALIDA, de proposito: um erro
        # especifico ("este formulario e de outro workspace") confirmaria a
        # existencia dele para quem esta sondando.
        if command.form_id is not None:
            secoes = (
                await self.session.execute(
                    select(SolicitationSection.slug)
                    .join(
                        SolicitationForm,
                        (SolicitationForm.id == SolicitationSection.form_id)
                        & (
                            SolicitationForm.workspace_id
                            == SolicitationSection.workspace_id
                        ),
                    )
                    .where(
                        SolicitationForm.id == command.form_id,
                        SolicitationForm.workspace_id == workspace.id,
                        SolicitationForm.deleted_at.is_(None),
                        SolicitationForm.is_published.is_(True),
                        SolicitationSection.deleted_at.is_(None),
                    )
                )
            ).scalars().all()
            validas = set(secoes)
            for item in command.items:
                if item.category not in validas:
                    raise ValidationError("Categoria de solicitacao invalida.")

        # ⚠️⚠️ A IDENTIFICACAO E CONFERIDA CONTRA O CABECALHO DO FORMULARIO
        # (Spec 043, fatia G), e nao contra uma lista fixa. Ver
        # `_identificacao_conferida`.
        contato = await self._identificacao_conferida(command, workspace.id)

        batch_id = uuid.uuid4()
        total = len(command.items)
        criadas: list[Solicitation] = []

        # A ordem da lista E a ordem de selecao do solicitante -- batch_seq
        # a preserva pra fila mostrar "1 de 3", "2 de 3" na mesma sequencia.
        for posicao, item in enumerate(command.items, start=1):
            solicitation = Solicitation(
                requester_name=command.requester_name.strip(),
                requester_email=command.requester_email.strip().lower(),
                requester_phone=contato["phone"],
                requester_department=contato["department"],
                requester_polo=contato["polo"],
                batch_id=batch_id,
                batch_seq=posicao,
                batch_total=total,
                category=item.category,
                summary=item.summary.strip()[:500],
                answers=item.answers,
                # ⚠️ E ELE QUE FAZ A FILA SABER DE QUEM E A SOLICITACAO. Sem
                # este campo ela nasce orfa: continua na fila (o JOIN e LEFT),
                # mas visivel a quem tem `solicitation.review` no workspace
                # inteiro, em vez do time dono do formulario.
                form_id=command.form_id,
                status=SolicitationStatus.PENDING,
            )
            insert_public(
                self.session, workspace_id=workspace.id, solicitation=solicitation
            )
            criadas.append(solicitation)

        await uow.commit()
        for solicitation in criadas:
            await self.session.refresh(solicitation)
        return criadas

    # ------------------------------------------------------------
    # Autenticado (triagem)
    # ------------------------------------------------------------
    async def _identificacao_conferida(
        self, command: CreatePublicCommand, workspace_id: uuid.UUID
    ) -> dict[str, str | None]:
        """Telefone, area e polo: o formulario pede? entao tem de vir.

        ⚠️⚠️ A OBRIGATORIEDADE MUDOU DE LUGAR NA FATIA G. Ela era do schema
        (`min_length`), o que recusava o pedido antes de o servidor saber por
        qual porta ele entrou -- e o formulario de TI, que nao pergunta polo,
        levaria 422 em toda submissao. Agora quem decide e o CABECALHO do
        formulario: rotulo preenchido = pergunta e exige; `NULL` = nao
        pergunta.

        ⚠️ E O QUE NAO E PEDIDO E DESCARTADO, e nao apenas ignorado. Um cliente
        antigo (ou uma aba aberta desde antes do deploy) continua mandando os
        cinco campos; gravar um "Polo: Taboão" que o formulario nao perguntou
        poria na fila um dado que ninguem pediu e que a tela nao sabe rotular.

        ⚠️ SEM `form_id` NADA MUDA: cai no comportamento antigo, com os tres
        exigidos. E o mesmo ramo de compatibilidade da validacao de categoria,
        e ele morre junto com ela.
        """
        vindos = {
            "phone": (command.requester_phone or "").strip(),
            "department": (command.requester_department or "").strip(),
            "polo": (command.requester_polo or "").strip(),
        }
        rotulos = {"phone": "Telefone", "department": "Área", "polo": "Polo"}

        if command.form_id is None:
            for chave, valor in vindos.items():
                if not valor:
                    raise ValidationError(
                        f"{rotulos[chave]} é obrigatório.",
                        details={"field": f"requester_{chave}"},
                    )
            return dict(vindos)

        cabecalho = (
            await self.session.execute(
                select(
                    SolicitationForm.phone_label,
                    SolicitationForm.department_label,
                    SolicitationForm.polo_label,
                ).where(
                    SolicitationForm.id == command.form_id,
                    SolicitationForm.workspace_id == workspace_id,
                    SolicitationForm.deleted_at.is_(None),
                )
            )
        ).one_or_none()
        if cabecalho is None:
            # O formulario ja foi conferido antes deste ponto; chegar aqui sem
            # linha e defeito nosso, nao pedido invalido.
            raise EntityNotFoundError("Formulário não encontrado.")

        pedidos = dict(
            zip(("phone", "department", "polo"), cabecalho, strict=True)
        )
        resultado: dict[str, str | None] = {}
        for chave, rotulo in pedidos.items():
            if rotulo is None:
                resultado[chave] = None  # nao perguntou -> descarta
                continue
            if not vindos[chave]:
                raise ValidationError(
                    f"{rotulo} é obrigatório.",
                    details={"field": f"requester_{chave}"},
                )
            resultado[chave] = vindos[chave]
        return resultado

    async def rotulos_de_categoria(
        self, itens: list[Solicitation]
    ) -> dict[tuple[uuid.UUID | None, str], RotuloDeCategoria]:
        """Titulo, emoji e prazo de cada categoria que aparece nestes pedidos.

        ⚠️⚠️ ATE 26/08 A FILA LIA ISTO DE UM ARQUIVO ESTATICO NO FRONT
        (`CATEGORIA_POR_SLUG`, em `web/lib/solicitacaoForm.ts`). A fatia B
        trocou a fonte do formulario PUBLICO e nao a da fila -- e funcionava,
        porque a migration 0017 copiou os mesmos slugs. **A primeira secao
        criada pelo editor da fatia C2 apareceria la como slug cru e "❓".**
        Divergencia silenciosa: nada quebra, nada avisa, so fica feio para uma
        categoria e certo para as outras.

        ⚠️ E O ROTULO E RESOLVIDO AGORA, e nao gravado no pedido. E o oposto da
        regra das RESPOSTAS, que sao retrato do dia (`{label, value}`), e a
        diferenca e proposital: renomear "Foto" para "Fotografia" deve arrumar
        a fila inteira, inclusive o passado. Por isso o `slug` da secao nao
        pode mudar e o titulo pode -- um e a chave, o outro e a etiqueta.

        ⚠️ O PEDIDO ORFAO (sem `form_id`) TAMBEM GANHA ROTULO. Sao os
        anteriores a esta spec; eles chegaram pelo formulario estatico, cujas
        categorias sao exatamente as secoes que a 0017 criou. Procurar o slug
        entre todas as secoes do workspace devolve o titulo certo para eles --
        e resolver so por `form_id` seria uma regressao visivel: dois pedidos
        de julho perderiam o titulo que hoje tem.
        """
        tenant = require_tenant()
        slugs = {i.category for i in itens if i.category}
        if not slugs:
            return {}

        linhas = (
            await self.session.execute(
                select(
                    SolicitationSection.form_id,
                    SolicitationSection.slug,
                    SolicitationSection.title,
                    SolicitationSection.emoji,
                    SolicitationSection.sla_text,
                )
                .join(
                    SolicitationForm,
                    SolicitationForm.id == SolicitationSection.form_id,
                )
                .where(
                    SolicitationSection.workspace_id == tenant.workspace_id,
                    SolicitationSection.slug.in_(slugs),
                    SolicitationSection.deleted_at.is_(None),
                    SolicitationForm.deleted_at.is_(None),
                )
                # ⚠️ ORDEM PARA O DESEMPATE DO ORFAO: dois formularios podem
                # ter uma secao de mesmo slug. Sem `form_id` para escolher, o
                # mais ANTIGO vence -- e o mais antigo e justamente aquele de
                # onde os pedidos orfaos vieram.
                .order_by(SolicitationForm.created_at.desc())
            )
        ).all()

        rotulos: dict[tuple[uuid.UUID | None, str], RotuloDeCategoria] = {}
        for form_id, slug, title, emoji, sla in linhas:
            rotulo = RotuloDeCategoria(title=title, emoji=emoji, sla_text=sla)
            rotulos[(form_id, slug)] = rotulo
            # `desc()` acima faz o mais antigo ser escrito por ULTIMO, entao
            # ele e quem fica na chave sem form.
            rotulos[(None, slug)] = rotulo
        return rotulos

    async def titulos_das_tarefas(
        self, itens: list[Solicitation]
    ) -> dict[uuid.UUID, str]:
        """O titulo de cada tarefa vinculada nesta pagina da fila.

        ⚠️ RESOLVIDO NA HORA, e nao gravado no pedido: renomear a tarefa no
        quadro arruma o link na fila. Mesma regra do rotulo da categoria -- o
        `task_id` e a chave, o titulo e a etiqueta.

        ⚠️ E TAREFA APAGADA NAO ENTRA. Ela sai do dicionario, a tela cai no
        "tarefa vinculada" sem nome, e o pedido volta a aparecer como algo a
        resolver -- que e a verdade.

        ⚠️ UMA CONSULTA PARA A PAGINA INTEIRA: dez envios de quatro categorias
        seriam 40 idas ao banco para buscar um titulo.
        """
        ids = {i.task_id for i in itens if i.task_id is not None}
        if not ids:
            return {}
        tenant = require_tenant()
        linhas = (
            await self.session.execute(
                select(Task.id, Task.title).where(
                    Task.id.in_(ids),
                    Task.workspace_id == tenant.workspace_id,
                    Task.deleted_at.is_(None),
                )
            )
        ).all()
        return {tid: titulo for tid, titulo in linhas}

    async def list_batches(
        self, *, params: PageParams, filtro: str | None, team_id: uuid.UUID | None
    ) -> tuple[list[Batch], int]:
        """Fila agrupada por ENVIO (um card por submissao).

        `team_id` recorta a fila pelo time do FORMULARIO (Spec 048, fatia D).
        `None` = sem recorte. Sem default nos tres metodos de leitura, de
        proposito -- ver `SolicitationRepository.count_pending`.
        """
        validos = set(SolicitationStatus) | {"SEM_TAREFA"}
        if filtro is not None and filtro not in validos:
            raise ValidationError("Filtro invalido.")

        linhas, total = await self.repo.list_batches(
            params=params, filtro=filtro, team_id=team_id
        )

        # Agrupa preservando a ordem devolvida pelo repositorio (envio mais
        # recente primeiro; dentro do envio, a ordem de selecao original).
        agrupado: dict[uuid.UUID, list[Solicitation]] = {}
        for linha in linhas:
            agrupado.setdefault(linha.batch_id, []).append(linha)

        return [
            Batch(
                batch_id=batch_id,
                requester_name=itens[0].requester_name,
                requester_email=itens[0].requester_email,
                requester_phone=itens[0].requester_phone,
                requester_department=itens[0].requester_department,
                requester_polo=itens[0].requester_polo,
                created_at=itens[0].created_at,
                items=itens,
            )
            for batch_id, itens in agrupado.items()
        ], total

    async def count_pending(self, team_id: uuid.UUID | None) -> int:
        return await self.repo.count_pending(team_id)

    async def count_approved_without_task(self, team_id: uuid.UUID | None) -> int:
        return await self.repo.count_approved_without_task(team_id)

    async def _assert_tarefa_do_workspace(self, task_id: uuid.UUID) -> Task:
        """A tarefa existe, e VIVA e e deste workspace?

        ⚠️ A FK COMPOSTA JA IMPEDIRIA apontar para outro cliente -- mas o erro
        viria do banco como violacao de integridade, feio e sem explicacao.
        Aqui vira 404 com texto.

        ⚠️ E O `deleted_at` IMPORTA: tarefa arquivada some das telas, e
        vincular o pedido a uma delas seria criar um botao que leva a lugar
        nenhum. A FK nao sabe de soft delete.
        """
        tenant = require_tenant()
        tarefa = (
            await self.session.execute(
                select(Task).where(
                    Task.id == task_id,
                    Task.workspace_id == tenant.workspace_id,
                    Task.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if tarefa is None:
            raise EntityNotFoundError("Tarefa não encontrada.")
        return tarefa

    async def criar_tarefa(
        self, uow: UnitOfWork, command: CriarTarefaCommand
    ) -> tuple[Solicitation, Task]:
        """Cria a tarefa A PARTIR do pedido e ja a vincula.

        ⚠️⚠️ ISTO SUBSTITUI UM COPIA-E-COLA, e o rastro dele estava na tela: o
        botao "Copiar briefing" existe desde a Spec 025 porque o fluxo real era
        copiar, sair da fila, abrir o quadro, criar a tarefa, colar, voltar e
        marcar "tarefa criada". Seis passos, e o ultimo era o que mais se
        esquecia -- dai o filtro "aprovadas sem tarefa" ter valor.

        ⚠️ O TIME VEM DO FORMULARIO, e nao de quem clica. O pedido entrou por
        uma porta que pertence a um time; a tarefa nasce nesse mesmo time. Usar
        o time de quem tria faria a tarefa nascer longe de quem vai faze-la
        sempre que um ADMIN triasse a fila de outra equipe.

        ⚠️ E O PEDIDO PRECISA ESTAR ACEITO. Criar tarefa de pedido pendente
        pularia a triagem por um caminho lateral -- a mesma razao de `andar`
        recusar PENDING.
        """
        solicitation = await self._para_triar(command.solicitation_id)
        if solicitation.status not in ACEITOS:
            raise BusinessRuleError(
                "Aprove a solicitação antes de criar a tarefa."
            )
        if solicitation.task_id is not None:
            # ⚠️ RECUSA EM VEZ DE CRIAR A SEGUNDA: dois cliques no mesmo botao,
            # ou duas abas, dariam duas tarefas identicas no quadro -- e a
            # segunda ficaria orfa, porque o vinculo e um so.
            raise BusinessRuleError(
                "Esta solicitação já tem uma tarefa vinculada."
            )

        time = await self._time_do_pedido(solicitation)
        # ⚠️ O ROTULO BONITO DA CATEGORIA, e nao o slug: a tarefa se chama
        # "[Fotografia] ..." e nao "[foto] ...". Se a secao nao existir mais, o
        # slug e a reserva -- a mesma regra da fila.
        rotulos = await self.rotulos_de_categoria([solicitation])
        rotulo = rotulos.get((solicitation.form_id, solicitation.category))
        nome = rotulo.title if rotulo else None

        tenant = require_tenant()
        tarefa = await TaskService(self.session).create(
            CreateTaskCommand(
                title=titulo_da_tarefa(solicitation, nome),
                description=briefing(solicitation, nome),
                team_id=time,
                board_id=command.board_id,
                # ⚠️ QUEM TRIA VIRA RESPONSAVEL quando ninguem e indicado --
                # ver `CriarTarefaCommand.assignee_ids`.
                assignee_ids=command.assignee_ids or [tenant.user_id],
            )
        )

        solicitation.task_id = tarefa.id
        solicitation.task_created_at = datetime.now(UTC)
        solicitation.task_marked_by_user_id = tenant.user_id
        await uow.commit()
        await self.session.refresh(solicitation)
        return solicitation, tarefa

    async def _para_triar(self, solicitation_id: uuid.UUID) -> Solicitation:
        """O pedido, se quem chama o TRIA. Spec 051, fatia B.

        Duas perguntas, nesta ordem:

            ler   -- o `_base_select` do repositorio ja recorta por
                     `solicitation.read` no time do formulario: fora dele, 404;
            triar -- `solicitation.review` NO TIME DO FORMULARIO: sem ele, 403.

        ⚠️ HOJE OS DOIS VERBOS ESTAO NOS MESMOS PAPEIS, e o 403 nao acontece por
        nenhum papel pre-definido. A pergunta fica porque a rota so ve
        `solicitation.review` "em algum lugar" -- e o dia em que um papel ler
        sem triar e o dia em que ele triaria a fila de outro time.

        ⚠️ O TIME E O DO FORMULARIO MESMO APAGADO, como no `_base_select` (que
        junta sem olhar `deleted_at`): a fila e o triar tem de concordar sobre
        de quem e o pedido. Orfa de verdade (sem `form_id`) nao tem time, e
        `can_in(p, None)` responde so pela organizacao.
        """
        solicitation = await self.repo.get_by_id_or_raise(solicitation_id)
        time = None
        if solicitation.form_id is not None:
            time = (
                await self.session.execute(
                    select(SolicitationForm.team_id).where(
                        SolicitationForm.id == solicitation.form_id
                    )
                )
            ).scalar_one_or_none()
        if not require_tenant().has_permission_in("solicitation.review", time):
            raise AuthorizationError("Você não tria as solicitações deste time.")
        return solicitation

    async def _time_do_pedido(self, solicitation: Solicitation):
        """O time dono do FORMULARIO por onde o pedido entrou.

        ⚠️ `None` PARA PEDIDO ORFAO (anterior a esta spec, ou de formulario
        apagado), e `None` no `CreateTaskCommand` significa "o subtime de quem
        cria" -- que e o comportamento de sempre. E a unica saida honesta: nao
        ha time para herdar.
        """
        if solicitation.form_id is None:
            return None
        return (
            await self.session.execute(
                select(SolicitationForm.team_id).where(
                    SolicitationForm.id == solicitation.form_id,
                    SolicitationForm.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()

    async def mark_task(
        self, uow: UnitOfWork, command: MarkTaskCommand
    ) -> Solicitation:
        """Marca/desmarca "tarefa criada" numa solicitacao APROVADA.

        E autodeclarado -- ninguem verifica se a tarefa existe mesmo. O
        valor esta no CONTRARIO: o que fica sem marca aparece no filtro
        "aprovadas sem tarefa" e para de ser invisivel.
        """
        solicitation = await self._para_triar(command.solicitation_id)

        # ⚠️ OS TRES ACEITOS (Spec 043, fatia D), e nao so APPROVED. Um pedido
        # EM ANDAMENTO e justamente aquele em que a tarefa foi criada -- exigir
        # APPROVED aqui tornaria impossivel marcar a tarefa depois de comecar o
        # trabalho, que e quando isso normalmente acontece.
        if solicitation.status not in ACEITOS:
            raise BusinessRuleError(
                "So solicitacao aprovada pode ser marcada como tarefa criada."
            )

        if command.created:
            tenant = require_tenant()
            solicitation.task_created_at = datetime.now(UTC)
            solicitation.task_marked_by_user_id = tenant.user_id
            solicitation.task_ref = (command.task_ref or "").strip()[:500] or None
            if command.task_id is not None:
                # ⚠️ CONFERIDA CONTRA O WORKSPACE, e nao aceita crua. A FK
                # composta ja impediria apontar para outro cliente, mas o erro
                # viria do banco como violacao de integridade -- feio e sem
                # explicacao. Aqui vira 404 com texto.
                tarefa = await self._assert_tarefa_do_workspace(command.task_id)
                # ⚠️⚠️ Spec 051, fatia B: E ESTAR NA LENTE de quem marca. So o
                # workspace era conferido -- um gerente do Marketing vinculava
                # uma tarefa do Comercial (bastava o id) e a fila passava a
                # mostrar o TITULO dela (`titulos_das_tarefas`). Fora da lente,
                # a mesma resposta de tarefa inexistente: 404.
                await TaskScopeGuards(self.session).assert_visible(tarefa)
            solicitation.task_id = command.task_id
        else:
            solicitation.task_created_at = None
            solicitation.task_marked_by_user_id = None
            solicitation.task_ref = None
            # ⚠️ DESMARCAR SOLTA O VINCULO TAMBEM. Deixar `task_id` apontando
            # para uma tarefa depois de "esta solicitacao nao tem tarefa" seria
            # a tela dizendo duas coisas opostas ao mesmo tempo.
            solicitation.task_id = None

        await uow.commit()
        await self.session.refresh(solicitation)
        return solicitation

    async def get(self, solicitation_id: uuid.UUID) -> Solicitation:
        return await self.repo.get_by_id_or_raise(solicitation_id)

    async def _monta_aviso(
        self, solicitation: Solicitation, anterior: str
    ) -> AvisoDeStatus | None:
        """O retrato do pedido para o n8n, montado AINDA COM A SESSAO VIVA.

        ⚠️⚠️ MONTAR ANTES E ENVIAR DEPOIS DO COMMIT e o coracao da regra 1 do
        §8. Se o envio acontecesse dentro da transacao, um n8n lento seguraria
        a linha no banco e um n8n fora do ar **desfaria a aprovacao**. Mas
        depois do commit a sessao pode nao servir mais para ler relacionamento
        -- entao os VALORES sao lidos aqui, e o que atravessa e um dataclass
        congelado, sem nenhum caminho de volta ao banco.

        ⚠️ E ELE SO CONSULTA SE O RECURSO ESTIVER LIGADO. Sem `N8N_WEBHOOK_URL`
        nao ha razao para duas consultas a cada aprovacao.
        """
        if not aviso_de_status.esta_ligado():
            return None

        rotulos = await self.rotulos_de_categoria([solicitation])
        rotulo = rotulos.get((solicitation.form_id, solicitation.category))

        form_slug = form_titulo = form_time = None
        if solicitation.form_id is not None:
            linha = (
                await self.session.execute(
                    select(
                        SolicitationForm.slug,
                        SolicitationForm.title,
                        Team.name,
                    )
                    .join(
                        Team,
                        (Team.id == SolicitationForm.team_id)
                        & (Team.workspace_id == SolicitationForm.workspace_id),
                    )
                    .where(SolicitationForm.id == solicitation.form_id)
                )
            ).one_or_none()
            if linha is not None:
                form_slug, form_titulo, form_time = linha

        return AvisoDeStatus(
            solicitation_id=solicitation.id,
            protocolo=str(solicitation.batch_id).split("-")[0].upper(),
            status_anterior=anterior,
            status_novo=solicitation.status,
            resumo=solicitation.summary,
            categoria=solicitation.category,
            categoria_titulo=rotulo.title if rotulo else solicitation.category,
            categoria_prazo=rotulo.sla_text if rotulo else None,
            motivo_recusa=solicitation.review_note,
            criada_em=solicitation.created_at,
            requester_name=solicitation.requester_name,
            requester_email=solicitation.requester_email,
            requester_phone=solicitation.requester_phone,
            requester_department=solicitation.requester_department,
            requester_polo=solicitation.requester_polo,
            form_slug=form_slug,
            form_titulo=form_titulo,
            form_time=form_time,
        )

    async def _avisar_status(self, aviso: AvisoDeStatus | None) -> None:
        """Dispara o aviso. **Nunca levanta** -- ver `aviso_de_status`."""
        if aviso is None:
            return
        await aviso_de_status.avisar(aviso)

    async def andar(
        self, uow: UnitOfWork, command: AndarCommand
    ) -> Solicitation:
        """Move um pedido ACEITO entre aprovada, em andamento e concluida.

        ⚠️ ISTO NAO E TRIAGEM, e a separacao e o ponto da fatia D. `review`
        decide se o pedido vale; `andar` conta em que pe ele esta. Por isso
        este metodo **nao toca** em `reviewed_by_user_id` nem em `reviewed_at`:
        eles registram quem decidiu e quando, e sao o que sobra para responder
        quando alguem cobrar meses depois.

        ⚠️ E POR ISSO A PERMISSAO E A MESMA (`solicitation.review`) mas a
        GUARDA E OUTRA: `can_review` continua exigindo PENDING, e este caminho
        exige o contrario -- ja ter saido de PENDING.
        """
        solicitation = await self._para_triar(command.solicitation_id)

        if command.novo_status not in ACEITOS:
            raise ValidationError(
                "Situação inválida: use aprovada, em andamento ou concluída."
            )
        if not pode_andar(solicitation.status, command.novo_status):
            # ⚠️ A MENSAGEM SEPARA OS DOIS MOTIVOS, porque as saidas sao
            # diferentes: de PENDING falta triar, de REJECTED nao ha saida.
            if solicitation.status == SolicitationStatus.PENDING:
                raise BusinessRuleError(
                    "Esta solicitação ainda não foi triada — aprove antes de "
                    "marcar o andamento."
                )
            if solicitation.status == SolicitationStatus.REJECTED:
                raise BusinessRuleError(
                    "Solicitação rejeitada não volta ao fluxo. Quem foi "
                    "recusado pode enviar um novo pedido."
                )
            raise BusinessRuleError("A solicitação já está nesta situação.")

        anterior = solicitation.status
        solicitation.status = command.novo_status

        aviso = await self._monta_aviso(solicitation, anterior)
        await uow.commit()
        await self.session.refresh(solicitation)
        await self._avisar_status(aviso)
        return solicitation

    async def review(
        self, uow: UnitOfWork, command: ReviewCommand
    ) -> Solicitation:
        """Aprova ou rejeita uma solicitacao PENDING.

        Rejeicao EXIGE justificativa: e o unico retorno que o
        solicitante tera (nao ha conta/notificacao pra ele) -- a
        justificativa fica registrada pra quando ele cobrar.
        """
        solicitation = await self._para_triar(command.solicitation_id)

        if not can_review(solicitation.status):
            raise BusinessRuleError(
                "Solicitacao ja triada: apenas solicitacoes pendentes "
                "podem ser aprovadas ou rejeitadas."
            )

        note = (command.note or "").strip()
        if not command.approve and not note:
            raise ValidationError(
                "Rejeicao exige uma justificativa (review_note)."
            )

        tenant = require_tenant()
        anterior = solicitation.status
        solicitation.status = (
            SolicitationStatus.APPROVED
            if command.approve
            else SolicitationStatus.REJECTED
        )
        solicitation.review_note = note or None
        solicitation.reviewed_by_user_id = tenant.user_id
        solicitation.reviewed_at = datetime.now(UTC)

        # ⚠️ MONTADO ANTES DO COMMIT, ENVIADO DEPOIS -- ver `_avisar_status`.
        aviso = await self._monta_aviso(solicitation, anterior)
        await uow.commit()
        await self.session.refresh(solicitation)
        await self._avisar_status(aviso)
        return solicitation
