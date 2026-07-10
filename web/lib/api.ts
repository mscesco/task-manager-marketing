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
  // details estruturado do erro (ex.: invalid_ids no 422 de assignee).
  details?: Record<string, any>;
  constructor(status: number, message: string, code?: string, details?: Record<string, any>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Options = {
  method?: string;
  body?: unknown;
  auth?: boolean; // anexa o Bearer token (default true)
};

// ---------------------------------------------------------------
// RECUPERACAO DE 401  (refresh do access token)
// ---------------------------------------------------------------
// O access token dura ~15 min. Quando expira, a proxima request volta 401.
// Aqui a gente troca o refresh (longo, dias) por um par novo e RETENTA a
// request UMA vez -- transparente pro usuario, sem F5.
//
// Duas travas que importam (ver consultoria, nao remover):
//   1. SINGLE-FLIGHT: varias requests batendo 401 ao mesmo tempo disparam
//      UM unico refresh; todas aguardam a MESMA promise. Sem isso, N
//      requests concorrentes fariam N refreshes correndo pra gravar o token.
//   2. ANTI-LOOP: a retentativa carrega isRetry=true e NAO dispara outro
//      refresh. Se o refresh tambem falha (refresh expirado/revogado), a
//      sessao esta morta -> limpa e manda pro login. Sem retentativa infinita.

let _refreshing: Promise<string | null> | null = null;

function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}

// Chama /auth/refresh DIRETO no fetch -- nao passa por api()/_request, senao
// recursa no proprio tratamento de 401. Devolve o access novo, ou null se o
// refresh tambem falhou (sessao morta).
async function doRefresh(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return null;
    const pair = (await res.json()) as TokenPair;
    setTokens(pair.access_token, pair.refresh_token);
    return pair.access_token;
  } catch {
    // Rede caiu no meio do refresh: trata como falha (nao derruba a sessao
    // a forca; o proximo 401 tenta de novo).
    return null;
  }
}

// Single-flight: se ja ha um refresh em voo, devolve a mesma promise.
function refreshAccessToken(): Promise<string | null> {
  if (_refreshing === null) {
    _refreshing = doRefresh().finally(() => {
      _refreshing = null;
    });
  }
  return _refreshing;
}

// Sessao morta: limpa tokens e caches e manda pro login UMA vez. Hard-nav de
// proposito -- garante o redirect venha a request da tela que for (e o buraco
// de hoje: cada .catch trata do seu jeito, a maioria nao redireciona).
function killSession() {
  clearTokens();
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.replace("/login");
  }
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  return _request<T>(path, method, body, auth, false);
}

async function _request<T>(
  path: string,
  method: string,
  body: unknown,
  auth: boolean,
  isRetry: boolean
): Promise<T> {
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

  // 401 com token anexado, e ainda nao e a retentativa: access expirou.
  // Tenta UM refresh (single-flight) + UM retry. So entra aqui quando a
  // request usa auth E mandou token -- 401 de rota publica (login) cai fora.
  if (res.status === 401 && auth && !isRetry && getToken()) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      // Retry pega o token novo via getToken() (isRetry=true: nao recursa).
      return _request<T>(path, method, body, auth, true);
    }
    killSession();
    throw new ApiError(401, "Sessao expirada. Faca login novamente.");
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
    const details = data?.detail?.details || data?.details;
    throw new ApiError(res.status, typeof detail === "string" ? detail : "Erro", code, details);
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

export type TeamMembership = { team_id: string; role: string };

export type CurrentUser = {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  is_active: boolean;
  must_change_password: boolean;
  roles: string[];
  permissions: string[];
  // Trabalho 2: vinculos (time, papel) do usuario -> base da lente
  // (quais quadros de subtime mostrar, qual e a raiz).
  teams: TeamMembership[];
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
  archived_only?: boolean;
} = {}): Promise<TaskListResponse> {
  const q = new URLSearchParams();
  q.set("page", String(params.page ?? 1));
  q.set("size", String(params.size ?? 100));
  if (params.status) q.set("status", params.status);
  if (params.project_id) q.set("project_id", params.project_id);
  if (params.include_archived) q.set("include_archived", "true");
  if (params.archived_only) q.set("archived_only", "true");
  return api<TaskListResponse>(`/api/v1/tasks?${q.toString()}`);
}

