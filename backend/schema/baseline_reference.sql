--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: ltree; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS ltree WITH SCHEMA public;


--
-- Name: EXTENSION ltree; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION ltree IS 'data type for hierarchical tree-like structures';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: priority_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.priority_level AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH',
    'URGENT'
);


--
-- Name: project_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.project_status AS ENUM (
    'PLANNING',
    'ACTIVE',
    'BLOCKED',
    'COMPLETED',
    'CANCELLED'
);


--
-- Name: task_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_status AS ENUM (
    'BACKLOG',
    'PLANNED',
    'IN_PROGRESS',
    'IN_REVIEW',
    'BLOCKED',
    'COMPLETED',
    'CANCELLED'
);


--
-- Name: user_team_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_team_role AS ENUM (
    'ADMIN',
    'MANAGER',
    'SUPERVISOR',
    'OPERATOR'
);


--
-- Name: task_history_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.task_history_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
            RAISE EXCEPTION 'task_history eh append-only: UPDATE/DELETE bloqueado.'
                USING ERRCODE = 'P0001';
        END;
        $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: attachment; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: comment; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: COLUMN comment.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.comment.updated_at IS 'Nao atualiza sozinho. Setado pelo backend via SQLAlchemy onupdate.';


--
-- Name: COLUMN comment.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.comment.deleted_at IS 'Soft delete real. NULL = ativo. Queries operacionais filtram deleted_at IS NULL.';


--
-- Name: project; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: COLUMN project.is_archived; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.project.is_archived IS 'Ocultacao operacional, NAO e delecao. Entidade segue valida; archived != deleted.';


--
-- Name: COLUMN project.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.project.updated_at IS 'Nao atualiza sozinho. Setado pelo backend via SQLAlchemy onupdate.';


--
-- Name: COLUMN project.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.project.deleted_at IS 'Soft delete real. NULL = ativo. Queries operacionais filtram deleted_at IS NULL.';


--
-- Name: task; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: COLUMN task."position"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.task."position" IS 'Ordenacao temporaria. Futuro: fractional indexing.';


--
-- Name: COLUMN task.path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.task.path IS 'Hierarquia LTREE. Exemplo: root.child.subchild';


--
-- Name: COLUMN task.is_archived; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.task.is_archived IS 'Ocultacao operacional, NAO e delecao. Entidade segue valida; archived != deleted.';


--
-- Name: COLUMN task.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.task.updated_at IS 'Nao atualiza sozinho. Setado pelo backend via SQLAlchemy onupdate.';


--
-- Name: COLUMN task.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.task.deleted_at IS 'Soft delete real. NULL = ativo. Queries operacionais filtram deleted_at IS NULL.';


--
-- Name: CONSTRAINT chk_task_no_self_parent ON task; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT chk_task_no_self_parent ON public.task IS 'Impede self-reference direta. Ciclos indiretos (A->B->C->A) sao validados na service layer.';


--
-- Name: task_assignment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_assignment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    assigned_by uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE task_assignment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.task_assignment IS 'PIVOT task<->users. O frontend inicialmente usa apenas 1 responsavel por task, mas a modelagem suporta MULTIPLOS responsaveis (N:N). Essa restricao NAO deve ser imposta no banco: e decisao de UI, nao de schema.';


--
-- Name: task_history; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: COLUMN task_history.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.task_history.metadata IS 'Contexto do evento para sistema futuro: source, trigger, automation, websocket, activity feed.';


