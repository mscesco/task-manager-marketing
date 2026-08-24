"""CRUD do formulario de solicitacao (Spec 043, fatia A).

⚠️ ESTE SERVICO NAO E LIDO PELO FORMULARIO PUBLICO AINDA. A fatia A cria a
estrutura e a API; quem troca a FONTE do `/solicitar` e a fatia B. Ate la o
publico continua lendo o `web/lib/solicitacaoForm.ts`, e nada muda para quem
usa.

A separacao e deliberada: a rota publica e a UNICA escrita sem credencial da
API, e trocar a fonte dela no mesmo movimento em que o modelo nasce seria
mudar duas coisas de uma vez num caminho que nao tem login para culpar.
"""

from __future__ import annotations

import uuid

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models import (
    SolicitationForm,
    SolicitationQuestion,
    SolicitationSection,
)
from app.modules.auth.domain import team_scope
from app.modules.solicitations.domain.form import exige_opcoes, kind_valido
from app.shared.exceptions.base import (
    AuthorizationError,
    EntityNotFoundError,
    ValidationError,
)

logger = structlog.get_logger(__name__)

#: Slug fora do formato vira URL publica quebrada.
CODIGO_SLUG_INVALIDO = "formulario_slug_invalido"
#: Slug ja usado por outro formulario VIVO do mesmo workspace.
CODIGO_SLUG_REPETIDO = "formulario_slug_repetido"
#: `kind` que o formulario publico nao sabe desenhar.
CODIGO_TIPO_INVALIDO = "pergunta_tipo_invalido"
#: `escolha`/`multi` sem alternativa nenhuma.
CODIGO_SEM_OPCOES = "pergunta_sem_opcoes"

_SLUG_OK = set("abcdefghijklmnopqrstuvwxyz0123456789-")


