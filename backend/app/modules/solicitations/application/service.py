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
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models import Solicitation
from app.db.unit_of_work import UnitOfWork
from app.modules.solicitations.domain.solicitation import (
    CATEGORIES,
    SolicitationStatus,
    can_review,
)
from app.modules.solicitations.infrastructure.repository import (
    SolicitationRepository,
    get_workspace_by_slug,
    insert_public,
)
from app.shared.exceptions.base import (
    BusinessRuleError,
    EntityNotFoundError,
    ValidationError,
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
    requester_phone: str
    requester_department: str
    requester_polo: str
    items: list[SolicitationItem]
    honeypot: str = ""


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

        # Valida TODAS antes de gravar QUALQUER uma.
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

        batch_id = uuid.uuid4()
        total = len(command.items)
        criadas: list[Solicitation] = []

        # A ordem da lista E a ordem de selecao do solicitante -- batch_seq
        # a preserva pra fila mostrar "1 de 3", "2 de 3" na mesma sequencia.
        for posicao, item in enumerate(command.items, start=1):
            solicitation = Solicitation(
                requester_name=command.requester_name.strip(),
                requester_email=command.requester_email.strip().lower(),
                requester_phone=command.requester_phone.strip(),
                requester_department=command.requester_department.strip(),
                requester_polo=command.requester_polo.strip(),
                batch_id=batch_id,
                batch_seq=posicao,
                batch_total=total,
                category=item.category,
                summary=item.summary.strip()[:500],
                answers=item.answers,
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
    async def list_batches(
        self, *, params: PageParams, filtro: str | None
    ) -> tuple[list[Batch], int]:
        """Fila agrupada por ENVIO (um card por submissao)."""
        validos = set(SolicitationStatus) | {"SEM_TAREFA"}
        if filtro is not None and filtro not in validos:
            raise ValidationError("Filtro invalido.")

        linhas, total = await self.repo.list_batches(
            params=params, filtro=filtro
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

    async def count_pending(self) -> int:
        return await self.repo.count_pending()

    async def count_approved_without_task(self) -> int:
        return await self.repo.count_approved_without_task()

    async def mark_task(
        self, uow: UnitOfWork, command: MarkTaskCommand
    ) -> Solicitation:
        """Marca/desmarca "tarefa criada" numa solicitacao APROVADA.

        E autodeclarado -- ninguem verifica se a tarefa existe mesmo. O
        valor esta no CONTRARIO: o que fica sem marca aparece no filtro
        "aprovadas sem tarefa" e para de ser invisivel.
        """
        solicitation = await self.repo.get_by_id_or_raise(
            command.solicitation_id
        )

        if solicitation.status != SolicitationStatus.APPROVED:
            raise BusinessRuleError(
                "So solicitacao aprovada pode ser marcada como tarefa criada."
            )

        if command.created:
            tenant = require_tenant()
            solicitation.task_created_at = datetime.now(UTC)
            solicitation.task_marked_by_user_id = tenant.user_id
            solicitation.task_ref = (command.task_ref or "").strip()[:500] or None
        else:
            solicitation.task_created_at = None
            solicitation.task_marked_by_user_id = None
            solicitation.task_ref = None

        await uow.commit()
        await self.session.refresh(solicitation)
        return solicitation

    async def get(self, solicitation_id: uuid.UUID) -> Solicitation:
        return await self.repo.get_by_id_or_raise(solicitation_id)

    async def review(
        self, uow: UnitOfWork, command: ReviewCommand
    ) -> Solicitation:
        """Aprova ou rejeita uma solicitacao PENDING.

        Rejeicao EXIGE justificativa: e o unico retorno que o
        solicitante tera (nao ha conta/notificacao pra ele) -- a
        justificativa fica registrada pra quando ele cobrar.
        """
        solicitation = await self.repo.get_by_id_or_raise(command.solicitation_id)

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
        solicitation.status = (
            SolicitationStatus.APPROVED
            if command.approve
            else SolicitationStatus.REJECTED
        )
        solicitation.review_note = note or None
        solicitation.reviewed_by_user_id = tenant.user_id
        solicitation.reviewed_at = datetime.now(UTC)

        await uow.commit()
        await self.session.refresh(solicitation)
        return solicitation