--
-- Name: task_watcher; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_watcher (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: COLUMN team.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.team.updated_at IS 'Nao atualiza sozinho. Setado pelo backend via SQLAlchemy onupdate.';


--
-- Name: CONSTRAINT chk_team_no_self_parent ON team; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT chk_team_no_self_parent ON public.team IS 'Impede self-reference direta. Ciclos indiretos (A->B->C->A) sao validados na service layer.';


--
-- Name: CONSTRAINT chk_team_slug_format ON team; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT chk_team_slug_format ON public.team IS 'Slug restrito a minusculas, digitos e hifen para uso seguro em URLs.';


--
-- Name: time_entry; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: user_team; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_team (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    team_id uuid NOT NULL,
    role public.user_team_role NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: COLUMN users.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.updated_at IS 'Nao atualiza sozinho. Setado pelo backend via SQLAlchemy onupdate.';


--
-- Name: workspace; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(120) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_workspace_slug_format CHECK (((slug)::text ~ '^[a-z0-9-]+$'::text))
);


--
-- Name: COLUMN workspace.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.workspace.updated_at IS 'Nao atualiza sozinho. Setado pelo backend via SQLAlchemy onupdate.';


--
-- Name: CONSTRAINT chk_workspace_slug_format ON workspace; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT chk_workspace_slug_format ON public.workspace IS 'Slug restrito a minusculas, digitos e hifen para uso seguro em URLs.';


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: attachment attachment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment
    ADD CONSTRAINT attachment_pkey PRIMARY KEY (id);


--
-- Name: comment comment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT comment_pkey PRIMARY KEY (id);


--
-- Name: project project_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project
    ADD CONSTRAINT project_pkey PRIMARY KEY (id);


--
-- Name: task_assignment task_assignment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignment
    ADD CONSTRAINT task_assignment_pkey PRIMARY KEY (id);


--
-- Name: task_history task_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_history
    ADD CONSTRAINT task_history_pkey PRIMARY KEY (id);


--
-- Name: task task_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task
    ADD CONSTRAINT task_pkey PRIMARY KEY (id);


--
-- Name: task_watcher task_watcher_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_watcher
    ADD CONSTRAINT task_watcher_pkey PRIMARY KEY (id);


--
-- Name: team team_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team
    ADD CONSTRAINT team_pkey PRIMARY KEY (id);


--
-- Name: time_entry time_entry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entry
    ADD CONSTRAINT time_entry_pkey PRIMARY KEY (id);


--
-- Name: task_assignment uq_assignment_task_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignment
    ADD CONSTRAINT uq_assignment_task_user UNIQUE (task_id, user_id);


--
-- Name: comment uq_comment_id_workspace; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT uq_comment_id_workspace UNIQUE (id, workspace_id);


--
-- Name: project uq_project_id_workspace; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project
    ADD CONSTRAINT uq_project_id_workspace UNIQUE (id, workspace_id);


--
-- Name: task uq_task_id_workspace; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task
    ADD CONSTRAINT uq_task_id_workspace UNIQUE (id, workspace_id);


--
-- Name: team uq_team_id_workspace; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team
    ADD CONSTRAINT uq_team_id_workspace UNIQUE (id, workspace_id);


--
-- Name: team uq_team_workspace_slug; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team
    ADD CONSTRAINT uq_team_workspace_slug UNIQUE (workspace_id, slug);


--
-- Name: users uq_users_id_workspace; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_id_workspace UNIQUE (id, workspace_id);


--
-- Name: users uq_users_workspace_email; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_workspace_email UNIQUE (workspace_id, email);


--
-- Name: user_team uq_userteam_user_team; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_team
    ADD CONSTRAINT uq_userteam_user_team UNIQUE (user_id, team_id);


--
-- Name: task_watcher uq_watcher_task_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_watcher
    ADD CONSTRAINT uq_watcher_task_user UNIQUE (task_id, user_id);


--
-- Name: user_team user_team_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_team
    ADD CONSTRAINT user_team_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: workspace workspace_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_pkey PRIMARY KEY (id);


--
-- Name: workspace workspace_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_slug_key UNIQUE (slug);


--
-- Name: idx_assignment_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_user ON public.task_assignment USING btree (user_id);


--
-- Name: idx_assignment_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_workspace ON public.task_assignment USING btree (workspace_id);


--
-- Name: idx_attachment_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attachment_task ON public.attachment USING btree (workspace_id, task_id);


--
-- Name: idx_comment_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comment_active ON public.comment USING btree (workspace_id, task_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_comment_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comment_parent ON public.comment USING btree (parent_comment_id);


--
-- Name: idx_history_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_history_created ON public.task_history USING btree (workspace_id, created_at DESC);


--
-- Name: idx_history_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_history_event ON public.task_history USING btree (event_type);


--
-- Name: idx_history_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_history_task ON public.task_history USING btree (workspace_id, task_id, created_at);


--
-- Name: idx_project_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_active ON public.project USING btree (workspace_id, status) WHERE (deleted_at IS NULL);


--
-- Name: idx_project_archived; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_archived ON public.project USING btree (workspace_id, is_archived) WHERE (deleted_at IS NULL);


--
-- Name: idx_task_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_due_date ON public.task USING btree (workspace_id, status, due_date) WHERE (deleted_at IS NULL);


--
-- Name: idx_task_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_parent ON public.task USING btree (workspace_id, parent_task_id);


--
-- Name: idx_task_path_gist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_path_gist ON public.task USING gist (path);


--
-- Name: idx_task_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_project ON public.task USING btree (workspace_id, project_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_task_project_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_project_position ON public.task USING btree (workspace_id, project_id, "position");


--
-- Name: idx_task_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_team ON public.task USING btree (team_id);


--
-- Name: idx_team_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_parent ON public.team USING btree (parent_team_id);


--
-- Name: idx_timeentry_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_timeentry_task ON public.time_entry USING btree (workspace_id, task_id);


--
-- Name: idx_timeentry_user_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_timeentry_user_started ON public.time_entry USING btree (workspace_id, user_id, started_at DESC);


--
-- Name: idx_userteam_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_userteam_team ON public.user_team USING btree (team_id);


--
-- Name: idx_userteam_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_userteam_workspace ON public.user_team USING btree (workspace_id);


--
-- Name: idx_watcher_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_watcher_user ON public.task_watcher USING btree (user_id);


--
-- Name: ix_project_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_project_team ON public.project USING btree (team_id);


--
-- Name: ix_task_assignment_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_task_assignment_ws_user ON public.task_assignment USING btree (workspace_id, user_id);


--
-- Name: ix_task_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_task_team ON public.task USING btree (team_id);


--
-- Name: ix_task_watcher_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_task_watcher_ws_user ON public.task_watcher USING btree (workspace_id, user_id);


--
-- Name: project_personal_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_personal_per_user ON public.project USING btree (workspace_id, created_by) WHERE (is_personal = true);


--
-- Name: task_path_gist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_path_gist ON public.task USING gist (path);


--
-- Name: unique_active_timer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX unique_active_timer ON public.time_entry USING btree (user_id) WHERE (ended_at IS NULL);


--
-- Name: task_history task_history_no_update_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER task_history_no_update_delete BEFORE DELETE OR UPDATE ON public.task_history FOR EACH ROW EXECUTE FUNCTION public.task_history_immutable();


--
-- Name: task_assignment fk_assignment_assigned_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignment
    ADD CONSTRAINT fk_assignment_assigned_by FOREIGN KEY (assigned_by, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: task_assignment fk_assignment_task; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignment
    ADD CONSTRAINT fk_assignment_task FOREIGN KEY (task_id, workspace_id) REFERENCES public.task(id, workspace_id) ON DELETE CASCADE;


--
-- Name: task_assignment fk_assignment_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignment
    ADD CONSTRAINT fk_assignment_user FOREIGN KEY (user_id, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE CASCADE;


--
-- Name: task_assignment fk_assignment_workspace; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignment
    ADD CONSTRAINT fk_assignment_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;


--
-- Name: attachment fk_attachment_task; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment
    ADD CONSTRAINT fk_attachment_task FOREIGN KEY (task_id, workspace_id) REFERENCES public.task(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: attachment fk_attachment_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment
    ADD CONSTRAINT fk_attachment_user FOREIGN KEY (uploaded_by, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: attachment fk_attachment_workspace; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment
    ADD CONSTRAINT fk_attachment_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;


--
-- Name: comment fk_comment_parent; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT fk_comment_parent FOREIGN KEY (parent_comment_id, workspace_id) REFERENCES public.comment(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: comment fk_comment_task; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT fk_comment_task FOREIGN KEY (task_id, workspace_id) REFERENCES public.task(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: comment fk_comment_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT fk_comment_user FOREIGN KEY (user_id, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: comment fk_comment_workspace; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT fk_comment_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;


--
-- Name: task_history fk_history_task; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_history
    ADD CONSTRAINT fk_history_task FOREIGN KEY (task_id, workspace_id) REFERENCES public.task(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: task_history fk_history_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_history
    ADD CONSTRAINT fk_history_user FOREIGN KEY (user_id, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: task_history fk_history_workspace; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_history
    ADD CONSTRAINT fk_history_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;


--
-- Name: project fk_project_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project
    ADD CONSTRAINT fk_project_created_by FOREIGN KEY (created_by, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: project fk_project_workspace; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project
    ADD CONSTRAINT fk_project_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;


--
-- Name: task fk_task_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task
    ADD CONSTRAINT fk_task_created_by FOREIGN KEY (created_by, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: task fk_task_parent; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task
    ADD CONSTRAINT fk_task_parent FOREIGN KEY (parent_task_id, workspace_id) REFERENCES public.task(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: task fk_task_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task
    ADD CONSTRAINT fk_task_project FOREIGN KEY (project_id, workspace_id) REFERENCES public.project(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: task fk_task_team; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task
    ADD CONSTRAINT fk_task_team FOREIGN KEY (team_id, workspace_id) REFERENCES public.team(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: task fk_task_workspace; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task
    ADD CONSTRAINT fk_task_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;


--
-- Name: team fk_team_parent; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team
    ADD CONSTRAINT fk_team_parent FOREIGN KEY (parent_team_id, workspace_id) REFERENCES public.team(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: team fk_team_workspace; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team
    ADD CONSTRAINT fk_team_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;


--
-- Name: time_entry fk_timeentry_task; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entry
    ADD CONSTRAINT fk_timeentry_task FOREIGN KEY (task_id, workspace_id) REFERENCES public.task(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: time_entry fk_timeentry_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entry
    ADD CONSTRAINT fk_timeentry_user FOREIGN KEY (user_id, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: time_entry fk_timeentry_workspace; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entry
    ADD CONSTRAINT fk_timeentry_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;


--
-- Name: users fk_users_workspace; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_users_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;


--
-- Name: user_team fk_userteam_team; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_team
    ADD CONSTRAINT fk_userteam_team FOREIGN KEY (team_id, workspace_id) REFERENCES public.team(id, workspace_id) ON DELETE CASCADE;


--
-- Name: user_team fk_userteam_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_team
    ADD CONSTRAINT fk_userteam_user FOREIGN KEY (user_id, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE CASCADE;


--
-- Name: user_team fk_userteam_workspace; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_team
    ADD CONSTRAINT fk_userteam_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;


--
-- Name: task_watcher fk_watcher_task; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_watcher
    ADD CONSTRAINT fk_watcher_task FOREIGN KEY (task_id, workspace_id) REFERENCES public.task(id, workspace_id) ON DELETE CASCADE;


--
-- Name: task_watcher fk_watcher_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_watcher
    ADD CONSTRAINT fk_watcher_user FOREIGN KEY (user_id, workspace_id) REFERENCES public.users(id, workspace_id) ON DELETE CASCADE;


--
-- Name: task_watcher fk_watcher_workspace; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_watcher
    ADD CONSTRAINT fk_watcher_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;


--
-- Name: project project_team; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project
    ADD CONSTRAINT project_team FOREIGN KEY (team_id, workspace_id) REFERENCES public.team(id, workspace_id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--