class SolicitationFormService:
    """Escrita e leitura autenticada dos formularios."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------
    # Guardas
    # ------------------------------------------------------------------
    def _assert_pode_gerir(self, team_id: uuid.UUID) -> None:
        """O papel alcanca ESTE time?

        ⚠️ A PERMISSAO SOZINHA NAO BASTA, e e por isso que esta funcao existe.
        `solicitation_form.manage` esta em ADMIN e MANAGER (decisao da Camila,
        22/08) -- mas MANAGER e um papel de TIME. Sem esta conferencia, o
        gestor de Design editaria a porta de entrada do Marketing, e "cada
        equipe cria o seu" viraria "qualquer gestor edita o de qualquer um".

        ⚠️ `editable_team_ids` DEVOLVE `None` PARA ADMIN -- "sem filtro de
        time". Tratar `None` como conjunto vazio travaria justamente o papel
        que enxerga tudo.
        """
        tenant = require_tenant()
        editaveis = team_scope.editable_team_ids(
            tenant.memberships, tenant.team_tree
        )
        if editaveis is None:
            return
        if team_id not in editaveis:
            raise AuthorizationError(
                "Você não gerencia formulários deste time."
            )

    def _assert_slug_valido(self, slug: str) -> str:
        """Minusculas, numeros e hifen. Nada mais.

        ⚠️ ELE VIRA URL PUBLICA (`/solicitar/<slug>`), entao espaco, acento e
        barra nao sao questao de gosto: quebram o endereco que alguem vai
        divulgar. A recusa e do DOMINIO e nao do Pydantic -- validador custom
        neste projeto devolve 500 no lugar de 422.
        """
        limpo = slug.strip().lower()
        if not limpo or not set(limpo) <= _SLUG_OK:
            raise ValidationError(
                "O endereço só aceita letras minúsculas, números e hífen.",
                code=CODIGO_SLUG_INVALIDO,
                details={"slug": slug},
            )
        return limpo

    async def _assert_slug_livre(
        self, slug: str, *, exceto: uuid.UUID | None = None
    ) -> None:
        tenant = require_tenant()
        stmt = select(SolicitationForm.id).where(
            SolicitationForm.workspace_id == tenant.workspace_id,
            SolicitationForm.slug == slug,
            SolicitationForm.deleted_at.is_(None),
        )
        if exceto is not None:
            stmt = stmt.where(SolicitationForm.id != exceto)
        if (await self._session.execute(stmt)).first() is not None:
            raise ValidationError(
                "Já existe um formulário com este endereço.",
                code=CODIGO_SLUG_REPETIDO,
                details={"slug": slug},
            )

    async def _form_do_workspace(self, form_id: uuid.UUID) -> SolicitationForm:
        tenant = require_tenant()
        form = (
            await self._session.execute(
                select(SolicitationForm).where(
                    SolicitationForm.id == form_id,
                    SolicitationForm.workspace_id == tenant.workspace_id,
                    SolicitationForm.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if form is None:
            raise EntityNotFoundError("Formulário não encontrado.")
        return form

    # ------------------------------------------------------------------
    # Formulario
    # ------------------------------------------------------------------
    async def obter_formulario(self, form_id: uuid.UUID) -> SolicitationForm:
        """Um formulario do workspace, ou 404.

        ⚠️ LEITURA NAO EXIGE ALCANCE DE TIME, e a rota exige a permissao. Quem
        chega aqui ja passou por `solicitation_form.manage`; conferir o time
        tambem na leitura devolveria 403 para um ADMIN olhando o formulario de
        outro time -- que e exatamente o que ele pode fazer.
        """
        return await self._form_do_workspace(form_id)

    async def criar_formulario(
        self,
        *,
        team_id: uuid.UUID,
        slug: str,
        title: str,
        description: str = "",
    ) -> SolicitationForm:
        """⚠️ NASCE DESPUBLICADO, SEMPRE, e `is_published` nao e parametro.

        Formulario nasce vazio -- sem secao e sem pergunta. Publicado na
        criacao, ele apareceria na lista publica como uma porta que nao
        pergunta nada. Publicar e um gesto proprio, depois de montar.
        """
        self._assert_pode_gerir(team_id)
        limpo = self._assert_slug_valido(slug)
        await self._assert_slug_livre(limpo)
        tenant = require_tenant()

        form = SolicitationForm(
            workspace_id=tenant.workspace_id,
            team_id=team_id,
            slug=limpo,
            title=title.strip(),
            description=description.strip(),
            is_published=False,
            created_by=tenant.user_id,
        )
        self._session.add(form)
        await self._session.flush()
        logger.info(
            "solicitation_form.criado",
            form_id=str(form.id),
            team_id=str(team_id),
            slug=limpo,
        )
        return form

    async def listar_formularios(self) -> list[SolicitationForm]:
        """Os formularios que o papel ALCANCA, publicados ou nao.

        ⚠️ FILTRA POR TIME PELO MESMO MOTIVO DA FILA (§11.3 da spec): o
        formulario e do time, e quem nao alcanca o time nao tem o que fazer
        com o formulario dele.
        """
        tenant = require_tenant()
        stmt = (
            select(SolicitationForm)
            .where(
                SolicitationForm.workspace_id == tenant.workspace_id,
                SolicitationForm.deleted_at.is_(None),
            )
            .order_by(SolicitationForm.title)
        )
        visiveis = team_scope.visible_team_ids(
            tenant.memberships, tenant.team_tree
        )
        if visiveis is not None:
            stmt = stmt.where(SolicitationForm.team_id.in_(visiveis))
        return list((await self._session.execute(stmt)).scalars().all())

    async def renomear_formulario(
        self,
        *,
        form_id: uuid.UUID,
        title: str | None = None,
        description: str | None = None,
        slug: str | None = None,
    ) -> SolicitationForm:
        """⚠️ `team_id` NAO ENTRA, e a ausencia e a trava.

        Mudar o time do formulario e mudar QUEM TRIA as solicitacoes dele --
        inclusive as que ja chegaram, porque a fila as encontra pelo time do
        formulario. Seria uma operacao de visibilidade disfarcada de edicao,
        que e o mesmo motivo pelo qual `BoardRenameRequest` nao aceita
        `team_id`.
        """
        form = await self._form_do_workspace(form_id)
        self._assert_pode_gerir(form.team_id)
        if slug is not None:
            limpo = self._assert_slug_valido(slug)
            await self._assert_slug_livre(limpo, exceto=form.id)
            form.slug = limpo
        if title is not None:
            form.title = title.strip()
        if description is not None:
            form.description = description.strip()
        await self._session.flush()
        return form

    async def publicar(
        self, *, form_id: uuid.UUID, publicado: bool
    ) -> SolicitationForm:
        """Liga ou desliga a porta publica.

        ⚠️ PUBLICAR EXIGE AO MENOS UMA PERGUNTA. Formulario vazio publicado e
        um endereco que a pessoa abre, le o titulo e nao tem o que responder --
        e ela vai achar que o site quebrou. Despublicar nao exige nada.
        """
        form = await self._form_do_workspace(form_id)
        self._assert_pode_gerir(form.team_id)
        if publicado:
            total = (
                await self._session.execute(
                    select(SolicitationQuestion.id)
                    .join(
                        SolicitationSection,
                        SolicitationSection.id == SolicitationQuestion.section_id,
                    )
                    .where(
                        SolicitationSection.form_id == form.id,
                        SolicitationSection.deleted_at.is_(None),
                        SolicitationQuestion.deleted_at.is_(None),
                    )
                    .limit(1)
                )
            ).first()
            if total is None:
                raise ValidationError(
                    "Um formulário sem perguntas não pode ser publicado."
                )
        form.is_published = publicado
        await self._session.flush()
        logger.info(
            "solicitation_form.publicacao",
            form_id=str(form.id),
            publicado=publicado,
        )
        return form

    async def apagar_formulario(self, *, form_id: uuid.UUID) -> None:
        """Soft delete.

        ⚠️ AS SOLICITACOES QUE VIERAM DELE NAO SAO TOCADAS. Elas guardam as
        respostas em `answers` (texto da pergunta + valor) e continuam
        legiveis sem o formulario -- e continuam na fila, porque o `JOIN` dela
        e `LEFT`. Apagar a porta nao apaga quem entrou por ela.
        """
        form = await self._form_do_workspace(form_id)
        self._assert_pode_gerir(form.team_id)
        form.deleted_at = func.now()
        await self._session.flush()
        logger.info("solicitation_form.apagado", form_id=str(form.id))

    # ------------------------------------------------------------------
    # Secao
    # ------------------------------------------------------------------
    async def criar_secao(
        self,
        *,
        form_id: uuid.UUID,
        slug: str,
        title: str,
        emoji: str = "",
        sla_text: str | None = None,
    ) -> SolicitationSection:
        form = await self._form_do_workspace(form_id)
        self._assert_pode_gerir(form.team_id)
        limpo = self._assert_slug_valido(slug)
        tenant = require_tenant()

        # Posicao no FIM, sempre. Reordenar e gesto proprio (fatia C).
        atuais = (
            await self._session.execute(
                select(SolicitationSection.id).where(
                    SolicitationSection.form_id == form.id,
                    SolicitationSection.deleted_at.is_(None),
                )
            )
        ).all()

        secao = SolicitationSection(
            workspace_id=tenant.workspace_id,
            form_id=form.id,
            slug=limpo,
            title=title.strip(),
            emoji=emoji.strip(),
            sla_text=sla_text,
            position=len(atuais),
        )
        self._session.add(secao)
        await self._session.flush()
        return secao

    async def _secao_do_workspace(
        self, section_id: uuid.UUID
    ) -> SolicitationSection:
        tenant = require_tenant()
        secao = (
            await self._session.execute(
                select(SolicitationSection).where(
                    SolicitationSection.id == section_id,
                    SolicitationSection.workspace_id == tenant.workspace_id,
                    SolicitationSection.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if secao is None:
            raise EntityNotFoundError("Seção não encontrada.")
        return secao

    # ------------------------------------------------------------------
    # Pergunta
    # ------------------------------------------------------------------
    async def criar_pergunta(
        self,
        *,
        section_id: uuid.UUID,
        label: str,
        kind: str,
        required: bool = False,
        options: list[str] | None = None,
        placeholder: str | None = None,
        help_text: str | None = None,
    ) -> SolicitationQuestion:
        """⚠️ AS DUAS RECUSAS AQUI SAO SOBRE O FORMULARIO PUBLICO, e nao sobre
        higiene de dado:

          - `kind` desconhecido vira um campo que a tela NAO SABE DESENHAR --
            e o publico descobre isso como um buraco no meio do formulario;
          - `escolha`/`multi` sem alternativa e um beco: se for obrigatoria,
            TRAVA o envio, e quem responde nao tem como saber por que.
        """
        secao = await self._secao_do_workspace(section_id)
        form = await self._form_do_workspace(secao.form_id)
        self._assert_pode_gerir(form.team_id)

        if not kind_valido(kind):
            raise ValidationError(
                "Este tipo de pergunta não existe.",
                code=CODIGO_TIPO_INVALIDO,
                details={"kind": kind},
            )
        opcoes = [o.strip() for o in (options or []) if o.strip()]
        if exige_opcoes(kind) and not opcoes:
            raise ValidationError(
                "Uma pergunta de escolha precisa de ao menos uma alternativa.",
                code=CODIGO_SEM_OPCOES,
                details={"kind": kind},
            )

        tenant = require_tenant()
        atuais = (
            await self._session.execute(
                select(SolicitationQuestion.id).where(
                    SolicitationQuestion.section_id == secao.id,
                    SolicitationQuestion.deleted_at.is_(None),
                )
            )
        ).all()

        pergunta = SolicitationQuestion(
            workspace_id=tenant.workspace_id,
            section_id=secao.id,
            label=label.strip(),
            kind=kind,
            required=required,
            options=opcoes,
            placeholder=placeholder,
            help=help_text,
            position=len(atuais),
        )
        self._session.add(pergunta)
        await self._session.flush()
        return pergunta

    async def apagar_pergunta(self, *, question_id: uuid.UUID) -> None:
        """Soft delete.

        ⚠️ E ELE NAO TOCA EM RESPOSTA NENHUMA -- nem poderia. As respostas
        vivem em `solicitation.answers` como `{label, value}`, com o TEXTO da
        pergunta. Apagar a pergunta hoje nao muda o que alguem respondeu
        ontem, e e por isso que o formulario pode ser editavel sem medo.
        """
        tenant = require_tenant()
        pergunta = (
            await self._session.execute(
                select(SolicitationQuestion).where(
                    SolicitationQuestion.id == question_id,
                    SolicitationQuestion.workspace_id == tenant.workspace_id,
                    SolicitationQuestion.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if pergunta is None:
            raise EntityNotFoundError("Pergunta não encontrada.")
        secao = await self._secao_do_workspace(pergunta.section_id)
        form = await self._form_do_workspace(secao.form_id)
        self._assert_pode_gerir(form.team_id)

        pergunta.deleted_at = func.now()
        await self._session.flush()

    async def perguntas_do_form(
        self, form_id: uuid.UUID
    ) -> tuple[list[SolicitationSection], list[SolicitationQuestion]]:
        """As secoes e perguntas VIVAS de um formulario, em ordem."""
        form = await self._form_do_workspace(form_id)
        secoes = list(
            (
                await self._session.execute(
                    select(SolicitationSection)
                    .where(
                        SolicitationSection.form_id == form.id,
                        SolicitationSection.deleted_at.is_(None),
                    )
                    .order_by(SolicitationSection.position)
                )
            )
            .scalars()
            .all()
        )
        if not secoes:
            return [], []
        perguntas = list(
            (
                await self._session.execute(
                    select(SolicitationQuestion)
                    .where(
                        SolicitationQuestion.section_id.in_([s.id for s in secoes]),
                        SolicitationQuestion.deleted_at.is_(None),
                    )
                    .order_by(SolicitationQuestion.position)
                )
            )
            .scalars()
            .all()
        )
        return secoes, perguntas