// ---------------------------------------------------------------
// BUSCA COMPLETA (anti-teto silencioso)  -- P0.2
// ---------------------------------------------------------------
// O quadro filtra/busca no cliente, entao precisa do conjunto COMPLETO, nao
// de uma pagina. Antes batia size=100 fixo: alem de 100, tasks sumiam do
// quadro E da busca sem aviso. Aqui pagina ate o total, com TETO DE SEGURANCA:
// se o total passar do teto, devolve truncated=true para a tela AVISAR (em
// vez de perder em silencio). O teto definitivo vem do auto-arquivamento de
// concluidas/canceladas (proxima entrega) -- aqui so paramos de mentir.

const TASK_FETCH_CEILING = 1000;

export type AllTasksResult = { items: Task[]; total: number; truncated: boolean };

export async function listAllTasks(
  params: { project_id?: string; include_archived?: boolean; status?: string } = {}
): Promise<AllTasksResult> {
  const pageSize = 100; // teto do backend (size <= 100)
  const first = await listTasks({ ...params, page: 1, size: pageSize });
  const total = first.total;
  const cap = Math.min(total, TASK_FETCH_CEILING);

  // Dedupe por id: paginacao por offset pode repetir um item na borda se
  // alguem cria/edita task durante a carga (ordenada por created_at desc).
  const seen = new Set<string>();
  const items: Task[] = [];
  const push = (arr: Task[]) => {
    for (const t of arr) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        items.push(t);
      }
    }
  };
  push(first.items);

  let page = 2;
  while (items.length < cap) {
    const next = await listTasks({ ...params, page, size: pageSize });
    if (next.items.length === 0) break; // defensivo: nada mais a buscar
    push(next.items);
    page++;
  }

  return { items, total, truncated: total > items.length };
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
// BUSCA COMPLETA de "minhas tarefas" (anti-teto silencioso)
// ---------------------------------------------------------------
// A tela minhas-tarefas filtra (status/relacao) no CLIENTE, entao precisa do
// conjunto COMPLETO -- nao de uma pagina. Antes batia size=100 fixo: alem de
// 100 relacoes, tarefas sumiam da lista E os filtros/contadores passavam a
// mentir (filtravam um recorte truncado). Mesmo padrao de listAllTasks: pagina
// ate o total, com TETO DE SEGURANCA; se estourar, truncated=true pra tela
// AVISAR em vez de perder em silencio. Dedupe por id porque paginacao por
// offset pode repetir um item na borda se algo muda durante a carga.
export type AllMyAssignmentsResult = {
  items: MyTaskItem[];
  total: number;
  truncated: boolean;
};

export async function listAllMyAssignments(): Promise<AllMyAssignmentsResult> {
  const pageSize = 100; // teto do backend por pagina
  const first = await listMyAssignments({ page: 1, size: pageSize });
  const total = first.total;
  const cap = Math.min(total, TASK_FETCH_CEILING);

  const seen = new Set<string>();
  const items: MyTaskItem[] = [];
  const push = (arr: MyTaskItem[]) => {
    for (const t of arr) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        items.push(t);
      }
    }
  };
  push(first.items);

  let page = 2;
  while (items.length < cap) {
    const next = await listMyAssignments({ page, size: pageSize });
    if (next.items.length === 0) break; // defensivo: nada mais a buscar
    push(next.items);
    page++;
  }

  return { items, total, truncated: total > items.length };
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

