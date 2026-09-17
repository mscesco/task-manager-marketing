"""notification_mute + notification.roles -- preferencias de notificacao (Spec 054, fatia A)

Revision ID: 0028_preferencias_de_notificacao
Revises: 0027_juncao_de_avisos
Create Date: 2026-09-17

Duas pecas, e a terceira e preencher o que ja existe:

  - `notification_mute`: UMA LINHA = UM TOGGLE DESLIGADO (spec §6.1). A
    ausencia significa ligado, e e isso que faz um tipo de aviso criado no
    futuro nascer ligado para todo mundo sem migration nova (D11).
    `UNIQUE (user_id, type, role)`; `role` e `watcher`, `assignee`, `creator`
    ou `none` (os toggles de papel unico: reacao, por/tirar como seguidor).

  - `notification.roles`: POR QUE o aviso chegou para quem recebe (D12) --
    como seguidor, responsavel e/ou criador, gravado no instante do envio.
    Vazio = sem papel (tipos pessoais, ou nao deu para saber).

  - ⚠️ O PREENCHIMENTO DOS AVISOS ANTIGOS (D13, spec §6.3). Decisao dela, contra
    a propria preferencia por nao ter migration, porque a 054 precisa de uma de
    qualquer jeito. O papel e reconstruido pelo que existe HOJE (seguidor,
    responsavel, criador). E APROXIMADO, e a aproximacao erra para o lado
    seguro: um aviso pode ganhar um papel a mais, mas um papel a mais so torna
    o silencio MAIS DIFICIL (silencia quando TODO papel esta desligado, D4). E
    quando nada e encontrado, `roles` fica vazio e o aviso nunca e silenciado.

  - ⚠️ PRAZO CHEGANDO E VENCIDO NAO GANHAM `watcher`: esses avisos vao para
    responsaveis ou criador (Spec 023), e a tela nao tem toggle de seguidor
    para eles. Com `watcher` no conjunto, nunca poderiam ser silenciados.

⚠️ ORDEM DO DEPLOY: MIGRATION ANTES DO CODIGO, como a 0027. `roles` entra num
model que ja existe; o codigo novo sem a coluna da 500 em toda leitura de
notificacao. O codigo velho ignora a coluna, e os INSERT dele caem no DEFAULT.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0028_preferencias_de_notificacao"
down_revision: str | None = "0027_juncao_de_avisos"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


#: Os tipos de aviso que tem AUDIENCIA por papel (spec §5).
TIPOS_COM_PAPEL: tuple[str, ...] = (
    "TASK_COMMENTED",
    "TASK_COLUMN_CHANGED",
    "TASK_DUE_CHANGED",
    "TASK_DESCRIPTION_CHANGED",
    "TASK_ARCHIVED",
    "TASK_UNARCHIVED",
    "TASK_DELETED",
    "TASK_DUE_SOON",
    "TASK_OVERDUE",
)

#: Os de prazo: so responsavel e criador (ver o topo).
TIPOS_SEM_SEGUIDOR: tuple[str, ...] = ("TASK_DUE_SOON", "TASK_OVERDUE")


def _lista(tipos: tuple[str, ...]) -> str:
    return ", ".join(f"'{t}'" for t in tipos)


#: ⚠️ CONSTANTE DE MODULO, e nao so dentro do `upgrade`: o teste
#: `test_preencher_papeis_0028_db.py` a executa sobre dados montados. A
#: migration roda uma vez sobre um banco vazio nos testes, entao sem isto o
#: preenchimento nunca seria exercitado antes da producao.
PREENCHER_PAPEIS = f"""
UPDATE public.notification AS n
SET roles = ARRAY(
    SELECT p.papel
    FROM (VALUES
        (1, 'watcher',
         n.type NOT IN ({_lista(TIPOS_SEM_SEGUIDOR)})
         AND EXISTS (SELECT 1 FROM public.task_watcher w
                     WHERE w.task_id = n.task_id AND w.user_id = n.recipient_id)),
        (2, 'assignee',
         EXISTS (SELECT 1 FROM public.task_assignment a
                 WHERE a.task_id = n.task_id AND a.user_id = n.recipient_id)),
        (3, 'creator',
         EXISTS (SELECT 1 FROM public.task t
                 WHERE t.id = n.task_id AND t.created_by = n.recipient_id))
    ) AS p(ordem, papel, tem)
    WHERE p.tem
    ORDER BY p.ordem
)::character varying(10)[]
WHERE n.task_id IS NOT NULL
  AND n.type IN ({_lista(TIPOS_COM_PAPEL)});
"""


STATEMENTS: tuple[str, ...] = (
    """
    CREATE TABLE public.notification_mute (
        id uuid DEFAULT gen_random_uuid() NOT NULL,
        workspace_id uuid NOT NULL,
        user_id uuid NOT NULL,
        type character varying(40) NOT NULL,
        role character varying(10) NOT NULL,
        created_at timestamp with time zone DEFAULT now() NOT NULL
    );
    """,
    """
    ALTER TABLE ONLY public.notification_mute
        ADD CONSTRAINT notification_mute_pkey PRIMARY KEY (id);
    """,
    """
    ALTER TABLE ONLY public.notification_mute
        ADD CONSTRAINT notification_mute_workspace_id_fkey
        FOREIGN KEY (workspace_id)
        REFERENCES public.workspace(id) ON DELETE RESTRICT;
    """,
    """
    ALTER TABLE ONLY public.notification_mute
        ADD CONSTRAINT notification_mute_user
        FOREIGN KEY (user_id, workspace_id)
        REFERENCES public.users(id, workspace_id) ON DELETE CASCADE;
    """,
    """
    ALTER TABLE ONLY public.notification_mute
        ADD CONSTRAINT uq_notification_mute_user_type_role
        UNIQUE (user_id, type, role);
    """,
    """
    ALTER TABLE ONLY public.notification_mute
        ADD CONSTRAINT ck_notification_mute_role
        CHECK (role IN ('watcher', 'assignee', 'creator', 'none'));
    """,
    """
    ALTER TABLE public.notification
        ADD COLUMN roles character varying(10)[]
        DEFAULT '{}'::character varying[] NOT NULL;
    """,
    PREENCHER_PAPEIS,
)


def upgrade() -> None:
    for stmt in STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    op.execute("ALTER TABLE public.notification DROP COLUMN IF EXISTS roles;")
    op.execute("DROP TABLE IF EXISTS public.notification_mute;")
