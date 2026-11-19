"""Categorias e tags de projeto: o catalogo do time raiz e o vinculo com o projeto.

As duas tem a mesma forma (nome e cor, do time raiz dos projetos); a diferenca
e so o vinculo: o projeto aponta para uma categoria (`category_id`) e para
varias tags (`project_tag_link`). O commit e do Unit of Work, no router.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import UTC, datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models import Project, ProjectCategory, ProjectTag, ProjectTagLink
from app.modules.auth.domain import team_scope
from app.modules.bases.domain.columns import OPTION_COLORS
from app.shared.exceptions.base import (
    AuthorizationError,
    ConflictError,
    EntityNotFoundError,
    ValidationError,
)

LabelModel = type[ProjectCategory] | type[ProjectTag]
_NOME = {ProjectCategory: "categoria", ProjectTag: "tag"}


class ProjectLabelService:
    """CRUD do catalogo de um tipo (`ProjectCategory` ou `ProjectTag`)."""

    def __init__(self, session: AsyncSession, model: LabelModel) -> None:
        self._session = session
        self._model = model

    async def list(self, team_id: uuid.UUID | None) -> list[ProjectCategory | ProjectTag]:
        """O catalogo do time raiz de `team_id`; sem ele, o de todas as raizes visiveis."""
        m = self._model
        stmt = select(m).where(m.workspace_id == require_tenant().workspace_id)
        if team_id is not None:
            stmt = stmt.where(m.team_id == self._raiz_visivel(team_id))
        else:
            raizes = _raizes_visiveis()
            if raizes is not None:
                stmt = stmt.where(m.team_id.in_(raizes))
        return list((await self._session.execute(stmt.order_by(m.name))).scalars())

    async def create(
        self, *, team_id: uuid.UUID, name: str, color: str
    ) -> ProjectCategory | ProjectTag:
        raiz = self._raiz_visivel(team_id)
        _assert_edita_projeto(raiz)
        nome = _nome_valido(name)
        await self._assert_nome_livre(raiz, nome, exceto=None)
        label = self._model(
            workspace_id=require_tenant().workspace_id,
            team_id=raiz,
            name=nome,
            color=_cor_valida(color),
        )
        self._session.add(label)
        await self._session.flush()
        return label

    async def update(
        self, *, label_id: uuid.UUID, name: str | None, color: str | None
    ) -> ProjectCategory | ProjectTag:
        label = await self._get_editavel(label_id)
        if name is not None:
            nome = _nome_valido(name)
            await self._assert_nome_livre(label.team_id, nome, exceto=label.id)
            label.name = nome
        if color is not None:
            label.color = _cor_valida(color)
        await self._session.flush()
        return label

    async def delete(self, *, label_id: uuid.UUID) -> None:
        """Apaga do catalogo. A tag sai dos projetos (CASCADE); a categoria
        solta os projetos aqui, porque a FK e RESTRICT."""
        label = await self._get_editavel(label_id)
        if self._model is ProjectCategory:
            await self._session.execute(
                update(Project)
                .where(
                    Project.category_id == label.id,
                    Project.workspace_id == label.workspace_id,
                )
                .values(category_id=None)
            )
        await self._session.delete(label)
        await self._session.flush()

    # ----------------------------------------------------
    def _raiz_visivel(self, team_id: uuid.UUID) -> uuid.UUID:
        tenant = require_tenant()
        if team_id not in {n.team_id for n in tenant.team_tree}:
            raise ValidationError(
                "Time informado nao existe neste workspace.",
                details={"field": "team_id"},
            )
        raiz = team_scope.root_of(team_id, tenant.team_tree)
        raizes = _raizes_visiveis()
        if raizes is not None and raiz not in raizes:
            raise ValidationError(
                "Time informado esta fora do seu alcance.",
                details={"field": "team_id"},
            )
        return raiz

    async def _get_editavel(self, label_id: uuid.UUID) -> ProjectCategory | ProjectTag:
        m = self._model
        label = (
            await self._session.execute(
                select(m).where(
                    m.id == label_id, m.workspace_id == require_tenant().workspace_id
                )
            )
        ).scalar_one_or_none()
        raizes = _raizes_visiveis()
        # Fora da lente e 404, como id inexistente.
        if label is None or (raizes is not None and label.team_id not in raizes):
            raise EntityNotFoundError(m.__name__, identifier=label_id)
        _assert_edita_projeto(label.team_id)
        return label

    async def _assert_nome_livre(
        self, raiz: uuid.UUID, nome: str, *, exceto: uuid.UUID | None
    ) -> None:
        # shortcut: maiuscula/minuscula so no servico (o UNIQUE do banco diferencia);
        # dois cliques simultaneos com grafias diferentes passariam. Indice em lower(name) se doer.
        m = self._model
        stmt = select(m.id).where(
            m.team_id == raiz, func.lower(m.name) == nome.lower()
        )
        if exceto is not None:
            stmt = stmt.where(m.id != exceto)
        if (await self._session.execute(stmt)).first() is not None:
            raise ConflictError(
                f"Já existe uma {_NOME[m]} com esse nome.",
                details={"field": "name"},
            )


def _raizes_visiveis() -> frozenset[uuid.UUID] | None:
    tenant = require_tenant()
    visiveis = team_scope.visible_team_ids(
        tenant.memberships, tenant.team_tree, org_role=tenant.org_role
    )
    if visiveis is None:
        return None
    return frozenset(team_scope.root_of(t, tenant.team_tree) for t in visiveis)


def _assert_edita_projeto(raiz: uuid.UUID) -> None:
    if not require_tenant().has_permission_in("project.update", raiz):
        raise AuthorizationError(
            "Você não tem essa permissão nos projetos deste time.",
            details={"permission": "project.update"},
        )


def _nome_valido(name: str) -> str:
    nome = name.strip()
    if not nome:
        raise ValidationError("O nome não pode ficar vazio.", details={"field": "name"})
    return nome


def _cor_valida(color: str) -> str:
    if color not in OPTION_COLORS:
        raise ValidationError(
            "Cor fora da paleta.", details={"field": "color", "value": color}
        )
    return color


# --------------------------------------------------------
# Vinculo com o projeto
# --------------------------------------------------------
async def labels_for(
    session: AsyncSession, projects: list[Project]
) -> dict[uuid.UUID, tuple[ProjectCategory | None, list[ProjectTag]]]:
    """Categoria e tags de cada projeto, em duas consultas para a lista inteira."""
    if not projects:
        return {}
    ids = [p.id for p in projects]
    cat_ids = {p.category_id for p in projects if p.category_id is not None}
    categorias = (
        {
            c.id: c
            for c in (
                await session.execute(
                    select(ProjectCategory).where(ProjectCategory.id.in_(cat_ids))
                )
            ).scalars()
        }
        if cat_ids
        else {}
    )
    tags: dict[uuid.UUID, list[ProjectTag]] = defaultdict(list)
    rows = await session.execute(
        select(ProjectTagLink.project_id, ProjectTag)
        .join(ProjectTag, ProjectTag.id == ProjectTagLink.tag_id)
        .where(ProjectTagLink.project_id.in_(ids))
        .order_by(ProjectTag.name)
    )
    for project_id, tag in rows.all():
        tags[project_id].append(tag)
    return {
        p.id: (categorias.get(p.category_id) if p.category_id else None, tags[p.id])
        for p in projects
    }


async def set_category(
    session: AsyncSession, project: Project, category_id: uuid.UUID | None
) -> None:
    """Aponta o projeto para uma categoria do time raiz dele (ou nenhuma)."""
    if category_id is not None:
        await _assert_do_time(session, ProjectCategory, project, [category_id], "category_id")
    project.category_id = category_id


async def set_tags(
    session: AsyncSession, project: Project, tag_ids: list[uuid.UUID]
) -> None:
    """Troca as tags do projeto pela lista inteira."""
    ids = list(dict.fromkeys(tag_ids))
    await _assert_do_time(session, ProjectTag, project, ids, "tag_ids")
    await session.execute(
        delete(ProjectTagLink).where(ProjectTagLink.project_id == project.id)
    )
    session.add_all(
        ProjectTagLink(workspace_id=project.workspace_id, project_id=project.id, tag_id=t)
        for t in ids
    )
    # As tags moram em outra tabela: sem isto, o "atualizado em" do projeto nao muda.
    project.updated_at = datetime.now(UTC)
    await session.flush()


async def _assert_do_time(
    session: AsyncSession,
    model: LabelModel,
    project: Project,
    ids: list[uuid.UUID],
    campo: str,
) -> None:
    if not ids:
        return
    raiz = team_scope.root_of(project.team_id, require_tenant().team_tree)  # type: ignore[arg-type]
    achados = (
        await session.execute(
            select(func.count()).where(
                model.id.in_(ids),
                model.team_id == raiz,
                model.workspace_id == project.workspace_id,
            )
        )
    ).scalar_one()
    if achados != len(ids):
        raise ValidationError(
            f"{_NOME[model].capitalize()} de outro time ou inexistente.",
            details={"field": campo},
        )
