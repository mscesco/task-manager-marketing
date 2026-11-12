"use client";
// Seguir uma tarefa no detalhe: `BotaoSeguir` (um clique, no topo) e `LinhaDeSeguidores`
// (o `+` para pôr e tirar outras pessoas). Os dois recebem o mesmo `useSeguidores`,
// criado uma vez no `TaskDetail`, para não discordarem.
// Grava na hora, otimista; volta atrás com aviso se o servidor recusar.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BellOff } from "lucide-react";

import SeletorDePessoas from "@/components/SeletorDePessoas";
import { addWatcher, listWatchers, removeWatcher, type ApiError } from "@/lib/api";
import {
  mensagemDeFalha,
  permissoesDeSeguidor,
  pessoasOferecidas,
  rotuloDoBotaoSeguir,
} from "@/lib/seguidores";

export type EstadoDosSeguidores = {
  /** `null` = ainda carregando (ou a leitura falhou). */
  seguidores: string[] | null;
  ocupados: ReadonlySet<string>;
  alternar: (userId: string, daPropriaPessoa: boolean) => Promise<void>;
};

/** Carrega e altera os seguidores de uma tarefa; ignora a resposta de uma tarefa anterior. */
export function useSeguidores(
  taskId: string | null,
  avisar: (texto: string) => void,
): EstadoDosSeguidores {
  const [seguidores, setSeguidores] = useState<string[] | null>(null);
  const [ocupados, setOcupados] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSeguidores(null);
    if (!taskId) return;
    let vivo = true;
    listWatchers(taskId)
      .then((ids) => {
        if (vivo) setSeguidores(ids);
      })
      .catch(() => {
        // Falhou: a linha fica em "carregando" em vez de afirmar "ninguem".
        if (vivo) setSeguidores(null);
      });
    return () => {
      vivo = false;
    };
  }, [taskId]);

  const alternar = useCallback(
    async (userId: string, daPropriaPessoa: boolean) => {
      if (!taskId || seguidores === null) return;
      const jaSegue = seguidores.includes(userId);
      const anterior = seguidores;
      setSeguidores(jaSegue ? anterior.filter((x) => x !== userId) : [...anterior, userId]);
      setOcupados((s) => new Set(s).add(userId));
      try {
        const ids = jaSegue
          ? await removeWatcher(taskId, userId)
          : // O botao do topo manda SEM user_id: "eu". O `+` manda o id.
            await addWatcher(taskId, daPropriaPessoa ? undefined : userId);
        setSeguidores(ids);
      } catch (e) {
        setSeguidores(anterior);
        avisar(mensagemDeFalha(e as ApiError, daPropriaPessoa));
      } finally {
        setOcupados((s) => {
          const n = new Set(s);
          n.delete(userId);
          return n;
        });
      }
    },
    [taskId, seguidores, avisar],
  );

  return { seguidores, ocupados, alternar };
}

export function BotaoSeguir({
  estado,
  meuId,
  arquivada,
}: {
  estado: EstadoDosSeguidores;
  meuId: string | null;
  arquivada: boolean;
}) {
  const { seguirASiMesmo } = permissoesDeSeguidor({ arquivada, podeGerenciar: false });
  // Sem saber quem sou eu ou quem segue, nao ha o que afirmar: nao desenha.
  if (!meuId || estado.seguidores === null || !seguirASiMesmo) return null;
  const sigo = estado.seguidores.includes(meuId);
  const ocupado = estado.ocupados.has(meuId);
  const rotulo = rotuloDoBotaoSeguir(sigo);
  return (
    <button
      type="button"
      className="btn btn-ghost shrink-0 gap-1.5"
      // Inline porque o `.btn` do `globals.css` fica fora de camada e vence `px-*`/`py-*`
      // do Tailwind. Mesmo padding e fonte do "fechar" ao lado.
      style={{ padding: "4px 10px", fontSize: 13 }}
      onClick={() => void estado.alternar(meuId, true)}
      disabled={ocupado}
      aria-pressed={sigo}
    >
      {sigo ? <BellOff size={13} aria-hidden /> : <Bell size={13} aria-hidden />}
      {rotulo}
    </button>
  );
}

export function LinhaDeSeguidores({
  estado,
  meuId,
  arquivada,
  podeGerenciar,
  nomes,
  inativos,
  foraDoEscopo,
}: {
  estado: EstadoDosSeguidores;
  meuId: string | null;
  arquivada: boolean;
  podeGerenciar: boolean | undefined;
  nomes: ReadonlyMap<string, { name: string }>;
  inativos: ReadonlySet<string>;
  foraDoEscopo: ReadonlySet<string>;
}) {
  const [busca, setBusca] = useState("");
  const { mexerEmOutros } = permissoesDeSeguidor({ arquivada, podeGerenciar });
  const marcados = estado.seguidores ?? [];

  const oferecidas = useMemo(
    () =>
      pessoasOferecidas({
        membros: Array.from(nomes.entries()).map(([id, m]) => ({ id, name: m.name })),
        busca,
        inativos,
        foraDoEscopo,
        marcados,
      }),
    [nomes, busca, inativos, foraDoEscopo, marcados],
  );

  return (
    // Sem `rotulo`: o detalhe põe "Seguidores" na coluna de rótulos.
    <SeletorDePessoas
      marcados={marcados}
      nomes={nomes}
      inativos={inativos}
      oferecidas={oferecidas}
      busca={busca}
      onBusca={setBusca}
      onAlternar={(id) => void estado.alternar(id, id === meuId)}
      podeAbrir={mexerEmOutros && estado.seguidores !== null}
      ocupados={estado.ocupados}
      // Vazio é só o `+`, sem "ninguém".
      rotuloDoBotao="Escolher seguidores"
    />
  );
}
