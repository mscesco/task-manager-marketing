// Cliente HTTP. Depende de `lib/` (regras puras), nunca o contrário; o `import type` de volta não é ciclo.
import {
  indiceDeColunas,
  type Coluna,
  type OrigemDaColuna,
  quadroGeralDoTime,
} from "@/lib/coluna";
import { soleRootTeam } from "@/lib/rootTeams";
import type { AchadoDaBusca, CorpoDoMover, PreviaDoMover } from "@/lib/moverTarefa";
import type { Permission } from "@/lib/permissions.generated";

// Cliente único do backend: URL base, token, 401 (refresh) e o 409 de troca de senha.
// API_URL vazio = chamadas relativas ("/api/v1/..."): em dev o next.config reescreve, em produção o Traefik roteia.

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
  _workspace = undefined;
}

export class ApiError extends Error {
  status: number;
  // 'password_change_required' chega no corpo do 409 do gate de troca de senha.
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

// ---- Recuperação de 401: troca o refresh por um par novo e retenta UMA vez.
// Single-flight (um refresh para N requests) e sem loop (a retentativa não renova de novo).

/** "unavailable" (429, 5xx, rede) não é sessão morta: não desloga. */
export type RefreshOutcome = "renewed" | "dead" | "unavailable";

let _refreshing: Promise<RefreshOutcome> | null = null;

function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}

/** Recusa do servidor (4xx que não é o freio) = o refresh não vale mais. */
export function refreshOutcomeOf(status: number): RefreshOutcome {
  if (status >= 200 && status < 300) return "renewed";
  if (status >= 400 && status < 500 && status !== 429) return "dead";
  return "unavailable";
}

// Chama /auth/refresh DIRETO no fetch -- nao passa por api()/_request, senao
// recursa no proprio tratamento de 401.
async function doRefresh(): Promise<RefreshOutcome> {
  const refresh = getRefreshToken();
  if (!refresh) return "dead";
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    const outcome = refreshOutcomeOf(res.status);
    if (outcome === "renewed") {
      const pair = (await res.json()) as TokenPair;
      setTokens(pair.access_token, pair.refresh_token);
    }
    return outcome;
  } catch {
    return "unavailable"; // rede caiu: a sessao continua; a proxima acao tenta de novo
  }
}

/** O 401 de uma request com token: renova, ou encerra a sessão se o servidor recusou o refresh. */
async function renewOrEndSession(): Promise<void> {
  const outcome = await refreshAccessToken();
  if (outcome === "renewed") return;
  if (outcome === "dead") {
    killSession();
    throw new ApiError(401, "Sessao expirada. Faca login novamente.");
  }
  throw new ApiError(503, "Não consegui renovar a sessão agora. Tente de novo em instantes.");
}

// Single-flight: se ja ha um refresh em voo, devolve a mesma promise.
function refreshAccessToken(): Promise<RefreshOutcome> {
  if (_refreshing === null) {
    _refreshing = doRefresh().finally(() => {
      _refreshing = null;
    });
  }
  return _refreshing;
}

// Sessão morta: limpa tokens e caches e manda pro login uma vez (hard-nav).
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
      "Não consegui falar com o servidor. O backend está rodando na porta 8000?"
    );
  }

  // 401 com token e ainda não é a retentativa: tenta um refresh + um retry. 401 de rota pública cai fora.
  if (res.status === 401 && auth && !isRetry) {
    // Sem token nenhum a sessão já acabou (saiu em outra aba, storage limpo).
    if (!getToken()) {
      killSession();
      throw new ApiError(401, "Sessao expirada. Faca login novamente.");
    }
    await renewOrEndSession();
    // Retry pega o token novo via getToken() (isRetry=true: nao recursa).
    return _request<T>(path, method, body, auth, true);
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
    // O envelope de erro desta API é `{ error: { code, message, details } }` (`backend/app/api/errors.py`).
    // `data.detail` cobre o 422 do próprio FastAPI e o corpo não-JSON.
    const env = data?.error ?? data?.detail ?? data;
    const detail = env?.message || (typeof env === "string" ? env : null) ||
      `Erro ${res.status}`;
    const code = env?.code;
    const details = env?.details;
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
  // `Permission` (gerada do backend), não `string`: permissão removida deixa de compilar.
  permissions: Permission[];
  // Papel na organização; `roles`/`permissions` misturam os níveis e não respondem "administra a organização?".
  org_role?: OrgRole | null;
  // Vínculos (time, papel) do usuário: base da lente.
  teams: TeamMembership[];
};

export async function getMe(): Promise<CurrentUser> {
  return api<CurrentUser>("/api/v1/auth/me");
}

// Avisa o servidor que a sessão acabou (mata access e refresh em todos os aparelhos).
// Fetch direto: o 401 dispararia refresh + killSession no meio do logout. Nunca lança.
// O token é lido na primeira linha, antes de qualquer await: quem chama limpa os tokens logo em seguida.
export async function logout(): Promise<void> {
  const token = getToken();
  if (!token) return;
  try {
    await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Rede caiu: ignorado de propósito.
  }
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
  // Obrigatórios (NOT NULL no banco). Campo novo de resposta: declare aqui no mesmo passo do backend.
  board_id: string;
  column_id: string;
  /**
   * Quem pergunta pode apagar esta tarefa (e moderar comentário nela), no time da tarefa.
   * O botão vem daqui, não de `me.permissions`. Vem em toda resposta de tarefa.
   */
  can_delete: boolean;
  /** Pode pôr e tirar OUTRA pessoa como seguidora; calculado no servidor. */
  can_manage_watchers?: boolean;
  /**
   * Os três abaixo só vêm na listagem. Opcionais: respostas de mutação não os trazem, e o upsert
   * tem de preservá-los ao substituir a task no estado (como `assignee_ids`).
   */
  /** Filhas DIRETAS vivas (arquivada fora). Denominador do `☑ x/y`. */
  subtask_total?: number;
  /** Filhas diretas vivas em coluna `DONE`. Numerador. */
  subtask_done?: number;
  /** Responsaveis da SUBARVORE inteira, raiz junto. Filtro por pessoa/subtime. */
  subtree_assignee_ids?: string[];
  start_date: string | null;
  due_date: string | null;
  /** Hora do prazo; `null` = vence no dia. Vem com segundos ("18:00:00"): compare via `lib/prazo.ts`. */
  due_time: string | null;
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
  parent_task_id?: string;
  include_archived?: boolean;
  archived_only?: boolean;
  // Só tarefas de topo.
  root_only?: boolean;
  // Busca por título, casando também o de descendente.
  q?: string;
  /** Recorte pelo time ativo e seus descendentes. Vai em `under_team_id` (o `team_id` do backend casa por igualdade). */
  underTeamId?: string | null;
} = {}): Promise<TaskListResponse> {
  const q = new URLSearchParams();
  q.set("page", String(params.page ?? 1));
  q.set("size", String(params.size ?? 100));
  if (params.status) q.set("status", params.status);
  if (params.project_id) q.set("project_id", params.project_id);
  if (params.parent_task_id) q.set("parent_task_id", params.parent_task_id);
  if (params.root_only) q.set("root_only", "true");
  if (params.q && params.q.trim() !== "") q.set("q", params.q.trim());
  if (params.include_archived) q.set("include_archived", "true");
  if (params.archived_only) q.set("archived_only", "true");
  if (params.underTeamId) q.set("under_team_id", params.underTeamId);
  return api<TaskListResponse>(`/api/v1/tasks?${q.toString()}`);
}

// ---- Filhas diretas de uma tarefa (o `TaskDetail` busca as próprias).
// `include_archived: true` sempre: o aviso de exclusão conta todas (a cascata leva arquivadas); a checklist filtra.
// Pagina até o fim (`size=100` é o teto do backend).
export async function listarFilhas(parentTaskId: string): Promise<Task[]> {
  const pageSize = 100;
  const primeira = await listTasks({
    parent_task_id: parentTaskId,
    include_archived: true,
    page: 1,
    size: pageSize,
  });
  // Dedupe por id: paginação por offset pode repetir item na borda e fazer o laço parar cedo.
  const vistos = new Set<string>();
  const itens: Task[] = [];
  const acrescentar = (arr: Task[]) => {
    for (const t of arr) {
      if (vistos.has(t.id)) continue;
      vistos.add(t.id);
      itens.push(t);
    }
  };
  acrescentar(primeira.items);
  let page = 2;
  while (itens.length < primeira.total) {
    const proxima = await listTasks({
      parent_task_id: parentTaskId,
      include_archived: true,
      page,
      size: pageSize,
    });
    if (proxima.items.length === 0) break; // defensivo
    acrescentar(proxima.items);
    page++;
  }
  return itens;
}

// ---- Busca completa: pagina até o total com teto; acima do teto devolve `truncated` para a tela avisar.

const TASK_FETCH_CEILING = 1000;

export type AllTasksResult = { items: Task[]; total: number; truncated: boolean };

export async function listAllTasks(
  params: {
    project_id?: string;
    include_archived?: boolean;
    status?: string;
    // Com `root_only` subtarefa não viaja; contadores e filtros vêm prontos em `subtask_*`/`subtree_assignee_ids`.
    root_only?: boolean;
    q?: string;
  } = {}
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

export type MyTaskItem = Task & {
  relations: string[];
  /** Título da tarefa-mãe, em lote. `null` sem mãe ou com mãe fora da lente (a tela mostra "Subtarefa"). */
  parent_title: string | null;
};
export type MyAssignmentsResponse = {
  items: MyTaskItem[];
  total: number;
  page: number;
  size: number;
};

/**
 * Minhas tarefas, opcionalmente recortadas por time. `teamId: null` = todos os times (modo de uso, não esquecimento).
 * Vai em `under_team_id`: `team_id` esconderia tarefa interna de subtime.
 */
export async function listMyAssignments(params: {
  teamId: string | null;
  page?: number;
  size?: number;
}): Promise<MyAssignmentsResponse> {
  const q = new URLSearchParams();
  q.set("page", String(params.page ?? 1));
  q.set("size", String(params.size ?? 100));
  if (params.teamId) q.set("under_team_id", params.teamId);
  return api<MyAssignmentsResponse>(`/api/v1/me/assignments?${q.toString()}`);
}

// ---- Busca completa de "minhas tarefas": mesmo padrão de `listAllTasks` (teto, `truncated`, dedupe).
export type AllMyAssignmentsResult = {
  items: MyTaskItem[];
  total: number;
  truncated: boolean;
};

/** `teamId` vai em TODAS as páginas, senão a partir da 2ª a lista vem sem recorte. */
export async function listAllMyAssignments(
  teamId: string | null
): Promise<AllMyAssignmentsResult> {
  const pageSize = 100; // teto do backend por pagina
  const first = await listMyAssignments({ teamId, page: 1, size: pageSize });
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
    const next = await listMyAssignments({ teamId, page, size: pageSize });
    if (next.items.length === 0) break; // defensivo: nada mais a buscar
    push(next.items);
    page++;
  }

  return { items, total, truncated: total > items.length };
}

