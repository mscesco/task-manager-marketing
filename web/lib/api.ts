// lib/api.ts
// Cliente unico de acesso ao backend FastAPI. Centraliza:
//  - a URL base (RELATIVA por padrao -- topologia A, ADR 0001 da raiz)
//  - o token de acesso (guardado em memoria + localStorage)
//  - tratamento de 401 (token expirado) e do gate 409 (troca de senha)
//
// Tudo que fala com a API passa por aqui. Nenhum componente monta URL na mao.
//
// BASE RELATIVA: por padrao API_URL = "" -> as chamadas viram "/api/v1/..."
// relativas a origem do browser. Em DEV, o next.config reescreve /api ->
// localhost:8000. Em PROD, o Traefik roteia /api -> backend. Mesma origem
// nos dois -> CORS nao aparece. So defina NEXT_PUBLIC_API_URL (absoluta) se
// algum dia precisar furar isso de proposito.

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
const WORKSPACE_SLUG = process.env.NEXT_PUBLIC_WORKSPACE_SLUG || "unifecaf";

const ACCESS_KEY = "tm_access_token";
const REFRESH_KEY = "tm_refresh_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_KEY);
}
export function setTokens(access: string, refresh: string) {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}
export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  // Os times, a lista de membros e o usuario logado sao por-sessao; ao
  // trocar de sessao, descarta os caches.
  _teams = undefined;
  _members = undefined;
  _me = undefined;
}

export class ApiError extends Error {
  status: number;
  // 'password_change_required' chega no corpo do 409 do gate (E7).
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Options = {
  method?: string;
  body?: unknown;
  auth?: boolean; // anexa o Bearer token (default true)
};

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch so estoura assim em rede/CORS. Mensagem util em vez de "Failed to fetch".
    throw new ApiError(
      0,
      "Nao consegui falar com o servidor. O backend esta rodando na porta 8000?"
    );
  }

  if (res.status === 204) return undefined as T;

  let data: any = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
  }

  if (!res.ok) {
    const detail =
      (data && (data.detail?.message || data.detail || data.message)) ||
      `Erro ${res.status}`;
    const code = data?.detail?.code || data?.code;
    throw new ApiError(res.status, typeof detail === "string" ? detail : "Erro", code);
  }
  return data as T;
}

// ---- chamadas especificas (uma funcao por endpoint usado) ----

export type TokenPair = { access_token: string; refresh_token: string; token_type: string };

export async function login(email: string, password: string): Promise<TokenPair> {
  return api<TokenPair>("/api/v1/auth/login", {
    method: "POST",
    auth: false,
    body: { email, password, workspace_slug: WORKSPACE_SLUG },
  });
}

export type CurrentUser = {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  is_active: boolean;
  must_change_password: boolean;
  roles: string[];
  permissions: string[];
};

export async function getMe(): Promise<CurrentUser> {
  return api<CurrentUser>("/api/v1/auth/me");
}

export async function changePassword(current: string, next: string): Promise<void> {
  await api("/api/v1/auth/change-password", {
    method: "POST",
    body: { current_password: current, new_password: next },
  });
}

export type Task = {
  id: string;
  project_id: string | null;
  parent_task_id: string | null;
  team_id: string | null;
  title: string;
  description: string;
  status: string;
  priority: string;
  position: number;
  depth: number;
  path: string;
  due_date: string | null;
  completed_at: string | null;
  created_by: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  // So a listagem (GET /tasks) traz isto, em lote (selo do card). As
  // respostas de mutacao (POST/PATCH/move) NAO trazem -> opcional, e o
  // estado local PRESERVA o valor no merge (nao sobrescrever com undefined).
  assignee_ids?: string[];
};

export type TaskListResponse = {
  items: Task[];
  total: number;
  page: number;
  size: number;
};

export async function listTasks(params: {
  page?: number;
  size?: number;
  status?: string;
  project_id?: string;
  include_archived?: boolean;
} = {}): Promise<TaskListResponse> {
  const q = new URLSearchParams();
  q.set("page", String(params.page ?? 1));
  q.set("size", String(params.size ?? 100));
  if (params.status) q.set("status", params.status);
  if (params.project_id) q.set("project_id", params.project_id);
  if (params.include_archived) q.set("include_archived", "true");
  return api<TaskListResponse>(`/api/v1/tasks?${q.toString()}`);
}

export type MyTaskItem = Task & { relations: string[]; out_of_scope: boolean };
export type MyAssignmentsResponse = {
  items: MyTaskItem[];
  total: number;
  page: number;
  size: number;
};

