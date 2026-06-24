"""baseline real -- schema v5 completo (colapso de 0001-0007)

Revision ID: 0001_baseline_v5
Revises:
Create Date: 2026-06-23

-----------------------------------------------------------
BASELINE COLAPSADO (Spec 008 / ADR 0022).

Esta migration constroi o schema v5 INTEIRO a partir do zero:
extensoes (ltree, pgcrypto), os 4 enums, as 12 tabelas, PKs,
UNIQUEs, CHECKs, 27 indices (inclusive o GIST de ltree), a
funcao task_history_immutable() e a trigger
task_history_no_update_delete que torna task_history
append-only, e as 34 FKs compostas (id, workspace_id).

O DDL foi EXTRAIDO de schema/schema_v5.sql (provado fiel a
producao no passo zero) e validado: banco vazio -> esta
migration -> pg_dump bate byte a byte com a referencia
(Portao 1). A tabela alembic_version NAO e criada aqui: o
proprio Alembic a gerencia.

As migrations 0002-0007 foram apagadas no colapso. Producao,
carimbada em 0007, exige UM re-stamp (ver plan.md):
    alembic stamp 0001_baseline_v5 --purge
-----------------------------------------------------------
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0001_baseline_v5"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# DDL completo do schema v5, extraido de schema/schema_v5.sql.
# Comentarios de secao do pg_dump removidos; o re-dump os regenera.
BASELINE_SQL = """\
CREATE EXTENSION IF NOT EXISTS ltree WITH SCHEMA public;

COMMENT ON EXTENSION ltree IS 'data type for hierarchical tree-like structures';

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';

CREATE TYPE public.priority_level AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH',
    'URGENT'
);

CREATE TYPE public.project_status AS ENUM (
    'PLANNING',
    'ACTIVE',
    'BLOCKED',
    'COMPLETED',
    'CANCELLED'
);

CREATE TYPE public.task_status AS ENUM (
    'BACKLOG',
    'PLANNED',
    'IN_PROGRESS',
    'IN_REVIEW',
    'BLOCKED',
    'COMPLETED',
    'CANCELLED'
);

CREATE TYPE public.user_team_role AS ENUM (
    'ADMIN',
    'MANAGER',
    'SUPERVISOR',
    'OPERATOR'
);

CREATE FUNCTION public.task_history_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
            RAISE EXCEPTION 'task_history eh append-only: UPDATE/DELETE bloqueado.'
                USING ERRCODE = 'P0001';
        END;
        $$;

CREATE TABLE public.attachment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    task_id uuid NOT NULL,
    uploaded_by uuid NOT NULL,
    file_name character varying(512) NOT NULL,
    storage_key character varying(1024) NOT NULL,
    mime_type character varying(255) NOT NULL,
    file_size bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_attachment_file_size_non_negative CHECK ((file_size >= 0))
);

CREATE TABLE public.comment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    parent_comment_id uuid,
    content text NOT NULL,
    edited_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

COMMENT ON COLUMN public.comment.updated_at IS 'Nao atualiza sozinho. Setado pelo backend via SQLAlchemy onupdate.';

COMMENT ON COLUMN public.comment.deleted_at IS 'Soft delete real. NULL = ativo. Queries operacionais filtram deleted_at IS NULL.';

CREATE TABLE public.project (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    description text NOT NULL,
    status public.project_status DEFAULT 'PLANNING'::public.project_status NOT NULL,
    priority public.priority_level DEFAULT 'MEDIUM'::public.priority_level NOT NULL,
    start_date date,
    due_date date,
    completed_at timestamp with time zone,
    created_by uuid NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    is_personal boolean DEFAULT false NOT NULL,
    team_id uuid,
    CONSTRAINT project_team_required_when_common CHECK ((is_personal OR (team_id IS NOT NULL) OR (deleted_at IS NOT NULL)))
);

COMMENT ON COLUMN public.project.is_archived IS 'Ocultacao operacional, NAO e delecao. Entidade segue valida; archived != deleted.';

COMMENT ON COLUMN public.project.updated_at IS 'Nao atualiza sozinho. Setado pelo backend via SQLAlchemy onupdate.';

COMMENT ON COLUMN public.project.deleted_at IS 'Soft delete real. NULL = ativo. Queries operacionais filtram deleted_at IS NULL.';

