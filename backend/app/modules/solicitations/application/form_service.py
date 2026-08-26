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

    async def editar_secao(
        self,
        *,
        section_id: uuid.UUID,
        title: str | None = None,
        emoji: str | None = None,
        sla_text: str | None = None,
    ) -> SolicitationSection:
        """Titulo, emoji e prazo. **O `slug` NAO entra, e isso e deliberado.**

        ⚠️ O SLUG DA SECAO E O QUE FICA GRAVADO EM CADA SOLICITACAO. Ele viaja
        como `solicitation_item.category` e e ele que a fila usa para dizer de
        que categoria o pedido e. Troca-lo hoje nao muda os pedidos de ontem:
        eles continuam com o slug velho e passam a aparecer na fila como texto
        cru, sem titulo e sem emoji -- para sempre, e sem erro nenhum.

        Titulo e emoji podem mudar a vontade justamente porque NAO sao
        gravados: a fila os resolve pelo slug, entao renomear a secao arruma o
        passado junto com o presente. E essa a diferenca entre os dois campos,
        e e por isso que um e editavel e o outro nao.
        """
        secao = await self._secao_do_workspace(section_id)
        form = await self._form_do_workspace(secao.form_id)
        self._assert_pode_gerir(form.team_id)

        if title is not None:
            secao.title = title.strip()
        if emoji is not None:
            secao.emoji = emoji.strip()
        if sla_text is not None:
            secao.sla_text = sla_text.strip() or None
        await self._session.flush()
        logger.info("solicitation_section.editada", section_id=str(secao.id))
        return secao

    async def definir_resumo(
        self, *, section_id: uuid.UUID, question_id: uuid.UUID | None
    ) -> SolicitationSection:
        """Qual pergunta vira o TITULO do pedido na fila.

        ⚠️ GESTO PROPRIO PELO MESMO MOTIVO DA CONDICIONAL: limpar e mandar
        `null`, e num PATCH `null` se confunde com "nao mexe".

        ⚠️ E SEM ESCOLHA HA RESERVA -- o front usa o primeiro campo da secao.
        Entao `None` aqui e "volta ao padrao", e nao "fica sem titulo".
        """
        secao = await self._secao_do_workspace(section_id)
        form = await self._form_do_workspace(secao.form_id)
        self._assert_pode_gerir(form.team_id)

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
        """Soft delete da secao E das perguntas dela.

        ⚠️ AS PERGUNTAS VAO JUNTO DE PROPOSITO (ADR-0005). Deixa-las vivas
        penduradas numa secao morta faria elas voltarem inteiras se a secao
        fosse restaurada -- mas, pior, elas continuariam servindo de alvo para
        condicionais de perguntas que ninguem consegue mais ver.

        ⚠️ E OS PEDIDOS QUE JA CHEGARAM POR ESTA SECAO NAO SAO TOCADOS. Eles
        guardam o texto das perguntas que responderam; o que se perde e o
        titulo bonito na fila, que passa a mostrar o slug cru.
        """
        secao = await self._secao_do_workspace(section_id)
        form = await self._form_do_workspace(secao.form_id)
        self._assert_pode_gerir(form.team_id)

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

        # ⚠️ DEPENDENTE DE FORA DA SECAO NAO EXISTE HOJE (a condicional e
        # obrigatoriamente da mesma secao, e os 25 herdados foram conferidos um
        # a um), mas dado antigo pode ter escapado -- e apagar em silencio uma
        # secao que deixa pergunta invisivel em OUTRA e exatamente o defeito
        # que esta spec inteira tenta nao cometer.
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
        self._assert_pode_gerir(form.team_id)

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

    async def perguntas_da_secao(
        self, section_id: uuid.UUID
    ) -> list[SolicitationQuestion]:
        """As perguntas VIVAS de uma secao, em ordem."""
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
        """As perguntas VIVAS cuja condicional aponta para esta.

        ⚠️ ELAS SAO O MOTIVO DE METADE DAS RECUSAS DESTE ARQUIVO. Uma pergunta
        condicional so aparece quando a pergunta-alvo tem certo valor; se o
        alvo some, muda de tipo ou perde a alternativa citada, a dependente
        NAO da erro -- ela simplesmente nunca mais aparece no formulario
        publico. Quem edita nao ve nada acontecer, e o buraco so vira noticia
        quando alguem reclama que "sumiu a pergunta da data".
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
        self._assert_pode_gerir(form.team_id)
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
        """⚠️ AS DUAS RECUSAS NOVAS AQUI SAO SOBRE AS DEPENDENTES.

        Trocar o tipo de `escolha` para `texto`, ou tirar da lista a
        alternativa que uma condicional cita, deixa a dependente invisivel
        para sempre -- sem erro, sem aviso. Recusar nomeando quem depende e a
        unica forma de quem edita descobrir isso ANTES.

        ⚠️ E MUDAR `label` E SEGURO, por mais que pareca o contrario: a
        resposta antiga guarda o TEXTO perguntado no dia
        (`solicitation.answers` = `{label, value}`). Renomear a pergunta hoje
        nao reescreve o que alguem respondeu ontem.
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

        # ⚠️ `options` so e reescrito quando VEM. `None` aqui e "nao mexe", e
        # nao "esvazia" -- esvaziar uma lista de alternativas por omissao seria
        # apagar o formulario de quem so quis corrigir uma vírgula no titulo.
        novas_opcoes = (
            pergunta.options
            if options is None
            else [o.strip() for o in options if o.strip()]
        )
        if not exige_opcoes(novo_kind):
            # Tipo sem alternativas nao carrega lista: guardar uma lista morta
            # faria a tela de edicao mostrar opcoes que o publico nao ve.
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
        """Liga (ou desliga) o "só aparece quando…" de uma pergunta.

        ⚠️ GESTO PROPRIO, E NAO UM CAMPO DO `PATCH`, por um motivo bobo e
        decisivo: DESLIGAR a condicional e mandar `null`, e num PATCH `null`
        se confunde com "nao mexe". Aqui os dois argumentos sao obrigatorios,
        entao nao ha ambiguidade nenhuma.

        As tres regras sao as mesmas que os 25 condicionais herdados do
        formulario do Marketing ja cumpriam -- foram conferidos um a um:

          - **mesma secao**: o publico responde uma secao de cada vez, e uma
            condicional que atravessa secao dependeria de resposta que ainda
            nao existe na tela;
          - **para tras**: alvo depois da dependente e uma pergunta que se
            revela por algo que ainda nao foi perguntado;
          - **alvo de escolha**: comparar com `igual` so faz sentido contra
            uma lista de alternativas.
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
        """Soft delete.

        ⚠️ E ELE NAO TOCA EM RESPOSTA NENHUMA -- nem poderia. As respostas
        vivem em `solicitation.answers` como `{label, value}`, com o TEXTO da
        pergunta. Apagar a pergunta hoje nao muda o que alguem respondeu
        ontem, e e por isso que o formulario pode ser editavel sem medo.

        ⚠️ MAS ELE RECUSA QUANDO OUTRAS DEPENDEM DELA. Sem esta guarda, as
        dependentes ficariam apontando para uma pergunta morta: nunca mais
        apareceriam no formulario, sem erro nenhum no caminho. Some UMA e
        somem TRES -- e so a primeira foi pedida.
        """
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

        # ⚠️ A PERGUNTA-RESUMO NAO PODE FICAR APONTANDO PARA UM MORTO. O front
        # tem reserva (`resumoDe` cai no primeiro campo), entao limpar aqui e
        # honesto: a secao volta ao padrao em vez de guardar um id fantasma.
        if secao.summary_question_id == pergunta.id:
            secao.summary_question_id = None

        pergunta.deleted_at = func.now()
        await self._session.flush()

    async def reordenar_perguntas(
        self, *, section_id: uuid.UUID, ids: list[uuid.UUID]
    ) -> list[SolicitationQuestion]:
        """A nova ordem das perguntas de UMA secao.

        ⚠️ REORDENAR PODE QUEBRAR CONDICIONAL, e por isso a conferencia no fim
        e obrigatoria: arrastar a dependente para cima do alvo faz dela uma
        pergunta que se revela por algo ainda nao perguntado. A regra e a
        mesma de `definir_condicional`, so que aplicada ao movimento inverso.
        """
        secao = await self._secao_do_workspace(section_id)
        form = await self._form_do_workspace(secao.form_id)
        self._assert_pode_gerir(form.team_id)

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
        """A lista recebida e EXATAMENTE o conjunto vivo?

        ⚠️ ACEITAR LISTA PARCIAL SERIA O DEFEITO SILENCIOSO CLASSICO desta
        tela: duas abas abertas, uma cria uma secao, a outra arrasta e envia a
        ordem ANTIGA -- e a secao nova ficaria com a posicao de outra. Exigir
        o conjunto inteiro faz a aba velha receber um erro em vez de apagar o
        trabalho da outra.
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