export async function listMyAssignments(params: {
  page?: number;
  size?: number;
} = {}): Promise<MyAssignmentsResponse> {
  const q = new URLSearchParams();
  q.set("page", String(params.page ?? 1));
  q.set("size", String(params.size ?? 100));
  return api<MyAssignmentsResponse>(`/api/v1/me/assignments?${q.toString()}`);
}

// ---------------------------------------------------------------
// TIMES + CRIACAO  (pin na raiz -- ver web/docs/adr/0001-pin-time-raiz-criacao.md)
// ---------------------------------------------------------------
// Toda task criada pelo quadro nasce DONA do time raiz (Marketing geral),
// nao do subtime de quem cria. E o que garante que todo mundo enxerga E
// edita o quadro geral mesmo depois de subtimes existirem. O id da raiz e
// o time com parent_team_id == null. Buscado uma vez e memoizado.

export type Team = {
  id: string;
  workspace_id: string;
  parent_team_id: string | null;
  name: string;
  slug: string;
};

type TeamListResponse = { items: Team[]; total: number };

// Lista de times do workspace (raiz + subtimes). Estavel na sessao ->
// buscada UMA vez e memoizada. getRootTeamId e listSubteams derivam daqui,
// entao o endpoint /teams e batido uma unica vez por sessao. Limpa no
// clearTokens.
let _teams: Team[] | undefined; // undefined = ainda nao buscado

async function listTeams(): Promise<Team[]> {
  if (_teams !== undefined) return _teams;
  const res = await api<TeamListResponse>("/api/v1/workspaces/current/teams");
  _teams = res.items;
  return _teams;
}

export async function getRootTeamId(): Promise<string | null> {
  const teams = await listTeams();
  const root = teams.find((t) => t.parent_team_id === null);
  // DIVIDA DOCUMENTADA (ADR 0001 do front): se a raiz nao for achada,
  // cai-se no null e o backend deriva o time pela membership -- hoje
  // identico ao pin (sem subtimes). QUANDO subtimes existirem, trocar
  // este null por erro duro, senao a heranca silenciosa volta.
  return root ? root.id : null;
}

