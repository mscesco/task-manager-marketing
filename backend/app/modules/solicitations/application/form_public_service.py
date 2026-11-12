"""Leitura do formulario para quem nao tem login.

Nao usa `BaseRepository` (o `require_tenant()` dele estoura sem contexto): o
workspace vem do slug e toda consulta daqui precisa de `workspace_id` no WHERE,
escrito a mao. Sem esse filtro, formulario de outro cliente vaza pela porta publica.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    SolicitationForm,
    SolicitationQuestion,
    SolicitationSection,
    Team,
    Workspace,
)
from app.modules.solicitations.api.form_public_schemas import (
    PublicFormDetail,
    PublicFormResumo,
    PublicQuestion,
    PublicSection,
)
from app.shared.exceptions.base import EntityNotFoundError


class SolicitationPublicFormService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _workspace_id(self, slug: str):
        ws = (
            await self._session.execute(
                select(Workspace.id).where(Workspace.slug == slug)
            )
        ).scalar_one_or_none()
        return ws

    async def listar(self, workspace_slug: str) -> list[PublicFormResumo]:
        """Os publicados, com o nome do time, em ordem de titulo.

        Workspace inexistente devolve lista vazia, para nao revelar slugs.
        """
        ws_id = await self._workspace_id(workspace_slug)
        if ws_id is None:
            return []

        linhas = (
            await self._session.execute(
                select(
                    SolicitationForm.slug,
                    SolicitationForm.title,
                    SolicitationForm.description,
                    Team.name,
                )
                .join(
                    Team,
                    (Team.id == SolicitationForm.team_id)
                    & (Team.workspace_id == SolicitationForm.workspace_id),
                )
                .where(
                    SolicitationForm.workspace_id == ws_id,
                    SolicitationForm.deleted_at.is_(None),
                    SolicitationForm.is_published.is_(True),
                )
                .order_by(SolicitationForm.title)
            )
        ).all()
        return [
            PublicFormResumo(
                slug=linha[0],
                title=linha[1],
                description=linha[2],
                team_name=linha[3],
            )
            for linha in linhas
        ]

    async def obter(
        self, *, workspace_slug: str, form_slug: str
    ) -> PublicFormDetail:
        """Um formulario publicado, com secoes e perguntas vivas.

        404 generico para nao existe, despublicado, apagado ou de outro workspace.
        """
        ws_id = await self._workspace_id(workspace_slug)
        if ws_id is None:
            raise EntityNotFoundError("Formulário", identifier=form_slug)

        form = (
            await self._session.execute(
                select(SolicitationForm).where(
                    SolicitationForm.workspace_id == ws_id,
                    SolicitationForm.slug == form_slug,
                    SolicitationForm.deleted_at.is_(None),
                    SolicitationForm.is_published.is_(True),
                )
            )
        ).scalar_one_or_none()
        if form is None:
            raise EntityNotFoundError("Formulário", identifier=form_slug)

        secoes = list(
            (
                await self._session.execute(
                    select(SolicitationSection)
                    .where(
                        SolicitationSection.workspace_id == ws_id,
                        SolicitationSection.form_id == form.id,
                        SolicitationSection.deleted_at.is_(None),
                    )
                    .order_by(SolicitationSection.position)
                )
            )
            .scalars()
            .all()
        )
        perguntas: list[SolicitationQuestion] = []
        if secoes:
            perguntas = list(
                (
                    await self._session.execute(
                        select(SolicitationQuestion)
                        .where(
                            SolicitationQuestion.workspace_id == ws_id,
                            SolicitationQuestion.section_id.in_(
                                [s.id for s in secoes]
                            ),
                            SolicitationQuestion.deleted_at.is_(None),
                        )
                        .order_by(SolicitationQuestion.position)
                    )
                )
                .scalars()
                .all()
            )

        por_secao: dict = {s.id: [] for s in secoes}
        for q in perguntas:
            por_secao[q.section_id].append(
                PublicQuestion(
                    id=q.id,
                    label=q.label,
                    kind=q.kind,
                    required=q.required,
                    options=list(q.options or []),
                    placeholder=q.placeholder,
                    help=q.help,
                    show_if_question_id=q.show_if_question_id,
                    show_if_value=q.show_if_value,
                )
            )

        return PublicFormDetail(
            id=form.id,
            slug=form.slug,
            title=form.title,
            description=form.description,
            phone_label=form.phone_label,
            department_label=form.department_label,
            polo_label=form.polo_label,
            sections=[
                PublicSection(
                    slug=s.slug,
                    title=s.title,
                    emoji=s.emoji,
                    sla_text=s.sla_text,
                    summary_question_id=s.summary_question_id,
                    repeatable=s.repeatable,
                    repeat_label=s.repeat_label,
                    questions=por_secao[s.id],
                )
                for s in secoes
            ],
        )
