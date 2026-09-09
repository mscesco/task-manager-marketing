"use client";
// components/ContextSwitcher.tsx
// O seletor de contexto da barra lateral — Spec 047, revisão de 09/09.
//
// ⚠️⚠️ ELE EXISTE PARA TIRAR "ORGANIZAÇÃO" E "TIMES" DA LISTA DO MENU, e a
// razão é da Camila: *"ela não é para estar no menu junto com projetos, minhas
// tarefas e afins, é outra seção"*. E ela está certa — "Projetos" e "Minhas
// tarefas" são LUGARES DE TRABALHO; a organização e a árvore de times são
// ONDE VOCÊ ESTÁ. Misturar os dois faz a lista crescer sem que nenhum item
// fique mais fácil de achar.
//
// ⚠️ O PAINEL É `fixed`, E NÃO `absolute`, e isso não é preferência: o
// `<aside>` da barra tem `overflow-y-auto` (posto lá em 05/08, para o menu não
// sumir com zoom). Um painel `absolute` dentro dele seria RECORTADO pela
// barra — apareceria pela metade, ou não apareceria. Por isso ele mede o
// gatilho na abertura e se posiciona na viewport.
//
// ⚠️ E POR MEDIR NA ABERTURA, ele FECHA ao rolar ou redimensionar: a medida
// envelhece no primeiro pixel de rolagem, e um painel flutuando longe do
// gatilho é pior que um painel fechado.
//
// ⚠️ FECHA AO CLICAR FORA com `contains`, e não comparando `e.target ===
// e.currentTarget`: aquele é o padrão do SCRIM de modal, e aqui fecharia ao
// clicar DENTRO da lista. Mesma distinção registrada em `TaskDetail` e em
// `SeletorEmPilula`.
//
// ⚠️ MORA EM `components/`, então tem guardião — `app/` fica fora do
// `include` do vitest.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Building2, Check, ChevronDown } from "lucide-react";
import type { Team } from "@/lib/api";

/** Uma área com os subtimes dela, já na ordem em que o painel desenha. */
export type ArvoreDoSeletor = {
  readonly area: Team;
  readonly subtimes: Team[];
};

/**
 * Agrupa a lista plana de times em áreas + subtimes.
 *
 * ⚠️ SÓ DOIS NÍVEIS NO PAINEL, mesmo que a árvore tenha três: um menu com
 * indentação de neto vira um mapa, e mapa não é o que se lê com o mouse
 * parado. O neto se alcança entrando no pai — que é a mesma escolha da visão
 * "Subtimes" da tela de time (`cartoesDeSubtime`).
 */
export function arvoresDoSeletor(teams: readonly Team[]): ArvoreDoSeletor[] {
  return teams
    .filter((t) => t.parent_team_id === null)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((area) => ({
      area,
      subtimes: teams
        .filter((t) => t.parent_team_id === area.id)
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    }));
}

/** O que o gatilho mostra: onde a pessoa está agora. */
export function rotuloDoContexto(
  pathname: string,
  teams: readonly Team[],
): string {
  if (pathname === "/organizacao") return "Organização";
  const m = /^\/times\/([^/]+)/.exec(pathname);
  if (m) {
    const time = teams.find((t) => t.id === m[1]);
    if (time) return time.name;
  }
  // ⚠️ Fora dessas telas o seletor não MENTE dizendo um time: ele diz o que
  // faz. Escolher um nome qualquer aqui (o primeiro time, o time da pessoa)
  // sugeriria um contexto ativo que a tela não tem.
  return "Times e organização";
}

