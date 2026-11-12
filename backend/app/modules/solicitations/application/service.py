"""Service de Solicitacoes: envio publico, fila de triagem, triagem e andamento.

No envio publico, slug de workspace invalido da 404 generico e o honeypot
(`website` preenchido) e descartado em silencio, respondendo como sucesso.
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
from app.modules.solicitations.domain.briefing import (
    briefing,
    titulo_da_tarefa,
)
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
from app.modules.tasks.application.task_guards import TaskScopeGuards
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
)
from app.shared.exceptions.base import (
    AuthorizationError,
    BusinessRuleError,
    EntityNotFoundError,
    ValidationError,
)
from app.shared.pagination import PageParams

# Maximo de itens num envio (cada repeticao de secao e um item); corta payload inflado.
MAX_ITENS_POR_LOTE = 60
#: Quantas vezes a mesma secao repetivel entra num envio.
MAX_REPETICOES_POR_SECAO = 20
#: Texto do envio inteiro (resumos + perguntas + respostas). Os tetos por campo
#: ainda permitiam ~19 MB por POST numa rota sem login; 200 mil folga um envio real.
MAX_CARACTERES_POR_ENVIO = 200_000


@dataclass(frozen=True, slots=True)
class SolicitationItem:
    """Uma categoria preenchida dentro de um envio."""

    category: str
    summary: str
    answers: list[dict]


@dataclass(frozen=True, slots=True)
class CreatePublicCommand:
    """Um envio do formulario = N itens (multi-selecao de categorias).

    Os dados do solicitante sao replicados em cada linha, para cada solicitacao
    ser autoexplicativa na fila, sem join.
    """

    workspace_slug: str
    requester_name: str
    requester_email: str
    #: `None` = o formulario nao perguntou este campo.
    requester_phone: str | None
    requester_department: str | None
    requester_polo: str | None
    items: list[SolicitationItem]
    honeypot: str = ""
    #: De qual formulario veio o envio. `None` cai na validacao contra `CATEGORIES`.
    form_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class RotuloDeCategoria:
    """Como uma categoria se apresenta na fila.

    A chave e o `slug`, gravado no pedido; titulo e emoji sao resolvidos na hora,
    entao renomear a secao arruma a fila inteira.
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
    #: A tarefa vinculada (`task_ref` e o texto livre legado).
    task_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class CriarTarefaCommand:
    """Criar a tarefa a partir do pedido, ja vinculada.

    `board_id=None` = quadro geral. O time vem do formulario, nao de quem tria.
    """

    solicitation_id: uuid.UUID
    board_id: uuid.UUID | None = None
    #: Responsaveis. Vazio = quem esta triando (toda tarefa exige um responsavel).
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
        """Cria uma linha por categoria selecionada, todas no mesmo lote.

        Cada linha nasce PENDING e e triada separadamente; o `batch_id`
        compartilhado vira o protocolo. Tudo-ou-nada num unico commit.

        Retorna None quando o honeypot pegou um bot (a rota responde 201 assim mesmo).
        """
        if command.honeypot.strip():
            return None  # bot; finge sucesso, nao persiste

        if not command.items:
            raise ValidationError("Selecione ao menos um tipo de solicitacao.")
        if len(command.items) > MAX_ITENS_POR_LOTE:
            raise ValidationError(
                f"Envie no maximo {MAX_ITENS_POR_LOTE} solicitacoes de uma vez."
            )
        caracteres = sum(
            len(item.summary) + sum(len(a["label"]) + len(a["value"]) for a in item.answers)
            for item in command.items
        )
        if caracteres > MAX_CARACTERES_POR_ENVIO:
            raise ValidationError(
                "O envio ficou grande demais. Encurte as respostas mais longas "
                "ou divida em mais de um envio."
            )

        # Com `form_id`, as categorias validas sao as secoes daquele formulario;
        # sem ele, a lista fixa `CATEGORIES`. Valida todas antes de gravar.
        if command.form_id is None:
            for item in command.items:
                if item.category not in CATEGORIES:
                    raise ValidationError("Categoria de solicitacao invalida.")

        # Categoria repetida so vale em secao repetivel (conferido abaixo); sem
        # formulario nada repete.
        categorias = [i.category for i in command.items]
        repetidas = {c: categorias.count(c) for c in categorias if categorias.count(c) > 1}
        if repetidas and command.form_id is None:
            raise ValidationError(
                "Cada tipo de solicitacao pode ser escolhido uma vez por envio."
            )

        workspace = await get_workspace_by_slug(
            self.session, command.workspace_slug
        )
        if workspace is None:
            # 404 generico de proposito (nao enumera slugs).
            raise EntityNotFoundError("Workspace", identifier=command.workspace_slug)

        # O formulario tem de ser deste workspace e estar publicado. A recusa e a
        # mesma de categoria invalida, para nao confirmar a existencia dele.
        if command.form_id is not None:
            secoes = (
                await self.session.execute(
                    select(SolicitationSection.slug, SolicitationSection.repeatable)
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
            ).all()
            repetivel = {slug: rep for slug, rep in secoes}
            for item in command.items:
                if item.category not in repetivel:
                    raise ValidationError("Categoria de solicitacao invalida.")
            for slug, vezes in repetidas.items():
                if not repetivel[slug]:
                    raise ValidationError(
                        "Cada tipo de solicitacao pode ser escolhido uma vez por envio."
                    )
                if vezes > MAX_REPETICOES_POR_SECAO:
                    raise ValidationError(
                        f"Uma secao repete no maximo {MAX_REPETICOES_POR_SECAO} "
                        "vezes por envio."
                    )

        # Identificacao conferida contra o cabecalho do formulario.
        contato = await self._identificacao_conferida(command, workspace.id)

        batch_id = uuid.uuid4()
        total = len(command.items)
        criadas: list[Solicitation] = []

        # A ordem da lista e a ordem de selecao; `batch_seq` a preserva.
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
                # Sem `form_id` o pedido nasce orfao e aparece fora do time dono.
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

        Rotulo preenchido no cabecalho = pergunta e exige; `NULL` = nao pergunta
        e o valor enviado e descartado. Sem `form_id`, os tres sao exigidos.
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

        Resolvido na hora (renomear a secao arruma o passado). Pedido sem
        `form_id` tambem ganha rotulo, procurando o slug entre todas as secoes
        do workspace.
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
                # Desempate do pedido sem formulario: o formulario mais antigo vence.
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

    async def titulos_dos_formularios(
        self, itens: list[Solicitation]
    ) -> dict[uuid.UUID, str]:
        """O titulo do formulario de cada pedido desta pagina.

        Formulario apagado entra; pedido sem `form_id` fica de fora.
        """
        ids = {i.form_id for i in itens if i.form_id is not None}
        if not ids:
            return {}
        tenant = require_tenant()
        linhas = (
            await self.session.execute(
                select(SolicitationForm.id, SolicitationForm.title).where(
                    SolicitationForm.id.in_(ids),
                    SolicitationForm.workspace_id == tenant.workspace_id,
                )
            )
        ).all()
        return {fid: titulo for fid, titulo in linhas}

    async def titulos_das_tarefas(
        self, itens: list[Solicitation]
    ) -> dict[uuid.UUID, str]:
        """O titulo de cada tarefa vinculada nesta pagina, numa consulta so.

        Resolvido na hora; tarefa apagada nao entra.
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
        self,
        *,
        params: PageParams,
        filtro: str | None,
        team_id: uuid.UUID | None,
        search: str | None = None,
        form_id: uuid.UUID | None = None,
        without_task: bool = False,
    ) -> tuple[list[Batch], int]:
        """Fila agrupada por envio (um card por submissao).

        `team_id` recorta pelo time do formulario; `None` = sem recorte. Sem
        default de proposito -- ver `SolicitationRepository.count_pending`.
        """
        validos = set(SolicitationStatus) | {"SEM_TAREFA", "ACTIVE"}
        if filtro is not None and filtro not in validos:
            raise ValidationError("Filtro invalido.")

        linhas, total = await self.repo.list_batches(
            params=params,
            filtro=filtro,
            team_id=team_id,
            search=search,
            form_id=form_id,
            without_task=without_task,
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

    async def count_by_tab(
        self,
        team_id: uuid.UUID | None,
        search: str | None = None,
        form_id: uuid.UUID | None = None,
        *,
        filtro: str | None = None,
        without_task: bool = False,
    ) -> dict[str, int]:
        return await self.repo.count_by_tab(
            team_id, search, form_id, filtro=filtro, without_task=without_task
        )

    async def form_options(
        self, team_id: uuid.UUID | None
    ) -> list[tuple[uuid.UUID, str]]:
        return await self.repo.form_options(team_id)

    async def count_pending(self, team_id: uuid.UUID | None) -> int:
        return await self.repo.count_pending(team_id)

    async def count_approved_without_task(self, team_id: uuid.UUID | None) -> int:
        return await self.repo.count_approved_without_task(team_id)

    async def _assert_tarefa_do_workspace(self, task_id: uuid.UUID) -> Task:
        """A tarefa existe, esta viva e e deste workspace? Senao, 404 com texto.

        A FK composta ja barraria outro workspace, mas com erro de integridade, e
        nao sabe de soft delete.
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
        """Cria a tarefa a partir do pedido e ja a vincula.

        O time vem do formulario por onde o pedido entrou, nao de quem clica. O
        pedido precisa estar aceito.
        """
        solicitation = await self._para_triar(command.solicitation_id)
        if solicitation.status not in ACEITOS:
            raise BusinessRuleError(
                "Aprove a solicitação antes de criar a tarefa."
            )
        if solicitation.task_id is not None:
            # Recusa a segunda (duplo clique, duas abas): o vinculo e um so.
            raise BusinessRuleError(
                "Esta solicitação já tem uma tarefa vinculada."
            )

        time = await self._time_do_pedido(solicitation)
        # Titulo da secao, e nao o slug; se a secao sumiu, o slug e a reserva.
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
                # Ninguem indicado: quem tria vira responsavel.
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
        """O pedido, se quem chama o tria.

            ler   -- o `_base_select` do repositorio ja recorta por
                     `solicitation.read` no time do formulario: fora dele, 404;
            triar -- `solicitation.review` no time do formulario: sem ele, 403.

        A rota so confere `solicitation.review` "em algum lugar"; aqui e no time.
        O time e o do formulario mesmo apagado, como no `_base_select`. Pedido sem
        `form_id` nao tem time e `None` responde so pela organizacao.
        """
        solicitation = await self.repo.get_by_id_or_raise(solicitation_id)
        # Trava a linha e rele: sem isso, aprovar e rejeitar ao mesmo tempo (ou
        # dois "Criar tarefa") passariam as duas verificacoes.
        await self.session.execute(
            select(Solicitation.id)
            .where(Solicitation.id == solicitation.id)
            .with_for_update()
        )
        await self.session.refresh(solicitation)
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
        """O time dono do formulario por onde o pedido entrou.

        `None` so para pedido sem `form_id` (no `CreateTaskCommand`, "o subtime
        de quem cria"). Formulario apagado ainda tem time, como no `_para_triar`.
        """
        if solicitation.form_id is None:
            return None
        return (
            await self.session.execute(
                select(SolicitationForm.team_id).where(
                    SolicitationForm.id == solicitation.form_id
                )
            )
        ).scalar_one_or_none()

    async def mark_task(
        self, uow: UnitOfWork, command: MarkTaskCommand
    ) -> Solicitation:
        """Marca/desmarca "tarefa criada" numa solicitacao aceita.

        Autodeclarado: ninguem verifica se a tarefa existe. O que fica sem marca
        aparece no filtro "aprovadas sem tarefa".
        """
        solicitation = await self._para_triar(command.solicitation_id)

        # Os tres aceitos, e nao so APPROVED: a tarefa costuma ser marcada ja em andamento.
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
                tarefa = await self._assert_tarefa_do_workspace(command.task_id)
                # E precisa estar na lente de quem marca; fora dela, 404.
                await TaskScopeGuards(self.session).assert_visible(tarefa)
                solicitation.task_id = command.task_id
            # Sem `task_id`, o vinculo que ja existe fica.
        else:
            solicitation.task_created_at = None
            solicitation.task_marked_by_user_id = None
            solicitation.task_ref = None
            # Desmarcar solta o vinculo tambem.
            solicitation.task_id = None

        await uow.commit()
        await self.session.refresh(solicitation)
        return solicitation

    async def get(self, solicitation_id: uuid.UUID) -> Solicitation:
        return await self.repo.get_by_id_or_raise(solicitation_id)

    async def _monta_aviso(
        self, solicitation: Solicitation, anterior: str
    ) -> AvisoDeStatus | None:
        """O retrato do pedido para o n8n, montado ainda com a sessao viva.

        Monta antes e envia depois do commit (ver `aviso_de_status`). So consulta
        se o recurso estiver ligado.
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
        """Dispara o aviso. Nunca levanta -- ver `aviso_de_status`."""
        if aviso is None:
            return
        await aviso_de_status.avisar(aviso)

    async def andar(
        self, uow: UnitOfWork, command: AndarCommand
    ) -> Solicitation:
        """Move um pedido aceito entre aprovada, em andamento e concluida.

        Nao e triagem: nao toca em `reviewed_by_user_id` nem em `reviewed_at`.
        """
        solicitation = await self._para_triar(command.solicitation_id)

        if command.novo_status not in ACEITOS:
            raise ValidationError(
                "Situação inválida: use aprovada, em andamento ou concluída."
            )
        if not pode_andar(solicitation.status, command.novo_status):
            # Mensagens distintas: de PENDING falta triar, de REJECTED nao ha saida.
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

        Rejeicao exige justificativa: e o unico retorno que o solicitante recebe.
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

        # Montado antes do commit, enviado depois.
        aviso = await self._monta_aviso(solicitation, anterior)
        await uow.commit()
        await self.session.refresh(solicitation)
        await self._avisar_status(aviso)
        return solicitation
