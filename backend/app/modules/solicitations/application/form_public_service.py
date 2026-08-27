"""Leitura do formulario para quem NAO tem login (Spec 043, fatia B).

⚠️⚠️ ESTE SERVICO NAO USA O `BaseRepository`, E ISSO E DELIBERADO. O
`_base_select` dele chama `require_tenant()`, que ESTOURA sem contexto -- e
aqui nao ha usuario nenhum. O mesmo desenho ja existe no `insert_public` do
`repository.py`: caminho publico resolve o workspace pelo SLUG, explicitamente,
e nunca le dado de tenant sem ele.

⚠️ POR ISSO TODA CONSULTA DAQUI CARREGA `workspace_id` NO WHERE, escrito a mao.
Nao ha rede de seguranca automatica neste caminho -- se alguem esquecer o
filtro, o formulario de outro cliente sai pela porta publica, e nenhum teste de
tenant existente pegaria isso.
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

        ⚠️ WORKSPACE INEXISTENTE DEVOLVE LISTA VAZIA -- ver o router. Nao e
        tolerancia a erro: e nao dar resposta diferente para quem sonda slugs.
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

        ⚠️ 404 GENERICO PARA OS QUATRO CASOS (nao existe, despublicado,
        apagado, de outro workspace). Respostas diferentes viram um enumerador
        de slugs -- e o `EntityNotFoundError` deste projeto ja e generico na
        borda.
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
            # ⚠️ OS ROTULOS DA IDENTIFICACAO (Spec 043, fatia G). Sem eles a
            # porta publica desenharia os cinco campos fixos de sempre -- que
            # era exatamente o defeito: "Polo" aparecia num formulario de TI.
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
                    questions=por_secao[s.id],
                )
                for s in secoes
            ],
        )
