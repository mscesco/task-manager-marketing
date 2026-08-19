// lib/api.ts
//
// ⚠️ UNICO IMPORT DESTE ARQUIVO (fatia 4a/4b da Spec 036): o tipo `Coluna`
// vem de `lib/coluna.ts`, e nao o contrario. Ver o bloco QUADROS mais
// abaixo para o motivo (fronteira de pureza da Spec 027).
import {
  indiceDeColunas,
  type Coluna,
  type OrigemDaColuna,
} from "@/lib/coluna";

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
      "Não consegui falar com o servidor. O backend está rodando na porta 8000?"
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
    // ⚠️ O ENVELOPE DE ERRO DESTA API E `{ error: { code, message, details } }`
    // -- ver `backend/app/api/errors.py:_error_body`. A versao anterior desta
    // funcao so procurava em `data.detail.*` (a forma PADRAO do FastAPI, que
    // este backend NAO usa) e em `data.message` / `data.details` na raiz.
    // Resultado: `code` e `details` vinham SEMPRE `undefined`, e a mensagem
    // caia no literal `Erro <status>` em toda falha de dominio.
    //
    // Duas coisas que estavam quebradas por causa disso, e nenhum portao
    // pegava (`tsc` e `next build` nao leem corpo de HTTP; o unico teste que
    // montava erro usava `{"detail":"nope"}`, que e a forma do FastAPI, nao a
    // deste backend):
    //   - `TaskModal.tsx:580` le `e.details?.invalid_ids` -- nunca chegou nada,
    //     apesar de `test_task_create_assignees_http_db.py:213` existir do lado
    //     do backend justamente porque "o front depende de details.invalid_ids";
    //   - toda mensagem de regra de dominio virava "Erro 409" / "Erro 422" em
    //     vez do texto que o backend escreveu.
    //
    // As formas antigas ficam no encadeamento DE PROPOSITO: `data.detail` cobre
    // o 422 do proprio Pydantic/FastAPI (que nao passa pelo handler da casa) e
    // o `data = { detail: text }` do corpo nao-JSON, logo acima.
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
  permissions: string[];
  // Trabalho 2: vinculos (time, papel) do usuario -> base da lente
  // (quais quadros de subtime mostrar, qual e a raiz).
  teams: TeamMembership[];
};

export async function getMe(): Promise<CurrentUser> {
  return api<CurrentUser>("/api/v1/auth/me");
}

// Spec 030 (D4): avisa o servidor que a sessao acabou. O backend incrementa
// users.token_version, o que mata o access E o refresh -- de TODOS os
// aparelhos da pessoa, nao so deste. Antes disto, "Sair" era so
// clearTokens(): uma copia do refresh continuava valendo por 7 dias.
//
// DUAS DECISOES DE IMPLEMENTACAO, as duas de proposito:
//
// 1. FETCH DIRETO, sem passar por api()/_request. Se o access ja estiver
//    expirado, o 401 acionaria refresh + retentativa + killSession(), que faz
//    hard-nav pra /login no meio de um logout que ja esta indo pra /login.
//    Igual ao doRefresh: a rota de sessao nao pode usar a maquinaria de sessao.
//
// 2. NUNCA LANCA. Sair nao pode falhar por causa de rede, servidor fora do ar
//    ou token ja morto. Quem chama limpa o local e navega de qualquer jeito;
//    se o aviso nao chegou, a sessao morre sozinha quando o refresh expirar.
//
// ⚠️ O token e lido na PRIMEIRA linha, sincrona, antes de qualquer await.
// `sair()` dispara esta funcao sem esperar e chama clearTokens() logo em
// seguida -- se a leitura do token migrar para depois de um await, o header
// sai vazio e o logout vira no-op silencioso.
export async function logout(): Promise<void> {
  const token = getToken();
  if (!token) return;
  try {
    await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Rede caiu: ignorado de proposito (ver decisao 2 acima).
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
  // ⚠️ Spec 036, fatia 3. O backend passou a devolver os dois em
  // `TaskResponse` (e portanto em `TaskListItem`, `TaskDetailResponse` e
  // `MyTaskItem`, que herdam). NAO SAO OPCIONAIS: as colunas viraram NOT NULL
  // na migration `0011`, entao toda tarefa tem quadro e coluna.
  //
  // ⚠️ ELES FICARAM DE FORA DESTE TIPO ATE 10/08 -- a fatia 3 subiu o backend
  // e ninguem tocou aqui. O buraco so apareceu quando a fatia 4b tentou
  // filtrar por `column_id`, porque teste com fixture `as MyTaskItem` cala o
  // `tsc`. Se voce for acrescentar campo de resposta, acrescente NOS DOIS
  // lados no mesmo passo.
  board_id: string;
  column_id: string;
  /**
   * Spec 038, fatia A.
   *
   * ⚠️ ERA O MESMO BURACO DO `board_id`/`column_id` DESCRITO LOGO ACIMA, e o
   * aviso daquele bloco ("acrescente NOS DOIS lados no mesmo passo") descrevia
   * este campo antes de ele existir aqui. O backend serve `start_date` desde
   * sempre -- esta no `TaskResponse` (`schemas.py:142`), no create, no update e
   * no `TaskService` -- e o front nunca o declarou. Nada ficava vermelho:
   * campo a mais na resposta e ignorado em silencio pelo tipo.
   */
  start_date: string | null;
  due_date: string | null;
  /**
   * Spec 038, fatia B: a HORA do prazo. `null` = "vence no dia".
   *
   * ⚠️ VEM COM SEGUNDOS (`"18:00:00"`) -- e o `TIME` do Postgres. Quem compara
   * NAO pode usar este valor cru contra `"HH:MM"`: a string mais longa vence.
   * `lib/prazo.ts::estaAtrasada` normaliza antes, e e por la que a regra passa.
   */
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
} = {}): Promise<TaskListResponse> {
  const q = new URLSearchParams();
  q.set("page", String(params.page ?? 1));
  q.set("size", String(params.size ?? 100));
  if (params.status) q.set("status", params.status);
  if (params.project_id) q.set("project_id", params.project_id);
  if (params.parent_task_id) q.set("parent_task_id", params.parent_task_id);
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

export type MyTaskItem = Task & {
  relations: string[];
  /**
   * Titulo da tarefa-mae, quando esta e subtarefa. Vem em LOTE do backend
   * (1 query por pagina) -- ver ADR 0025 para o mesmo padrao em assignee_ids.
   *
   * `null` quando nao ha mae OU quando a mae esta fora da lente do usuario.
   * A tela cai no rotulo generico "Subtarefa"; NUNCA inventa titulo.
   *
   * Resolver isto no front, procurando a mae entre os itens carregados, nao
   * serve: o caso que importa e estar designado SO na filha -- e ai a mae
   * nao esta na lista.
   */
  parent_title: string | null;
};
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
  description?: string | null;
  // Spec 029: o que aponta para o time, em LOTE (uma query pra lista toda).
  // Alimenta a tela de gestao -- informa e desabilita botao obvio; NAO
  // autoriza (o DELETE recheca no backend, porque estes numeros envelhecem).
  // `tarefas` inclui as que estao na lixeira: elas sumiram do quadro mas
  // seguram a foreign key e o banco recusa o DELETE por causa delas.
  tarefas?: number;
  projetos?: number;
  membros?: number;
  filhos?: number;
};

