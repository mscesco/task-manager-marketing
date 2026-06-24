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
  // O time raiz e por-workspace; ao trocar de sessao, descarta o cache.
  _rootTeamId = undefined;
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
} = {}): Promise<TaskListResponse> {
  const q = new URLSearchParams();
  q.set("page", String(params.page ?? 1));
  q.set("size", String(params.size ?? 100));
  if (params.status) q.set("status", params.status);
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

let _rootTeamId: string | null | undefined; // undefined = ainda nao buscado

export async function getRootTeamId(): Promise<string | null> {
  if (_rootTeamId !== undefined) return _rootTeamId;
  const res = await api<TeamListResponse>("/api/v1/workspaces/current/teams");
  const root = res.items.find((t) => t.parent_team_id === null);
  // DIVIDA DOCUMENTADA (ADR 0001 do front): se a raiz nao for achada,
  // cai-se no null e o backend deriva o time pela membership -- hoje
  // identico ao pin (sem subtimes). QUANDO subtimes existirem, trocar
  // este null por erro duro, senao a heranca silenciosa volta.
  _rootTeamId = root ? root.id : null;
  return _rootTeamId;
}

export type TaskCreateInput = {
  title: string;
  description?: string;
  priority?: string;
  due_date?: string | null;
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
      // project_id / parent_task_id de fora: task avulsa no time raiz.
    },
  });
}
