"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, ChevronLeft, ChevronRight, GripVertical, X } from "lucide-react";

import type { LinhaDeEdicao } from "@/lib/rascunhoDeColunas";
import { ROTULO_DA_SEMANTICA } from "@/lib/edicaoDeColunas";
import { semanticaTerminal } from "@/lib/coluna";

/**
 * O cabeçalho de uma coluna com o modo de edição LIGADO (Spec 036, fatia 6c-2).
 *
 * ⚠️ MESMA ANATOMIA DO CABEÇALHO NORMAL -- ponto colorido, nome, borda inferior
 * na cor da coluna --, com os controles no lugar da contagem. Desenhar outra
 * coisa faria o modo de edição parecer outra tela, e a pessoa perderia a
 * referência de qual coluna é qual justamente quando está movendo colunas.
 *
 * ⚠️ NADA AQUI FALA COM O SERVIDOR. O modo é de LOTE: tudo o que acontece nesta
 * tela vive no rascunho até a pessoa concluir. Este componente só reporta
 * intenções para cima.
 */
export default function CabecalhoDeColunaEditavel({
  linha,
  cor,
  podeIrEsquerda,
  podeIrDireita,
  onRenomear,
  onMarcar,
  onTornarAlvo,
  onAvisar,
  onMover,
  arrasteRef,
  arrasteProps,
}: {
  linha: LinhaDeEdicao;
  cor: string;
  podeIrEsquerda: boolean;
  podeIrDireita: boolean;
  onRenomear: (nome: string) => void;
  onMarcar: () => void;
  /**
   * Torna esta coluna o ALVO da semântica dela (Spec 036, fatia 12).
   *
   * ⚠️ NÃO EXISTE "DESMARCAR", e a ausência é a trava: sem alvo, `OPEN` e
   * `DONE` fazem toda criação de tarefa naquele quadro devolver 422 -- dias
   * depois, para outra pessoa. Trocar é trocar.
   */
  onTornarAlvo: () => void;
  /**
   * Liga ou desliga a cobrança de prazo desta coluna (Spec 039, §7.3).
   *
   * ⚠️ RECEBE O VALOR NOVO, e não é um "alternar" sem argumento. Quem sabe o
   * valor atual é a `linha`, e mandar o destino explícito evita o clássico de
   * dois cliques rápidos lerem o mesmo estado velho.
   */
  onAvisar: (valor: boolean) => void;
  onMover: (direcao: "esquerda" | "direita") => void;
  /** Vem do `useSortable`. Ausente nos testes -- ver o comentário da alça. */
  arrasteRef?: (no: HTMLElement | null) => void;
  arrasteProps?: Record<string, unknown>;
}) {
  const [editandoNome, setEditandoNome] = useState(false);
  const [rascunhoNome, setRascunhoNome] = useState(linha.nome);
  const campoRef = useRef<HTMLInputElement | null>(null);

  // ⚠️ O FOCO VAI PARA O CAMPO AO ABRIR. Sem isto a pessoa clica no nome, o
  // campo aparece, e ela precisa clicar de novo -- e quem usa leitor de tela
  // não é avisado de que o modo de digitação começou.
  useEffect(() => {
    if (!editandoNome) return;
    // ⚠️ `focus()` E DEPOIS `select()`, e nao so o segundo. Medido em 13/08:
    // `select()` sozinho seleciona o texto mas NAO move o foco no jsdom -- e o
    // teste do foco caiu apontando para o `<body>`. Em navegador ele costuma
    // focar de tabela, o que faria o defeito passar despercebido ate alguem
    // usar teclado.
    campoRef.current?.focus();
    campoRef.current?.select();
  }, [editandoNome]);

  // ⚠️ RESSINCRONIZA QUANDO O NOME MUDA POR FORA. Acontece ao descartar a
  // edição: o rascunho volta ao original e este campo ficaria com o texto
  // velho, mentindo sobre o estado.
  useEffect(() => {
    if (!editandoNome) setRascunhoNome(linha.nome);
  }, [linha.nome, editandoNome]);

  function confirmarNome() {
    const limpo = rascunhoNome.trim();
    setEditandoNome(false);
    // ⚠️ NOME VAZIO NÃO VIRA RENOMEAÇÃO. O backend recusaria com 422, e no lote
    // isso derruba a edição inteira -- por um campo que a pessoa só limpou sem
    // querer antes de desistir.
    if (limpo && limpo !== linha.nome) onRenomear(limpo);
    else setRascunhoNome(linha.nome);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 10,
        paddingBottom: 8,
        borderBottom: `2px solid ${cor}`,
        flexShrink: 0,
        // ⚠️ A COLUNA MARCADA FICA APAGADA, MAS LEGÍVEL. Ela continua na tela
        // porque o modelo é de lote: enquanto não concluir, nada aconteceu, e a
        // pessoa precisa poder desmarcar.
        opacity: linha.apagada ? 0.45 : 1,
      }}
      data-apagada={linha.apagada ? "sim" : "nao"}
    >
      {/* ⚠️ A ALÇA É O ÚNICO PONTO DE ARRASTE, e não o cabeçalho inteiro:
          clicar no nome renomeia, e as duas coisas no mesmo alvo fariam um
          clique curto virar arraste de 2px e vice-versa. */}
      <span
        ref={arrasteRef}
        {...(arrasteProps ?? {})}
        aria-label={`Arrastar ${linha.nome}`}
        style={{
          display: "inline-flex",
          cursor: linha.apagada ? "default" : "grab",
          color: "var(--text-faint)",
          touchAction: "none",
        }}
      >
        <GripVertical size={14} />
      </span>

      <span
        style={{ width: 8, height: 8, borderRadius: 999, background: cor }}
      />

      {editandoNome ? (
        <input
          ref={campoRef}
          className="input"
          value={rascunhoNome}
          aria-label={`Nome da coluna ${linha.nome}`}
          // ⚠️ FALTAVA ATE 18/08, e criar coluna sempre teve. Sem isto, um nome
          // acima do teto viajava no LOTE e voltava 422 -- e no lote a recusa
          // perde a edicao INTEIRA: renomear tres colunas, uma passar do teto,
          // e perder as tres. Mesmo motivo do `nomeDeQuadroValido` existir no
          // front: nao gastar requisicao que ja se sabe que volta recusada.
          //
          // ⚠️ NOME QUE JA ESTA LONGO NO BANCO NAO FICA PRESO. `maxLength` nao
          // trunca valor que veio do servidor -- ele barra DIGITACAO nova. A
          // pessoa apaga e escreve um menor; era o caso das 15 colunas acima de
          // 60 que existiam em producao quando este limite entrou.
          maxLength={60}
          onChange={(e) => setRascunhoNome(e.target.value)}
          onBlur={confirmarNome}
          onKeyDown={(e) => {
            // ⚠️ `stopPropagation` NOS DOIS: `Esc` fecharia o modo de edição
            // inteiro e `Enter` poderia disparar o botão de concluir. Aqui as
            // duas teclas pertencem ao campo.
            e.stopPropagation();
            if (e.key === "Enter") confirmarNome();
            if (e.key === "Escape") {
              setRascunhoNome(linha.nome);
              setEditandoNome(false);
            }
          }}
          style={{ fontSize: 13, padding: "2px 6px", height: 26, flex: 1 }}
        />
      ) : (
        <button
          type="button"
          onClick={() => !linha.apagada && setEditandoNome(true)}
          disabled={linha.apagada}
          title={linha.apagada ? undefined : "Clique para renomear"}
          style={{
            fontWeight: 700,
            fontSize: 13,
            background: "none",
            border: "none",
            padding: 0,
            cursor: linha.apagada ? "default" : "text",
            color: "inherit",
            textAlign: "left",
            textDecoration: linha.apagada ? "line-through" : "none",
          }}
        >
          {linha.nome}
        </button>
      )}

      {/* ⚠️ A COLUNA NOVA É DESENHADA NO QUADRO DESDE 17/08, para poder ser
          posicionada no mesmo gesto em que nasce. Sem este selo ela fica
          indistinguível de uma coluna vazia de verdade -- e a diferença
          importa: esta ainda não existe no servidor, sair sem concluir a
          descarta, e a cor dela vai mudar (quem escolhe é o backend). */}
      {linha.nova && (
        <span
          className="muted"
          style={{ fontSize: 10, whiteSpace: "nowrap" }}
          title="Esta coluna ainda não existe. Ela é criada quando você concluir a edição."
        >
          nova
        </span>
      )}

      {/* ⚠️ O SELO DE ALVO EXISTE PORQUE REORDENAR TORNA A CONFUSÃO PROVÁVEL.
          O destino da cascata é `is_default_target` e NÃO a primeira pela ordem
          (ADR 0030). Sem o selo, alguém põe "Entregue" antes de "Concluído" e
          espera que as tarefas passem a cair lá -- e não vão, sem nada avisar.

          ⚠️ E ELE NUNCA APARECE NUMA COLUNA NOVA: `is_default_target` nasce
          `false` no backend. É aqui que a ausência de "trocar o alvo de uma
          semântica" fica visível para quem usa. */}
      {/* ⚠️ O SELO VIROU O CONTROLE NA FATIA 12 (decisão da Camila, 18/08), e
          não ganhou um botão ao lado. É a mesma lição da fatia 10, onde a
          pílula de datas virou o gatilho: o rótulo que anuncia a escolha é o
          lugar natural de trocá-la.

          ⚠️ ATÉ AQUI ELE ERA SÓ TEXTO, e isso tinha um custo escrito no
          `plan.md`: o selo "anuncia que existe uma coluna escolhida e não
          oferece como trocá-la". Rótulo visível convida à pergunta, e a
          resposta era "apague o quadro e recomece".

          ⚠️ NA COLUNA QUE JÁ É O ALVO ELE NÃO É BOTÃO. Não existe desmarcar --
          um clique que não faz nada é pior que um texto que não clica. */}
      {linha.alvo && !linha.apagada && (
        <span
          className="muted"
          style={{ fontSize: 10, whiteSpace: "nowrap" }}
          title={`O sistema usa esta coluna quando precisa escolher sozinho uma coluna ${ROTULO_DA_SEMANTICA[linha.semantic] ?? ""}.`}
        >
          padrão
        </span>
      )}

      {/* ⚠️ E NA QUE NÃO É, O CONVITE -- apagado, e só fora da lista de
          apagar. Oferecer "tornar padrão" numa coluna riscada pediria dois
          gestos contraditórios no mesmo lote; o `comAlvo` até desfaz a
          exclusão, mas oferecer isso na tela seria confuso.

          ⚠️ E NUNCA NA COLUNA NOVA: ela não tem id, e o backend aplica o alvo
          numa etapa que roda antes de criar. A pessoa cria, conclui, e marca
          depois -- `comAlvo` recusa `tmp:`. */}
      {!linha.alvo && !linha.apagada && !linha.nova && (
        <button
          type="button"
          onClick={onTornarAlvo}
          aria-label={`Tornar ${linha.nome} a coluna padrão de ${ROTULO_DA_SEMANTICA[linha.semantic] ?? "sua semântica"}`}
          title={`Fazer o sistema usar esta coluna quando precisar escolher sozinho uma coluna ${ROTULO_DA_SEMANTICA[linha.semantic] ?? ""}.`}
          style={{
            fontSize: 10, whiteSpace: "nowrap",
            background: "none", border: "1px dashed var(--border)",
            borderRadius: 999, padding: "0 6px", cursor: "pointer",
            color: "var(--text-faint)", lineHeight: "16px",
          }}
        >
          tornar padrão
        </button>
      )}

      {/* ---- Cobrar prazo (Spec 039, F9 e §7.3, item 2) ---------------
          ⚠️ ESTE BOTÃO EXISTE PARA AS 8 COLUNAS DE PRODUÇÃO. Elas nasceram
          antes de o campo ter escritor, e até 22/08 a única forma de mudar era
          SQL no Adminer. O modo de edição já salva em lote com desfazer, então
          a caixa pega isso de graça.

          ⚠️ É ÍCONE, E NÃO CAIXA COM RÓTULO -- e a diferença é deliberada. O
          §7.3 pede o texto "Cobrar prazo nesta coluna" com as consequências ao
          lado, e ele está por extenso no FORMULÁRIO DE CRIAR, onde há espaço.
          Aqui o cabeçalho tem ~250px e já carrega alça, nome, selo, duas setas
          e o "x": a mesma frase empurraria tudo. O texto vive no `title` e no
          `aria-label`, e o estado é dito pelo `aria-pressed` -- não pela cor
          do sino, que sozinha não diz nada a quem não vê cor.

          ⚠️ NUNCA EM COLUNA TERMINAL (§7.3, item 3): lá o backend ignora a
          flag, e um controle inerte é mentira de interface. E nunca na
          apagada: mexer numa coluna que sai no mesmo lote é gesto sem efeito
          -- o `paraLote` inclusive filtra. */}
      {!linha.apagada && !semanticaTerminal(linha.semantic) && (
        <button
          type="button"
          onClick={() => onAvisar(!linha.avisaPrazo)}
          aria-pressed={linha.avisaPrazo}
          aria-label={`Cobrar prazo na coluna ${linha.nome}`}
          title={
            linha.avisaPrazo
              ? "Cobra prazo: as tarefas daqui ficam vermelhas quando atrasam e geram aviso. Clique para desligar."
              : "Não cobra prazo: as tarefas daqui não ficam vermelhas por atraso nem geram aviso. Clique para ligar."
          }
          style={{
            display: "inline-flex", alignItems: "center",
            background: "none", border: "none", padding: 2,
            cursor: "pointer", lineHeight: 0,
            color: linha.avisaPrazo ? "var(--text-faint)" : "var(--text-soft)",
          }}
        >
          {linha.avisaPrazo ? <Bell size={13} /> : <BellOff size={13} />}
        </button>
      )}

      <span style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label={`Mover ${linha.nome} para a esquerda`}
          disabled={!podeIrEsquerda}
          onClick={() => onMover("esquerda")}
          style={{ padding: 2, height: 22 }}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label={`Mover ${linha.nome} para a direita`}
          disabled={!podeIrDireita}
          onClick={() => onMover("direita")}
          style={{ padding: 2, height: 22 }}
        >
          <ChevronRight size={14} />
        </button>

        {/* ⚠️ COM IMPEDIMENTO, O BOTÃO NÃO EXISTE -- e o motivo aparece no
            lugar. Desabilitado seria pior: a pessoa clica, nada acontece, e ela
            não sabe se o produto travou ou se ela não pode. */}
        {linha.impedimento ? (
          <span
            className="muted"
            style={{ fontSize: 10, maxWidth: 120, lineHeight: 1.2 }}
            title={linha.impedimento}
          >
            não pode ser apagada
          </span>
        ) : (
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={
              linha.apagada
                ? `Manter ${linha.nome}`
                : `Apagar ${linha.nome}`
            }
            onClick={onMarcar}
            style={{
              padding: 2,
              height: 22,
              color: linha.apagada ? "var(--text-soft)" : "var(--danger)",
            }}
          >
            {linha.apagada ? (
              <span style={{ fontSize: 11, padding: "0 4px" }}>desfazer</span>
            ) : (
              <X size={14} />
            )}
          </button>
        )}
      </span>
    </div>
  );
}