type TeamListResponse = { items: Team[]; total: number };

// Lista de times do workspace (raiz + subtimes). Estavel na sessao ->
// buscada UMA vez e memoizada. getRootTeamId e listSubteams derivam daqui,
// entao o endpoint /teams e batido uma unica vez por sessao. Limpa no
// clearTokens.
//
// HISTORICO DA INVARIANTE: ate a Spec 029 nenhum fluxo do front mutava a
// arvore de times, entao um invalidateTeams() seria codigo morto -- e o
// comentario que estava aqui avisava que, SE um dia entrasse uma tela de
// gestao de subtime, ela PRECISARIA zerar `_teams`. Esse dia chegou:
// `/times` cria, edita e remove. O `invalidateTeams()` abaixo e o cumprimento
// desse aviso; sem ele, criar um subtime nao o faz aparecer no seletor do
// quadro nem na lente ate a proxima recarga.
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
// Zera o cache de times -> a proxima listTeams() rebusca. Chamar apos criar,
// editar ou remover. Espelha invalidateMembers.
export function invalidateTeams() {
  _teams = undefined;
}

// Spec 029/D1: criar exige team.manage (ADMIN ou MANAGER). 409 = slug repetido
// ou segundo time raiz; 422 = slug fora de ^[a-z0-9-]+$.
export async function createTeam(input: {
  name: string;
  slug: string;
  parent_team_id: string;
}): Promise<Team> {
  const t = await api<Team>("/api/v1/workspaces/current/teams", {
    method: "POST",
    body: input,
  });
  invalidateTeams();
  return t;
}

// Spec 029/D6: edita nome e descricao. O SLUG NAO ENTRA -- e identificador
// estavel, e o backend nem o aceita neste endpoint. 409 = tentou editar a raiz.
// `description` ausente preserva a atual; string vazia limpa.
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

// Spec 029/D1 e D3-A: remover exige workspace.manage (SO ADMIN) e time vazio.
// 403 = nao e admin; 409 = e a raiz OU ainda tem tarefa/projeto/membro/subtime
// (a mensagem do backend traz os numeros); 404 = time inexistente. 204 sem corpo.
export async function deleteTeam(id: string): Promise<void> {
  await api<void>(`/api/v1/workspaces/current/teams/${id}`, {
    method: "DELETE",
  });
  invalidateTeams();
}

// Spec 029/D3-B: o que sai junto se o time for esvaziado e removido.
// Somente leitura. Numeros do MOMENTO DA CHAMADA -- os da listagem podem ter
// envelhecido desde o carregamento da tela.
export type PreviaRemocao = {
  team_id: string;
  nome: string;
  eh_raiz: boolean;
  tarefas_vivas: number;
  tarefas_na_lixeira: number;
  projetos: number;
  membros: number;
  filhos: number;
};

export async function previaRemocaoTeam(id: string): Promise<PreviaRemocao> {
  return api<PreviaRemocao>(
    `/api/v1/workspaces/current/teams/${id}/previa-remocao`
  );
}

// Move o conteudo para o time principal, ARQUIVA as tarefas vivas e apaga o
// time. Exige workspace.manage (so ADMIN). Uma transacao no backend: ou tudo
// ou nada. 409 = e a raiz ou tem subtime filho. Devolve o que FOI feito.
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

