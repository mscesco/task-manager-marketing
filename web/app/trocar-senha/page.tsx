"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { changePassword, getToken, ApiError } from "@/lib/api";

export default function TrocarSenhaPage() {
  const router = useRouter();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  async function trocar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nova.length < 8) return setErro("A nova senha precisa de ao menos 8 caracteres.");
    if (nova !== confirma) return setErro("As senhas nao conferem.");
    if (nova === atual) return setErro("A nova senha precisa ser diferente da atual.");
    setCarregando(true);
    try {
      await changePassword(atual, nova);
      router.replace("/quadro");
    } catch (err) {
      const e = err as ApiError;
      setErro(
        e.status === 401 ? "Senha atual incorreta." : e.message || "Nao foi possivel trocar."
      );
      setCarregando(false);
    }
  }

  return (
    <div className="center-screen">
      <form
        onSubmit={trocar}
        style={{
          width: 380, background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 14, padding: 32, boxShadow: "var(--shadow)",
          display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.02em" }}>Defina sua senha</h1>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            No primeiro acesso voce precisa trocar a senha provisoria por uma sua.
          </p>
        </div>

        {erro && <div className="error-box">{erro}</div>}

        <div className="field">
          <label className="label">Senha atual (provisoria)</label>
          <input className="input" type="password" value={atual}
            onChange={(e) => setAtual(e.target.value)} required autoComplete="current-password" />
        </div>
        <div className="field">
          <label className="label">Nova senha</label>
          <input className="input" type="password" value={nova}
            onChange={(e) => setNova(e.target.value)} required autoComplete="new-password"
            placeholder="ao menos 8 caracteres" />
        </div>
        <div className="field">
          <label className="label">Confirme a nova senha</label>
          <input className="input" type="password" value={confirma}
            onChange={(e) => setConfirma(e.target.value)} required autoComplete="new-password" />
        </div>

        <button className="btn btn-primary" type="submit" disabled={carregando}>
          {carregando ? "Salvando…" : "Salvar e entrar"}
        </button>
      </form>
    </div>
  );
}