export default function ContextSwitcher({
  teams,
  pathname,
  podeGerirOrganizacao,
  expandida,
}: {
  teams: Team[];
  pathname: string;
  /** `area.create` — o mesmo gate que a entrada de menu tinha. */
  podeGerirOrganizacao: boolean;
  /** A barra está expandida? Retraída, sobra só o ícone. */
  expandida: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [caixa, setCaixa] = useState<{ top: number; left: number } | null>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);

  const arvores = arvoresDoSeletor(teams);
  const rotulo = rotuloDoContexto(pathname, teams);

  // ⚠️ `useLayoutEffect` e não `useEffect`: medir depois da PINTURA faria o
  // painel aparecer um quadro no canto (0,0) e saltar para o lugar. Aqui ele
  // já nasce posicionado.
  useLayoutEffect(() => {
    if (!aberto) return;
    const r = gatilhoRef.current?.getBoundingClientRect();
    if (r) setCaixa({ top: r.bottom + 6, left: r.left });
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    function onDown(e: MouseEvent) {
      const alvo = e.target as Node;
      if (
        !gatilhoRef.current?.contains(alvo) &&
        !painelRef.current?.contains(alvo)
      ) {
        setAberto(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    // Ver o bloco no topo: a medida envelhece com a rolagem.
    const fechar = () => setAberto(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("resize", fechar);
    window.addEventListener("scroll", fechar, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("resize", fechar);
      window.removeEventListener("scroll", fechar, true);
    };
  }, [aberto]);

  return (
    <>
      <button
        ref={gatilhoRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label="Times e organização"
        title="Times e organização"
        onClick={() => setAberto((v) => !v)}
        className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-surface-2 ${
          expandida ? "" : "justify-center px-0"
        }`}
      >
        <Building2 size={18} aria-hidden="true" className="shrink-0" />
        {expandida && (
          <>
            <span className="min-w-0 flex-1 truncate text-left">{rotulo}</span>
            {/* A seta gira junto — o mesmo movimento que a pessoa acabou de
                fazer com o clique, devolvido na tela. */}
            <motion.span
              className="inline-flex shrink-0"
              animate={{ rotate: aberto ? 180 : 0 }}
              transition={{ type: "spring", duration: 0.3, bounce: 0.2 }}
            >
              <ChevronDown size={15} aria-hidden="true" />
            </motion.span>
          </>
        )}
      </button>

      {/* ⚠️ `AnimatePresence` é o que permite a SAÍDA animada: sem ele o React
          desmonta o nó na hora e o `exit` nunca roda. Abrir suave e sumir seco
          é pior do que não animar. */}
      <AnimatePresence>
        {aberto && caixa && (
          <motion.div
            ref={painelRef}
            role="menu"
            aria-label="Times e organização"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: "spring", duration: 0.26, bounce: 0.16 }}
            // ⚠️ A origem da escala é o CANTO DE CIMA À ESQUERDA, que é onde
            // o gatilho está: escalando a partir do centro, o painel cresce
            // também para cima e parece brotar do nada.
            style={{
              position: "fixed",
              top: caixa.top,
              left: caixa.left,
              zIndex: 60,
              transformOrigin: "top left",
              width: 248,
              maxHeight: "min(70vh, 520px)",
              overflowY: "auto",
              borderRadius: 12,
              padding: 6,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow)",
            }}
          >
            {/* ⚠️ AS LINHAS ENTRAM EM CASCATA (`staggerChildren`), e é o que a
                Camila pediu ao mandar a página de animação. O atraso é de 18ms
                e a lista é curta de propósito: cascata longa vira espera, e o
                menu é justamente o lugar onde ninguém quer esperar. */}
            <motion.div
              initial="fechado"
              animate="aberto"
              variants={{
                aberto: { transition: { staggerChildren: 0.018 } },
                fechado: {},
              }}
            >
              {arvores.length === 0 && (
                <div className="muted px-2 py-2 text-xs">
                  Nenhuma área ainda.
                </div>
              )}

              {arvores.map(({ area, subtimes }) => (
                <div key={area.id}>
                  <ItemDoSeletor
                    href={`/times/${area.id}`}
                    rotulo={area.name}
                    ativo={pathname === `/times/${area.id}`}
                    forte
                  />
                  {subtimes.map((s) => (
                    <ItemDoSeletor
                      key={s.id}
                      href={`/times/${s.id}`}
                      rotulo={s.name}
                      ativo={pathname === `/times/${s.id}`}
                      recuado
                    />
                  ))}
                </div>
              ))}

              {podeGerirOrganizacao && (
                <>
                  {/* ⚠️ A LINHA SEPARA DUAS COISAS DIFERENTES: acima, PARA ONDE
                      IR; abaixo, ADMINISTRAR o conjunto. Sem ela, "Gerenciar a
                      organização" lê-se como só mais um time da lista. */}
                  <motion.div
                    variants={ITEM}
                    className="my-1.5 border-t border-border"
                  />
                  <ItemDoSeletor
                    href="/organizacao"
                    rotulo="Gerenciar a organização"
                    ativo={pathname === "/organizacao"}
                  />
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// Cada linha sobe 4px enquanto aparece. Curto: é confirmação de que o menu
// abriu, não um número de dança.
const ITEM = {
  fechado: { opacity: 0, y: -4 },
  aberto: { opacity: 1, y: 0 },
};

function ItemDoSeletor({
  href,
  rotulo,
  ativo,
  forte = false,
  recuado = false,
}: {
  href: string;
  rotulo: string;
  ativo: boolean;
  forte?: boolean;
  recuado?: boolean;
}) {
  return (
    <motion.div variants={ITEM}>
      {/* ⚠️ `<a href>` E NÃO `<Link>`: a navegação deste app é recarga total
          (está registrado no topo do `AppShell`, junto do motivo de a barra
          persistir o próprio estado). Misturar os dois faria metade das
          telas recarregar e a outra metade não. */}
      <a
        href={href}
        role="menuitem"
        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] ${
          recuado ? "pl-6" : ""
        } ${forte ? "font-semibold" : "font-medium"} ${
          ativo ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-surface-2"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{rotulo}</span>
        {ativo && <Check size={14} aria-hidden="true" className="shrink-0" />}
      </a>
    </motion.div>
  );
}
