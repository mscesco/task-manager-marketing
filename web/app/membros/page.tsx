"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import {
  listMembers,
  listSubteams,
  createMember,
  resetMemberPassword,
  deactivateMember,
  currentUser,
  ApiError,
  type Member,
  type Team,
  type MemberRole,
  type CurrentUser,
} from "@/lib/api";
import { iniciais, corAvatar } from "@/lib/people";

// Membros: lista + cadastro (4a) + resetar senha / desativar (4b), gated por
// team.manage. Reset e cadastro compartilham o reveal-once da senha (ADR 0008).
const PAPEL_LABEL: Record<MemberRole, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};
const PAPEIS: MemberRole[] = ["OPERATOR", "SUPERVISOR", "MANAGER", "ADMIN"];

type Revelado = { titulo: string; email: string; senha: string };

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

  // reveal-once compartilhado por cadastro e reset (ADR 0008).
  const [revelado, setRevelado] = useState<Revelado | null>(null);

  // cadastro
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [subtimeId, setSubtimeId] = useState("");
  const [papel, setPapel] = useState<MemberRole | "">("");
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

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
      setRevelado({
        titulo: `Membro cadastrado: ${novo.name}`,
        email: novo.email,
        senha: novo.temporary_password,
      });
      setCriando(false);
      limparForm();
      await carregar();
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
        {podeGerenciar && !criando && !revelado && (
          <button
            className="btn btn-primary"
            onClick={() => setCriando(true)}
            style={{ marginLeft: "auto", padding: "8px 14px" }}
          >
            + Cadastrar membro
          </button>
        )}
      </div>

      {revelado && (
        <SenhaProvisoria
          titulo={revelado.titulo}
          email={revelado.email}
          senha={revelado.senha}
          onFechar={() => setRevelado(null)}
        />
      )}

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
            <LinhaMembro
              key={m.id}
              m={m}
              subtime={nomeSubtime(m.team_id)}
              primeira={i === 0}
              podeGerenciar={podeGerenciar}
              isSelf={me?.id === m.id}
              onRevelar={setRevelado}
              onMudou={carregar}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Linha da lista + acoes de gestao (4b). Resetar/desativar so aparecem pra
// quem tem team.manage, em membro ATIVO que nao e voce mesmo. Confirmacao
// inline (sem dialog do browser). Reset alimenta o reveal-once do pai.
function LinhaMembro({
  m,
  subtime,
  primeira,
  podeGerenciar,
  isSelf,
  onRevelar,
  onMudou,
}: {
  m: Member;
  subtime: string;
  primeira: boolean;
  podeGerenciar: boolean;
  isSelf: boolean;
  onRevelar: (r: Revelado) => void;
  onMudou: () => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDesativar, setConfirmDesativar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erroLinha, setErroLinha] = useState<string | null>(null);

  const mostraAcoes = podeGerenciar && !isSelf && m.is_active;

  async function resetar() {
    setBusy(true);
    setErroLinha(null);
    try {
      const r = await resetMemberPassword(m.id);
      setConfirmReset(false);
      onRevelar({
        titulo: `Senha resetada: ${m.name}`,
        email: m.email,
        senha: r.temporary_password,
      });
    } catch (e) {
      const a = e as ApiError;
      setErroLinha(a.status === 403 ? "Sem permissao." : a.message || "Nao consegui resetar.");
    } finally {
      setBusy(false);
    }
  }

  async function desativar() {
    setBusy(true);
    setErroLinha(null);
    try {
      await deactivateMember(m.id);
      setConfirmDesativar(false);
      onMudou(); // recarrega a lista (cache ja invalidado)
    } catch (e) {
      const a = e as ApiError;
      setErroLinha(a.status === 403 ? "Sem permissao." : a.message || "Nao consegui desativar.");
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: 8, padding: "12px 16px",
        borderTop: primeira ? "none" : "1px solid var(--border)",
        background: "var(--surface)", opacity: m.is_active ? 1 : 0.6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{
          width: 32, height: 32, borderRadius: 999, flexShrink: 0,
          background: corAvatar(m.id), color: "#fff", fontSize: 12, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {iniciais(m.name)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {m.name}{isSelf && <span className="muted" style={{ fontWeight: 400 }}> (voce)</span>}
          </div>
          <div className="muted" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {m.email}
          </div>
        </div>
        <span className="muted" style={{
          fontSize: 12, padding: "3px 9px", borderRadius: 999,
          background: "var(--surface-2)", border: "1px solid var(--border)", flexShrink: 0,
        }}>
          {subtime}
        </span>
        {!m.is_active && (
          <span style={{
            fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
            color: "var(--text-faint)", border: "1px solid var(--border)", flexShrink: 0,
          }}>
            inativo
          </span>
        )}

        {mostraAcoes && !confirmReset && !confirmDesativar && (
          <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button className="btn btn-ghost" onClick={() => { setErroLinha(null); setConfirmReset(true); }}
              style={{ padding: "4px 10px", fontSize: 12 }}>
              Resetar senha
            </button>
            <button className="btn btn-ghost" onClick={() => { setErroLinha(null); setConfirmDesativar(true); }}
              style={{ padding: "4px 10px", fontSize: 12, color: "var(--danger, #b42318)" }}>
              Desativar
            </button>
          </span>
        )}
      </div>

      {/* confirmacao: resetar senha */}
      {confirmReset && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 44 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Gerar nova senha provisoria para {m.name}? A senha atual dele deixa de valer.
          </span>
          <button className="btn btn-primary" onClick={resetar} disabled={busy}
            style={{ padding: "4px 12px", fontSize: 12 }}>
            {busy ? "…" : "Resetar"}
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirmReset(false)} disabled={busy}
            style={{ padding: "4px 12px", fontSize: 12 }}>
            Cancelar
          </button>
        </div>
      )}

      {/* confirmacao: desativar */}
      {confirmDesativar && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 44, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Desativar {m.name}? Hoje <strong>não tem como reativar pela tela</strong>.
          </span>
          <button className="btn btn-primary" onClick={desativar} disabled={busy}
            style={{ padding: "4px 12px", fontSize: 12, background: "var(--danger, #b42318)", borderColor: "transparent" }}>
            {busy ? "…" : "Desativar"}
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirmDesativar(false)} disabled={busy}
            style={{ padding: "4px 12px", fontSize: 12 }}>
            Cancelar
          </button>
        </div>
      )}

      {erroLinha && <div className="error-box" style={{ marginLeft: 44 }}>{erroLinha}</div>}
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
      <div style={{ fontSize: 13 }}>Senha provisoria (o membro troca no 1º acesso):</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <code style={{
          fontSize: 15, fontWeight: 700, padding: "6px 12px", borderRadius: 8,
          background: "var(--surface)", border: "1px solid var(--border)", userSelect: "all",
        }}>
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