CREATE TABLE public.task (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid,
    parent_task_id uuid,
    team_id uuid,
    title character varying(255) NOT NULL,
    description text NOT NULL,
    status public.task_status DEFAULT 'BACKLOG'::public.task_status NOT NULL,
    priority public.priority_level DEFAULT 'MEDIUM'::public.priority_level NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    depth integer DEFAULT 0 NOT NULL,
    path public.ltree NOT NULL,
    start_date date,
    due_date date,
    completed_at timestamp with time zone,
    created_by uuid NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT chk_task_depth_non_negative CHECK ((depth >= 0)),
    CONSTRAINT chk_task_no_self_parent CHECK (((parent_task_id IS NULL) OR (parent_task_id <> id))),
    CONSTRAINT chk_task_position_non_negative CHECK (("position" >= 0))
);

COMMENT ON COLUMN public.task."position" IS 'Ordenacao temporaria. Futuro: fractional indexing.';

COMMENT ON COLUMN public.task.path IS 'Hierarquia LTREE. Exemplo: root.child.subchild';

COMMENT ON COLUMN public.task.is_archived IS 'Ocultacao operacional, NAO e delecao. Entidade segue valida; archived != deleted.';

COMMENT ON COLUMN public.task.updated_at IS 'Nao atualiza sozinho. Setado pelo backend via SQLAlchemy onupdate.';

COMMENT ON COLUMN public.task.deleted_at IS 'Soft delete real. NULL = ativo. Queries operacionais filtram deleted_at IS NULL.';

COMMENT ON CONSTRAINT chk_task_no_self_parent ON public.task IS 'Impede self-reference direta. Ciclos indiretos (A->B->C->A) sao validados na service layer.';

CREATE TABLE public.task_assignment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    assigned_by uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.task_assignment IS 'PIVOT task<->users. O frontend inicialmente usa apenas 1 responsavel por task, mas a modelagem suporta MULTIPLOS responsaveis (N:N). Essa restricao NAO deve ser imposta no banco: e decisao de UI, nao de schema.';

CREATE TABLE public.task_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    event_type character varying(80) NOT NULL,
    field_name character varying(80),
    old_value jsonb,
    new_value jsonb,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON COLUMN public.task_history.metadata IS 'Contexto do evento para sistema futuro: source, trigger, automation, websocket, activity feed.';

CREATE TABLE public.task_watcher (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.team (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    parent_team_id uuid,
    name character varying(255) NOT NULL,
    slug character varying(120) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_team_no_self_parent CHECK (((parent_team_id IS NULL) OR (parent_team_id <> id))),
    CONSTRAINT chk_team_slug_format CHECK (((slug)::text ~ '^[a-z0-9-]+$'::text))
);

COMMENT ON COLUMN public.team.updated_at IS 'Nao atualiza sozinho. Setado pelo backend via SQLAlchemy onupdate.';

COMMENT ON CONSTRAINT chk_team_no_self_parent ON public.team IS 'Impede self-reference direta. Ciclos indiretos (A->B->C->A) sao validados na service layer.';

COMMENT ON CONSTRAINT chk_team_slug_format ON public.team IS 'Slug restrito a minusculas, digitos e hifen para uso seguro em URLs.';

CREATE TABLE public.time_entry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    description text,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    duration_seconds integer,
    is_manual boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_timeentry_duration_non_negative CHECK (((duration_seconds IS NULL) OR (duration_seconds >= 0))),
    CONSTRAINT chk_timeentry_interval CHECK (((ended_at IS NULL) OR (ended_at >= started_at)))
);

CREATE TABLE public.user_team (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    team_id uuid NOT NULL,
    role public.user_team_role NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(320) NOT NULL,
    password_hash character varying(255) NOT NULL,
    avatar_url character varying(1024),
    is_active boolean DEFAULT true NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    must_change_password boolean DEFAULT false NOT NULL,
    password_expires_at timestamp with time zone
);

COMMENT ON COLUMN public.users.updated_at IS 'Nao atualiza sozinho. Setado pelo backend via SQLAlchemy onupdate.';

CREATE TABLE public.workspace (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(120) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_workspace_slug_format CHECK (((slug)::text ~ '^[a-z0-9-]+$'::text))
);

COMMENT ON COLUMN public.workspace.updated_at IS 'Nao atualiza sozinho. Setado pelo backend via SQLAlchemy onupdate.';

COMMENT ON CONSTRAINT chk_workspace_slug_format ON public.workspace IS 'Slug restrito a minusculas, digitos e hifen para uso seguro em URLs.';

ALTER TABLE ONLY public.attachment
    ADD CONSTRAINT attachment_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT comment_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project
    ADD CONSTRAINT project_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.task_assignment
    ADD CONSTRAINT task_assignment_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.task_history
    ADD CONSTRAINT task_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.task
    ADD CONSTRAINT task_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.task_watcher
    ADD CONSTRAINT task_watcher_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.team
    ADD CONSTRAINT team_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.time_entry
    ADD CONSTRAINT time_entry_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.task_assignment
    ADD CONSTRAINT uq_assignment_task_user UNIQUE (task_id, user_id);

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT uq_comment_id_workspace UNIQUE (id, workspace_id);