// Spec 014: raiz + subtimes, para o seletor de TIME no cadastro de membro.
// Diferente de listSubteams, a RAIZ entra (a admin pode vincular alguem no
// principal). Ordena raiz primeiro (parent_team_id === null), subtimes por
// nome (pt-BR). Deriva do mesmo listTeams() memoizado.
export async function listTeamsAll(): Promise<Team[]> {
  const teams = await listTeams();
  return [...teams].sort((a, b) => {
    const ra = a.parent_team_id === null ? 0 : 1;
    const rb = b.parent_team_id === null ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

export type TaskCreateInput = {
  title: string;
  description?: string;
  priority?: string;
  due_date?: string | null;
  project_id?: string | null; // criar dentro de um projeto (Entrega 11)
  assignee_ids?: string[]; // Spec 021: responsaveis ja na criacao
  // Fatia 5: time EXPLICITO da task de topo. Ausente => pin na raiz
  // (ADR 0001, comportamento de hoje). Presente => usa este time
  // (ex.: quadro de subtime cria task INTERNA daquele subtime).
  team_id?: string | null;
};

export async function createTask(input: TaskCreateInput): Promise<Task> {
  // Fatia 5: se o chamador deu um team_id explicito (quadro de subtime),
  // usa ele; senao mantem o pin na raiz (ADR 0001, comportamento atual).
  const teamId =
    input.team_id !== undefined && input.team_id !== null
      ? input.team_id
      : await getRootTeamId();
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
      // Spec 021: responsaveis na criacao (so manda se houver).
      ...(input.assignee_ids?.length ? { assignee_ids: input.assignee_ids } : {}),
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

// Move a task pra outro projeto e/ou pai, OU tira de projeto (avulsa, Spec 022:
// detach_project=true). Endpoint SEPARADO do PATCH -- project_id/parent_task_id
// NAO entram no updateTask de proposito. Como toda mutacao de task, a resposta
// NAO traz assignee_ids -> preservar no merge do estado local (ADR 0025).
export type TaskMoveInput = {
  project_id?: string;
  parent_task_id?: string;
  detach_project?: boolean;
};

export async function moveTask(
  id: string,
  input: TaskMoveInput
): Promise<Task> {
  return api<Task>(`/api/v1/tasks/${id}/move`, { method: "POST", body: input });
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
// GESTAO DE MEMBROS  (Entrega 15) -- exige team.manage no backend
// ---------------------------------------------------------------

export type MemberRole = "ADMIN" | "MANAGER" | "SUPERVISOR" | "OPERATOR";

// Spec 015, Fatia 1: vinculo (time, papel) de um membro. Alimenta a UI de
// administracao de papel (mostrar o papel atual antes de oferecer alterar).
export type MemberTeam = { team_id: string; role: MemberRole };

// POST /members devolve a senha provisoria UMA vez (ADR 0021 backend /
// 0008 front). So existe nesta resposta; nao e re-buscavel.
export type MemberCreated = Member & {
  must_change_password: boolean;
  password_expires_at: string | null;
  temporary_password: string;
};

export type ResetPasswordResult = {
  user_id: string;
  must_change_password: boolean;
  password_expires_at: string | null;
  temporary_password: string;
};

// Zera o cache de membros -> a proxima listMembers() rebusca. Chamar apos
// cadastrar/desativar pra lista e seletores de responsavel (Board/TaskDetail)
// nao ficarem defasados (D8).
export function invalidateMembers() {
  _members = undefined;
}

// Spec 014: cadastra um membro. teamId e role sao OBRIGATORIOS -- o time pode
// ser o principal (raiz) ou um subtime, escolha explicita na tela. Exige
// team.manage (403); criar role=ADMIN exige ator ADMIN (403 do gate D2);
// 409 = e-mail repetido; 422 = campos invalidos / "1 subtime". Invalida o
// cache no sucesso.
export async function createMember(input: {
  name: string;
  email: string;
  teamId: string;
  role: MemberRole;
}): Promise<MemberCreated> {
  const r = await api<MemberCreated>("/api/v1/members", {
    method: "POST",
    body: {
      name: input.name,
      email: input.email,
      team_id: input.teamId,
      role: input.role,
    },
  });
  invalidateMembers();
  return r;
}

// Spec 015, Fatia 1: papeis de um membro por time. Leitura -- so exige estar
// autenticado. Nao usa o cache de membros (e detalhe sob demanda).
export async function listMemberTeams(userId: string): Promise<MemberTeam[]> {
  return api<MemberTeam[]>(`/api/v1/members/${userId}/teams`);
}

// Spec 015, Fatia 2: troca o papel de um membro num time. Exige team.manage;
// matriz no backend (ADMIN qualquer; MANAGER so SUPERVISOR/OPERATOR; ninguem
// altera o proprio). 403 = matriz; 404 = vinculo inexistente.
export async function changeMemberRole(
  userId: string,
  teamId: string,
  role: MemberRole
): Promise<MemberTeam> {
  return api<MemberTeam>(`/api/v1/members/${userId}/teams/${teamId}`, {
    method: "PATCH",
    body: { role },
  });
}

// Spec 016: adiciona um membro EXISTENTE a um time, com um papel. Exige
// team.manage; matriz no backend (ADMIN qualquer; MANAGER SUP/OP -> 403);
// 409 = ja no time; 422 = 2o subtime. Invalida o cache (a lista pode mudar).
export async function assignMemberToTeam(
  userId: string,
  teamId: string,
  role: MemberRole
): Promise<MemberTeam> {
  const r = await api<MemberTeam>(`/api/v1/members/${userId}/team`, {
    method: "POST",
    body: { team_id: teamId, role },
  });
  invalidateMembers();
  return r;
}

// Spec 015, Fatia 4: remove um membro de um time (B3). 204 sem corpo. Matriz
// (403) + anti-lockout/anti-orfao (409 se for o ultimo vinculo) no backend.
export async function removeMemberFromTeam(
  userId: string,
  teamId: string
): Promise<void> {
  await api<void>(`/api/v1/members/${userId}/teams/${teamId}`, {
    method: "DELETE",
  });
  invalidateMembers(); // o subtime exibido na lista pode mudar
}

// Spec 015, Fatia 4: move um membro de um time para outro (B2), preservando o
// papel. Atomico no backend; matriz (403); 409 = mesmo time ou ja no destino.
export async function moveMemberSubteam(
  userId: string,
  fromTeamId: string,
  toTeamId: string
): Promise<MemberTeam> {
  const r = await api<MemberTeam>(`/api/v1/members/${userId}/move-subteam`, {
    method: "POST",
    body: { from_team_id: fromTeamId, to_team_id: toTeamId },
  });
  invalidateMembers(); // o subtime exibido na lista mudou
  return r;
}

// Reset administrativo: gera nova senha provisoria, devolvida UMA vez
// (team.manage). Nao invalida _members (so muda senha, nao a lista).
export async function resetMemberPassword(
  userId: string
): Promise<ResetPasswordResult> {
  return api<ResetPasswordResult>(`/api/v1/members/${userId}/reset-password`, {
    method: "POST",
  });
}

// Desativa (soft). VIA UNICA: nao ha endpoint de reativar (D5). O backend
// barra desativar a si mesmo. Invalida o cache no sucesso.
export async function deactivateMember(userId: string): Promise<Member> {
  const r = await api<Member>(`/api/v1/members/${userId}/deactivate`, {
    method: "POST",
  });
  invalidateMembers();
  return r;
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

// ---------------------------------------------------------------
// ARQUIVADAS  (tela dedicada -- Spec 013, fatia 4)
// ---------------------------------------------------------------
// Lista pagina DE VERDADE (page/size): o conjunto de arquivadas cresce sem
// fim, entao nao usa fetch-all/teto como o quadro -- uma lista pagina natural.
export async function listArchivedTasks(
  params: { page?: number; size?: number } = {}
): Promise<TaskListResponse> {
  return listTasks({
    page: params.page ?? 1,
    size: params.size ?? 30,
    archived_only: true,
  });
}

// Reativar = desarquivar + voltar pra BACKLOG (Spec 013, DECISAO C). ORDEM
// importa: muda o status PRIMEIRO (tira a task da elegibilidade da varredura),
// depois desarquiva. Se o unarchive falhar no meio, a task fica
// BACKLOG+arquivada e NAO e re-arquivada pela varredura (BACKLOG nao e
// terminal) -- sem loop, e o usuario pode tentar de novo.
export async function reactivateTask(id: string): Promise<Task> {
  await updateTask(id, { status: "BACKLOG" });
  return unarchiveTask(id);
}

// Soft-delete CASCATEADO (ADR 0005): apaga a task, toda a subtree e os
// comentarios. Exige task.delete (so ADMIN/MANAGER). A resposta traz
// cascade_count = quantas FILHAS foram apagadas junto (nao conta a raiz).
export type DeleteTaskResult = Task & { cascade_count: number };

export async function deleteTask(id: string): Promise<DeleteTaskResult> {
  return api<DeleteTaskResult>(`/api/v1/tasks/${id}`, { method: "DELETE" });
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

// Versao completa (anti-teto): pagina ate o total, com o mesmo teto das
// tasks. Usada pelo quadro geral pra montar o mapa id->titulo do selo de
// projeto -- antes batia size=100 fixo e perdia projetos alem disso.
export async function listAllProjects(
  params: { status?: ProjectStatus; include_archived?: boolean } = {}
): Promise<{ items: Project[]; total: number; truncated: boolean }> {
  const pageSize = 100;
  const first = await listProjects({ ...params, page: 1, size: pageSize });
  const total = first.total;
  const cap = Math.min(total, TASK_FETCH_CEILING);

  const seen = new Set<string>();
  const items: Project[] = [];
  const push = (arr: Project[]) => {
    for (const p of arr) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        items.push(p);
      }
    }
  };
  push(first.items);

  let page = 2;
  while (items.length < cap) {
    const next = await listProjects({ ...params, page, size: pageSize });
    if (next.items.length === 0) break;
    push(next.items);
    page++;
  }
  return { items, total, truncated: total > items.length };
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

// ---------------------------------------------------------------
// NOTIFICACOES IN-APP  (Spec 018)
// ---------------------------------------------------------------
// Pessoais: o backend escopa tudo por recipient == usuario logado.
// Sem cache: o badge e pollado e o feed e sempre buscado fresco.
// O type se chama AppNotification (e nao Notification) de proposito --
// "Notification" e um tipo GLOBAL do DOM (Web Notifications API) e
// sombrea-lo causaria confusao/erro de tipo.

export type NotificationType =
  | "TASK_ASSIGNED"
  | "TASK_COMMENTED"
  | "TASK_MENTIONED";

export type AppNotification = {
  id: string;
  type: NotificationType;
  actor_id: string | null;
  task_id: string | null;
  comment_id: string | null;
  payload: { actor_name?: string; task_title?: string } | null;
  read_at: string | null; // null = nao lida
  created_at: string;
};

export type NotificationListResponse = {
  items: AppNotification[];
  total: number;
  page: number;
  size: number;
};

// Feed paginado, mais novas primeiro.
export async function listNotifications(
  params: { unread_only?: boolean; page?: number; size?: number } = {}
): Promise<NotificationListResponse> {
  const q = new URLSearchParams();
  if (params.unread_only) q.set("unread_only", "true");
  q.set("page", String(params.page ?? 1));
  q.set("size", String(params.size ?? 20));
  return api<NotificationListResponse>(`/api/v1/notifications?${q.toString()}`);
}

// Contagem de nao-lidas (endpoint leve; e o que o sino polla).
export async function getUnreadCount(): Promise<number> {
  const r = await api<{ count: number }>("/api/v1/notifications/unread-count");
  return r.count;
}

// Marca UMA como lida. 204 sem corpo. 404 se nao for sua.
export async function markNotificationRead(id: string): Promise<void> {
  await api<void>(`/api/v1/notifications/${id}/read`, { method: "POST" });
}

// Marca todas as nao-lidas como lidas. Retorna quantas.
export async function markAllNotificationsRead(): Promise<number> {
  const r = await api<{ updated: number }>("/api/v1/notifications/read-all", {
    method: "POST",
  });
  return r.updated;
}
