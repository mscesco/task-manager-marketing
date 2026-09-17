"use client";
// components/PreferenciasDeNotificacao.tsx
// O cartão "Notificações" do Meu perfil (Spec 054, fatia D).
//
// Pedido dela, 17/09: *"uma tela de configuração de notificações dentro do
// perfil que permite mudar as notificações que quero ou não receber (...) com
// toggle em cada uma das possibilidades de notificações"*.
//
// ⚠️ UMA GRADE, E NÃO UMA LISTA DE 24 (§9.2 da spec, aprovada por ela): uma
// linha por aviso, uma coluna por papel. Vinte e quatro interruptores em lista
// seriam vinte e quatro frases quase iguais -- "comentário como seguidor",
// "comentário como responsável" --, e ninguém acharia o que procura.
//
// ⚠️ É UMA `<table>` DE VERDADE, com `<th scope>` nas duas direções. Numa grade
// de caixas a pergunta "este interruptor é de quê?" se responde OLHANDO para a
// linha e a coluna; quem usa leitor de tela não olha. Com a tabela, cada
// interruptor é anunciado com a linha e a coluna dele -- e é por isso que o
// rótulo acessível vem de `lib/preferenciasDeNotificacao.ts` e não do desenho.
//
// ⚠️ MORA EM `components/` e não em `app/`, para ter guardião: o `include` do
// vitest não lê `app/`. A regra (linhas, colunas, rótulos, o que a ausência
// significa) está em `lib/preferenciasDeNotificacao.ts` -- aqui só se desenha.

import { useEffect, useState } from "react";

import Loading from "@/components/Loading";
import Switch from "@/components/Switch";
import { useAvisar } from "@/components/Toasts";
import {
  listNotificationPreferences,
  setNotificationPreference,
  type ApiError,
  type NotificationToggle,
} from "@/lib/api";
import {
  COLUNAS,
  SECOES,
  type LinhaDePreferencia,
  type Papel,
  chave,
  estaLigado,
  mapear,
  resumo,
  rotuloDoToggle,
} from "@/lib/preferenciasDeNotificacao";