export async function listTeamsAll(): Promise<Team[]> {
  const teams = await listTeams();
  return [...teams].sort((a, b) => {
    const ra = a.parent_team_id === null ? 0 : 1;
    const rb = b.parent_team_id === null ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

// ===========================================================================
// QUADROS (Spec 036, fatia 2 no backend / fatia 4b aqui)
// ===========================================================================
//
// ⚠️ O TIPO `Coluna` NAO MORA AQUI, e e a unica excecao a convencao de que
// tipo de resposta da API vive neste arquivo (`Task`, `Team`, `Member`,
// `Project`). Ele vive em `lib/coluna.ts` junto com as regras que o
// interpretam -- e o motivo e a fronteira de pureza da Spec 027: se `Coluna`
// morasse aqui, `coluna.ts` teria de importar deste modulo, que carrega
// `fetch`, token e `localStorage`. O modulo de regras deixaria de ser
// testavel sem mock, que e exatamente o que a fatia 4a comprou.
//
// A dependencia fica `api -> coluna -> status`, sem ciclo.

/**
 * Um quadro alcancavel, com as colunas na ordem visual.
 *
 * Espelha `BoardResponse` do backend. `workspace_id` e `deleted_at` NAO vem --
 * o backend nao os expoe de proposito (o primeiro seria uma trava de servidor
 * refeita no cliente; o segundo so poderia valer `null`).
 */
/**
 * Uma coluna com a contagem de tarefas (`GET /boards/{id}/columns/{id}`).
 *
 * ⚠️ SO O ENDPOINT DE DETALHE DEVOLVE `task_count`. O `GET /boards` nao o
 * carrega de proposito: poria um `COUNT` por coluna em toda abertura de tela,
 * para um numero que so a confirmacao de apagar le.
 */
export type ColunaComContagem = Coluna & { task_count: number };

export type Quadro = {
  id: string;
  name: string;
  team_id: string;
  is_default: boolean;
  colunas: Coluna[];
};

/**
 * Os quadros que quem pergunta ALCANCA, pela lente de time.
 *
 * A trava inteira mora na consulta do backend, nao numa permissao de rota
 * (ADR 0035, D3): SUPERVISOR/OPERATOR de X ve o quadro geral e os do proprio
 * subtime; MANAGER/ADMIN da raiz veem os internos tambem.
 *
 * ⚠️ SEM MEMOIZACAO, ao contrario de `listTeams`. Nao e esquecimento: a fatia
 * 5 traz criar/renomear/apagar quadro e CRUD de coluna, e um cache aqui viraria
 * o mesmo defeito que a Spec 029 criou em `listTeams` -- criar um subtime nao
 * o fazia aparecer ate a proxima recarga. Producao tem UM quadro
 * (`scripts/invariantes.sql`, consulta 5, medida em 10/08/2026), entao o custo
 * de rebuscar por tela e uma requisicao. **Se um dia doer, o lugar de rever e
 * este comentario -- e ai o cache nasce COM o `invalidateQuadros()`, nao
 * depois.**
 *
 * ⚠️ SEM PAGINACAO, pelo mesmo motivo do router: o front precisa da lista
 * inteira para desenhar o seletor de quadro. A ADR 0034 preve poucas dezenas
 * no pior caso, um por subtime.
 */
export async function listBoards(): Promise<Quadro[]> {
  return api<Quadro[]>("/api/v1/boards");
}

/**
 * As colunas do quadro PADRAO do time raiz -- o "Quadro geral".
 *
 * Existe porque a fatia 4b troca `STATUSES` (const sincrona de 8 status) pela
 * lista de colunas, e as telas que hoje leem `STATUSES` (`/minhas-tarefas`,
 * `/arquivadas`, `TaskModal`) desenham o quadro geral, nao um quadro escolhido.
 *
 * ⚠️ DEVOLVE `[]`, E NAO LEVANTA, quando nao acha o quadro padrao. Quem chama
 * distingue "ainda carregando" (`null` no estado) de "carregou e nao ha
 * coluna" (`[]`) -- e uma tela sem coluna nenhuma e um estado que a fatia 4b
 * tem de desenhar de propósito (a sabotagem da fatia 4 no `plan.md` e
 * literalmente "devolver a lista de colunas vazia da API").
 *
 * ⚠️ `is_default` E O CRITERIO, nao o nome do quadro. Nome e editavel na
 * fatia 5; a flag tem indice parcial no banco (`board_um_padrao_por_time`).
 */
export async function colunasDoQuadroGeral(): Promise<Coluna[]> {
  return (await quadroGeralComIndice()).colunas;
}

/**
 * As colunas do Quadro geral E o indice de TODAS as colunas alcancaveis, numa
 * requisicao so (Spec 036, fatia 5b-5b).
 *
 * ⚠️ UMA REQUISICAO, E ISSO E O PONTO. `listBoards()` ja devolve todo quadro
 * alcancavel COM as colunas dele; a versao anterior desta funcao achava o
 * padrao e **jogava o resto fora**. As telas transversais precisavam
 * exatamente do resto: sem ele, tarefa de quadro avulso nao tem nome de coluna
 * para mostrar, e o rotulo cai na reserva por status. Chamar `listBoards()`
 * duas vezes -- uma para as colunas, outra para o indice -- resolveria o mesmo
 * problema pagando duas viagens; e `listBoards` NAO e memoizada de proposito
 * (ver `lib/__tests__/quadros.test.ts`).
 *
 * ⚠️ `colunasDoQuadroGeral` DELEGA PARA CA. Antes eram duas copias de "achar o
 * padrao e ordenar por position"; duas copias da mesma regra e o defeito que a
 * Spec 036 passou a fatia inteira matando. Os testes que ja existiam dela
 * guardam este caminho agora.
 *
 * ⚠️ SEM QUADRO PADRAO: `colunas` sai `[]` (e NAO levanta -- o motivo esta no
 * bloco acima) e o indice **continua cheio**, com nome de quadro em toda
 * coluna. E o certo: se nao ha quadro desta tela, nenhuma coluna e "daqui".
 */
export async function quadroGeralComIndice(): Promise<{
  colunas: Coluna[];
  indice: Map<string, OrigemDaColuna>;
}> {
  const quadros = await listBoards();
  const geral = quadros.find((q) => q.is_default);
  const colunas = geral
    ? [...geral.colunas].sort((a, b) => a.position - b.position)
    : [];
  return { colunas, indice: indiceDeColunas(quadros, geral?.id ?? null) };
}


// ---------------------------------------------------------------
// ESCRITA DE QUADRO E DE COLUNA (Spec 036, fatias 5b-3 e 5b-4)
//
// ⚠️ NENHUMA DELAS TINHA LEITOR ATE A 5b-6. O backend entregou os endpoints
// nas fatias 5b-3 e 5b-4; estas funcoes existem para a tela que os consome, e
// sao entregues JUNTO com ela de proposito -- o projeto ja tem duas cicatrizes
// de codigo sem leitor nesta mesma spec (`is_default_target` ate a 4c,
// `corEhHex` ate hoje).
//
// ⚠️ AS ROTAS DE COLUNA SAO ANINHADAS, e isso e trava e nao estetica. A
// autorizacao no backend acontece sobre o TIME DO QUADRO, e o servico confere
// que a coluna pertence AQUELE quadro. Montar a URL sem o `board_id` -- ou com
// o errado -- devolve 404, e nao edita a coluna alheia.
// ---------------------------------------------------------------

/** Cria um quadro avulso para um time. Nasce com as quatro colunas base. */
export async function createBoard(input: {
  name: string;
  team_id: string;
}): Promise<Quadro> {
  return api<Quadro>("/api/v1/boards", { method: "POST", body: input });
}

/**
 * Renomeia um quadro.
 *
 * ⚠️ SO O NOME VAI NO CORPO. `team_id` decide QUEM ENXERGA o quadro (ADR 0035
 * D3); manda-lo aqui seria operacao de visibilidade disfarcada de edicao -- e
 * o Pydantic do backend IGNORA chave desconhecida em silencio, entao o campo a
 * mais nao daria erro nenhum, so nao faria nada.
 */
/** `GET /boards/{id}` -- o quadro com a CONTAGEM de tarefas vivas. */
export type QuadroComContagem = Quadro & { task_count: number };

/**
 * Busca um quadro com a contagem de tarefas -- para a confirmacao de apagar.
 *
 * ⚠️ `GET /boards` NAO TRAZ CONTAGEM, de proposito: seria uma subconsulta por
 * quadro num endpoint que roda a cada abertura de tela. Somar as colunas pelo
 * `colunaComContagem` custaria uma requisicao POR COLUNA.
 *
 * ⚠️ O NUMERO E DE UM INSTANTE. Entre ler e confirmar, alguem pode criar
 * tarefa ali -- por isso o `DELETE` devolve quantas APAGOU e a tela compara.
 */
export async function getBoard(boardId: string): Promise<QuadroComContagem> {
  return api<QuadroComContagem>(`/api/v1/boards/${boardId}`);
}

/**
 * Apaga um quadro E as tarefas dentro dele. Devolve quantas foram apagadas.
 *
 * ⚠️⚠️ **NAO PERGUNTA O DESTINO DAS TAREFAS, e e a unica operacao do produto
 * assim.** Apagar COLUNA sempre oferece para onde elas vao. Quem chama isto
 * tem de ter passado pela confirmacao por DIGITACAO DO NOME -- a trava e da
 * tela, e o endpoint nao a repete.
 *
 * ⚠️ NAO HA DESFAZER NO PRODUTO. O resgate e
 * `backend/scripts/restaurar_quadro.sql`, rodado no banco.
 *
 * ⚠️ LE O `code`: `quadro_padrao_nao_apagavel` e a recusa do Quadro geral. A
 * tela nem oferece o botao nele (o seletor so lista os avulsos), entao chegar
 * neste erro significa chamada fora da tela.
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

/**
 * Acrescenta uma coluna ao FIM de um quadro avulso.
 *
 * ⚠️ SO NOME E SEMANTICA. Cor, posicao, `is_default_target` e `legacy_status`
 * nao sao parametro no backend, e cada um por um motivo diferente -- ver
 * `BoardService.criar_coluna`. Mandar qualquer um deles nao daria erro (o
 * Pydantic descarta chave desconhecida), e a tela ficaria com a impressao de
 * ter escolhido algo que ninguem leu.
 */
export async function criarColuna(
  boardId: string,
  input: { name: string; semantic: Coluna["semantic"] }
): Promise<Coluna> {
  return api<Coluna>(`/api/v1/boards/${boardId}/columns`, {
    method: "POST",
    body: input,
  });
}

/**
 * Renomeia uma coluna.
 *
 * ⚠️ SEMANTICA NAO SE EDITA. Ela decide cascata de conclusao, varredura de
 * arquivamento, proporcao da checklist e aviso de prazo -- os quatro em
 * silencio. Trocar a semantica de uma coluna com tarefas dentro mudaria o
 * significado das tarefas sem tocar em nenhuma delas.
 */
/** Uma coluna a nascer no lote. `tmp` e apelido do cliente, nao id. */
export type LoteCriar = {
  tmp: string;
  name: string;
  semantic: Coluna["semantic"];
};

export type LoteRenomear = { id: string; name: string };

/** `destino` aceita `tmp:apelido` alem de UUID. `null` = a coluna esta vazia. */
export type LoteApagar = { id: string; destino: string | null };

export type LoteDeColunas = {
  criar?: LoteCriar[];
  renomear?: LoteRenomear[];
  /**
   * Ids que passam a ser o ALVO da semantica deles (Spec 036, fatia 12).
   *
   * ⚠️ SO UUID -- `tmp:` NAO ENTRA. A etapa do backend roda ANTES de apagar,
   * e e isso que permite "trocar o alvo e apagar a coluna antiga" num gesto.
   */
  alvos?: string[];
  apagar?: LoteApagar[];
  /** UUID em texto, ou `tmp:apelido`. ⚠️ VAZIA = nao mexer na ordem. */
  ordem?: string[];
};

/**
 * Aplica a edicao inteira de colunas de um quadro, num pedido so.
 *
 * ⚠️ SUBSTITUI A `reordenarColunas`, QUE FOI APAGADA junto com a rota
 * `PATCH /columns/order`. Aquilo nasceu na fatia 6a, antes de o modelo de tela
 * assentar, e ficou sem chamador quando a edicao virou lote.
 *
 * ⚠️ O `tmp:` E A RAZAO DE SER DISTO. A coluna nova ainda nao tem id quando a
 * pessoa escolhe que as tarefas de outra vao para ela -- e trocar uma coluna
 * por outra e o gesto que o lote existe para permitir. O backend monta o mapa
 * `tmp -> id` na etapa de criacao.
 *
 * ⚠️ UMA TRANSACAO SO: recusa em qualquer etapa desfaz o lote inteiro. A tela
 * refaz a edicao; nao existe estado meio aplicado para reconciliar.
 *
 * ⚠️ LE O `code`, NUNCA A MENSAGEM. As recusas possiveis:
 * `coluna_sem_destino`, `coluna_semantica_obrigatoria`,
 * `coluna_ponte_obrigatoria`, `colunas_divergentes`,
 * `referencia_tmp_desconhecida`, `referencia_tmp_repetida`.
 *
 * ⚠️ DEVOLVE AS COLUNAS INTEIRAS, inclusive os ids das que acabaram de nascer
 * -- que ate agora a tela so conhecia pelo apelido.
 */
export async function aplicarLoteDeColunas(
  boardId: string,
  lote: LoteDeColunas
): Promise<{ colunas: Coluna[]; movidas: number }> {
  return api<{ colunas: Coluna[]; movidas: number }>(
    `/api/v1/boards/${boardId}/columns`,
    {
      method: "PUT",
      // ⚠️ CORPO MONTADO CAMPO A CAMPO -> PRECISA DE `*Corpo.test.ts`. Regra da
      // fatia 5b-7: `body: input` e imune porque campo novo chega sozinho;
      // isto aqui nao e. O guardiao e `lib/__tests__/loteDeColunasCorpo.test.ts`.
      body: {
        criar: lote.criar ?? [],
        renomear: lote.renomear ?? [],
        // ⚠️ A LINHA QUE O `board_id` NAO TEVE. Declarar no tipo NAO poe no
        // corpo -- e este corpo e montado campo a campo, que e por que o
        // `loteDeColunasCorpo.test.ts` existe. Sem esta linha o alvo seria
        // descartado em silencio e o lote responderia 200.
        alvos: lote.alvos ?? [],
        apagar: lote.apagar ?? [],
        ordem: lote.ordem ?? [],
      },
    }
  );
}

export async function renomearColuna(
  boardId: string,
  columnId: string,
  name: string
): Promise<Coluna> {
  return api<Coluna>(`/api/v1/boards/${boardId}/columns/${columnId}`, {
    method: "PATCH",
    body: { name },
  });
}

/**
 * Uma coluna com quantas tarefas VIVAS ela tem. E o numero do aviso de apagar.
 *
 * ⚠️ ELE ENVELHECE, e a tela tem de aceitar isso. Alguem pode mover uma tarefa
 * para ca entre esta chamada e o `DELETE`. O que o `DELETE` devolve e quantas
 * REALMENTE moveram -- se os dois numeros divergirem, quem mente e o aviso.
 *
 * ⚠️ NAO CONTA APAGADAS e CONTA ARQUIVADAS. E o numero que a PESSOA ve; tarefa
 * apagada nao existe para ela. O movimento leva as apagadas junto por causa da
 * FK `RESTRICT`, entao os dois numeros divergem por desenho.
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
 * Apaga uma coluna, mandando as tarefas dela para `destinoId`.
 *
 * Devolve quantas tarefas VIVAS foram movidas.
 *
 * ⚠️ `destino_id` VAI NA QUERY STRING, e nao no corpo. `DELETE` com corpo e
 * descartado por parte da infraestrutura de rede -- e quando o corpo se perde,
 * o backend para de mover tarefa e passa a recusar por falta de destino, que e
 * um 422 sem causa aparente.
 *
 * ⚠️ DUAS RECUSAS DIFERENTES CHEGAM COMO 422, e a tela precisa distingui-las
 * pela mensagem: "para onde vao estas tarefas?" (falta destino) e "o quadro
 * continua funcionando depois?" (ultima coluna OPEN ou DONE). A segunda vale
 * MESMO com destino escolhido -- passar um destino nao a contorna.
 */
export async function apagarColuna(
  boardId: string,
  columnId: string,
  destinoId?: string
): Promise<number> {
  const query = destinoId ? `?destino_id=${encodeURIComponent(destinoId)}` : "";
  const res = await api<{ movidas: number }>(
    `/api/v1/boards/${boardId}/columns/${columnId}${query}`,
    { method: "DELETE" }
  );
  return res.movidas;
}


/**
 * As colunas do quadro de uma TAREFA (fatia 4c-2), ordenadas por posicao.
 *
 * ⚠️ MESMA REGRA DO `Board.tsx`, e ela mora aqui para nao virar duas: o quadro
 * sai do `board_id` DA TAREFA, e o padrao e so o ultimo recurso -- para o caso
 * de o quadro nao voltar na lista (sem alcance, apagado). Escolher pelo
 * padrao direto e o defeito que a sabotagem da 4c-1 pegou.
 *
 * ⚠️ DEVOLVE `[]` EM VEZ DE LEVANTAR, igual a `colunasDoQuadroGeral`: quem
 * chama distingue "ainda carregando" (`null` no estado) de "carregou e nao ha
 * coluna" (`[]`).
 */
export async function colunasDoQuadro(boardId: string): Promise<Coluna[]> {
  const quadros = await listBoards();
  const quadro =
    quadros.find((q) => q.id === boardId) ?? quadros.find((q) => q.is_default);
  if (!quadro) return [];
  return [...quadro.colunas].sort((a, b) => a.position - b.position);
}


export type TaskCreateInput = {
  title: string;
  description?: string;
  priority?: string;
  /**
   * Spec 038, fatia A. ⚠️ DECLARAR AQUI NAO BASTA -- `createTask` monta o
   * corpo CAMPO A CAMPO, e foi exatamente assim que o `board_id` ficou de fora
   * por uma fatia inteira (ver o comentario dentro do corpo). O guardiao e
   * `lib/__tests__/createTaskCorpo.test.ts`, e nao teste de componente.
   */
  start_date?: string | null;
  due_date?: string | null;
  /** Spec 038, fatia B. ⚠️ Hora SEM data volta 422 (`_validate_hora`). */
  due_time?: string | null;
  project_id?: string | null; // criar dentro de um projeto (Entrega 11)
  assignee_ids?: string[]; // Spec 021: responsaveis ja na criacao
  // Fatia 5: time EXPLICITO da task de topo. Ausente => pin na raiz
  // (ADR 0001, comportamento de hoje). Presente => usa este time
  // (ex.: quadro de subtime cria task INTERNA daquele subtime).
  team_id?: string | null;
  /**
   * Spec 036, fatia 5b-6: em QUAL quadro a tarefa de topo nasce.
   *
   * ⚠️ AUSENTE ou `null` = Quadro geral, que e o comportamento de sempre e o
   * de 100% das tarefas ate 12/08. So a tela de um quadro AVULSO preenche.
   *
   * ⚠️ IGNORADO EM SUBTAREFA -- filha herda o quadro do pai (ADR 0024). O
   * backend descarta; nao ha erro a esperar.
   *
   * ⚠️ O BACKEND CONFERE O ALCANCE (`_assert_board_in_reach`) e devolve 422
   * com `board_fora_de_alcance` se o quadro nao estiver na lente de quem
   * escreve. Este campo nao e confiavel so por estar tipado aqui.
   */
  board_id?: string | null;
};

/**
 * Spec 033. ⚠️ NAO TEM CAMPO DE DATA, e isso e a D5 defendida no cliente.
 * A copia nasce sem prazo; um `due_date` aqui e a copia de uma campanha de
 * marco nasce vencida e o job dispara TASK_OVERDUE em lote.
 * ⚠️ NAO TEM CAMPO DE STATUS: copia nasce BACKLOG, sempre.
 */
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
  /**
   * ⚠️ D13, MORTO em 05/08 pela ADR 0031. O backend ainda aceita por
   * compatibilidade, mas o modal nao manda mais: nao existe "leve sem
   * responsaveis". Quem nao pode herdar e resolvido no passo 2, ANTES do
   * POST. Voltar a mandar `false` reabre a porta da subtarefa orfa.
   */
  include_assignees?: boolean;
  /**
   * PASSO 2 (ADR 0031). Chaves = ids de subtarefa DIRETA da origem.
   * Ausentes = herda como sempre. Lista vazia e recusada pelo backend com
   * 422 -- quem nao vai, vai em `skip_subtasks`.
   */
  subtask_assignees?: Record<string, string[]>;
  /** Subtarefas diretas que NAO vao. Leva a subarvore delas junto. */
  skip_subtasks?: string[];
};

export type TaskDuplicateResult = Task & {
  /**
   * D9-c: responsaveis de SUBTAREFA descartados por nao alcancarem mais a
   * task. Vazio e o normal. Nao vazio = alguma subtarefa nasceu sem
   * responsavel, e a tela avisa.
   */
  skipped_assignees: string[];
  /**
   * True = a copia virou tarefa de TOPO porque a irma que ela seria nasceria
   * dentro de um pai ARQUIVADO -- e o quadro so desenha raiz (Board.tsx:580),
   * entao ela existiria sem nenhuma tela pra mostra-la. A tela AVISA.
   */
  promoted_to_root: boolean;
};

export async function duplicateTask(
  taskId: string,
  input: TaskDuplicateInput
): Promise<TaskDuplicateResult> {
  // ⚠️ Sem o pin na raiz do `createTask`: aqui o time vem do modal (que
  // herdou o da origem) ou fica ausente pro backend resolver pela
  // precedencia normal. Chamar `getRootTeamId()` aqui jogaria toda copia
  // feita num quadro de subtime para a raiz.
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
        // ⚠️ ESTE CORPO E MONTADO CAMPO A CAMPO, entao campo novo no tipo
        // NAO chega ao backend sozinho -- em 05/08 o passo 2 do modal montou
        // as duas chaves, os testes do componente afirmaram que o modal as
        // mandava (com `duplicateTask` MOCKADO) e nada chegava na API: a
        // subtarefa nascia sem responsavel e a "nao levar" ia junto assim
        // mesmo. Ao acrescentar campo em `TaskDuplicateInput`, acrescente
        // aqui tambem.
        subtask_assignees: input.subtask_assignees ?? {},
        skip_subtasks: input.skip_subtasks ?? [],
      },
    }
  );
}

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
      // ⚠️ A LINHA QUE O `board_id` NAO TEVE. Declarar no tipo nao poe no
      // corpo -- ver o bloco de aviso mais abaixo, escrito depois de a tarefa
      // criada num quadro avulso nascer no Quadro geral por uma fatia inteira.
      start_date: input.start_date ?? null,
      due_date: input.due_date ?? null,
      // ⚠️ A LINHA QUE O `board_id` NAO TEVE, pela terceira vez nesta spec.
      due_time: input.due_time ?? null,
      // pin: so manda team_id se a raiz foi resolvida.
      ...(teamId ? { team_id: teamId } : {}),
      // project_id explicito (task de projeto) ou ausente (avulsa no raiz).
      ...(input.project_id ? { project_id: input.project_id } : {}),
      // Spec 021: responsaveis na criacao (so manda se houver).
      ...(input.assignee_ids?.length ? { assignee_ids: input.assignee_ids } : {}),
      // ⚠️ FALTAVA, DESDE A FATIA 5b-6 (achado em 13/08, na tela). O tipo
      // `TaskCreateInput` declara `board_id` com quinze linhas de comentario,
      // o `TaskModal` o preenche, o `Board` o passa e o backend inteiro o
      // consome (schema -> router -> `TaskService.create`) -- e ESTA linha,
      // que poe o campo no CORPO, nunca existiu. A tarefa criada dentro de um
      // quadro avulso nascia no Quadro geral.
      //
      // ⚠️ E NAO DAVA ERRO EM LUGAR NENHUM: `board_id` e opcional no backend,
      // entao a ausencia cai em `default_board_and_column_for_status`, que
      // devolve o Quadro geral. Verde nos tres portoes, verde no CI, e o
      // sintoma so aparece na tela -- a tarefa some do quadro em que a pessoa
      // estava e reaparece na lente do time.
      //
      // ⚠️ OS TESTES DE COMPONENTE NAO PEGAM ISTO, e chegaram a dar falsa
      // confianca: eles mockam `createTask` e afirmam o ARGUMENTO, nao o
      // corpo. O guardiao certo e `lib/__tests__/createTaskCorpo.test.ts`,
      // irmao do `duplicateTaskCorpo.test.ts` -- que existe porque a MESMA
      // falha aconteceu em 05/08 com `subtask_assignees` e `skip_subtasks`.
      ...(input.board_id ? { board_id: input.board_id } : {}),
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
  /**
   * Spec 038, fatia A.
   *
   * ⚠️ AQUI DECLARAR BASTA, e a diferenca para o `createTask` e o motivo de
   * este comentario existir: `updateTask` manda `body: input` inteiro, entao o
   * campo viaja sozinho. O `createTask` monta campo a campo e precisou de uma
   * linha no corpo. **Dois caminhos, duas regras** -- e e por isso que o teste
   * de corpo existe para um e nao para o outro.
   *
   * ⚠️ `null` LIMPA, `undefined` NAO MEXE. O backend usa `fields_set`
   * (`task_service.py:1112`), entao mandar `start_date: null` apaga a data e
   * omitir o campo a preserva. A tela precisa mandar `null` explicito quando a
   * pessoa limpa o campo -- `""` viraria 422.
   *
   * ⚠️ E O BACKEND RECUSA `start_date > due_date` com 422 (`_validate_dates`,
   * `task_service.py:1613`), conferindo o estado FINAL da tarefa e nao so o
   * que veio no corpo. Quem chama tem de saber ler esse erro.
   */
  start_date?: string | null;
  due_date?: string | null;
  /**
   * Spec 038, fatia B.
   *
   * ⚠️ `null` LIMPA, `undefined` NAO MEXE -- mesmo `fields_set` do vizinho.
   *
   * ⚠️ E O BACKEND VALIDA O PAR RESULTANTE: apagar so o `due_date` de uma
   * tarefa que TEM hora volta 422, mesmo sem `due_time` no corpo. Quem limpa a
   * data tem de limpar a hora junto.
   */
  due_time?: string | null;
  /**
   * Fatia 5a do backend (ADR 0041): mover a tarefa de COLUNA, com o status
   * derivado dela pelo servidor.
   *
   * ⚠️ MUTUAMENTE EXCLUSIVO COM `status` -- mandar os dois na mesma chamada
   * devolve 422 (`validation_error`, `details.field = "column_id"`). O tipo
   * nao consegue expressar isso sem partir `TaskUpdateInput` em dois, e
   * partir tornaria toda chamada existente mais verbosa para proteger um erro
   * que so um caminho novo pode cometer. **A regra vale, e quem a viola
   * descobre no 422, nao no `tsc`.**
   *
   * ⚠️ O front NAO consegue calcular o status resultante: a ponte
   * (`legacy_status`) nao viaja no `GET /boards`, de proposito (ADR 0033).
   * Quem precisa do status novo le a RESPOSTA desta chamada.
   */
  column_id?: string;
};

