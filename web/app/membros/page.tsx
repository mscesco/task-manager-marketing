"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import {
  listMembers,
  listSubteams,
  createMember,
  currentUser,
  ApiError,
  type Member,
  type Team,
  type MemberRole,
  type MemberCreated,
  type CurrentUser,
} from "@/lib/api";
import { iniciais, corAvatar } from "@/lib/people";

// Membros: lista (Fatia 3) + cadastro com reveal-once da senha (Fatia 4a),
// gated por team.manage. Resetar senha e desativar entram na 4b.
const PAPEL_LABEL: Record<MemberRole, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};
const PAPEIS: MemberRole[] = ["OPERATOR", "SUPERVISOR", "MANAGER", "ADMIN"];

export default function MembrosPage() {
  return (
    <AppShell>
      <Membros />
    </AppShell>
  );
}

function Membros() {
  const [membros, setMembros] = useState<Member[] | null>(null);
  const [subtimes, setSubtimes] = useState<Team[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [me, setMe] = useState<CurrentUser | null>(null);

  // cadastro
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [subtimeId, setSubtimeId] = useState("");
  const [papel, setPapel] = useState<MemberRole | "">("");
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  // reveal-once: so existe enquanto o admin nao fecha (ADR 0008).
  const [criado, setCriado] = useState<MemberCreated | null>(null);

  const podeGerenciar = me?.permissions.includes("team.manage") ?? false;

  function nomeSubtime(id: string | null): string {
    if (!id) return "—";
    return subtimes.find((t) => t.id === id)?.name ?? "—";
  }

  async function carregar() {
    try {
      const ms = await listMembers();
      setMembros([...ms].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
    } catch (e) {
      setErro((e as ApiError).message || "Nao consegui carregar os membros.");
    }
  }

  useEffect(() => {
    carregar();
    listSubteams().then(setSubtimes).catch(() => {});
    currentUser().then(setMe).catch(() => {});
  }, []);

  function limparForm() {
    setNome("");
    setEmail("");
    setSubtimeId("");
    setPapel("");
    setErroForm(null);
  }

  async function cadastrar() {
    const n = nome.trim();
    const e = email.trim();
    if (!n || !e) {
      setErroForm("Nome e e-mail sao obrigatorios.");
      return;
    }
    // subtime e papel andam juntos (backend exige os dois ou nenhum).
    if ((subtimeId === "") !== (papel === "")) {
      setErroForm("Para vincular a um subtime, escolha o subtime E o papel (ou deixe ambos vazios).");
      return;
    }
    setSalvando(true);
    setErroForm(null);
    try {
      const novo = await createMember({
        name: n,
        email: e,
        teamId: subtimeId || null,
        role: (papel || null) as MemberRole | null,
      });
      setCriado(novo); // dispara o reveal-once
      setCriando(false);
      limparForm();
      await carregar(); // createMember ja invalidou o cache
    } catch (err) {
      const a = err as ApiError;
      setErroForm(
        a.status === 409
          ? "Ja existe um membro com esse e-mail (ou faltou subtime+papel juntos)."
          : a.status === 422
          ? "Dados invalidos (e-mail, ou a pessoa ja esta em outro subtime)."
          : a.status === 403
          ? "Voce nao tem permissao para cadastrar membros."
          : a.message || "Nao consegui cadastrar."
      );
    } finally {
      setSalvando(false);
    }
  }

  if (erro) return <div className="error-box" style={{ maxWidth: 560 }}>{erro}</div>;
  if (!membros) return <div className="muted">Carregando membros…</div>;

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 19, letterSpacing: "-0.02em" }}>Membros</h1>
        <span className="muted" style={{ fontSize: 13 }}>{membros.length}</span>
        {podeGerenciar && !criando && !criado && (
          <button
            className="btn btn-primary"
            onClick={() => setCriando(true)}
            style={{ marginLeft: "auto", padding: "8px 14px" }}
          >
            + Cadastrar membro
          </button>
        )}
      </div>

      {/* reveal-once da senha provisoria (ADR 0008) */}
      {criado && (
        <SenhaProvisoria
          titulo={`Membro cadastrado: ${criado.name}`}
          email={criado.email}
          senha={criado.temporary_password}
          onFechar={() => setCriado(null)}
        />
      )}

      {/* formulario de cadastro */}
      {criando && (
        <div
          style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 12, padding: 20, marginBottom: 16,
            display: "flex", flexDirection: "column", gap: 12,
          }}
        >
          <div className="field">
            <span className="label">Nome</span>
            <input className="input" value={nome} disabled={salvando} autoFocus
              onChange={(ev) => setNome(ev.target.value)} maxLength={255} />
          </div>
          <div className="field">
            <span className="label">E-mail</span>
            <input className="input" type="email" value={email} disabled={salvando}
              onChange={(ev) => setEmail(ev.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <span className="label">Subtime (opcional)</span>
              <select className="input" value={subtimeId} disabled={salvando}
                onChange={(ev) => setSubtimeId(ev.target.value)}>
                <option value="">— sem subtime —</option>
                {subtimes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <span className="label">Papel (se houver subtime)</span>
              <select className="input" value={papel} disabled={salvando || subtimeId === ""}
                onChange={(ev) => setPapel(ev.target.value as MemberRole | "")}>
                <option value="">—</option>
                {PAPEIS.map((p) => (
                  <option key={p} value={p}>{PAPEL_LABEL[p]}</option>
                ))}
              </select>
            </div>
          </div>

          {erroForm && <div className="error-box">{erroForm}</div>}

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={cadastrar}
              disabled={salvando || !nome.trim() || !email.trim()}
              style={{ padding: "8px 14px" }}>
              {salvando ? "Cadastrando…" : "Cadastrar"}
            </button>
            <button className="btn btn-ghost" onClick={() => { setCriando(false); limparForm(); }}
              disabled={salvando} style={{ padding: "8px 14px" }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {membros.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: 40, textAlign: "center", maxWidth: 480 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Nenhum membro</p>
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          {membros.map((m, i) => (
            <div
              key={m.id}
              style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                background: "var(--surface)", opacity: m.is_active ? 1 : 0.6,
              }}
            >
              <span style={{
                width: 32, height: 32, borderRadius: 999, flexShrink: 0,
                background: corAvatar(m.id), color: "#fff", fontSize: 12, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {iniciais(m.name)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.name}
                </div>
                <div className="muted" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.email}
                </div>
              </div>
              <span className="muted" style={{
                fontSize: 12, padding: "3px 9px", borderRadius: 999,
                background: "var(--surface-2)", border: "1px solid var(--border)", flexShrink: 0,
              }}>
                {nomeSubtime(m.team_id)}
              </span>
              {!m.is_active && (
                <span style={{
                  fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
                  color: "var(--text-faint)", border: "1px solid var(--border)", flexShrink: 0,
                }}>
                  inativo
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Bloco reveal-once: a senha provisoria so existe aqui (nao volta). Mostra
// com aviso, botao copiar, e some ao fechar.
function SenhaProvisoria({
  titulo,
  email,
  senha,
  onFechar,
}: {
  titulo: string;
  email: string;
  senha: string;
  onFechar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(senha);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }
  return (
    <div
      style={{
        border: "1px solid var(--accent)", borderRadius: 12, padding: 20,
        marginBottom: 16, background: "var(--accent-soft)",
        display: "flex", flexDirection: "column", gap: 10,
      }}
    >
      <strong style={{ fontSize: 14 }}>{titulo}</strong>
      <span className="muted" style={{ fontSize: 13 }}>{email}</span>
      <div style={{ fontSize: 13 }}>
        Senha provisoria (o membro troca no 1º acesso):
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <code
          style={{
            fontSize: 15, fontWeight: 700, padding: "6px 12px", borderRadius: 8,
            background: "var(--surface)", border: "1px solid var(--border)",
            userSelect: "all",
          }}
        >
          {senha}
        </code>
        <button className="btn btn-ghost" onClick={copiar} style={{ padding: "6px 12px" }}>
          {copiado ? "Copiado!" : "Copiar"}
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--danger, #b42318)", fontWeight: 600 }}>
        Copie agora — esta senha não aparece de novo. Repasse ao membro pelo canal combinado.
      </div>
      <button className="btn btn-primary" onClick={onFechar} style={{ alignSelf: "flex-start", padding: "6px 14px" }}>
        Concluir
      </button>
    </div>
  );
}
