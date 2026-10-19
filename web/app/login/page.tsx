"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { login, getMe, setTokens, ApiError } from "@/lib/api";

// Redesign (fatia 4): duas colunas a partir de 900px -- o painel azul com
// tres cartoezinhos decorativos a esquerda, o formulario num card a direita.
// Abaixo disso so o formulario. Nada de frase de efeito (decisao dela).

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
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
      // Spec 058 (§10.1): a entrada é a tela inicial, e não mais o quadro.
      router.replace(me.must_change_password ? "/trocar-senha" : "/inicio");
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
    <div className="grid min-h-screen min-[900px]:grid-cols-[1.1fr_1fr]">
      {/* O painel: so decoracao e identidade. `aria-hidden` nos cartoezinhos,
          porque o texto deles e cenario, nao conteudo. */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-panel p-14 text-white min-[900px]:flex">
        <div className="relative flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white text-md font-extrabold text-panel">
            GT
          </span>
          <strong className="text-md font-bold tracking-[-0.01em]">Gestor de Tarefas</strong>
          <span className="rounded-full border border-white/25 px-2.5 py-0.5 text-sm font-semibold opacity-75">
            UniFECAF
          </span>
        </div>

        <div className="relative my-auto h-[420px]" aria-hidden="true">
          <div className="login-tile left-0 top-6 w-[300px]">
            <b className="block text-base font-bold">Campanha de matrícula 2027.1</b>
            <small className="mt-0.5 block text-sm opacity-85">Em andamento · vence sexta</small>
            <span className="mt-2.5 block h-1.5 rounded-full bg-white/20">
              <span className="block h-full w-[64%] rounded-full bg-accent" />
            </span>
          </div>
          <div className="login-tile left-[230px] top-[140px] w-[260px]">
            <b className="block text-base font-bold">Semana da Psicologia</b>
            <small className="mt-0.5 block text-sm opacity-85">Arte aprovada · 3 subtarefas</small>
            <span className="mt-2.5 inline-flex gap-1.5">
              <span className="rounded-full bg-teal-soft px-2 text-xs font-bold text-teal">Concluída</span>
              <span className="rounded-full bg-amber-soft px-2 text-xs font-bold text-amber">Alta</span>
            </span>
          </div>
          <div className="login-tile left-[60px] top-[262px] w-[240px]">
            <b className="block text-base font-bold">4 solicitações novas</b>
            <small className="mt-0.5 block text-sm opacity-85">a mais antiga chegou há 2 h</small>
          </div>
        </div>

        <div className="relative text-sm opacity-60">Marketing · UniFECAF</div>
      </section>

      <section className="flex items-center justify-center px-8 py-12">
        <form
          onSubmit={entrar}
          className="login-rise flex w-full max-w-[400px] flex-col gap-5 rounded-2xl border border-border bg-surface p-9 shadow-[var(--shadow)]"
        >
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 text-[26px] font-extrabold tracking-[-0.02em]">Entrar</h1>
            <p className="muted m-0 text-base">
              Use o e-mail institucional e a senha que você recebeu.
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
            <div className="relative">
              <input
                id="senha" className="input w-full"
                // `.input` vence o `pr-*` do Tailwind (web/AGENTS.md §11):
                // o respiro para o botao do olho vai inline.
                style={{ paddingRight: 44 }}
                type={mostrarSenha ? "text" : "password"}
                autoComplete="current-password"
                value={senha} onChange={(e) => setSenha(e.target.value)}
                placeholder="••••••••" required
              />
              <button
                type="button"
                aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                aria-pressed={mostrarSenha}
                onClick={() => setMostrarSenha((v) => !v)}
                className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-ink-faint hover:bg-surface-2"
              >
                {mostrarSenha ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
              </button>
            </div>
          </div>

          <button className="btn btn-primary" type="submit" disabled={carregando}>
            {carregando ? "Entrando…" : "Entrar"}
          </button>
          <p className="muted m-0 text-center text-sm">
            Primeiro acesso? Entre com a senha provisória; o sistema pedirá uma nova.
          </p>
        </form>
      </section>
    </div>
  );
}