ALTER TABLE ONLY public.project
    ADD CONSTRAINT uq_project_id_workspace UNIQUE (id, workspace_id);

ALTER TABLE ONLY public.task
    ADD CONSTRAINT uq_task_id_workspace UNIQUE (id, workspace_id);

ALTER TABLE ONLY public.team
    ADD CONSTRAINT uq_team_id_workspace UNIQUE (id, workspace_id);

ALTER TABLE ONLY public.team
    ADD CONSTRAINT uq_team_workspace_slug UNIQUE (workspace_id, slug);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_id_workspace UNIQUE (id, workspace_id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_workspace_email UNIQUE (workspace_id, email);

ALTER TABLE ONLY public.user_team
    ADD CONSTRAINT uq_userteam_user_team UNIQUE (user_id, team_id);

ALTER TABLE ONLY public.task_watcher
    ADD CONSTRAINT uq_watcher_task_user UNIQUE (task_id, user_id);

ALTER TABLE ONLY public.user_team
    ADD CONSTRAINT user_team_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_slug_key UNIQUE (slug);

CREATE INDEX idx_assignment_user ON public.task_assignment USING btree (user_id);

CREATE INDEX idx_assignment_workspace ON public.task_assignment USING btree (workspace_id);

CREATE INDEX idx_attachment_task ON public.attachment USING btree (workspace_id, task_id);

CREATE INDEX idx_comment_active ON public.comment USING btree (workspace_id, task_id) WHERE (deleted_at IS NULL);

CREATE INDEX idx_comment_parent ON public.comment USING btree (parent_comment_id);

CREATE INDEX idx_history_created ON public.task_history USING btree (workspace_id, created_at DESC);

CREATE INDEX idx_history_event ON public.task_history USING btree (event_type);

CREATE INDEX idx_history_task ON public.task_history USING btree (workspace_id, task_id, created_at);

CREATE INDEX idx_project_active ON public.project USING btree (workspace_id, status) WHERE (deleted_at IS NULL);

CREATE INDEX idx_project_archived ON public.project USING btree (workspace_id, is_archived) WHERE (deleted_at IS NULL);

CREATE INDEX idx_task_due_date ON public.task USING btree (workspace_id, status, due_date) WHERE (deleted_at IS NULL);

CREATE INDEX idx_task_parent ON public.task USING btree (workspace_id, parent_task_id);

CREATE INDEX idx_task_path_gist ON public.task USING gist (path);

CREATE INDEX idx_task_project ON public.task USING btree (workspace_id, project_id) WHERE (deleted_at IS NULL);

CREATE INDEX idx_task_project_position ON public.task USING btree (workspace_id, project_id, "position");

CREATE INDEX idx_task_team ON public.task USING btree (team_id);

CREATE INDEX idx_team_parent ON public.team USING btree (parent_team_id);

CREATE INDEX idx_timeentry_task ON public.time_entry USING btree (workspace_id, task_id);

CREATE INDEX idx_timeentry_user_started ON public.time_entry USING btree (workspace_id, user_id, started_at DESC);

CREATE INDEX idx_userteam_team ON public.user_team USING btree (team_id);

CREATE INDEX idx_userteam_workspace ON public.user_team USING btree (workspace_id);

CREATE INDEX idx_watcher_user ON public.task_watcher USING btree (user_id);

CREATE INDEX ix_project_team ON public.project USING btree (team_id);

CREATE INDEX ix_task_assignment_ws_user ON public.task_assignment USING btree (workspace_id, user_id);

CREATE INDEX ix_task_team ON public.task USING btree (team_id);

CREATE INDEX ix_task_watcher_ws_user ON public.task_watcher USING btree (workspace_id, user_id);

CREATE UNIQUE INDEX project_personal_per_user ON public.project USING btree (workspace_id, created_by) WHERE (is_personal = true);

CREATE INDEX task_path_gist ON public.task USING gist (path);

CREATE UNIQUE INDEX unique_active_timer ON public.time_entry USING btree (user_id) WHERE (ended_at IS NULL);

CREATE TRIGGER task_history_no_update_delete BEFORE DELETE OR UPDATE ON public.task_history FOR EACH ROW EXECUTE FUNCTION public.task_history_immutable();

ALTER TABLE ONLY public.task_assignment
    ADD CONSTRAINT fk_assignment_assigned_by FOREIGN KEY (assigned_by, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.task_assignment
    ADD CONSTRAINT fk_assignment_task FOREIGN KEY (task_id, workspace_id) REFERENCES public.task(id, workspace_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.task_assignment
    ADD CONSTRAINT fk_assignment_user FOREIGN KEY (user_id, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.task_assignment
    ADD CONSTRAINT fk_assignment_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.attachment
    ADD CONSTRAINT fk_attachment_task FOREIGN KEY (task_id, workspace_id) REFERENCES public.task(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.attachment
    ADD CONSTRAINT fk_attachment_user FOREIGN KEY (uploaded_by, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.attachment
    ADD CONSTRAINT fk_attachment_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT fk_comment_parent FOREIGN KEY (parent_comment_id, workspace_id) REFERENCES public.comment(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT fk_comment_task FOREIGN KEY (task_id, workspace_id) REFERENCES public.task(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT fk_comment_user FOREIGN KEY (user_id, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT fk_comment_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.task_history
    ADD CONSTRAINT fk_history_task FOREIGN KEY (task_id, workspace_id) REFERENCES public.task(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.task_history
    ADD CONSTRAINT fk_history_user FOREIGN KEY (user_id, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.task_history
    ADD CONSTRAINT fk_history_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.project
    ADD CONSTRAINT fk_project_created_by FOREIGN KEY (created_by, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.project
    ADD CONSTRAINT fk_project_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.task
    ADD CONSTRAINT fk_task_created_by FOREIGN KEY (created_by, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.task
    ADD CONSTRAINT fk_task_parent FOREIGN KEY (parent_task_id, workspace_id) REFERENCES public.task(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.task
    ADD CONSTRAINT fk_task_project FOREIGN KEY (project_id, workspace_id) REFERENCES public.project(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.task
    ADD CONSTRAINT fk_task_team FOREIGN KEY (team_id, workspace_id) REFERENCES public.team(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.task
    ADD CONSTRAINT fk_task_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.team
    ADD CONSTRAINT fk_team_parent FOREIGN KEY (parent_team_id, workspace_id) REFERENCES public.team(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.team
    ADD CONSTRAINT fk_team_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.time_entry
    ADD CONSTRAINT fk_timeentry_task FOREIGN KEY (task_id, workspace_id) REFERENCES public.task(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.time_entry
    ADD CONSTRAINT fk_timeentry_user FOREIGN KEY (user_id, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.time_entry
    ADD CONSTRAINT fk_timeentry_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_users_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.user_team
    ADD CONSTRAINT fk_userteam_team FOREIGN KEY (team_id, workspace_id) REFERENCES public.team(id, workspace_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_team
    ADD CONSTRAINT fk_userteam_user FOREIGN KEY (user_id, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_team
    ADD CONSTRAINT fk_userteam_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.task_watcher
    ADD CONSTRAINT fk_watcher_task FOREIGN KEY (task_id, workspace_id) REFERENCES public.task(id, workspace_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.task_watcher
    ADD CONSTRAINT fk_watcher_user FOREIGN KEY (user_id, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.task_watcher
    ADD CONSTRAINT fk_watcher_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.project
    ADD CONSTRAINT project_team FOREIGN KEY (team_id, workspace_id) REFERENCES public.team(id, workspace_id) ON DELETE RESTRICT;
"""


def _split_statements(text: str) -> list[str]:
    """Divide o SQL em statements, respeitando dollar-quote ($$) e
    string literal ('...'). Necessario porque o corpo da funcao usa ';'
    dentro de $$ e dois COMMENT tem ';' dentro da string."""
    stmts: list[str] = []
    buf: list[str] = []
    i, n = 0, len(text)
    in_dollar = in_quote = False
    while i < n:
        if not in_quote and text[i : i + 2] == "$$":
            in_dollar = not in_dollar
            buf.append("$$")
            i += 2
            continue
        c = text[i]
        if c == "'" and not in_dollar:
            in_quote = not in_quote
            buf.append(c)
            i += 1
            continue
        if c == ";" and not in_dollar and not in_quote:
            s = "".join(buf).strip()
            if s:
                stmts.append(s)
            buf = []
            i += 1
            continue
        buf.append(c)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        stmts.append(tail)
    return stmts


def upgrade() -> None:
    """Cria o schema v5 inteiro. Cada statement roda isolado."""
    for stmt in _split_statements(BASELINE_SQL):
        op.execute(stmt)


def downgrade() -> None:
    """Reverter o baseline = destruir o schema. Nao implementado de
    proposito: zerar o banco e operacao manual e consciente."""
    pass