export default function PreferenciasDeNotificacao() {
  const avisar = useAvisar();
  const [toggles, setToggles] = useState<NotificationToggle[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Quais células estão no ar agora. Duas podem estar: a pessoa clica numa
  // linha e noutra sem esperar, e travar a grade inteira a cada clique faria
  // a tela parecer lenta num gesto que é instantâneo.
  const [noAr, setNoAr] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    listNotificationPreferences()
      .then(setToggles)
      .catch(() => setErro("Não consegui carregar suas preferências de notificação."));
  }, []);

  async function mudar(linha: LinhaDePreferencia, papel: Papel, ligado: boolean) {
    const k = chave(linha.grupo, papel);
    // ⚠️ OTIMISTA (D7): o interruptor vira agora. Numa grade, esperar a
    // resposta a cada clique faria a pastilha "voltar" por um instante --
    // e o gesto aqui é sempre uma sequência de vários.
    const antes = toggles;
    setToggles((atual) =>
      atual?.map((t) =>
        t.type_group === linha.grupo && t.role === papel ? { ...t, enabled: ligado } : t,
      ) ?? atual,
    );
    setNoAr((s) => new Set(s).add(k));
    try {
      // O servidor devolve a lista INTEIRA: os grupos que governam dois tipos
      // (arquivar+desarquivar, pôr+tirar) mudam junto, e assim a tela mostra o
      // que ficou gravado em vez de deduzir.
      const lista = await setNotificationPreference({
        type_group: linha.grupo,
        role: papel,
        enabled: ligado,
      });
      setToggles(lista);
      avisar("Preferência salva.");
    } catch (e) {
      // ⚠️ VOLTA ATRÁS E DIZ (D7): sem isto o interruptor ficaria mostrando um
      // silêncio que o servidor não gravou, e a pessoa descobriria ao não
      // receber -- ou ao receber -- semanas depois.
      setToggles(antes);
      avisar((e as ApiError).message || "Não consegui salvar a preferência.");
    } finally {
      setNoAr((s) => {
        const proximo = new Set(s);
        proximo.delete(k);
        return proximo;
      });
    }
  }

  if (erro) {
    return (
      <div className="error-box" role="alert">
        {erro}
      </div>
    );
  }
  if (!toggles) return <Loading tamanho="linha" rotulo="Carregando suas preferências" />;

  const mapa = mapear(toggles);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-md font-semibold">Notificações</h2>
        <p className="muted text-sm">
          Desligar <strong>esconde</strong>, não apaga: o aviso vai para a aba
          “Silenciadas” em <a href="/notificacoes?aba=silenciadas">Notificações</a>.
          Religar traz de volta o que já chegou.
        </p>
        <p className="muted mt-1 text-sm" role="status">
          {resumo(toggles)}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-base">
          <thead>
            <tr>
              <th scope="col" className="p-0 text-left">
                <span className="sr-only">Aviso</span>
              </th>
              {COLUNAS.map((c) => (
                <th
                  key={c.papel}
                  scope="col"
                  className="w-[88px] px-1 pb-2 text-sm font-semibold text-ink-faint"
                >
                  {c.rotulo}
                </th>
              ))}
            </tr>
          </thead>
          {SECOES.map((secao) => (
            <tbody key={secao.titulo}>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={1 + COLUNAS.length}
                  className="pt-3 pb-1 text-left text-sm font-semibold uppercase tracking-[0.06em] text-ink-faint"
                >
                  {secao.titulo}
                </th>
              </tr>
              {secao.linhas.map((linha) => (
                <tr key={linha.grupo} className="border-t border-border">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {linha.rotulo}
                    {linha.ajuda && (
                      <span
                        id={`ajuda-${linha.grupo}`}
                        className="muted mt-0.5 block text-sm"
                      >
                        {linha.ajuda}
                      </span>
                    )}
                  </th>
                  {linha.papeis[0] === "none" ? (
                    // Um interruptor só, no meio das três colunas: a linha não
                    // se divide por papel (reação, pôr/tirar, e as travadas).
                    <td colSpan={COLUNAS.length} className="py-2 text-center">
                      <Celula
                        linha={linha}
                        papel="none"
                        mapa={mapa}
                        noAr={noAr}
                        onMudar={mudar}
                      />
                    </td>
                  ) : (
                    COLUNAS.map((c) => (
                      <td key={c.papel} className="py-2 text-center">
                        {linha.papeis.includes(c.papel) ? (
                          <Celula
                            linha={linha}
                            papel={c.papel}
                            mapa={mapa}
                            noAr={noAr}
                            onMudar={mudar}
                          />
                        ) : (
                          // ⚠️ Prazo não tem coluna de seguidor (§5). Um traço,
                          // e não um interruptor desligado: desligado diria que
                          // ela PODE ligar, e esse aviso nunca chega por seguir.
                          <span className="muted" aria-label="não se aplica">
                            —
                          </span>
                        )}
                      </td>
                    ))
                  )}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

function Celula({
  linha,
  papel,
  mapa,
  noAr,
  onMudar,
}: {
  linha: LinhaDePreferencia;
  papel: Papel;
  mapa: ReturnType<typeof mapear>;
  noAr: ReadonlySet<string>;
  onMudar: (linha: LinhaDePreferencia, papel: Papel, ligado: boolean) => void;
}) {
  const ligado = linha.travada || estaLigado(mapa, linha.grupo, papel);
  return (
    <Switch
      checked={ligado}
      // Travado fica LIGADO e desabilitado (D6): a linha existe para mostrar
      // que o aviso existe, e a explicação ao lado diz por que não se desliga.
      disabled={linha.travada || noAr.has(chave(linha.grupo, papel))}
      aria-label={rotuloDoToggle(linha, papel)}
      aria-describedby={linha.ajuda ? `ajuda-${linha.grupo}` : undefined}
      onChange={(proximo) => onMudar(linha, papel, proximo)}
    />
  );
}
