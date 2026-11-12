"""CRUD autenticado do formulario de solicitacao (formulario, secoes, perguntas)."""

from __future__ import annotations

import uuid

import structlog
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models import (
    SolicitationForm,
    SolicitationQuestion,
    SolicitationSection,
    Team,
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
#: Duas secoes do MESMO formulario com o mesmo endereco.
CODIGO_SLUG_DE_SECAO_REPETIDO = "secao_slug_repetido"
#: Pergunta-resumo apontada para fora da propria secao.
CODIGO_RESUMO_FORA = "secao_resumo_fora"
#: Condicional que aponta para fora da secao, para a frente, ou para um tipo
#: sem alternativas.
CODIGO_CONDICIONAL_INVALIDA = "pergunta_condicional_invalida"
#: Mexer numa pergunta da qual OUTRAS dependem.
CODIGO_PERGUNTA_TEM_DEPENDENTE = "pergunta_tem_dependente"
#: Lista de reordenacao que nao bate com o que existe vivo.
CODIGO_ORDEM_INCOMPLETA = "ordem_incompleta"

_SLUG_OK = set("abcdefghijklmnopqrstuvwxyz0123456789-")


class SolicitationFormService:
    """Escrita e leitura autenticada dos formularios."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------
    # Guardas
    # ------------------------------------------------------------------
    def _assert_pode_gerir(self, verbo: str, team_id: uuid.UUID) -> None:
        """O ator tem `verbo` neste time? A permissao da rota sozinha nao basta."""
        if not require_tenant().has_permission_in(verbo, team_id):
            raise AuthorizationError(
                "Você não gerencia formulários deste time."
            )

    async def _proxima_posicao(self, modelo, condicao) -> int:
        """A posicao seguinte a maior ja usada, incluindo as apagadas.

        Contar os vivos colide depois de um soft delete, que nao compacta posicoes.
        """
        maior = (
            await self._session.execute(
                select(func.coalesce(func.max(modelo.position), -1)).where(
                    condicao
                )
            )
        ).scalar_one()
        return int(maior) + 1

    def _assert_slug_valido(self, slug: str) -> str:
        """Minusculas, numeros e hifen: o slug vira URL publica (`/solicitar/<slug>`)."""
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

    async def _assert_slug_de_secao_livre(
        self, *, form_id: uuid.UUID, slug: str
    ) -> None:
        """Este formulario ja tem uma secao viva com este endereco?

        O slug da secao fica gravado em cada pedido e a fila monta os rotulos por
        `(form_id, slug)`; dois iguais mostrariam o pedido com a secao errada.
        """
        existe = (
            await self._session.execute(
                select(SolicitationSection.id).where(
                    SolicitationSection.form_id == form_id,
                    SolicitationSection.slug == slug,
                    SolicitationSection.deleted_at.is_(None),
                )
            )
        ).first()
        if existe is not None:
            raise ValidationError(
                "Este formulário já tem uma seção com este endereço.",
                code=CODIGO_SLUG_DE_SECAO_REPETIDO,
                details={"slug": slug},
            )

    async def _assert_time_existe(self, team_id: uuid.UUID) -> None:
        """O time existe neste workspace? Senao, 404.

        Vem antes de `_assert_pode_gerir` (404, e nao 403, para id inexistente) e
        evita o 500 da FK composta `(team_id, workspace_id)`.
        """
        tenant = require_tenant()
        existe = (
            await self._session.execute(
                select(Team.id).where(
                    Team.id == team_id,
                    Team.workspace_id == tenant.workspace_id,
                )
            )
        ).first()
        if existe is None:
            raise EntityNotFoundError("Time não encontrado.")

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
        """Um formulario que quem chama le (`form.read` no time), ou 404."""
        form = await self._form_do_workspace(form_id)
        if not require_tenant().has_permission_in("form.read", form.team_id):
            raise EntityNotFoundError("Formulário não encontrado.")
        return form

    async def criar_formulario(
        self,
        *,
        team_id: uuid.UUID,
        slug: str,
        title: str,
        description: str = "",
    ) -> SolicitationForm:
        """Nasce despublicado e vazio; publicar e um gesto proprio, depois de montar."""
        # 404 antes de 403: existir e a primeira pergunta.
        await self._assert_time_existe(team_id)
        self._assert_pode_gerir("form.create", team_id)
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

    async def listar_formularios(
        self, team_id: uuid.UUID | None
    ) -> list[SolicitationForm]:
        """Os formularios que o papel le, publicados ou nao.

        Dois recortes: `form.read` ("posso ver?", `None` para papel de
        organizacao) e `team_id` ("qual time estou olhando?", com descendentes).
        `team_id` sem default: `None` = a organizacao inteira.
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
        leitura = tenant.teams_with_permission("form.read")
        if leitura is not None:
            stmt = stmt.where(SolicitationForm.team_id.in_(leitura))
        if team_id is not None:
            alvo = {team_id} | team_scope.descendants(team_id, tenant.team_tree)
            stmt = stmt.where(SolicitationForm.team_id.in_(alvo))
        return list((await self._session.execute(stmt)).scalars().all())

    async def renomear_formulario(
        self,
        *,
        form_id: uuid.UUID,
        title: str | None = None,
        description: str | None = None,
        slug: str | None = None,
        rotulos: dict[str, str | None] | None = None,
    ) -> SolicitationForm:
        """Sem `team_id`: mudar o time mudaria quem tria, inclusive os pedidos ja recebidos."""
        form = await self._form_do_workspace(form_id)
        self._assert_pode_gerir("form.update", form.team_id)
        if slug is not None:
            limpo = self._assert_slug_valido(slug)
            await self._assert_slug_livre(limpo, exceto=form.id)
            form.slug = limpo
        if title is not None:
            form.title = title.strip()
        if description is not None:
            form.description = description.strip()

        # Rotulos da identificacao: `None` desliga o campo. Chegam so os enviados
        # (`model_fields_set`, no router).
        for campo, rotulo in (rotulos or {}).items():
            limpo = rotulo.strip() if isinstance(rotulo, str) else None
            # Rotulo so de espacos tambem desliga.
            setattr(form, campo, limpo or None)

        await self._session.flush()
        return form

    async def publicar(
        self, *, form_id: uuid.UUID, publicado: bool
    ) -> SolicitationForm:
        """Liga ou desliga a porta publica. Publicar exige ao menos uma pergunta."""
        form = await self._form_do_workspace(form_id)
        self._assert_pode_gerir("form.publish", form.team_id)
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
        """Soft delete. As solicitacoes que vieram dele nao sao tocadas."""
        form = await self._form_do_workspace(form_id)
        self._assert_pode_gerir("form.delete", form.team_id)

        # Secoes e perguntas vao junto, como em `apagar_secao`.
        secoes = list(
            (
                await self._session.execute(
                    select(SolicitationSection.id).where(
                        SolicitationSection.form_id == form.id,
                        SolicitationSection.deleted_at.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        agora = func.now()
        if secoes:
            await self._session.execute(
                update(SolicitationQuestion)
                .where(
                    SolicitationQuestion.section_id.in_(secoes),
                    SolicitationQuestion.deleted_at.is_(None),
                )
                .values(deleted_at=agora)
            )
            await self._session.execute(
                update(SolicitationSection)
                .where(SolicitationSection.id.in_(secoes))
                .values(deleted_at=agora)
            )

        form.deleted_at = agora
        await self._session.flush()
        logger.info(
            "solicitation_form.apagado",
            form_id=str(form.id),
            secoes=len(secoes),
        )

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
        self._assert_pode_gerir("form.update", form.team_id)
        limpo = self._assert_slug_valido(slug)
        await self._assert_slug_de_secao_livre(form_id=form.id, slug=limpo)
        tenant = require_tenant()

        # Posicao no fim (MAX + 1, ver `_proxima_posicao`).
        proxima = await self._proxima_posicao(
            SolicitationSection,
            SolicitationSection.form_id == form.id,
        )

        secao = SolicitationSection(
            workspace_id=tenant.workspace_id,
            form_id=form.id,
            slug=limpo,
            title=title.strip(),
            emoji=emoji.strip(),
            sla_text=sla_text,
            position=proxima,
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

    async def editar_secao(
        self,
        *,
        section_id: uuid.UUID,
        title: str | None = None,
        emoji: str | None = None,
        sla_text: str | None = None,
        repeatable: bool | None = None,
        repeat_label: str | None = None,
    ) -> SolicitationSection:
        """Titulo, emoji, prazo e repeticao. O `slug` nao entra.

        O slug fica gravado em cada pedido (`category`) e e por ele que a fila acha
        titulo e emoji; troca-lo deixaria os pedidos antigos com texto cru.
        """
        secao = await self._secao_do_workspace(section_id)
        form = await self._form_do_workspace(secao.form_id)
        self._assert_pode_gerir("form.update", form.team_id)

        if title is not None:
            secao.title = title.strip()
        if emoji is not None:
            secao.emoji = emoji.strip()
        if sla_text is not None:
            secao.sla_text = sla_text.strip() or None
        if repeatable is not None:
            secao.repeatable = repeatable
        if repeat_label is not None:
            secao.repeat_label = repeat_label.strip() or None
        await self._session.flush()
        logger.info("solicitation_section.editada", section_id=str(secao.id))
        return secao

    async def definir_resumo(
        self, *, section_id: uuid.UUID, question_id: uuid.UUID | None
    ) -> SolicitationSection:
        """Qual pergunta vira o titulo do pedido na fila.

        `None` volta ao padrao (o front usa o primeiro campo da secao).
        """
        secao = await self._secao_do_workspace(section_id)
        form = await self._form_do_workspace(secao.form_id)
        self._assert_pode_gerir("form.update", form.team_id)

        if question_id is not None:
            pergunta = await self._pergunta_do_workspace(question_id)
            if pergunta.section_id != secao.id:
                raise ValidationError(
                    "O resumo tem de ser uma pergunta desta seção.",
                    code=CODIGO_RESUMO_FORA,
                    details={"pergunta": str(question_id)},
                )
        secao.summary_question_id = question_id
        await self._session.flush()
        return secao

    async def apagar_secao(self, *, section_id: uuid.UUID) -> None:
        """Soft delete da secao e das perguntas dela.

        Os pedidos que ja chegaram nao sao tocados; na fila passam a mostrar o slug.
        """
        secao = await self._secao_do_workspace(section_id)
        form = await self._form_do_workspace(secao.form_id)
        self._assert_pode_gerir("form.update", form.team_id)

        perguntas = list(
            (
                await self._session.execute(
                    select(SolicitationQuestion).where(
                        SolicitationQuestion.section_id == secao.id,
                        SolicitationQuestion.deleted_at.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )

        # Condicional e sempre da mesma secao, mas dado antigo pode ter escapado.
        dentro = {p.id for p in perguntas}
        for p in perguntas:
            for dep in await self._dependentes(p.id):
                if dep.id not in dentro:
                    raise ValidationError(
                        f"“{dep.label}”, em outra seção, só aparece por causa "
                        "de uma pergunta desta. Tire a condição dela antes.",
                        code=CODIGO_PERGUNTA_TEM_DEPENDENTE,
                        details={"dependente": str(dep.id)},
                    )

        agora = func.now()
        secao.deleted_at = agora
        for p in perguntas:
            p.deleted_at = agora
        await self._session.flush()
        logger.info(
            "solicitation_section.apagada",
            section_id=str(secao.id),
            perguntas=len(perguntas),
        )

    async def reordenar_secoes(
        self, *, form_id: uuid.UUID, ids: list[uuid.UUID]
    ) -> list[SolicitationSection]:
        """A nova ordem das secoes de um formulario."""
        form = await self._form_do_workspace(form_id)
        self._assert_pode_gerir("form.update", form.team_id)

        vivas = list(
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
        por_id = self._assert_ordem_completa(vivas, ids, "seções")
        for posicao, sid in enumerate(ids):
            por_id[sid].position = posicao
        await self._session.flush()
        return sorted(vivas, key=lambda s: s.position)

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
        """Recusa `kind` que a tela nao sabe desenhar e escolha sem alternativas."""
        secao = await self._secao_do_workspace(section_id)
        form = await self._form_do_workspace(secao.form_id)
        self._assert_pode_gerir("form.update", form.team_id)

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
        # MAX + 1: posicao repetida faria a regra ordinal da condicional recusar errado.
        proxima = await self._proxima_posicao(
            SolicitationQuestion,
            SolicitationQuestion.section_id == secao.id,
        )

        pergunta = SolicitationQuestion(
            workspace_id=tenant.workspace_id,
            section_id=secao.id,
            label=label.strip(),
            kind=kind,
            required=required,
            options=opcoes,
            placeholder=placeholder,
            help=help_text,
            position=proxima,
        )
        self._session.add(pergunta)
        await self._session.flush()
        return pergunta

    async def perguntas_da_secao(
        self, section_id: uuid.UUID
    ) -> list[SolicitationQuestion]:
        """As perguntas vivas de uma secao, em ordem."""
        return list(
            (
                await self._session.execute(
                    select(SolicitationQuestion)
                    .where(
                        SolicitationQuestion.section_id == section_id,
                        SolicitationQuestion.deleted_at.is_(None),
                    )
                    .order_by(SolicitationQuestion.position)
                )
            )
            .scalars()
            .all()
        )

    async def _pergunta_do_workspace(
        self, question_id: uuid.UUID
    ) -> SolicitationQuestion:
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
        return pergunta

    async def _dependentes(
        self, question_id: uuid.UUID
    ) -> list[SolicitationQuestion]:
        """As perguntas vivas cuja condicional aponta para esta.

        Se o alvo some, muda de tipo ou perde a alternativa citada, a dependente
        deixa de aparecer no formulario publico sem erro nenhum.
        """
        return list(
            (
                await self._session.execute(
                    select(SolicitationQuestion)
                    .where(
                        SolicitationQuestion.show_if_question_id == question_id,
                        SolicitationQuestion.deleted_at.is_(None),
                    )
                    .order_by(SolicitationQuestion.position)
                )
            )
            .scalars()
            .all()
        )

    async def _assert_pode_mexer_na_pergunta(
        self, pergunta: SolicitationQuestion
    ) -> SolicitationSection:
        secao = await self._secao_do_workspace(pergunta.section_id)
        form = await self._form_do_workspace(secao.form_id)
        self._assert_pode_gerir("form.update", form.team_id)
        return secao

    async def editar_pergunta(
        self,
        *,
        question_id: uuid.UUID,
        label: str | None = None,
        kind: str | None = None,
        required: bool | None = None,
        options: list[str] | None = None,
        placeholder: str | None = None,
        help_text: str | None = None,
    ) -> SolicitationQuestion:
        """Recusa mudar tipo ou alternativas de que uma dependente precisa.

        Mudar `label` e seguro: as respostas guardam o texto perguntado no dia.
        """
        pergunta = await self._pergunta_do_workspace(question_id)
        await self._assert_pode_mexer_na_pergunta(pergunta)

        novo_kind = pergunta.kind if kind is None else kind
        if not kind_valido(novo_kind):
            raise ValidationError(
                "Este tipo de pergunta não existe.",
                code=CODIGO_TIPO_INVALIDO,
                details={"kind": novo_kind},
            )

        # `options=None` e "nao mexe", e nao "esvazia".
        novas_opcoes = (
            pergunta.options
            if options is None
            else [o.strip() for o in options if o.strip()]
        )
        if not exige_opcoes(novo_kind):
            # Tipo sem alternativas nao guarda lista.
            novas_opcoes = []
        elif not novas_opcoes:
            raise ValidationError(
                "Uma pergunta de escolha precisa de ao menos uma alternativa.",
                code=CODIGO_SEM_OPCOES,
                details={"kind": novo_kind},
            )

        dependentes = await self._dependentes(pergunta.id)
        if dependentes:
            nomes = ", ".join(f"“{d.label}”" for d in dependentes[:3])
            if not exige_opcoes(novo_kind):
                raise ValidationError(
                    "Esta pergunta comanda outras "
                    f"({nomes}), então ela precisa continuar sendo de "
                    "escolha. Tire a condição delas primeiro.",
                    code=CODIGO_PERGUNTA_TEM_DEPENDENTE,
                    details={"dependentes": [str(d.id) for d in dependentes]},
                )
            perdidas = [
                d
                for d in dependentes
                if d.show_if_value is not None
                and d.show_if_value not in novas_opcoes
            ]
            if perdidas:
                faltando = ", ".join(
                    sorted({f"“{d.show_if_value}”" for d in perdidas})
                )
                raise ValidationError(
                    f"A alternativa {faltando} não pode sair: outras "
                    "perguntas só aparecem quando ela é escolhida.",
                    code=CODIGO_PERGUNTA_TEM_DEPENDENTE,
                    details={"dependentes": [str(d.id) for d in perdidas]},
                )

        if label is not None:
            pergunta.label = label.strip()
        pergunta.kind = novo_kind
        pergunta.options = novas_opcoes
        if required is not None:
            pergunta.required = required
        if placeholder is not None:
            pergunta.placeholder = placeholder.strip() or None
        if help_text is not None:
            pergunta.help = help_text.strip() or None
        await self._session.flush()
        logger.info("solicitation_question.editada", question_id=str(pergunta.id))
        return pergunta

    async def definir_condicional(
        self,
        *,
        question_id: uuid.UUID,
        alvo_id: uuid.UUID | None,
        valor: str | None,
    ) -> SolicitationQuestion:
        """Liga (ou desliga, com `alvo_id=None`) o "so aparece quando..." de uma pergunta.

        O alvo tem de ser da mesma secao, vir antes desta e ser de escolha.
        """
        pergunta = await self._pergunta_do_workspace(question_id)
        await self._assert_pode_mexer_na_pergunta(pergunta)

        if alvo_id is None:
            pergunta.show_if_question_id = None
            pergunta.show_if_value = None
            await self._session.flush()
            return pergunta

        if alvo_id == pergunta.id:
            raise ValidationError(
                "Uma pergunta não pode depender de si mesma.",
                code=CODIGO_CONDICIONAL_INVALIDA,
                details={"alvo": str(alvo_id)},
            )
        alvo = await self._pergunta_do_workspace(alvo_id)
        if alvo.section_id != pergunta.section_id:
            raise ValidationError(
                "A condição só pode usar uma pergunta da mesma seção.",
                code=CODIGO_CONDICIONAL_INVALIDA,
                details={"alvo": str(alvo_id)},
            )
        if alvo.position >= pergunta.position:
            raise ValidationError(
                "A condição precisa usar uma pergunta que vem ANTES desta.",
                code=CODIGO_CONDICIONAL_INVALIDA,
                details={"alvo": str(alvo_id)},
            )
        if not exige_opcoes(alvo.kind):
            raise ValidationError(
                "A condição só funciona com uma pergunta de escolha.",
                code=CODIGO_CONDICIONAL_INVALIDA,
                details={"alvo": str(alvo_id), "kind": alvo.kind},
            )
        if valor is None or valor not in alvo.options:
            raise ValidationError(
                "Escolha uma das alternativas da pergunta selecionada.",
                code=CODIGO_CONDICIONAL_INVALIDA,
                details={"valor": valor, "opcoes": list(alvo.options)},
            )

        pergunta.show_if_question_id = alvo.id
        pergunta.show_if_value = valor
        await self._session.flush()
        return pergunta

    async def apagar_pergunta(self, *, question_id: uuid.UUID) -> None:
        """Soft delete. Nao toca nas respostas; recusa se outras perguntas dependem dela."""
        pergunta = await self._pergunta_do_workspace(question_id)
        secao = await self._assert_pode_mexer_na_pergunta(pergunta)

        dependentes = await self._dependentes(pergunta.id)
        if dependentes:
            nomes = ", ".join(f"“{d.label}”" for d in dependentes[:3])
            raise ValidationError(
                f"Outras perguntas só aparecem por causa desta ({nomes}). "
                "Tire a condição delas antes de excluir.",
                code=CODIGO_PERGUNTA_TEM_DEPENDENTE,
                details={"dependentes": [str(d.id) for d in dependentes]},
            )

        # A pergunta-resumo nao pode apontar para pergunta apagada; volta ao padrao.
        if secao.summary_question_id == pergunta.id:
            secao.summary_question_id = None

        pergunta.deleted_at = func.now()
        await self._session.flush()

    async def reordenar_perguntas(
        self, *, section_id: uuid.UUID, ids: list[uuid.UUID]
    ) -> list[SolicitationQuestion]:
        """A nova ordem das perguntas de uma secao.

        Recusa se uma dependente ficar antes do alvo da condicional.
        """
        secao = await self._secao_do_workspace(section_id)
        form = await self._form_do_workspace(secao.form_id)
        self._assert_pode_gerir("form.update", form.team_id)

        vivas = list(
            (
                await self._session.execute(
                    select(SolicitationQuestion)
                    .where(
                        SolicitationQuestion.section_id == secao.id,
                        SolicitationQuestion.deleted_at.is_(None),
                    )
                    .order_by(SolicitationQuestion.position)
                )
            )
            .scalars()
            .all()
        )
        por_id = self._assert_ordem_completa(vivas, ids, "perguntas")

        for posicao, qid in enumerate(ids):
            por_id[qid].position = posicao
        await self._session.flush()

        novas = sorted(vivas, key=lambda q: q.position)
        lugar = {q.id: i for i, q in enumerate(novas)}
        for q in novas:
            if q.show_if_question_id is None:
                continue
            alvo = lugar.get(q.show_if_question_id)
            if alvo is not None and alvo >= lugar[q.id]:
                raise ValidationError(
                    f"“{q.label}” só aparece por causa de uma pergunta que "
                    "ficaria DEPOIS dela. Mova as duas juntas.",
                    code=CODIGO_CONDICIONAL_INVALIDA,
                    details={"pergunta": str(q.id)},
                )
        return novas

    # ------------------------------------------------------------------
    # Ordem
    # ------------------------------------------------------------------
    def _assert_ordem_completa(
        self, vivos: list, ids: list[uuid.UUID], oque: str
    ) -> dict:
        """A lista recebida e exatamente o conjunto vivo?

        Lista parcial deixaria uma aba velha sobrescrever a ordem de quem criou um item.
        """
        por_id = {v.id: v for v in vivos}
        if len(ids) != len(set(ids)) or set(ids) != set(por_id):
            raise ValidationError(
                f"A lista de {oque} enviada não bate com o formulário atual. "
                "Recarregue a página e tente de novo.",
                code=CODIGO_ORDEM_INCOMPLETA,
                details={"esperado": len(por_id), "recebido": len(ids)},
            )
        return por_id

    async def perguntas_do_form(
        self, form_id: uuid.UUID
    ) -> tuple[list[SolicitationSection], list[SolicitationQuestion]]:
        """As secoes e perguntas vivas de um formulario, em ordem."""
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