// Subtimes = times NAO-raiz (parent_team_id != null). Alimenta o dropdown
// de subtime do quadro (Entrega 13, Fatia 3). Ordenado por nome (pt-BR) pra
// UI estavel. Espelha a regra do backend (list_all_with_subteam): a raiz
// nunca entra.
export async function listSubteams(): Promise<Team[]> {
  const teams = await listTeams();
  return teams
    .filter((t) => t.parent_team_id !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export type TaskCreateInput = {
  title: string;
  description?: string;
  priority?: string;
  due_date?: string | null;
  project_id?: string | null; // criar dentro de um projeto (Entrega 11)
};

export async function createTask(input: TaskCreateInput): Promise<Task> {
  const teamId = await getRootTeamId();
  return api<Task>("/api/v1/tasks", {
    method: "POST",
    body: {
      title: input.title,
      description: input.description ?? "",
      priority: input.priority, // ausente => backend usa MEDIUM
      due_date: input.due_date ?? null,
      // pin: so manda team_id se a raiz foi resolvida.
      ...(teamId ? { team_id: teamId } : {}),
      // project_id explicito (task de projeto) ou ausente (avulsa no raiz).
      ...(input.project_id ? { project_id: input.project_id } : {}),
    },
  });
}

// ---------------------------------------------------------------
// EDICAO / MUDANCA DE STATUS  (Slice 2: mover; Slice 3: editar)
// ---------------------------------------------------------------
// PATCH parcial: so os campos presentes mudam. project_id e
// parent_task_id NAO entram aqui (seriam /move). O drag entre colunas
// usa isto enviando so { status }. O backend ajusta completed_at sozinho
// ao entrar/sair de COMPLETED.

export type TaskUpdateInput = {
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  due_date?: string | null;
};

export async function updateTask(
  id: string,
  input: TaskUpdateInput
): Promise<Task> {
  return api<Task>(`/api/v1/tasks/${id}`, { method: "PATCH", body: input });
}

// ---------------------------------------------------------------
// MEMBROS  (dropdown de responsavel + resolucao de nome/iniciais do selo)
// ---------------------------------------------------------------
// O /assignees devolve so user_ids; o nome e as iniciais do selo saem daqui.
// Lista por-workspace, estavel na sessao -> buscada uma vez e memoizada
// (mesmo padrao do time raiz). Limpa no clearTokens.

export type Member = {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  is_active: boolean;
  // Entrega 13 (Fatia 2): id do SUBTIME do membro (time nao-raiz) ou null.
  // Pelo ADR 0008 e no maximo um. O backend nunca devolve aqui o time raiz.
  // Usado pelo filtro de subtime no quadro (Fatia 3).
  team_id: string | null;
};

type MemberListResponse = { items: Member[]; total: number };

let _members: Member[] | undefined; // undefined = ainda nao buscado

export async function listMembers(): Promise<Member[]> {
  if (_members !== undefined) return _members;
  const res = await api<MemberListResponse>("/api/v1/members");
  _members = res.items;
  return _members;
}

// ---------------------------------------------------------------
// RESPONSAVEIS (assignees)  -- Entrega 10
// ---------------------------------------------------------------
// Rotas idempotentes do backend (Entrega 4): POST -> 201 (novo) / 200 (no-op);
// DELETE -> 200 com a lista, ou 404 se o par nao existia. Todas devolvem a
// lista atual de user_ids da task. N responsaveis por (sub)tarefa.

export type CollaboratorList = { task_id: string; user_ids: string[] };

export async function listAssignees(taskId: string): Promise<string[]> {
  const res = await api<CollaboratorList>(`/api/v1/tasks/${taskId}/assignees`);
  return res.user_ids;
}

export async function addAssignee(
  taskId: string,
  userId: string
): Promise<string[]> {
  const res = await api<CollaboratorList>(
    `/api/v1/tasks/${taskId}/assignees`,
    { method: "POST", body: { user_id: userId } }
  );
  return res.user_ids;
}

// Remove um responsavel. O backend devolve 404 se o par nao existia; o
// chamador (UI) trata isso como "ja removido" (idempotente na tela).
export async function removeAssignee(
  taskId: string,
  userId: string
): Promise<string[]> {
  const res = await api<CollaboratorList>(
    `/api/v1/tasks/${taskId}/assignees/${userId}`,
    { method: "DELETE" }
  );
  return res.user_ids;
}

// ---------------------------------------------------------------
// SUBTAREFAS  -- Entrega 10 (fatia 3)
// ---------------------------------------------------------------
// Cria uma subtarefa pendurada num pai. NAO manda team_id: o backend herda
// o time do pai (ADR 0024). MANDA o project_id do pai porque o backend EXIGE
// que subtarefa e pai estejam no mesmo projeto (task_service: parent.project_id
// != command.project_id -> erro). Avulsa => parentProjectId null, casa com null.
export async function createSubtask(
  parentTaskId: string,
  title: string,
  parentProjectId: string | null
): Promise<Task> {
  return api<Task>("/api/v1/tasks", {
    method: "POST",
    body: {
      title,
      parent_task_id: parentTaskId,
      ...(parentProjectId ? { project_id: parentProjectId } : {}),
    },
  });
}

// Arquivar/desarquivar (Entrega 12). Exige task.update -> TODOS os papeis
// podem (e a saida pra quem nao tem task.delete). Idempotente, SEM cascata
// (nao mexe nas subtarefas). Resposta NAO traz assignee_ids -> upsert preserva.
export async function archiveTask(id: string): Promise<Task> {
  return api<Task>(`/api/v1/tasks/${id}/archive`, { method: "POST" });
}
export async function unarchiveTask(id: string): Promise<Task> {
  return api<Task>(`/api/v1/tasks/${id}/unarchive`, { method: "POST" });
}

// ===============================================================
// PROJETOS  -- Entrega 11 (pasta: agrupa tasks; tudo no time raiz)
// ===============================================================
// Projeto = "pasta" de um trabalho maior. Pertence a um time (o raiz,
// Marketing geral) -> aparece pra todos. Designar e so nas tasks; o projeto
// nao tem membros proprios. Backend ja tinha o CRUD completo desde a E1.
export type ProjectStatus =
  | "PLANNING"
  | "ACTIVE"
  | "BLOCKED"
  | "COMPLETED"
  | "CANCELLED";

export type Project = {
  id: string;
  title: string;
  description: string;
  status: ProjectStatus;
  priority: string;
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  is_archived: boolean;
  is_personal: boolean;
  team_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ProjectListResponse = {
  items: Project[];
  total: number;
  page: number;
  size: number;
};

// Lista projetos do workspace (paginado). NAO filtra pessoal -> o pessoal do
// proprio usuario vem junto; a tela de pastas descarta is_personal no front.
export async function listProjects(
  params: {
    page?: number;
    size?: number;
    status?: ProjectStatus;
    include_archived?: boolean;
  } = {}
): Promise<ProjectListResponse> {
  const q = new URLSearchParams();
  q.set("page", String(params.page ?? 1));
  q.set("size", String(params.size ?? 100));
  if (params.status) q.set("status", params.status);
  if (params.include_archived) q.set("include_archived", "true");
  return api<ProjectListResponse>(`/api/v1/projects?${q.toString()}`);
}

export async function getProject(id: string): Promise<Project> {
  return api<Project>(`/api/v1/projects/${id}`);
}

export type ProjectCreateInput = {
  title: string;
  description?: string;
  status?: ProjectStatus;
  priority?: string;
  start_date?: string | null;
  due_date?: string | null;
  team_id?: string; // omitido -> resolve o time raiz (pin, ADR 0001)
};

// Cria projeto COMUM. Se team_id nao vier, usa o time raiz (Marketing geral)
// -> a pasta fica visivel pra todos, coerente com o pin do quadro.
export async function createProject(input: ProjectCreateInput): Promise<Project> {
  const team_id = input.team_id ?? (await getRootTeamId());
  if (!team_id) throw new Error("Time raiz nao encontrado para criar o projeto.");
  return api<Project>("/api/v1/projects", {
    method: "POST",
    body: {
      title: input.title,
      team_id,
      description: input.description ?? "",
      ...(input.status ? { status: input.status } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.start_date !== undefined ? { start_date: input.start_date } : {}),
      ...(input.due_date !== undefined ? { due_date: input.due_date } : {}),
    },
  });
}

export type ProjectUpdateInput = {
  title?: string;
  description?: string;
  status?: ProjectStatus;
  priority?: string;
  start_date?: string | null;
  due_date?: string | null;
};

export async function updateProject(
  id: string,
  patch: ProjectUpdateInput
): Promise<Project> {
  return api<Project>(`/api/v1/projects/${id}`, { method: "PATCH", body: patch });
}

export async function archiveProject(id: string): Promise<Project> {
  return api<Project>(`/api/v1/projects/${id}/archive`, { method: "POST" });
}

export async function unarchiveProject(id: string): Promise<Project> {
  return api<Project>(`/api/v1/projects/${id}/unarchive`, { method: "POST" });
}


// ---------------------------------------------------------------
// USUARIO LOGADO (memoizado)  -- Entrega 14
// ---------------------------------------------------------------
// getMe() bate na API toda vez. O thread de comentarios precisa do `id`
// (mostrar editar/apagar so no proprio comentario) e das `permissions`
// (task.delete -> moderacao). Memoiza igual aos outros caches; limpa no
// clearTokens. O AppShell continua usando getMe() direto (revalida a sessao).
let _me: CurrentUser | undefined; // undefined = ainda nao buscado

export async function currentUser(): Promise<CurrentUser> {
  if (_me !== undefined) return _me;
  _me = await getMe();
  return _me;
}

// ---------------------------------------------------------------
// COMENTARIOS  (Entrega 14)
// ---------------------------------------------------------------
// Thread por task, 1 nivel de replica. Visibilidade = visibilidade da task
// (404 se nao ve -> o backend ja garante; o front so propaga o erro).
// is_deleted=true => tombstone (content ja vem mascarado pelo backend).
// edited_at != null => foi editado.

export type Comment = {
  id: string;
  task_id: string;
  user_id: string;
  parent_comment_id: string | null;
  content: string;
  edited_at: string | null;
  created_at: string;
  is_deleted: boolean;
};

export type CommentList = {
  items: Comment[];
  total: number;
  page: number;
  size: number;
};

// Thread da task, created_at ASC (mais antigo -> mais novo). size default 50
// no backend; aqui so manda o que for passado.
export async function listComments(
  taskId: string,
  params: { page?: number; size?: number } = {}
): Promise<CommentList> {
  const q = new URLSearchParams();
  if (params.page) q.set("page", String(params.page));
  if (params.size) q.set("size", String(params.size));
  const qs = q.toString();
  return api<CommentList>(
    `/api/v1/tasks/${taskId}/comments${qs ? `?${qs}` : ""}`
  );
}

// parentCommentId so quando for replica. Regra de 1 nivel (pai tem que ser de
// topo) e validada no backend -> 422 se furar.
export async function createComment(
  taskId: string,
  content: string,
  parentCommentId?: string | null
): Promise<Comment> {
  return api<Comment>(`/api/v1/tasks/${taskId}/comments`, {
    method: "POST",
    body: {
      content,
      ...(parentCommentId ? { parent_comment_id: parentCommentId } : {}),
    },
  });
}

// So o autor edita (403 senao). O backend seta edited_at.
export async function editComment(
  taskId: string,
  commentId: string,
  content: string
): Promise<Comment> {
  return api<Comment>(`/api/v1/tasks/${taskId}/comments/${commentId}`, {
    method: "PATCH",
    body: { content },
  });
}

// Soft-delete. Autor ou moderador (task.delete). 204 sem corpo.
export async function deleteComment(
  taskId: string,
  commentId: string
): Promise<void> {
  await api<void>(`/api/v1/tasks/${taskId}/comments/${commentId}`, {
    method: "DELETE",
  });
}
