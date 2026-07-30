"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, getMe, setTokens, ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const tokens = await login(email.trim(), senha);
      setTokens(tokens.access_token, tokens.refresh_token);
      // primeiro acesso? backend marca must_change_password -> manda trocar
      const me = await getMe();
      router.replace(me.must_change_password ? "/trocar-senha" : "/quadro");
    } catch (err) {
      const e = err as ApiError;
      // 401 = credencial errada/expirada (backend manda msg generica de proposito)
      setErro(
        e.status === 401
          ? "E-mail ou senha incorretos."
          : e.message || "Não foi possível entrar."
      );
      setCarregando(false);
    }
  }

  return (
    <div className="center-screen">
      <form
        onSubmit={entrar}
        style={{
          width: 360, background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 14, padding: 32, boxShadow: "var(--shadow)",
          display: "flex", flexDirection: "column", gap: 18,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.02em" }}>Entrar</h1>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Gestor de tarefas — time de marketing
          </p>
        </div>

        {erro && <div className="error-box">{erro}</div>}

        <div className="field">
          <label className="label" htmlFor="email">E-mail</label>
          <input
            id="email" className="input" type="email" autoComplete="username"
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="seu.nome@unifecaf.com.br" required
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="senha">Senha</label>
          <input
            id="senha" className="input" type="password" autoComplete="current-password"
            value={senha} onChange={(e) => setSenha(e.target.value)}
            placeholder="••••••••" required
          />
        </div>

        <button className="btn btn-primary" type="submit" disabled={carregando}>
          {carregando ? "Entrando…" : "Entrar"}
        </button>
        <p className="muted" style={{ fontSize: 12, margin: 0, textAlign: "center" }}>
          Primeiro acesso? Use a senha provisória que você recebeu — o sistema
          pedira uma nova.
        </p>
      </form>
    </div>
  );
}