// ---- Times e criação.

export type Team = {
  id: string;
  workspace_id: string;
  parent_team_id: string | null;
  name: string;
  slug: string;
  description?: string | null;
  // Contagens em lote para a tela de gestão; só informam, o DELETE recheca.
  // `tarefas` inclui as da lixeira (seguram a foreign key).
  tarefas?: number;
  projetos?: number;
  membros?: number;
  filhos?: number;
  quadros?: number;
  formularios?: number;
  // Pode editar este time? Calculado no servidor. Só a listagem traz; ausente = "não".
  can_update?: boolean;
  // Pode criar projeto neste time? Ausente = "não".
  can_create_project?: boolean;
  // Pode apagar este time? Ausente = "não".
  can_delete?: boolean;
  // Pode criar base neste time (só time raiz)? Ausente = "não".
  can_create_base?: boolean;
  // Pode criar formulário de solicitação neste time (subtime vale)? Ausente = "não".
  can_create_form?: boolean;
};

type TeamListResponse = { items: Team[]; total: number };

// Times do workspace, memoizados na sessão. Limpa no `clearTokens` e em `invalidateTeams()` após mutação.
let _teams: Team[] | undefined; // undefined = ainda nao buscado

async function listTeams(): Promise<Team[]> {
  if (_teams !== undefined) return _teams;
  const res = await api<TeamListResponse>("/api/v1/workspaces/current/teams");
  _teams = res.items;
  return _teams;
}

/** O id do único time raiz do workspace; levanta se houver zero ou vários (regra em `lib/rootTeams.ts`). */
export async function getRootTeamId(): Promise<string> {
  return soleRootTeam(await listTeams()).id;
}