export async function updateTask(
  id: string,
  input: TaskUpdateInput
): Promise<Task> {
  return api<Task>(`/api/v1/tasks/${id}`, { method: "PATCH", body: input });
}

// Busca UMA task por id (GET /tasks/{id}). Usado pra reconstruir a cadeia de
// pais quando abro uma subtarefa por deep-link e o pai nao esta na minha lista.
// O backend responde TaskResponse + ids de colaboradores (campos a mais, que o
// tipo Task ignora sem problema).
export async function getTask(id: string): Promise<Task> {
  return api<Task>(`/api/v1/tasks/${id}`);
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

// Spec 034: cache SEPARADO por tarefa. ⚠️ NAO reaproveitar `_members` aqui --
// a lista filtrada depende da tarefa, e compartilhar a mesma entrada faria a
// PRIMEIRA tarefa aberta na sessao definir os seletores de todas as outras. O
// sintoma seria "as vezes o gestor aparece, as vezes nao": intermitente,
// invisivel pros tres portoes, e caro de reproduzir.
const _membersPorTarefa = new Map<string, Member[]>();

/**
 * Lista os membros do workspace.
 *
 * Sem argumento: lista completa, memoizada -- comportamento historico, usado
 * por seis telas.
 *
 * Com `reachesTaskId` (Spec 034): so quem ALCANCA aquela tarefa, pela regra do
 * backend (`user_can_view_task`, a MESMA que o POST de designacao usa). Serve
 * os dois seletores da tela de tarefa: responsavel e `@`.
 *
 * ⚠️ Nao serve o modal de CRIAR: la a tarefa ainda nao existe, entao nao ha
 * id pra perguntar. Aquele caminho segue em `lib/escopoTarefa.ts`.
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

// Cache por TIME, separado dos outros dois pelo mesmo motivo (Spec 034).
const _membersPorTime = new Map<string, Member[]>();

/**
 * Membros que enxergam as tasks de um TIME (Spec 034, Fatia 5).
 *
 * Serve o modal de CRIAR: a tarefa ainda nao existe, entao nao ha id pra
 * `listMembers(taskId)`. A pergunta vira "quem enxerga este time".
 *
 * ⚠️ Funcao SEPARADA, e nao um segundo argumento de `listMembers`. Com dois
 * argumentos opcionais, `listMembers(undefined, teamId)` compila e
 * `listMembers(teamId)` tambem -- e a segunda manda um id de TIME no
 * parametro de TAREFA, o que devolve 404 em vez de erro de tipo.
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
  // ⚠️ Limpar TAMBEM o cache por tarefa (Spec 034). Desativar alguem e zerar
  // so `_members` deixaria a pessoa viva nos seletores de toda tarefa que ja
  // tivesse sido aberta na sessao.
  _membersPorTarefa.clear();
  _membersPorTime.clear();
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
// 29/07: passou a aceitar RESPONSAVEL e PRAZO na criacao rapida. Antes so o
// titulo cabia aqui, entao designar alguem numa subtarefa exigia cria-la,
// abri-la e editar -- tres passos. O atalho que as pessoas encontraram foi
// designar todo mundo na TAREFA-MAE (ha cards com treze responsaveis), o que
// desmonta a leitura de quem faz o que.
//
// O endpoint sempre aceitou os dois campos; era a chamada que nao os mandava.
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

// Arquivar/desarquivar (Entrega 12). Exige task.update -> TODOS os papeis
// podem (e a saida pra quem nao tem task.delete). Idempotente. Resposta NAO
// traz assignee_ids -> upsert preserva.
//
// ⚠️ COM CASCATA desde 05/08: as duas operacoes levam a SUBARVORE INTEIRA
// junto, e `cascade_count` diz quantas subtarefas mudaram (sem contar a
// propria). Antes disso arquivar um pai deixava as filhas ATIVAS debaixo
// dele -- e nenhuma tela mostra subtarefa ativa de pai arquivado.
//
// ⚠️ `cascade_count > 0` significa que o estado local do chamador esta
// DESATUALIZADO: as filhas mudaram no banco e nao estao em nenhuma resposta.
// Quem chama precisa recarregar, nao so fazer upsert desta tarefa.
export type ArchiveResult = Task & { cascade_count: number };

export async function archiveTask(id: string): Promise<ArchiveResult> {
  return api<ArchiveResult>(`/api/v1/tasks/${id}/archive`, { method: "POST" });
}
export async function unarchiveTask(id: string): Promise<ArchiveResult> {
  return api<ArchiveResult>(`/api/v1/tasks/${id}/unarchive`, {
    method: "POST",
  });
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
  if (!team_id) throw new Error("Time raiz não encontrado para criar o projeto.");
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

// ---------------------------------------------------------------
// SOLICITAÇÕES (formulário público FazAê + fila de triagem)
// ---------------------------------------------------------------

export type SolicitacaoStatus = "PENDING" | "APPROVED" | "REJECTED";

export type SolicitacaoAnswer = { label: string; value: string };

/**
 * Detalhe de UMA solicitação — espelha `SolicitationResponse` do backend.
 * Retorno de aprovar / rejeitar / marcar tarefa.
 *
 * Não existe mais listagem plana: a fila é agrupada por envio
 * (`listarEnvios`), e o card já traz as `answers` de cada seção.
 */
export type Solicitacao = {
  id: string;
  batch_id: string;
  batch_seq: number;
  batch_total: number;
  requester_name: string;
  requester_email: string;
  requester_phone: string;
  requester_department: string;
  requester_polo: string;
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

// PÚBLICA (sem auth): entrada do formulário /solicitar.
// UM POST por envio, mesmo com várias categorias selecionadas — o rate
// limit é por IP (5/10min), então N requests bloqueariam o solicitante no
// meio do próprio pedido. A ORDEM de `items` é a ordem de seleção dele.
// O campo `website` é o honeypot anti-bot: SEMPRE enviar vazio da UI.
export async function enviarSolicitacaoPublica(payload: {
  requester_name: string;
  requester_email: string;
  requester_phone: string;
  requester_department: string;
  requester_polo: string;
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
  | "SEM_TAREFA"; // aprovadas que ninguém virou tarefa

export type BatchItem = {
  id: string;
  batch_seq: number;
  category: string;
  summary: string;
  status: SolicitacaoStatus;
  answers: SolicitacaoAnswer[];
  review_note: string | null;
  reviewed_at: string | null;
  task_created_at: string | null;
  task_ref: string | null;
};

export type Batch = {
  batch_id: string;
  protocol: string;
  requester_name: string;
  requester_email: string;
  requester_phone: string;
  requester_department: string;
  requester_polo: string;
  created_at: string;
  items: BatchItem[];
};

export type BatchListResponse = {
  items: Batch[];
  total: number; // total de ENVIOS, não de demandas
  page: number;
  size: number;
  pending_total: number;
  approved_without_task_total: number;
};

/** Fila de triagem: um card por envio, com todas as seções dentro. */
export async function listarEnvios(
  params: { filtro?: SolicitacaoFiltro; page?: number; size?: number } = {}
): Promise<BatchListResponse> {
  const q = new URLSearchParams();
  if (params.filtro) q.set("status", params.filtro);
  q.set("page", String(params.page ?? 1));
  q.set("size", String(params.size ?? 20));
  return api<BatchListResponse>(`/api/v1/solicitacoes?${q.toString()}`);
}

/** Marca/desmarca "tarefa criada" numa solicitação APROVADA. */
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