// Subtimes (times não-raiz), ordenados por nome. Espelha `list_all_with_subteam` do backend.
export async function listSubteams(): Promise<Team[]> {
  const teams = await listTeams();
  return teams
    .filter((t) => t.parent_team_id !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// Zera o cache de times; chamar após criar, editar ou remover.
// Também dispara `TIMES_MUDARAM` em `window` para quem já leu (a barra) reler: o cache mora fora do React.
export const TIMES_MUDARAM = "times:mudaram";

export function invalidateTeams() {
  _teams = undefined;
  // Guarda de SSR: `window` não existe no servidor.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(TIMES_MUDARAM));
  }
}

// 409 = slug repetido; 422 = slug fora de ^[a-z0-9-]+$.
export async function createTeam(input: {
  name: string;
  slug: string;
  // Ausente ou `null` = cria um time raiz; preenchido = cria um subtime. `""` dá 422 (o backend tipa UUID | None).
  parent_team_id?: string | null;
}): Promise<Team> {
  const t = await api<Team>("/api/v1/workspaces/current/teams", {
    method: "POST",
    body: input,
  });
  invalidateTeams();
  return t;
}

// Edita nome e descrição (slug não entra). 409 = tentou editar a raiz.
// `description` ausente preserva; string vazia limpa.
export async function updateTeam(
  id: string,
  input: { name: string; description?: string | null }
): Promise<Team> {
  const t = await api<Team>(`/api/v1/workspaces/current/teams/${id}`, {
    method: "PATCH",
    body: input,
  });
  invalidateTeams();
  return t;
}

// Remove time vazio. 409 = raiz ou ainda tem conteúdo (a mensagem traz os números); 204 sem corpo.
export async function deleteTeam(id: string): Promise<void> {
  await api<void>(`/api/v1/workspaces/current/teams/${id}`, {
    method: "DELETE",
  });
  invalidateTeams();
}

// O que sai junto se o time for esvaziado e removido. Números do momento da chamada.
export type PreviaRemocao = {
  team_id: string;
  nome: string;
  eh_raiz: boolean;
  tarefas_vivas: number;
  tarefas_na_lixeira: number;
  projetos: number;
  membros: number;
  filhos: number;
  // Sobem para o time raiz junto.
  quadros?: number;
  formularios?: number;
};

export async function previaRemocaoTeam(id: string): Promise<PreviaRemocao> {
  return api<PreviaRemocao>(
    `/api/v1/workspaces/current/teams/${id}/previa-remocao`
  );
}

// Move o conteúdo para o time principal, arquiva as tarefas vivas e apaga o time, numa transação.
// 409 = raiz ou tem subtime filho. Devolve o que foi feito.
export async function esvaziarERemoverTeam(
  id: string
): Promise<PreviaRemocao> {
  const r = await api<PreviaRemocao>(
    `/api/v1/workspaces/current/teams/${id}/esvaziar-e-remover`,
    { method: "POST" }
  );
  invalidateTeams();
  return r;
}

// ---- Workspace (a organização).
export type Workspace = {
  id: string;
  name: string;
  slug: string;
};

// Promove/rebaixa o papel de organização; `null` remove.
// 409 = seria o último administrador ativo (a organização se trancaria).
export async function changeOrganizationRole(
  userId: string,
  role: OrgRole | null,
): Promise<Member> {
  const m = await api<Member>(
    `/api/v1/members/${userId}/organization-role`,
    { method: "PATCH", body: { role } },
  );
  invalidateMembers();
  return m;
}

// Memoizado: a barra mostra o nome da organização em toda tela sem time na URL. Limpa no `clearTokens`.
let _workspace: Workspace | undefined;

export async function getWorkspace(): Promise<Workspace> {
  if (_workspace !== undefined) return _workspace;
  _workspace = await api<Workspace>("/api/v1/workspaces/current");
  return _workspace;
}

// Exige `workspace.manage`. Reescreve o cache com a resposta em vez de invalidar.
export async function renameWorkspace(name: string): Promise<Workspace> {
  const ws = await api<Workspace>("/api/v1/workspaces/current", {
    method: "PATCH",
    body: { name },
  });
  _workspace = ws;
  return ws;
}

export async function listTeamsAll(): Promise<Team[]> {
  const teams = await listTeams();
  return [...teams].sort((a, b) => {
    const ra = a.parent_team_id === null ? 0 : 1;
    const rb = b.parent_team_id === null ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

// ---- Quadros. O tipo `Coluna` mora em `lib/coluna.ts` para as regras ficarem puras (sem ciclo: api -> coluna -> status).

/** Um quadro alcançável, com as colunas na ordem visual. Espelha `BoardResponse`. */
/** Coluna com contagem de tarefas. Só o endpoint de detalhe devolve `task_count`. */
export type ColunaComContagem = Coluna & { task_count: number };

export type Quadro = {
  id: string;
  name: string;
  team_id: string;
  is_default: boolean;
  colunas: Coluna[];
};

/**
 * Os quadros que quem pergunta alcança (o recorte é feito na consulta do backend).
 * Sem memoização (criar/renomear quadro não teria invalidação) e sem paginação.
 */
export async function listBoards(): Promise<Quadro[]> {
  return api<Quadro[]>("/api/v1/boards");
}


/**
 * Colunas do quadro padrão + índice de todas as colunas alcançáveis, numa requisição.
 * Sem quadro padrão: `colunas` sai `[]` e o índice continua cheio.
 */
/**
 * Colunas do quadro geral de UM time + índice de todos os alcançáveis.
 * `null` = sem time: colunas vazias (kanban não espelha dois quadros). O índice não é recortado: rotula tarefa de quadro avulso.
 */
export async function quadroGeralComIndice(teamId: string | null): Promise<{
  colunas: Coluna[];
  indice: Map<string, OrigemDaColuna>;
}> {
  const quadros = await listBoards();
  const geral = teamId ? quadroGeralDoTime(quadros, teamId) : undefined;
  const colunas = geral
    ? [...geral.colunas].sort((a, b) => a.position - b.position)
    : [];
  return { colunas, indice: indiceDeColunas(quadros, geral?.id ?? null) };
}


// ---- Escrita de quadro e de coluna. Rotas de coluna são aninhadas no quadro: o backend autoriza pelo time
// do quadro e confere que a coluna é dele (board_id errado = 404).

/** Cria um quadro avulso para um time. Nasce com as quatro colunas base. */
export async function createBoard(input: {
  name: string;
  team_id: string;
}): Promise<Quadro> {
  return api<Quadro>("/api/v1/boards", { method: "POST", body: input });
}

/** Renomeia um quadro. Só o nome vai no corpo (`team_id` decide visibilidade; o backend ignoraria chave a mais). */
/** `GET /boards/{id}` -- o quadro com a CONTAGEM de tarefas vivas. */
export type QuadroComContagem = Quadro & { task_count: number };

/** Um quadro com a contagem de tarefas, para a confirmação de apagar. O número envelhece: o DELETE devolve quantas apagou. */
export async function getBoard(boardId: string): Promise<QuadroComContagem> {
  return api<QuadroComContagem>(`/api/v1/boards/${boardId}`);
}

/**
 * Apaga um quadro E as tarefas dentro dele; devolve quantas. Não pergunta destino nem tem desfazer:
 * a confirmação por digitação do nome é da tela. Resgate: `backend/scripts/restaurar_quadro.sql`.
 * `quadro_padrao_nao_apagavel` = tentou apagar o Quadro geral.
 */
export async function deleteBoard(
  boardId: string
): Promise<{ tarefas_apagadas: number }> {
  return api<{ tarefas_apagadas: number }>(`/api/v1/boards/${boardId}`, {
    method: "DELETE",
  });
}

export async function renameBoard(
  boardId: string,
  name: string
): Promise<Quadro> {
  return api<Quadro>(`/api/v1/boards/${boardId}`, {
    method: "PATCH",
    body: { name },
  });
}

/** Uma coluna a nascer no lote. `tmp` e apelido do cliente, nao id. */
export type LoteCriar = {
  tmp: string;
  name: string;
  semantic: Coluna["semantic"];
  /** Omitir = a rotação do backend escolhe. Só token da paleta (`CORES_DE_COLUNA`); hex volta 422. */
  color?: string;
  /** Omitir = `true`. */
  notify_deadline?: boolean;
};

/** Coluna que muda a cobrança de prazo. Só id real (coluna nova já nasce certa). */
export type LoteAviso = { id: string; notify_deadline: boolean };

export type LoteRenomear = { id: string; name: string };

/** `destino` aceita `tmp:apelido` alem de UUID. `null` = a coluna esta vazia. */
export type LoteApagar = { id: string; destino: string | null };

export type LoteDeColunas = {
  criar?: LoteCriar[];
  renomear?: LoteRenomear[];
  /** Ids que passam a ser o alvo da semântica deles. Só UUID (roda antes de apagar). */
  alvos?: string[];
  /** Colunas que ligam/desligam a cobrança de prazo (roda antes de apagar). */
  avisos?: LoteAviso[];
  apagar?: LoteApagar[];
  /** UUID em texto, ou `tmp:apelido`. Vazia = não mexer na ordem. */
  ordem?: string[];
};

/**
 * Aplica a edição inteira de colunas de um quadro numa transação. `tmp:` referencia coluna que ainda não tem id.
 * Leia o `code`, nunca a mensagem. Devolve as colunas inteiras, com os ids das novas.
 */
export async function aplicarLoteDeColunas(
  boardId: string,
  lote: LoteDeColunas
): Promise<{ colunas: Coluna[]; movidas: number }> {
  return api<{ colunas: Coluna[]; movidas: number }>(
    `/api/v1/boards/${boardId}/columns`,
    {
      method: "PUT",
      // Corpo montado campo a campo: campo novo no tipo precisa de linha aqui (guardião: `loteDeColunasCorpo.test.ts`).
      body: {
        criar: lote.criar ?? [],
        renomear: lote.renomear ?? [],
        avisos: lote.avisos ?? [],
        alvos: lote.alvos ?? [],
        apagar: lote.apagar ?? [],
        ordem: lote.ordem ?? [],
      },
    }
  );
}

/**
 * Uma coluna com quantas tarefas vivas ela tem (o número do aviso de apagar; envelhece).
 * Conta arquivadas, não conta apagadas.
 */
export async function colunaComContagem(
  boardId: string,
  columnId: string
): Promise<ColunaComContagem> {
  return api<ColunaComContagem>(
    `/api/v1/boards/${boardId}/columns/${columnId}`
  );
}


/**
 * As colunas do quadro de uma tarefa, ordenadas. O quadro sai do `board_id` da tarefa; o padrão é só reserva.
 * Devolve `[]` em vez de levantar.
 */
export async function colunasDoQuadro(boardId: string): Promise<Coluna[]> {
  const quadros = await listBoards();
  // Reserva só com um quadro geral: com vários não há como saber qual, e `[]` é a resposta honesta.
  const gerais = quadros.filter((q) => q.is_default);
  const quadro =
    quadros.find((q) => q.id === boardId) ??
    (gerais.length === 1 ? gerais[0] : undefined);
  if (!quadro) return [];
  return [...quadro.colunas].sort((a, b) => a.position - b.position);
}


export type TaskCreateInput = {
  title: string;
  description?: string;
  priority?: string;
  /** `createTask` monta o corpo campo a campo: declarar aqui não basta (guardião: `createTaskCorpo.test.ts`). */
  start_date?: string | null;
  due_date?: string | null;
  /** Hora sem data volta 422. */
  due_time?: string | null;
  project_id?: string | null; // criar dentro de um projeto
  assignee_ids?: string[]; // responsáveis já na criação
  /** Seguidores já na criação (precisa da linha no corpo de `createTask`). Quem não alcança volta em `details.invalid_ids`. */
  watcher_ids?: string[];
  // Time explícito da task de topo. Ausente => pin no time raiz.
  team_id?: string | null;
  /**
   * Em qual quadro a tarefa de topo nasce. Ausente/`null` = Quadro geral. Ignorado em subtarefa (herda do pai).
   * O backend confere o alcance (422 `board_fora_de_alcance`).
   */
  board_id?: string | null;
};

/** Sem data (a cópia nasceria vencida) e sem status (nasce BACKLOG). */
export type TaskDuplicateInput = {
  title: string;
  description?: string;
  priority?: string;
  project_id?: string | null;
  parent_task_id?: string | null;
  team_id?: string | null;
  /** Responsaveis do PAI, ja revisados no modal. */
  assignee_ids?: string[];
  include_subtasks?: boolean;
  /** Obsoleto: o backend ainda aceita, mas o modal não manda. Mandar `false` reabre a subtarefa órfã. */
  include_assignees?: boolean;
  /** Chaves = ids de subtarefa direta da origem; ausentes herdam. Lista vazia = 422 (use `skip_subtasks`). */
  subtask_assignees?: Record<string, string[]>;
  /** Subtarefas diretas que NAO vao. Leva a subarvore delas junto. */
  skip_subtasks?: string[];
};

export type TaskDuplicateResult = Task & {
  /** Responsáveis de subtarefa descartados por não alcançarem mais a task; não vazio = a tela avisa. */
  skipped_assignees: string[];
  /** A cópia virou tarefa de topo porque nasceria dentro de um pai arquivado (sem tela que a mostre). A tela avisa. */
  promoted_to_root: boolean;
};

export async function duplicateTask(
  taskId: string,
  input: TaskDuplicateInput
): Promise<TaskDuplicateResult> {
  // Sem o pin do `createTask`: o time vem do modal ou o backend resolve. O pin jogaria cópia de subtime na raiz.
  return api<TaskDuplicateResult>(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/duplicate`,
    {
      method: "POST",
      body: {
        title: input.title,
        description: input.description ?? "",
        priority: input.priority,
        project_id: input.project_id ?? null,
        parent_task_id: input.parent_task_id ?? null,
        team_id: input.team_id ?? null,
        assignee_ids: input.assignee_ids ?? [],
        include_subtasks: input.include_subtasks ?? false,
        include_assignees: input.include_assignees ?? true,
        // Corpo montado campo a campo: campo novo em `TaskDuplicateInput` precisa de linha aqui.
        subtask_assignees: input.subtask_assignees ?? {},
        skip_subtasks: input.skip_subtasks ?? [],
      },
    }
  );
}

export async function createTask(input: TaskCreateInput): Promise<Task> {
  // `team_id` explícito (quadro de subtime) ou pin no time raiz. O backend também deriva do quadro; o pin fica como segunda defesa.
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
      // Corpo montado campo a campo: todo campo do tipo precisa de linha aqui (guardião: `createTaskCorpo.test.ts`).
      start_date: input.start_date ?? null,
      due_date: input.due_date ?? null,
      due_time: input.due_time ?? null,
      // pin: so manda team_id se a raiz foi resolvida.
      ...(teamId ? { team_id: teamId } : {}),
      // project_id explicito (task de projeto) ou ausente (avulsa no raiz).
      ...(input.project_id ? { project_id: input.project_id } : {}),
      // Responsáveis na criação (só manda se houver).
      ...(input.assignee_ids?.length ? { assignee_ids: input.assignee_ids } : {}),
      ...(input.watcher_ids?.length ? { watcher_ids: input.watcher_ids } : {}),
      ...(input.board_id ? { board_id: input.board_id } : {}),
    },
  });
}

// ---- Edição: PATCH parcial, só os campos presentes mudam. project_id/parent_task_id vão por /move.
// O backend ajusta completed_at ao entrar/sair de COMPLETED.

export type TaskUpdateInput = {
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  /**
   * `body: input` inteiro: aqui declarar basta. `null` limpa, `undefined` não mexe (`""` = 422).
   * O backend recusa `start_date > due_date` (422), conferindo o estado final.
   */
  start_date?: string | null;
  due_date?: string | null;
  /** `null` limpa, `undefined` não mexe. Apagar o `due_date` de tarefa com hora volta 422: limpe os dois. */
  due_time?: string | null;
  /**
   * Move de coluna; o servidor deriva o status. Exclusivo com `status` (os dois = 422).
   * O front não calcula o status resultante: leia a resposta.
   */
  column_id?: string;
};

export async function updateTask(
  id: string,
  input: TaskUpdateInput
): Promise<Task> {
  return api<Task>(`/api/v1/tasks/${id}`, { method: "PATCH", body: input });
}

// Busca uma task por id (reconstruir a cadeia de pais num deep-link).
export async function getTask(id: string): Promise<Task> {
  return api<Task>(`/api/v1/tasks/${id}`);
}

// Move para outro projeto e/ou pai, ou tira de projeto (`detach_project`). A resposta não traz assignee_ids: preserve no merge.
export type TaskMoveInput = {
  project_id?: string;
  parent_task_id?: string;
  detach_project?: boolean;
};

export async function moveTask(
  id: string,
  input: TaskMoveInput
): Promise<Task> {
  const t = await api<Task>(`/api/v1/tasks/${id}/move`, { method: "POST", body: input });
  // O projeto decide quem alcança a tarefa: o cache de membros por tarefa fica velho.
  _membersPorTarefa.delete(id);
  return t;
}

/** Resposta do `relocate`; `task` é `null` na prévia. */
export type RespostaDoMover = PreviaDoMover & { task: Task | null };

/** Move para outro quadro e/ou outra mãe, levando a subárvore. Com `dry_run` só devolve a prévia. */
export async function relocateTask(
  id: string,
  corpo: CorpoDoMover,
  dryRun: boolean,
): Promise<RespostaDoMover> {
  const r = await api<RespostaDoMover>(`/api/v1/tasks/${id}/relocate`, {
    method: "POST",
    body: { ...corpo, dry_run: dryRun },
  });
  // Time e projeto mudam quem alcança, inclusive nas subtarefas.
  if (!dryRun) _membersPorTarefa.clear();
  return r;
}

/** Tarefas de qualquer nível do quadro, com o caminho. */
export async function searchBoardTasks(
  boardId: string,
  q: string,
  excludeTaskId: string,
): Promise<AchadoDaBusca[]> {
  const params = new URLSearchParams({ q, exclude_task_id: excludeTaskId });
  return api<AchadoDaBusca[]>(`/api/v1/boards/${boardId}/tasks/search?${params}`);
}

// ---- Membros: nome e iniciais do selo. Lista memoizada na sessão; limpa no clearTokens.

/** Papel na organização (sem time). */
export type OrgRole = "ADMIN" | "GESTOR";

export type Member = {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  is_active: boolean;
  // Papel na organização; `null` = nenhum (a maioria).
  org_role?: OrgRole | null;
  // Alimenta a aba "Convidados" (`memberState`): senha provisória e ainda não entrou.
  must_change_password?: boolean;
  // Os times raiz da pessoa; `team_ids` traz só subtimes. Vazio = sem vínculo nenhum.
  // Opcional: respostas de mutação não trazem, só a listagem.
  root_team_ids?: string[];
  // Todos os vínculos, com o papel. Não substitui `team_ids` (só subtimes, usado pelo filtro do quadro). Opcional como `root_team_ids`.
  memberships?: MemberTeam[];
  // Ids dos subtimes do membro (nunca o time raiz). Vazia = sem subtime; não existe `null`.
  team_ids: string[];
};

type MemberListResponse = { items: Member[]; total: number };

let _members: Member[] | undefined; // undefined = ainda nao buscado

// Cache separado por tarefa: compartilhar com `_members` faria a primeira tarefa aberta definir os seletores de todas.
const _membersPorTarefa = new Map<string, Member[]>();

/**
 * Membros do workspace. Sem argumento: lista completa, memoizada.
 * Com `reachesTaskId`: só quem alcança aquela tarefa (regra do backend). O modal de criar usa `listMembersDoTime`.
 */
export async function listMembers(reachesTaskId?: string): Promise<Member[]> {
  if (reachesTaskId === undefined) {
    if (_members !== undefined) return _members;
    const res = await api<MemberListResponse>("/api/v1/members");
    _members = res.items;
    return _members;
  }
  const emCache = _membersPorTarefa.get(reachesTaskId);
  if (emCache !== undefined) return emCache;
  const res = await api<MemberListResponse>(
    `/api/v1/members?reaches_task=${encodeURIComponent(reachesTaskId)}`
  );
  _membersPorTarefa.set(reachesTaskId, res.items);
  return res.items;
}

// Cache por time, separado dos outros dois.
const _membersPorTime = new Map<string, Member[]>();

/**
 * Membros que enxergam as tasks de um time (modal de criar, sem id de tarefa).
 * Função separada: um segundo argumento opcional deixaria passar id de time no lugar do de tarefa.
 */
export async function listMembersDoTime(teamId: string): Promise<Member[]> {
  const emCache = _membersPorTime.get(teamId);
  if (emCache !== undefined) return emCache;
  const res = await api<MemberListResponse>(
    `/api/v1/members?reaches_team=${encodeURIComponent(teamId)}`
  );
  _membersPorTime.set(teamId, res.items);
  return res.items;
}

// ---- Gestão de membros (exige team.manage no backend).

export type MemberRole = "MANAGER" | "SUPERVISOR" | "OPERATOR";

// Vínculo (time, papel) de um membro.
export type MemberTeam = { team_id: string; role: MemberRole };

/**
 * Um vínculo de `/members/{id}/teams` com o cadeado. `can_edit_role` vem do backend; não recalcular no front.
 * Responde só pelo papel: remover do time é outra rota, com outro gate.
 */
export type MemberTeamComCadeado = MemberTeam & { can_edit_role: boolean };

// POST /members devolve a senha provisória uma vez; não é re-buscável.
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

// Zera o cache de membros; chamar após cadastrar/desativar/trocar papel.
export function invalidateMembers() {
  _members = undefined;
  // Também o cache por tarefa: senão a pessoa desativada segue nos seletores de tarefas já abertas.
  _membersPorTarefa.clear();
  _membersPorTime.clear();
}

// Cadastra um membro; teamId e role obrigatórios (raiz ou subtime). 409 = e-mail repetido; 422 = campos inválidos.
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

/** Uma pessoa dentro de um time, com o cadeado. */
export type TeamMemberComCadeado = {
  user_id: string;
  role: MemberRole;
  // Conta ativa? Separa as duas razões do cadeado fechado: fora do escopo e desativada.
  is_active: boolean;
  can_edit_role: boolean;
};

/** Quem está neste time e quais desses cargos posso trocar (espelho de `listMemberTeams`). O cadeado vem do backend. */
export async function listTeamMembers(
  teamId: string,
): Promise<TeamMemberComCadeado[]> {
  return api<TeamMemberComCadeado[]>(`/api/v1/members/by-team/${teamId}`);
}

// Papéis de um membro por time. Não usa o cache de membros.
export async function listMemberTeams(
  userId: string,
): Promise<MemberTeamComCadeado[]> {
  return api<MemberTeamComCadeado[]>(`/api/v1/members/${userId}/teams`);
}

// Troca o papel de um membro num time; matriz no backend. 403 = matriz; 404 = vínculo inexistente.
export async function changeMemberRole(
  userId: string,
  teamId: string,
  role: MemberRole
): Promise<MemberTeam> {
  const r = await api<MemberTeam>(`/api/v1/members/${userId}/teams/${teamId}`, {
    method: "PATCH",
    body: { role },
  });
  // O papel viaja em `Member.memberships`, que está no cache memoizado.
  invalidateMembers();
  return r;
}

// Adiciona um membro existente a um time. 409 = já no time; 422 = 2º subtime.
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

// Remove um membro de um time; 204. 409 se for o último vínculo.
export async function removeMemberFromTeam(
  userId: string,
  teamId: string
): Promise<void> {
  await api<void>(`/api/v1/members/${userId}/teams/${teamId}`, {
    method: "DELETE",
  });
  invalidateMembers(); // o subtime exibido na lista pode mudar
}

// Reset administrativo: nova senha provisória, devolvida uma vez. Não invalida `_members`.
/** Os botões da conta de uma pessoa (resetar senha, desativar), respondidos pelo servidor. */
export type AcoesDaConta = {
  can_reset_password: boolean;
  can_deactivate: boolean;
  /** Só conta desativada (e conta desativada não ganha senha). */
  can_reactivate: boolean;
};

export async function memberAccountActions(userId: string): Promise<AcoesDaConta> {
  return api<AcoesDaConta>(`/api/v1/members/${userId}/account-actions`);
}

export async function resetMemberPassword(
  userId: string
): Promise<ResetPasswordResult> {
  return api<ResetPasswordResult>(`/api/v1/members/${userId}/reset-password`, {
    method: "POST",
  });
}

// Desativa (soft). O backend barra desativar a si mesmo. A volta é `reactivateMember`.
export async function deactivateMember(userId: string): Promise<Member> {
  const r = await api<Member>(`/api/v1/members/${userId}/deactivate`, {
    method: "POST",
  });
  invalidateMembers();
  return r;
}

// Reativa. A senha não muda; as sessões de antes não voltam.
export async function reactivateMember(userId: string): Promise<Member> {
  const r = await api<Member>(`/api/v1/members/${userId}/reactivate`, {
    method: "POST",
  });
  invalidateMembers();
  return r;
}

// ---- Responsáveis. Rotas idempotentes; todas devolvem a lista atual de user_ids da task.

export type CollaboratorList = { task_id: string; user_ids: string[] };

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

// 404 se o par não existia; a tela trata como "já removido".
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

// ---- Seguidores (`watchers` no backend). Toda rota devolve a lista atual de ids, na ordem de chegada.

export async function listWatchers(taskId: string): Promise<string[]> {
  const res = await api<CollaboratorList>(`/api/v1/tasks/${taskId}/watchers`);
  return res.user_ids;
}

/**
 * Põe alguém para seguir; sem `userId` = a própria pessoa.
 * Recusas: 403 (outra pessoa sem permissão), 422 `tarefa_arquivada` ou 422 de alcance.
 */
export async function addWatcher(
  taskId: string,
  userId?: string
): Promise<string[]> {
  const res = await api<CollaboratorList>(`/api/v1/tasks/${taskId}/watchers`, {
    method: "POST",
    body: userId ? { user_id: userId } : {},
  });
  return res.user_ids;
}

export async function removeWatcher(
  taskId: string,
  userId: string
): Promise<string[]> {
  const res = await api<CollaboratorList>(
    `/api/v1/tasks/${taskId}/watchers/${userId}`,
    { method: "DELETE" }
  );
  return res.user_ids;
}

// ---- Subtarefas. Não manda team_id (herda do pai); manda o project_id do pai (o backend exige o mesmo projeto).
/** Um evento do histórico da tarefa, cru; quem vira frase é `lib/historicoDaTarefa.ts`. */
export type TaskHistoryEvent = {
  id: string;
  event_type: string;
  field_name: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  event_metadata: Record<string, unknown> | null;
  user_id: string;
  created_at: string;
};

export type TaskHistoryPage = {
  items: TaskHistoryEvent[];
  total: number;
  page: number;
  size: number;
};

// Historico da tarefa, mais NOVO primeiro. 404 para quem nao ve a tarefa --
// a mesma regra dos comentarios.
export async function listTaskHistory(
  taskId: string,
  params: { page?: number; size?: number } = {}
): Promise<TaskHistoryPage> {
  const q = new URLSearchParams({
    page: String(params.page ?? 1),
    size: String(params.size ?? 20),
  });
  return api<TaskHistoryPage>(`/api/v1/tasks/${taskId}/history?${q.toString()}`);
}

export async function createSubtask(
  parentTaskId: string,
  title: string,
  parentProjectId: string | null,
  extras: { assigneeIds?: string[]; dueDate?: string | null } = {}
): Promise<Task> {
  return api<Task>("/api/v1/tasks", {
    method: "POST",
    body: {
      title,
      parent_task_id: parentTaskId,
      ...(parentProjectId ? { project_id: parentProjectId } : {}),
      ...(extras.assigneeIds?.length
        ? { assignee_ids: extras.assigneeIds }
        : {}),
      ...(extras.dueDate ? { due_date: extras.dueDate } : {}),
    },
  });
}

// Arquivar/desarquivar (exige task.update; idempotente). Leva a subárvore inteira junto.
// `cascade_count > 0` = o estado local está desatualizado: recarregar, não só fazer upsert.
export type ArchiveResult = Task & { cascade_count: number };

export async function archiveTask(id: string): Promise<ArchiveResult> {
  return api<ArchiveResult>(`/api/v1/tasks/${id}/archive`, { method: "POST" });
}
export async function unarchiveTask(id: string): Promise<ArchiveResult> {
  return api<ArchiveResult>(`/api/v1/tasks/${id}/unarchive`, {
    method: "POST",
  });
}

// ---- Arquivadas: paginação de verdade (o conjunto cresce sem fim).
/** As arquivadas recortadas pelo time ativo; `null` = sem recorte. */
export async function listArchivedTasks(params: {
  teamId: string | null;
  page?: number;
  size?: number;
}): Promise<TaskListResponse> {
  return listTasks({
    page: params.page ?? 1,
    size: params.size ?? 30,
    archived_only: true,
    underTeamId: params.teamId,
  });
}

// Reativar = voltar pra BACKLOG e depois desarquivar. A ordem importa: se o unarchive falhar,
// BACKLOG+arquivada não é re-arquivada pela varredura.
export async function reactivateTask(id: string): Promise<Task> {
  await updateTask(id, { status: "BACKLOG" });
  return unarchiveTask(id);
}

// Soft-delete em cascata (task, subárvore e comentários). `cascade_count` = filhas apagadas junto.
export type DeleteTaskResult = Task & { cascade_count: number };

export async function deleteTask(id: string): Promise<DeleteTaskResult> {
  return api<DeleteTaskResult>(`/api/v1/tasks/${id}`, { method: "DELETE" });
}

// ---- Projetos: pasta de tasks, pertence a um time. Designar é só nas tasks.
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
  // O backend ainda manda `is_archived`; a tela não o lê.
  team_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  // Botões do projeto, calculados pelo servidor no time do projeto. Obrigatórios.
  can_update: boolean;
  can_delete: boolean;
};

// ---- Links com nome (projeto e tarefa).

/** Um link salvo: o nome que aparece e o endereço. */
export type LinkItem = { id: string; title: string; url: string };

/**
 * Evento de `window` quando os links de um item mudam (`detail` = `{ dono, id }`).
 * Salvar links não muda a tarefa: sem o aviso o detalhe aberto ficaria com a lista antiga.
 */
export const LINKS_MUDARAM = "links:mudaram";

function avisarLinks(dono: "task" | "project", id: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LINKS_MUDARAM, { detail: { dono, id } }));
  }
}

export async function getTaskLinks(taskId: string): Promise<LinkItem[]> {
  return api<LinkItem[]>(`/api/v1/tasks/${taskId}/links`);
}

/** Substitui a lista INTEIRA de links da tarefa, na ordem dada. */
export async function putTaskLinks(
  taskId: string,
  links: { title: string; url: string }[],
): Promise<LinkItem[]> {
  const r = await api<LinkItem[]>(`/api/v1/tasks/${taskId}/links`, {
    method: "PUT",
    body: { links },
  });
  avisarLinks("task", taskId);
  return r;
}

export async function getProjectLinks(projectId: string): Promise<LinkItem[]> {
  return api<LinkItem[]>(`/api/v1/projects/${projectId}/links`);
}

/** Substitui a lista INTEIRA de links do projeto, na ordem dada. */
export async function putProjectLinks(
  projectId: string,
  links: { title: string; url: string }[],
): Promise<LinkItem[]> {
  const r = await api<LinkItem[]>(`/api/v1/projects/${projectId}/links`, {
    method: "PUT",
    body: { links },
  });
  avisarLinks("project", projectId);
  return r;
}

export type ProjectListResponse = {
  items: Project[];
  total: number;
  page: number;
  size: number;
};

// Lista projetos do workspace (paginado). `teamId` obrigatório; `null` é uma resposta, não default:
// para ESCOLHER (seletor) manda o time; para ROTULAR (mapa id -> título) manda `null`.
export async function listProjects(
  params: {
    teamId: string | null;
    page?: number;
    size?: number;
    status?: ProjectStatus;
  }
): Promise<ProjectListResponse> {
  const q = new URLSearchParams();
  q.set("page", String(params.page ?? 1));
  q.set("size", String(params.size ?? 100));
  if (params.status) q.set("status", params.status);
  if (params.teamId) q.set("team_id", params.teamId);
  return api<ProjectListResponse>(`/api/v1/projects?${q.toString()}`);
}

// Versão completa (anti-teto), para o mapa id->título do selo de projeto.
export async function listAllProjects(
  params: {
    teamId: string | null;
    status?: ProjectStatus;
  }
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
  team_id?: string; // omitido -> resolve o time raiz
};

// Cria projeto. Sem team_id usa o único time raiz.
export async function createProject(input: ProjectCreateInput): Promise<Project> {
  const team_id = input.team_id ?? (await getRootTeamId());
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

/** Apaga um projeto (soft delete). Não toca nas tarefas: elas só perdem a tag do projeto na tela. */
export async function deleteProject(id: string): Promise<Project> {
  return api<Project>(`/api/v1/projects/${id}`, { method: "DELETE" });
}


// ---- Usuário logado, memoizado; limpa no clearTokens. O AppShell usa getMe() direto (revalida a sessão).
let _me: CurrentUser | undefined; // undefined = ainda nao buscado

export async function currentUser(): Promise<CurrentUser> {
  if (_me !== undefined) return _me;
  _me = await getMe();
  return _me;
}

/** Evento de `window` quando o próprio nome muda (`detail` = nome novo), para a barra lateral. */
export const NOME_MUDOU = "me:nome-mudou";

/**
 * Troca o próprio nome (o servidor pega o alvo do token).
 * Acerta os três lugares que mostram o nome: `_me`, a lista de membros e a barra (pelo evento).
 */
export async function renameSelf(name: string): Promise<string> {
  const r = await api<{ name: string }>("/api/v1/auth/me", {
    method: "PATCH",
    body: { name },
  });
  if (_me !== undefined) _me = { ..._me, name: r.name };
  invalidateMembers();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(NOME_MUDOU, { detail: r.name }));
  }
  return r.name;
}

// ---- Comentários: thread por task, 1 nível de réplica. 404 se não vê a task.
// is_deleted=true => tombstone (conteúdo mascarado); edited_at != null => editado.

export type Comment = {
  id: string;
  task_id: string;
  user_id: string;
  parent_comment_id: string | null;
  content: string;
  edited_at: string | null;
  created_at: string;
  is_deleted: boolean;
  /** Reações na ordem de chegada de cada emoji; vazia em comentário apagado. `user_ids` porque a tela mostra quem reagiu. */
  reactions: { emoji: string; user_ids: string[] }[];
};

export type CommentList = {
  items: Comment[];
  total: number;
  page: number;
  size: number;
};

// Thread da task, mais antigo primeiro.
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

// parentCommentId só em réplica; 1 nível validado no backend (422).
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

// ---- Reações no comentário. `PUT` idempotente (trocar = pôr); devolve o comentário inteiro.
// Emoji inválido é 422 do servidor; a tela só oferece o catálogo gerado.
export async function setCommentReaction(
  taskId: string,
  commentId: string,
  emoji: string
): Promise<Comment> {
  return api<Comment>(
    `/api/v1/tasks/${taskId}/comments/${commentId}/reaction`,
    { method: "PUT", body: { emoji } }
  );
}

// Tirar o que nao existe tambem e 200 -- o duplo clique nao vira erro.
export async function deleteCommentReaction(
  taskId: string,
  commentId: string
): Promise<Comment> {
  return api<Comment>(
    `/api/v1/tasks/${taskId}/comments/${commentId}/reaction`,
    { method: "DELETE" }
  );
}

// ---- Notificações in-app, escopadas pelo backend ao usuário logado. Sem cache.
// `AppNotification`, não `Notification`: esse é um tipo global do DOM.

export type NotificationType =
  | "TASK_ASSIGNED"
  | "TASK_COMMENTED"
  | "TASK_MENTIONED"
  // Reagiram ao comentário da pessoa.
  | "TASK_COMMENT_REACTED"
  // Responderam ao comentário da pessoa.
  | "TASK_COMMENT_REPLIED"
  | "TASK_DUE_SOON"
  | "TASK_OVERDUE"
  | "ACCESS_LOST"
  // Outra pessoa colocou ou tirou quem recebe como seguidor.
  | "TASK_WATCH_ADDED"
  | "TASK_WATCH_REMOVED"
  // Mudanças na tarefa, para quem segue, é responsável ou criou; avisos seguidos do mesmo autor se juntam.
  | "TASK_COLUMN_CHANGED"
  | "TASK_DUE_CHANGED"
  | "TASK_DESCRIPTION_CHANGED"
  | "TASK_ARCHIVED"
  | "TASK_UNARCHIVED"
  | "TASK_DELETED";

/** O prazo como vem no payload de `TASK_DUE_CHANGED`. `time` = "HH:MM" ou null. */
export type PrazoDoAviso = { date: string; time: string | null };

export type AppNotification = {
  id: string;
  type: NotificationType;
  actor_id: string | null;
  task_id: string | null;
  comment_id: string | null;
  // `emoji` só em TASK_COMMENT_REACTED; `due_date` (YYYY-MM-DD) nos avisos de prazo; `quantidade` no ACCESS_LOST.
  payload: {
    actor_name?: string;
    task_title?: string;
    emoji?: string;
    due_date?: string;
    quantidade?: number;
    // Colunas vão pelo nome: o aviso é retrato do momento.
    from_column?: string | null;
    to_column?: string | null;
    from_due?: PrazoDoAviso | null;
    to_due?: PrazoDoAviso | null;
  } | null;
  read_at: string | null; // null = nao lida
  created_at: string;
  // A última mudança (difere de `created_at` quando avisos se juntaram); é o horário que a tela mostra.
  updated_at?: string;
  /** "ok" = a tarefa existe e quem lê a alcança; "gone" = excluída ou fora do alcance (sem `task_title`); null = aviso sem tarefa. */
  task_access?: "ok" | "gone" | null;
};

export type NotificationListResponse = {
  items: AppNotification[];
  total: number;
  page: number;
  size: number;
};

/** Filtros da tela de notificações; os mesmos vão para a listagem e para o "marcar estas como lidas". */
export type FiltroDeNotificacoes = {
  types?: readonly string[];
  task_id?: string | null;
  project_id?: string | null;
  /** A aba "Silenciadas"; ausente/`false` esconde as silenciadas. Fica no filtro porque o "marcar todas" usa o mesmo objeto. */
  muted?: boolean;
};

function aplicarFiltro(q: URLSearchParams, f: FiltroDeNotificacoes): void {
  for (const t of f.types ?? []) q.append("type", t);
  if (f.task_id) q.set("task_id", f.task_id);
  if (f.project_id) q.set("project_id", f.project_id);
  if (f.muted) q.set("muted", "true");
}

// Feed paginado, ultima mudanca primeiro.
export async function listNotifications(
  params: {
    unread_only?: boolean;
    page?: number;
    size?: number;
  } & FiltroDeNotificacoes = {}
): Promise<NotificationListResponse> {
  const q = new URLSearchParams();
  if (params.unread_only) q.set("unread_only", "true");
  q.set("page", String(params.page ?? 1));
  q.set("size", String(params.size ?? 20));
  aplicarFiltro(q, params);
  return api<NotificationListResponse>(`/api/v1/notifications?${q.toString()}`);
}

// Contagem de não-lidas (o que o sino polla). O padrão não conta silenciadas; `muted` conta as da aba.
export async function getUnreadCount(muted = false): Promise<number> {
  const qs = muted ? "?muted=true" : "";
  const r = await api<{ count: number }>(`/api/v1/notifications/unread-count${qs}`);
  return r.count;
}

// Marca UMA como lida. 204 sem corpo. 404 se nao for sua.
export async function markNotificationRead(id: string): Promise<void> {
  await api<void>(`/api/v1/notifications/${id}/read`, { method: "POST" });
}

// Marca as não-lidas como lidas (todas, ou só as do filtro). Retorna quantas.
export async function markAllNotificationsRead(
  filtro: FiltroDeNotificacoes = {}
): Promise<number> {
  const q = new URLSearchParams();
  aplicarFiltro(q, filtro);
  const qs = q.toString();
  const r = await api<{ updated: number }>(
    `/api/v1/notifications/read-all${qs ? `?${qs}` : ""}`,
    { method: "POST" }
  );
  return r.updated;
}

/** Um toggle da tela de preferências. */
export type NotificationToggle = {
  type_group: string;
  role: string;
  enabled: boolean;
  /** Travado: sempre ligado, e o PUT recusa 422. */
  locked: boolean;
};

export async function listNotificationPreferences(): Promise<NotificationToggle[]> {
  const r = await api<{ items: NotificationToggle[] }>(
    "/api/v1/me/notification-preferences"
  );
  return r.items;
}

// Liga ou desliga UM toggle. Devolve a lista INTEIRA -- os grupos que governam
// dois tipos mudam junto, e a tela nao precisa adivinhar o que o servidor fez.
export async function setNotificationPreference(pref: {
  type_group: string;
  role: string;
  enabled: boolean;
}): Promise<NotificationToggle[]> {
  const r = await api<{ items: NotificationToggle[] }>(
    "/api/v1/me/notification-preferences",
    { method: "PUT", body: pref }
  );
  return r.items;
}

/** Uma sugestão do campo "Tarefa ou projeto". */
export type AlvoDeNotificacao = {
  kind: "task" | "project";
  id: string;
  title: string;
};

export async function listNotificationTargets(
  termo: string
): Promise<AlvoDeNotificacao[]> {
  const q = new URLSearchParams({ q: termo });
  const r = await api<{ items: AlvoDeNotificacao[] }>(
    `/api/v1/notifications/targets?${q.toString()}`
  );
  return r.items;
}

// ---------------------------------------------------------------
// SOLICITAÇÕES (formulário público FazAê + fila de triagem)
// ---------------------------------------------------------------

/** IN_PROGRESS e DONE são andamento, não segunda triagem: não reescrevem quem aprovou nem quando. */
export type SolicitacaoStatus =
  | "PENDING"
  | "APPROVED"
  | "IN_PROGRESS"
  | "DONE"
  | "REJECTED";

/** Os estados de um pedido ACEITO -- e entre eles se anda nos dois sentidos. */
export const STATUS_ACEITOS: SolicitacaoStatus[] = [
  "APPROVED",
  "IN_PROGRESS",
  "DONE",
];

export type SolicitacaoAnswer = { label: string; value: string };

/** Detalhe de uma solicitação (`SolicitationResponse`); retorno de aprovar/rejeitar/marcar tarefa. */
export type Solicitacao = {
  id: string;
  batch_id: string;
  batch_seq: number;
  batch_total: number;
  requester_name: string;
  requester_email: string;
  /** Opcionais: `null` = o formulário não perguntou; "" = perguntou e ficou em branco. */
  requester_phone: string | null;
  requester_department: string | null;
  requester_polo: string | null;
  category: string;
  summary: string;
  answers: SolicitacaoAnswer[];
  status: SolicitacaoStatus;
  review_note: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  task_created_at: string | null;
  task_ref: string | null;
  created_at: string;
};

export type SolicitacaoItemEnvio = {
  category: string;
  summary: string;
  answers: SolicitacaoAnswer[];
};

// ---- Gestão dos formulários: permissão própria (`solicitation_form.manage`), distinta de `solicitation.review`.

export type Formulario = {
  id: string;
  team_id: string;
  slug: string;
  title: string;
  description: string;
  is_published: boolean;
  /** `null` = o formulário não pergunta este campo. */
  phone_label: string | null;
  department_label: string | null;
  polo_label: string | null;
};

/** Os formulários de um time. `teamId` obrigatório, `null` é resposta: daqui se abre o editor, e editar formulário de outro time muda a porta pública dele. */
export async function listarFormularios(
  teamId: string | null
): Promise<Formulario[]> {
  const q = new URLSearchParams();
  if (teamId) q.set("team_id", teamId);
  const qs = q.toString();
  return api<Formulario[]>(
    `/api/v1/solicitacoes/formularios${qs ? `?${qs}` : ""}`
  );
}

/** Nasce despublicado (decisão do backend): publicado vazio seria uma porta que não pergunta nada. */
export async function criarFormulario(input: {
  team_id: string;
  slug: string;
  title: string;
  description?: string;
}): Promise<Formulario> {
  return api<Formulario>("/api/v1/solicitacoes/formularios", {
    method: "POST",
    body: {
      team_id: input.team_id,
      slug: input.slug,
      title: input.title,
      description: input.description ?? "",
    },
  });
}

/** `team_id` não entra: mudar o time muda quem tria. O backend recusa o campo. */
/** Nos três rótulos, `null` = desligar o campo (nos outros, omitir = não mexer). Só envie quando for mudá-los. */
export async function renomearFormulario(
  id: string,
  patch: {
    title?: string;
    description?: string;
    slug?: string;
    phone_label?: string | null;
    department_label?: string | null;
    polo_label?: string | null;
  }
): Promise<Formulario> {
  return api<Formulario>(`/api/v1/solicitacoes/formularios/${id}`, {
    method: "PATCH",
    body: patch,
  });
}

export async function publicarFormulario(
  id: string,
  publicado: boolean
): Promise<Formulario> {
  return api<Formulario>(`/api/v1/solicitacoes/formularios/${id}/publicar`, {
    method: "POST",
    body: { publicado },
  });
}

export async function apagarFormulario(id: string): Promise<void> {
  await api<void>(`/api/v1/solicitacoes/formularios/${id}`, {
    method: "DELETE",
  });
}

// ---- O editor: seções e perguntas.

export type PerguntaDoEditor = {
  id: string;
  section_id: string;
  label: string;
  kind: string;
  required: boolean;
  options: string[];
  placeholder: string | null;
  help: string | null;
  show_if_question_id: string | null;
  show_if_value: string | null;
  position: number;
};

export type SecaoDoEditor = {
  id: string;
  slug: string;
  title: string;
  emoji: string;
  sla_text: string | null;
  summary_question_id: string | null;
  position: number;
  /** Seção repetível e o nome de cada repetição. */
  repeatable?: boolean;
  repeat_label?: string | null;
  questions: PerguntaDoEditor[];
};

export type FormularioDetalhado = Formulario & {
  sections: SecaoDoEditor[];
};

export async function obterFormulario(
  id: string
): Promise<FormularioDetalhado> {
  return api<FormularioDetalhado>(`/api/v1/solicitacoes/formularios/${id}`);
}

export async function criarSecao(
  formId: string,
  input: { slug: string; title: string; emoji?: string; sla_text?: string | null }
): Promise<SecaoDoEditor> {
  return api<SecaoDoEditor>(
    `/api/v1/solicitacoes/formularios/${formId}/secoes`,
    { method: "POST", body: input }
  );
}

/**
 * Não aceita `slug`: ele está gravado em cada pedido e é como a fila acha a categoria.
 * Título e emoji mudam à vontade porque a fila os resolve pelo slug.
 */
export async function editarSecao(
  sectionId: string,
  patch: {
    title?: string;
    emoji?: string;
    sla_text?: string | null;
    repeatable?: boolean;
    repeat_label?: string;
  }
): Promise<SecaoDoEditor> {
  return api<SecaoDoEditor>(`/api/v1/solicitacoes/secoes/${sectionId}`, {
    method: "PATCH",
    body: patch,
  });
}

export async function apagarSecao(sectionId: string): Promise<void> {
  await api<void>(`/api/v1/solicitacoes/secoes/${sectionId}`, {
    method: "DELETE",
  });
}

/** `question_id: null` volta ao padrao (o front usa o primeiro campo). */
export async function definirResumo(
  sectionId: string,
  questionId: string | null
): Promise<SecaoDoEditor> {
  return api<SecaoDoEditor>(
    `/api/v1/solicitacoes/secoes/${sectionId}/resumo`,
    { method: "POST", body: { question_id: questionId } }
  );
}

export async function criarPergunta(
  sectionId: string,
  input: {
    label: string;
    kind: string;
    required?: boolean;
    options?: string[];
    placeholder?: string | null;
    help?: string | null;
  }
): Promise<PerguntaDoEditor> {
  return api<PerguntaDoEditor>(
    `/api/v1/solicitacoes/secoes/${sectionId}/perguntas`,
    { method: "POST", body: input }
  );
}

/** `options` omitido = não mexe (não esvazia). */
export async function editarPergunta(
  questionId: string,
  patch: {
    label?: string;
    kind?: string;
    required?: boolean;
    options?: string[];
    placeholder?: string | null;
    help?: string | null;
  }
): Promise<PerguntaDoEditor> {
  return api<PerguntaDoEditor>(`/api/v1/solicitacoes/perguntas/${questionId}`, {
    method: "PATCH",
    body: patch,
  });
}

/** Rota própria: desligar é mandar `null`, que num PATCH se confundiria com "não mexe". */
export async function definirCondicional(
  questionId: string,
  alvoId: string | null,
  valor: string | null
): Promise<PerguntaDoEditor> {
  return api<PerguntaDoEditor>(
    `/api/v1/solicitacoes/perguntas/${questionId}/condicional`,
    { method: "POST", body: { alvo_id: alvoId, valor } }
  );
}

export async function apagarPergunta(questionId: string): Promise<void> {
  await api<void>(`/api/v1/solicitacoes/perguntas/${questionId}`, {
    method: "DELETE",
  });
}

/** As duas mandam o conjunto inteiro; o backend recusa lista parcial. */
export async function reordenarSecoes(
  formId: string,
  ids: string[]
): Promise<SecaoDoEditor[]> {
  return api<SecaoDoEditor[]>(
    `/api/v1/solicitacoes/formularios/${formId}/secoes/ordem`,
    { method: "POST", body: { ids } }
  );
}

export async function reordenarPerguntas(
  sectionId: string,
  ids: string[]
): Promise<PerguntaDoEditor[]> {
  return api<PerguntaDoEditor[]>(
    `/api/v1/solicitacoes/secoes/${sectionId}/perguntas/ordem`,
    { method: "POST", body: { ids } }
  );
}

// ---- O formulário público, lido do banco. `auth: false`: quem preenche não tem login.

export type PerguntaPublica = {
  id: string;
  label: string;
  kind: string;
  required: boolean;
  options: string[];
  placeholder: string | null;
  help: string | null;
  /** O id da outra pergunta (ver `lib/formularioDoBanco.ts`). */
  show_if_question_id: string | null;
  show_if_value: string | null;
};

export type SecaoPublica = {
  slug: string;
  title: string;
  emoji: string;
  sla_text: string | null;
  summary_question_id: string | null;
  /** A pessoa preenche a seção mais de uma vez no envio. */
  repeatable?: boolean;
  repeat_label?: string | null;
  questions: PerguntaPublica[];
};

export type FormularioPublico = {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** Rótulos da identificação; `null` = não pergunta. Nome e e-mail não são configuráveis. */
  phone_label: string | null;
  department_label: string | null;
  polo_label: string | null;
  sections: SecaoPublica[];
};

export type FormularioPublicoResumo = {
  slug: string;
  title: string;
  description: string;
  team_name: string;
};

/** Os formularios publicados do workspace. Lista vazia = nao ha nenhum. */
export async function listarFormulariosPublicos(): Promise<
  FormularioPublicoResumo[]
> {
  return api<FormularioPublicoResumo[]>(
    `/api/v1/solicitacoes/publico/formularios?workspace=${encodeURIComponent(
      WORKSPACE_SLUG
    )}`,
    { auth: false }
  );
}

/** Um formulário publicado, pelo slug. 404 cobre não existe/despublicado/apagado/outro workspace (não enumera slugs). */
export async function obterFormularioPublico(
  slug: string
): Promise<FormularioPublico> {
  return api<FormularioPublico>(
    `/api/v1/solicitacoes/publico/formularios/${encodeURIComponent(
      slug
    )}?workspace=${encodeURIComponent(WORKSPACE_SLUG)}`,
    { auth: false }
  );
}

// Pública (sem auth). Um POST por envio (o rate limit é por IP); `items` na ordem de seleção.
// `website` é o honeypot anti-bot: sempre vazio.
export async function enviarSolicitacaoPublica(payload: {
  /**
   * De qual formulário veio. Opcional no tipo (aba aberta durante deploy), mas a tela sempre manda:
   * sem ele a solicitação cai na fila do workspace inteiro.
   */
  form_id?: string;
  requester_name: string;
  requester_email: string;
  /** Opcionais: `null` = o formulário não perguntou; "" = perguntou e ficou em branco. */
  requester_phone: string | null;
  requester_department: string | null;
  requester_polo: string | null;
  items: SolicitacaoItemEnvio[];
  website?: string;
}): Promise<{ protocol: string; created: number }> {
  return api<{ protocol: string; created: number }>(
    "/api/v1/solicitacoes/publico",
    {
      method: "POST",
      auth: false,
      body: { workspace_slug: WORKSPACE_SLUG, website: "", ...payload },
    }
  );
}

// ---- Fila agrupada por ENVIO (visão principal da triagem) ----

export type SolicitacaoFiltro =
  | SolicitacaoStatus
  | "ACTIVE" // aprovada ou em andamento
  | "SEM_TAREFA"; // aprovadas que ninguém virou tarefa

/** As abas da fila; `WITHOUT_TASK` é o "só sem tarefa". */
export type FilaAba = "PENDING" | "ACTIVE" | "DONE" | "REJECTED" | "ALL" | "WITHOUT_TASK";

export type BatchItem = {
  id: string;
  batch_seq: number;
  /** O slug gravado no pedido: é a chave, não a etiqueta. */
  category: string;
  /**
   * Como a categoria se apresenta, resolvido pelo backend na hora (renomear seção arruma o passado).
   * `null` é legítimo (seção apagada): quem desenha cai no `category` cru.
   */
  category_title: string | null;
  category_emoji: string | null;
  category_sla: string | null;
  summary: string;
  status: SolicitacaoStatus;
  answers: SolicitacaoAnswer[];
  review_note: string | null;
  reviewed_at: string | null;
  task_created_at: string | null;
  /** Legado: texto livre das marcações antigas. Ver `task_id`. */
  task_ref: string | null;
  /** A tarefa vinculada. `task_title` vem `null` quando ela foi apagada. */
  task_id: string | null;
  task_title: string | null;
};

export type Batch = {
  batch_id: string;
  protocol: string;
  requester_name: string;
  requester_email: string;
  /** Opcionais: `null` = o formulário não perguntou; "" = perguntou e ficou em branco. */
  requester_phone: string | null;
  requester_department: string | null;
  requester_polo: string | null;
  created_at: string;
  /** Por qual formulário o envio entrou; `null` = pedido de antes de existir formulário por time. */
  form_id?: string | null;
  form_title?: string | null;
  items: BatchItem[];
};

export type BatchListResponse = {
  items: Batch[];
  total: number; // total de ENVIOS, não de demandas
  page: number;
  size: number;
  pending_total: number;
  approved_without_task_total: number;
  /** Os números das abas, em demandas, com a mesma busca e formulário. */
  tab_totals?: Partial<Record<FilaAba, number>>;
  /** Os formulários que têm pedido nesta fila -- as opções do filtro. */
  form_options?: { id: string; title: string }[];
};

/**
 * Fila de triagem: um card por envio. `teamId` obrigatório, `null` é resposta.
 * Os badges vêm no mesmo payload, contados com o mesmo `team_id`.
 */
export async function listarEnvios(
  params: {
    teamId: string | null;
    filtro?: SolicitacaoFiltro;
    page?: number;
    size?: number;
    /** Nome, e-mail ou protocolo. */
    busca?: string;
    formId?: string | null;
    /** Só demandas aceitas que ainda não viraram tarefa. */
    semTarefa?: boolean;
  }
): Promise<BatchListResponse> {
  const q = new URLSearchParams();
  if (params.filtro) q.set("status", params.filtro);
  if (params.busca?.trim()) q.set("q", params.busca.trim());
  if (params.formId) q.set("form_id", params.formId);
  if (params.semTarefa) q.set("without_task", "true");
  q.set("page", String(params.page ?? 1));
  q.set("size", String(params.size ?? 20));
  if (params.teamId) q.set("team_id", params.teamId);
  return api<BatchListResponse>(`/api/v1/solicitacoes?${q.toString()}`);
}

/** Marca/desmarca "tarefa criada" numa solicitação APROVADA. */
/** Cria a tarefa a partir do pedido e já a vincula. Sem `assignee_ids`, quem clica vira responsável. */
export async function criarTarefaDaSolicitacao(
  id: string,
  board_id?: string | null
): Promise<{ task_id: string; task_title: string }> {
  return api<{ task_id: string; task_title: string }>(
    `/api/v1/solicitacoes/${id}/criar-tarefa`,
    { method: "POST", body: { board_id: board_id ?? null } }
  );
}

export async function marcarTarefaCriada(
  id: string,
  created: boolean,
  taskRef?: string
): Promise<Solicitacao> {
  return api<Solicitacao>(`/api/v1/solicitacoes/${id}/tarefa`, {
    method: "POST",
    body: { created, task_ref: taskRef ?? null },
  });
}

/**
 * Move um pedido aceito entre aprovada, em andamento e concluída. Rota separada de `/aprovar`,
 * que reescreveria quem decidiu e quando.
 */
export async function andarSolicitacao(
  id: string,
  status: SolicitacaoStatus
): Promise<Solicitacao> {
  return api<Solicitacao>(`/api/v1/solicitacoes/${id}/andamento`, {
    method: "POST",
    body: { status },
  });
}

export async function aprovarSolicitacao(
  id: string,
  note?: string
): Promise<Solicitacao> {
  return api<Solicitacao>(`/api/v1/solicitacoes/${id}/aprovar`, {
    method: "POST",
    body: { note: note ?? null },
  });
}

export async function rejeitarSolicitacao(
  id: string,
  note: string
): Promise<Solicitacao> {
  return api<Solicitacao>(`/api/v1/solicitacoes/${id}/rejeitar`, {
    method: "POST",
    body: { note },
  });
}

// ---- Base. Os botões vêm do servidor, por base (`can_*`); a tela nunca deduz de papel. Sem cache de módulo.

export type BaseColumnType =
  | "title"
  | "text"
  | "number"
  | "date"
  | "select"
  | "multi_select"
  | "person"
  | "link"
  | "checkbox";

export type BaseOptionColor =
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red";

export type BaseOption = { id: string; label: string; color: BaseOptionColor };

export type BaseColumn = {
  id: string;
  name: string;
  type: BaseColumnType;
  options: BaseOption[];
  position: number;
  width: number | null;
  version: number;
};

export type BaseView = {
  id: string;
  name: string;
  layout: "table" | "calendar" | "board";
  config: Record<string, unknown>;
  position: number;
  is_default: boolean;
};

export type BaseSummary = {
  id: string;
  team_id: string;
  name: string;
  updated_at: string;
  can_update: boolean;
  can_delete: boolean;
};

export type BaseDetail = BaseSummary & {
  description: string;
  created_by: string;
  created_at: string;
  columns: BaseColumn[];
  views: BaseView[];
  can_create_column: boolean;
  can_update_column: boolean;
  can_delete_column: boolean;
  can_create_row: boolean;
  can_update_row: boolean;
  can_delete_row: boolean;
  can_create_view: boolean;
  can_update_view: boolean;
  can_delete_view: boolean;
};

/** Valor de célula como o servidor guarda. Ausente = vazia. */
/** Célula de link: lista, cada um com nome opcional. Células antigas podem ter texto solto: leia por `linksDaCelula`. */
export type BaseLinkValue = { title: string; url: string };
export type BaseCellValue = string | number | boolean | string[] | BaseLinkValue[];

export type BaseRow = {
  id: string;
  values: Record<string, BaseCellValue>;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type BaseRowList = {
  items: BaseRow[];
  total: number;
  limit: number;
  warning_at: number;
};

export type BaseTrashItem = {
  id: string;
  team_id: string;
  name: string;
  deleted_at: string;
  deleted_by: string | null;
  restorable_until: string;
  can_restore: boolean;
};

export type BaseOptionInput = { id?: string; label: string; color?: BaseOptionColor };

export async function listBases(): Promise<BaseSummary[]> {
  return api<BaseSummary[]>("/api/v1/bases");
}

export async function listBaseTrash(): Promise<BaseTrashItem[]> {
  return api<BaseTrashItem[]>("/api/v1/bases/trash");
}

export async function createBase(body: {
  name: string;
  team_id: string;
  description?: string;
}): Promise<BaseDetail> {
  return api<BaseDetail>("/api/v1/bases", { method: "POST", body });
}

export async function getBase(id: string): Promise<BaseDetail> {
  return api<BaseDetail>(`/api/v1/bases/${id}`);
}

export async function updateBase(
  id: string,
  body: { name?: string; description?: string }
): Promise<BaseDetail> {
  return api<BaseDetail>(`/api/v1/bases/${id}`, { method: "PATCH", body });
}

export async function deleteBase(id: string): Promise<BaseSummary> {
  return api<BaseSummary>(`/api/v1/bases/${id}`, { method: "DELETE" });
}

export async function restoreBase(id: string): Promise<BaseDetail> {
  return api<BaseDetail>(`/api/v1/bases/${id}/restore`, { method: "POST" });
}

export async function createBaseColumn(
  baseId: string,
  body: {
    name: string;
    type: BaseColumnType;
    options?: BaseOptionInput[];
    /** "Inserir à esquerda/direita"; ausente = no fim. */
    position?: number;
  }
): Promise<BaseColumn> {
  return api<BaseColumn>(`/api/v1/bases/${baseId}/columns`, { method: "POST", body });
}

/** "Duplicar propriedade": nome, tipo, opções e valores, à direita. */
export async function duplicateBaseColumn(baseId: string, columnId: string): Promise<BaseColumn> {
  return api<BaseColumn>(`/api/v1/bases/${baseId}/columns/${columnId}/duplicate`, {
    method: "POST",
  });
}

/** A coluna de texto vira a principal (título dos cards) e a de antes vira texto; os valores não mudam. */
export async function makeBaseColumnTitle(baseId: string, columnId: string): Promise<BaseColumn> {
  return api<BaseColumn>(`/api/v1/bases/${baseId}/columns/${columnId}/make-title`, {
    method: "POST",
  });
}

export async function updateBaseColumn(
  baseId: string,
  columnId: string,
  body: {
    name?: string;
    type?: BaseColumnType;
    options?: BaseOptionInput[];
    position?: number;
    width?: number | null;
  }
): Promise<BaseColumn> {
  return api<BaseColumn>(`/api/v1/bases/${baseId}/columns/${columnId}`, {
    method: "PATCH",
    body,
  });
}

export async function deleteBaseColumn(baseId: string, columnId: string): Promise<BaseColumn> {
  return api<BaseColumn>(`/api/v1/bases/${baseId}/columns/${columnId}`, {
    method: "DELETE",
  });
}

export async function deleteBaseOption(
  baseId: string,
  columnId: string,
  optionId: string
): Promise<BaseColumn> {
  return api<BaseColumn>(
    `/api/v1/bases/${baseId}/columns/${columnId}/options/${optionId}`,
    { method: "DELETE" }
  );
}

export async function listBaseRows(baseId: string): Promise<BaseRowList> {
  return api<BaseRowList>(`/api/v1/bases/${baseId}/rows`);
}

export async function createBaseRow(
  baseId: string,
  values: Record<string, BaseCellValue | null> = {}
): Promise<BaseRow> {
  return api<BaseRow>(`/api/v1/bases/${baseId}/rows`, { method: "POST", body: { values } });
}

/** Várias linhas numa ação só (colar além da última linha). */
export async function createBaseRows(
  baseId: string,
  rows: Record<string, BaseCellValue | null>[]
): Promise<BaseRow[]> {
  return api<BaseRow[]>(`/api/v1/bases/${baseId}/rows/batch`, {
    method: "POST",
    body: { rows: rows.map((values) => ({ values })) },
  });
}

/** Uma ou mais células como UMA ação -- um Ctrl+Z desfaz o grupo. `null` esvazia. */
export async function updateBaseCells(
  baseId: string,
  cells: { row_id: string; column_id: string; value: BaseCellValue | null }[]
): Promise<BaseRow[]> {
  return api<BaseRow[]>(`/api/v1/bases/${baseId}/cells`, { method: "PATCH", body: { cells } });
}

/**
 * O canal ao vivo de uma base: um `fetch` lido em fluxo. Não passa pelo `api()` (o corpo não acaba),
 * então o 401 não renova aqui: quem chama recarrega pelo `api()` e reabre. Token no cabeçalho, não na URL.
 */
export function abrirCanalDaBase(baseId: string, signal: AbortSignal): Promise<Response> {
  const token = getToken();
  return fetch(`${API_URL}/api/v1/bases/${baseId}/events`, {
    headers: {
      Accept: "text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal,
    cache: "no-store",
  });
}

/** Desfazer/refazer a ação mais recente da pessoa na base (até 1 dia). Conflito não é erro: 200 com `conflict: true`. */
export type BaseUndoResult = { applied: boolean; conflict: boolean; kind: string | null };

export async function undoBase(baseId: string): Promise<BaseUndoResult> {
  return api<BaseUndoResult>(`/api/v1/bases/${baseId}/undo`, { method: "POST" });
}

export async function redoBase(baseId: string): Promise<BaseUndoResult> {
  return api<BaseUndoResult>(`/api/v1/bases/${baseId}/redo`, { method: "POST" });
}

/** Visões são compartilhadas: mudar filtro ou ordem muda para todos. */
export async function createBaseView(
  baseId: string,
  body: { name: string; layout: BaseView["layout"]; config?: Record<string, unknown> }
): Promise<BaseView> {
  return api<BaseView>(`/api/v1/bases/${baseId}/views`, { method: "POST", body });
}

export async function updateBaseView(
  baseId: string,
  viewId: string,
  body: { name?: string; config?: Record<string, unknown>; position?: number }
): Promise<BaseView> {
  return api<BaseView>(`/api/v1/bases/${baseId}/views/${viewId}`, { method: "PATCH", body });
}

export async function deleteBaseView(baseId: string, viewId: string): Promise<void> {
  await api<void>(`/api/v1/bases/${baseId}/views/${viewId}`, { method: "DELETE" });
}

export async function deleteBaseRow(baseId: string, rowId: string): Promise<BaseRow> {
  return api<BaseRow>(`/api/v1/bases/${baseId}/rows/${rowId}`, { method: "DELETE" });
}

// ---- Tela inicial do time: um pedido, todos os cards. Card sem permissão vem `null`.

export type DashboardTask = {
  id: string;
  title: string;
  due_date: string | null;
  /** "18:00:00" -- com segundos, como todo `TIME` do Postgres. */
  due_time: string | null;
  parent_task_id: string | null;
  priority: string;
  /** Onde a tarefa está, como o quadro mostra: o nome e a cor da coluna. */
  column_name: string;
  column_color: string;
};

export type DashboardBucket = {
  start: string;
  end: string;
  done: number;
  on_time: number;
  overdue: number;
};

export type DashboardResponse = {
  /** O "hoje" do SERVIDOR, no fuso da organização: a tela não recalcula. */
  today: string;
  /** O período escolhido; `null` = "Agora" (a semana corrente e os 7 dias). */
  period: { start: string; end: string } | null;
  /** O resumo: a semana corrente, ou o período. */
  week: { start: string; end: string; done: number; total: number };
  overdue_total: number;
  oldest_overdue: DashboardTask[];
  /** Abertas e no prazo: as que vencem hoje, ou as do período. */
  on_time_total: number;
  /** "day" até 14 dias; "week" acima. */
  bucket_unit: "day" | "week";
  buckets: DashboardBucket[];
  mine: {
    overdue: DashboardTask[];
    overdue_total: number;
    on_time: DashboardTask[];
    on_time_total: number;
  };
  /** `is_active: false` = conta desativada que ainda tem tarefa aberta no time. */
  workload:
    | { user_id: string; name: string; open: number; overdue: number; is_active: boolean }[]
    | null;
  queue: { pending: number; oldest_at: string | null } | null;
};

/**
 * `teamId` null = "todos os times" da barra. `assigneeId`: o relatório inteiro
 * de uma pessoa -- só para quem vê a carga (o servidor responde 403 sem isso).
 */
export async function getDashboard(
  teamId: string | null,
  assigneeId: string | null = null,
  period: { start: string; end: string } | null = null
): Promise<DashboardResponse> {
  const q = new URLSearchParams();
  if (teamId) q.set("under_team_id", teamId);
  if (assigneeId) q.set("assignee_id", assigneeId);
  if (period) {
    q.set("start", period.start);
    q.set("end", period.end);
  }
  const s = q.toString();
  return api<DashboardResponse>(`/api/v1/dashboard${s ? `?${s}` : ""}`);
}

// ---- Arquivos: baixar planilha. Não passa por `api()` (resposta binária); mesmo token, refresh e envelope de erro.

async function _rawRequest(path: string, init: RequestInit, isRetry = false): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Não consegui falar com o servidor.");
  }
  if (res.status === 401 && !isRetry && getToken()) {
    await renewOrEndSession();
    return _rawRequest(path, init, true);
  }
  if (!res.ok) {
    let err: { code?: string; message?: string; details?: Record<string, any> } = {};
    try {
      err = ((await res.json()) as { error?: typeof err }).error ?? {};
    } catch {
      /* corpo que não é JSON: fica a mensagem genérica */
    }
    throw new ApiError(res.status, err.message || `Erro ${res.status}`, err.code, err.details);
  }
  return res;
}

/** Baixa um arquivo da API e o entrega ao navegador para salvar. `body`
 *  = POST com JSON (a exportação da Base manda as linhas da visão). */
export async function downloadFile(
  path: string,
  fallbackName: string,
  body?: unknown
): Promise<void> {
  const res = await _rawRequest(
    path,
    body === undefined
      ? { method: "GET" }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** O painel em planilha, com os mesmos filtros da tela. */
export async function exportDashboard(
  teamId: string | null,
  assigneeId: string | null,
  period: { start: string; end: string } | null
): Promise<void> {
  const q = new URLSearchParams();
  if (teamId) q.set("under_team_id", teamId);
  if (assigneeId) q.set("assignee_id", assigneeId);
  if (period) {
    q.set("start", period.start);
    q.set("end", period.end);
  }
  const s = q.toString();
  await downloadFile(`/api/v1/dashboard/export${s ? `?${s}` : ""}`, "painel.xlsx");
}

// ---- Base: planilha.

/** A Base em planilha, com as linhas e colunas DA VISÃO (na ordem da tela). */
export async function exportBase(
  baseId: string,
  format: "xlsx" | "csv",
  rowIds: string[],
  columnIds: string[]
): Promise<void> {
  await downloadFile(`/api/v1/bases/${baseId}/export`, `base.${format}`, {
    format,
    row_ids: rowIds,
    column_ids: columnIds,
  });
}

export type ImportFile = {
  filename: string;
  content_base64: string;
  sheet?: string | null;
  header_row?: number;
};

export type ImportPreview = {
  sheets: string[];
  sheet: string;
  header_row: number;
  total_rows: number;
  columns: { index: number; name: string; suggested_type: BaseColumnType; sample: string[] }[];
};

export type ImportColumnPlan = {
  index: number;
  action: "new" | "existing" | "title" | "ignore";
  name?: string | null;
  type?: BaseColumnType | null;
  column_id?: string | null;
};

export type ImportResult = {
  total: number;
  valid: number;
  error_count: number;
  errors: { line: number; column: string; message: string }[];
  imported: number;
  base_id: string | null;
};

export async function previewImport(file: ImportFile): Promise<ImportPreview> {
  return api<ImportPreview>("/api/v1/bases/import/preview", { method: "POST", body: file });
}

export async function runImport(
  body: ImportFile & {
    base_id?: string | null;
    new_name?: string | null;
    new_team_id?: string | null;
    columns: ImportColumnPlan[];
    dry_run: boolean;
    skip_invalid: boolean;
  }
): Promise<ImportResult> {
  return api<ImportResult>("/api/v1/bases/import", { method: "POST", body });
}

/** O conteúdo do arquivo em base64 (o corpo da importação é JSON). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(new ApiError(0, "Não consegui ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

