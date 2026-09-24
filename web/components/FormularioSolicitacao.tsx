"use client";
// /solicitar — formulário PÚBLICO de solicitação de demandas (FazAê).
// Sem AppShell e sem auth: quem preenche é gente de fora do sistema
// (coordenador de polo, professor, RH).
//
// FLUXO (multi-seleção):
//   passo 0        -> identificação + escolha de 1..N tipos de demanda
//   passos 1..N    -> uma seção por tipo, NA ORDEM em que foram marcados
//   passo N+1      -> revisão de tudo antes de enviar
//
// Cada tipo selecionado vira uma SOLICITAÇÃO INDEPENDENTE no backend
// (mesmo protocolo, triagem separada): o marketing pode aprovar a arte e
// rejeitar a divulgação do mesmo envio. Mas o envio é UM POST só — o rate
// limit é por IP, e N requests bloqueariam a pessoa no meio do pedido.
//
// Rascunho salvo no navegador a cada mudança (lib/rascunhoSolicitacao).
// Anti-bot: input honeypot "website" escondido.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDrawnOutline } from "@/components/AnimatedOutline";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import {
  enviarSolicitacaoPublica,
  ApiError,
  type SolicitacaoAnswer,
  type SolicitacaoItemEnvio,
} from "@/lib/api";
import {
  campoVisivel,
  type Campo,
  type Categoria,
} from "@/lib/solicitacaoForm";
import {
  descreverIdade,
  lerRascunho,
  limparRascunho,
  salvarRascunho,
  type RascunhoSolicitacao,
} from "@/lib/rascunhoSolicitacao";

type ValoresPorCategoria = Record<string, Record<string, string | string[]>>;

export type CamposDeIdentificacao = {
  telefone: string | null;
  area: string | null;
  polo: string | null;
};

/**
 * Os campos da etapa de identificação, montados a partir do formulário.
 *
 * ⚠️ NOME E E-MAIL SÃO FIXOS e vêm primeiro -- eles não são configuráveis
 * porque a fila é organizada por quem pediu e a resposta automática precisa do
 * endereço. Os três seguintes só aparecem se o formulário os pedir.
 */
export function camposDeIdentificacao(cfg: CamposDeIdentificacao) {
  const fixos = [
    { id: "nome", label: "Nome", tipo: "text" },
    { id: "email", label: "E-mail", tipo: "email" },
  ];
  const opcionais = [
    { id: "telefone", label: cfg.telefone, tipo: "tel" },
    { id: "area", label: cfg.area, tipo: "text" },
    { id: "polo", label: cfg.polo, tipo: "text" },
  ];
  return [
    ...fixos,
    ...opcionais.filter((c) => c.label).map((c) => ({ ...c, label: c.label! })),
  ];
}

const IDENT_VAZIO: Record<string, string> = {
  nome: "",
  email: "",
  telefone: "",
  area: "",
  polo: "",
};

/**
 * A porta pública, hoje alimentada pelo `solicitacaoForm.ts` (Spec 043, B).
 *
 * ⚠️ ESTA EXTRAÇÃO NÃO MUDA COMPORTAMENTO NENHUM, e é deliberadamente burra: o
 * corpo continua idêntico, e a única diferença é que as categorias chegam por
 * PROP em vez de virem do módulo. É o passo que separa "mover 580 linhas" de
 * "trocar a fonte do formulário" -- duas mudanças que, juntas, deixariam
 * qualquer defeito sem dono numa página que **não tem teste nenhum**.
 *
 * O próximo commit troca quem passa a prop.
 */
export default function FormularioSolicitacao({
  categorias,
  categoriaPorSlug,
  formId,
  titulo,
  descricao,
  identificacao,
}: {
  categorias: Categoria[];
  categoriaPorSlug: Record<string, Categoria>;
  /**
   * ⚠️ O TÍTULO ESTAVA ESCRITO NA MÃO ("FazAê · Solicitações de Marketing"),
   * mesmo com o formulário já tendo `title` no banco desde a fatia A. A fatia
   * B trocou a fonte das PERGUNTAS e esqueceu do cabeçalho -- qualquer
   * formulário novo abria com o nome do Marketing.
   */
  titulo: string;
  descricao: string;
  /**
   * Quais campos de identificação este formulário pede, e com que nome
   * (Spec 043, fatia G).
   *
   * ⚠️ NOME E E-MAIL NÃO ESTÃO AQUI, de propósito: a fila é organizada por
   * quem pediu, e a resposta automática de mudança de status precisa do
   * endereço. Os outros três são vocabulário institucional -- "Polo" não
   * significa nada num formulário de TI.
   */
  identificacao: CamposDeIdentificacao;
  /**
   * ⚠️ ELE VAI NO ENVIO, e é o que faz a solicitação cair na fila do TIME dono
   * do formulário. Sem ele ela nasce órfã: continua na fila (o `JOIN` é
   * `LEFT`), mas visível a quem tem `solicitation.review` no workspace
   * inteiro.
   */
  formId: string;
}) {
  // passo 0 = identificação+seleção; 1..N = seções; N+1 = revisão
  const [passo, setPasso] = useState(0);
  const [ident, setIdent] = useState<Record<string, string>>(IDENT_VAZIO);
  // ORDEM DE SELEÇÃO preservada: é a ordem das seções e do batch_seq.
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [valores, setValores] = useState<ValoresPorCategoria>({});
  const [honeypot, setHoneypot] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{
    protocol: string;
    created: number;
  } | null>(null);

  // Rascunho: só oferecemos restaurar depois de montar (localStorage não
  // existe no SSR). `hidratado` evita salvar por cima antes de perguntar.
  const [rascunhoAchado, setRascunhoAchado] = useState<RascunhoSolicitacao | null>(
    null
  );
  const [hidratado, setHidratado] = useState(false);
  const jaSalvou = useRef(false);
  // ⚠️ O FOCO VAI PARA O TÍTULO DE SUCESSO (revisão de títulos, 21/09). O
  // envio troca a tela inteira, e o botão "Enviar", que tinha o foco, deixa de
  // existir -- o foco caía no `<body>` e quem usa leitor de tela apertava
  // Enviar e não ouvia nada. Com o foco no `<h1>`, ele anuncia "Solicitação
  // enviada".
  const tituloDoResultado = useRef<HTMLHeadingElement>(null);
  useDocumentTitle(titulo);
  useEffect(() => {
    if (resultado) tituloDoResultado.current?.focus();
  }, [resultado]);

  useEffect(() => {
    const r = lerRascunho(formId);
    if (r) setRascunhoAchado(r);
    else setHidratado(true);
  }, []);

  // Salva a cada mudança, mas só depois de resolver o rascunho anterior.
  useEffect(() => {
    if (!hidratado || resultado) return;
    const temConteudo =
      selecionadas.length > 0 ||
      Object.values(ident).some((v) => v.trim().length > 0);
    if (!temConteudo && !jaSalvou.current) return;
    jaSalvou.current = true;
    salvarRascunho(formId, { ident, selecionadas, valores, passo });
  }, [ident, selecionadas, valores, passo, hidratado, resultado]);

  const categoriasSelecionadas: Categoria[] = useMemo(
    () =>
      selecionadas
        .map((slug) => categoriaPorSlug[slug])
        .filter((c): c is Categoria => Boolean(c)),
    [selecionadas]
  );

  const totalPassos = categoriasSelecionadas.length + 2; // seleção + seções + revisão
  const categoriaAtual =
    passo >= 1 && passo <= categoriasSelecionadas.length
      ? categoriasSelecionadas[passo - 1]
      : null;
  const naRevisao = passo === categoriasSelecionadas.length + 1;

  const camposVisiveis = useCallback(
    (cat: Categoria) =>
      cat.campos.filter((c) => campoVisivel(c, valores[cat.slug] ?? {})),
    [valores]
  );

  function alternarCategoria(slug: string) {
    setErro(null);
    setSelecionadas((prev) =>
      prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : [...prev, slug] // append: mantém a ordem de seleção
    );
  }

  // ⚠️ MEMOIZADO porque a lista entra num `map` de render e num `useEffect`
  // indireto: recriá-la a cada tecla digitada faria os campos perderem o foco.
  const campos = useMemo(
    () => camposDeIdentificacao(identificacao),
    [identificacao]
  );

  function identOk(): boolean {
    // ⚠️ NOME E E-MAIL SEMPRE. Os outros três só quando o formulário os pede
    // -- exigir "Polo" num formulário de TI travaria o envio num campo que a
    // tela nem desenha, e quem preenche não teria como descobrir por quê.
    if (ident.nome.trim().length < 2) return false;
    if (!/.+@.+\..+/.test(ident.email.trim())) return false;
    if (identificacao.telefone && ident.telefone.trim().length < 8) return false;
    if (identificacao.area && ident.area.trim().length === 0) return false;
    if (identificacao.polo && ident.polo.trim().length === 0) return false;
    return true;
  }

  function setValor(slug: string, campoId: string, v: string | string[]) {
    setValores((prev) => ({
      ...prev,
      [slug]: { ...(prev[slug] ?? {}), [campoId]: v },
    }));
  }

  /** Primeiro campo obrigatório vazio de uma categoria (ou null). */
  function faltando(cat: Categoria): Campo | null {
    const vals = valores[cat.slug] ?? {};
    for (const campo of camposVisiveis(cat)) {
      if (!campo.obrigatorio) continue;
      const v = vals[campo.id];
      if (v === undefined || (typeof v === "string" && !v.trim())) return campo;
      if (Array.isArray(v) && v.length === 0) return campo;
    }
    return null;
  }

  function avancar() {
    setErro(null);
    if (passo === 0) {
      if (!identOk()) {
        setErro(
          // ⚠️ A MENSAGEM É MONTADA DA LISTA DE CAMPOS, e não escrita à mão.
          // Fixa, ela acusava a pessoa de não preencher "área e polo" num
          // formulário que nem desenha esses campos -- exatamente o defeito
          // que o comentário do `identOk()` acima diz que não pode acontecer.
          // Achado pela revisão de 31/08.
          `Preencha ${campos
            .map((c) => c.label.toLowerCase())
            .join(", ")} antes de continuar.`
        );
        return;
      }
      if (selecionadas.length === 0) {
        setErro("Selecione ao menos um tipo de solicitação.");
        return;
      }
    } else if (categoriaAtual) {
      const falta = faltando(categoriaAtual);
      if (falta) {
        setErro(`Campo obrigatório não preenchido: "${falta.label}"`);
        document
          .getElementById(`campo-${categoriaAtual.slug}-${falta.id}`)
          ?.scrollIntoView({ block: "center" });
        return;
      }
    }
    setPasso((p) => Math.min(p + 1, totalPassos - 1));
    window.scrollTo({ top: 0 });
  }

  function voltar() {
    setErro(null);
    setPasso((p) => Math.max(0, p - 1));
    window.scrollTo({ top: 0 });
  }

  function irPara(indice: number) {
    setErro(null);
    setPasso(indice);
    window.scrollTo({ top: 0 });
  }

  function montarItens(): SolicitacaoItemEnvio[] {
    return categoriasSelecionadas.map((cat) => {
      const vals = valores[cat.slug] ?? {};
      const answers: SolicitacaoAnswer[] = [];
      for (const campo of camposVisiveis(cat)) {
        const v = vals[campo.id];
        if (v === undefined) continue;
        const texto = Array.isArray(v) ? v.join(", ") : v.trim();
        if (!texto) continue;
        answers.push({ label: campo.label, value: texto.slice(0, 5000) });
      }
      const resumoRaw = vals[cat.resumoDe];
      const resumo =
        (Array.isArray(resumoRaw) ? resumoRaw.join(", ") : resumoRaw)?.trim() ||
        cat.titulo;
      return { category: cat.slug, summary: resumo.slice(0, 500), answers };
    });
  }

  async function enviar() {
    setErro(null);
    // Revalida TUDO: a pessoa pode ter voltado e apagado algo.
    for (let i = 0; i < categoriasSelecionadas.length; i++) {
      const cat = categoriasSelecionadas[i];
      const falta = faltando(cat);
      if (falta) {
        setErro(
          `"${cat.titulo}" está incompleta: falta "${falta.label}". Clique em editar para corrigir.`
        );
        return;
      }
    }
    const items = montarItens();
    if (items.some((i) => i.answers.length === 0)) {
      setErro("Alguma seção ficou vazia. Revise antes de enviar.");
      return;
    }

    setEnviando(true);
    try {
      const r = await enviarSolicitacaoPublica({
        // ⚠️ SEMPRE MANDADO. O backend o aceita ausente por compatibilidade,
        // mas quem envia daqui sabe de qual formulário veio -- e é isso que põe
        // a solicitação na fila do time certo.
        form_id: formId,
        requester_name: ident.nome.trim(),
        requester_email: ident.email.trim(),
        // ⚠️ `null` NO QUE O FORMULÁRIO NÃO PERGUNTA, e não "". O backend
        // trata `null` como "este formulário não perguntou" e "" como
        // "perguntou e ficou em branco" -- a fila mostra só o que existe.
        requester_phone: identificacao.telefone ? ident.telefone.trim() : null,
        requester_department: identificacao.area ? ident.area.trim() : null,
        requester_polo: identificacao.polo ? ident.polo.trim() : null,
        items,
        website: honeypot,
      });
      limparRascunho(formId);
      setResultado(r);
    } catch (err) {
      const e = err as ApiError;
      setErro(
        e.status === 429
          ? "Muitas solicitações enviadas em pouco tempo. Aguarde alguns minutos e tente novamente."
          : e.message || "Não foi possível enviar. Tente novamente."
      );
    } finally {
      setEnviando(false);
    }
  }

  function recomecar() {
    limparRascunho(formId);
    setResultado(null);
    setIdent(IDENT_VAZIO);
    setSelecionadas([]);
    setValores({});
    setPasso(0);
    jaSalvou.current = false;
  }

  // ---------------- telas ----------------

  if (resultado) {
    return (
      <Casca>
        <div style={caixa({ textAlign: "center", gap: 12 })}>
          <div style={{ fontSize: 40 }}>✅</div>
          <h1
            ref={tituloDoResultado}
            // `-1`: recebe o foco pelo código, mas não entra na ordem do Tab.
            tabIndex={-1}
            style={{ margin: 0, fontSize: 20, outline: "none" }}
          >
            {resultado.created > 1
              ? `${resultado.created} solicitações enviadas`
              : "Solicitação enviada"}
          </h1>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            {/* ⚠️ Era "com o time de MARKETING", escrito na mão -- de antes de
                o formulário ser de qualquer time (Spec 043). */}
            Guarde o protocolo para acompanhar a sua solicitação:
          </p>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "var(--accent)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {resultado.protocol}
          </div>
          {resultado.created > 1 && (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Cada tipo de demanda é analisado separadamente e tem seu próprio
              prazo — podem ser aprovados em momentos diferentes.
            </p>
          )}
          <button className="btn" style={{ alignSelf: "center", marginTop: 8 }} onClick={recomecar}>
            Enviar outra solicitação
          </button>
        </div>
      </Casca>
    );
  }

  return (
    <Casca>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.02em" }}>
          {titulo}
        </h1>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
          {passo === 0
            ? descricao ||
              "Identifique-se e selecione TODOS os tipos de demanda que você precisa. Você preenche um de cada vez."
            : naRevisao
              ? "Confira tudo antes de enviar."
              : `Preencha os detalhes desta demanda.`}
        </p>
      </header>

      {rascunhoAchado && (
        <BannerRascunho
          rascunho={rascunhoAchado}
          onContinuar={() => {
            // ⚠️⚠️ SO RESTAURA SECAO QUE AINDA EXISTE. A chave do rascunho já
            // é por formulário, mas isso não cobre a seção APAGADA no editor
            // entre a visita e o retorno -- e o editor da fatia C2 tornou isso
            // possível. Restaurar um slug morto deixa a tela EM BRANCO: as três
            // seções do formulário são condicionais e nenhuma satisfaz a
            // condição com `selecionadas` desconhecidas.
            //
            // ⚠️ E O `passo` VOLTA PARA ZERO quando alguma some, em vez de ser
            // restaurado: ele é um índice dentro da lista de selecionadas, e
            // uma lista menor faz dele um número que aponta para lugar nenhum.
            const vivas = (rascunhoAchado.selecionadas ?? []).filter(
              (slug) => categoriaPorSlug[slug]
            );
            const perdeuAlguma =
              vivas.length !== (rascunhoAchado.selecionadas ?? []).length;

            setIdent({ ...IDENT_VAZIO, ...rascunhoAchado.ident });
            setSelecionadas(vivas);
            setValores(rascunhoAchado.valores ?? {});
            setPasso(perdeuAlguma ? 0 : rascunhoAchado.passo ?? 0);
            setRascunhoAchado(null);
            setHidratado(true);
            if (perdeuAlguma) {
              setErro(
                "Alguma coisa que você tinha escolhido não existe mais neste " +
                  "formulário. Confira a seleção antes de continuar."
              );
            }
          }}
          onDescartar={() => {
            limparRascunho(formId);
            setRascunhoAchado(null);
            setHidratado(true);
          }}
        />
      )}

      {selecionadas.length > 0 && (
        <Stepper
          categorias={categoriasSelecionadas}
          passo={passo}
          onIr={irPara}
          completa={(cat) => faltando(cat) === null}
        />
      )}

      {/* ⚠️ `role="alert"` FALTAVA AQUI, e esta é a única rota pública do
          produto -- quem usa leitor de tela não era avisado de que o envio
          falhou. As outras telas já têm; esta ficou para trás. Notado ao
          escrever o teste da mensagem de erro (revisão de 31/08). */}
      {erro && (
        <div className="error-box" style={{ marginBottom: 16 }} role="alert">
          {erro}
        </div>
      )}

      {/* Honeypot: invisível pra humanos, irresistível pra scripts. */}
      <div
        aria-hidden="true"
        style={{ position: "absolute", left: -9999, height: 0, overflow: "hidden" }}
      >
        <label>
          Website
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </label>
      </div>

      {/* ---------- passo 0: identificação + seleção ---------- */}
      {passo === 0 && (
        <>
          <section style={caixa({ gap: 14, marginBottom: 24 })}>
            {campos.map((c) => (
              <div className="field" key={c.id}>
                <label className="label" htmlFor={`id-${c.id}`}>
                  {c.label} <Obrigatorio />
                </label>
                <input
                  id={`id-${c.id}`}
                  className="input"
                  type={c.tipo}
                  value={ident[c.id]}
                  onChange={(e) =>
                    setIdent((p) => ({ ...p, [c.id]: e.target.value }))
                  }
                />
              </div>
            ))}
          </section>

          <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>
            Como podemos ajudar você hoje?
          </h2>
          <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
            Marque quantos precisar. Você preenche uma seção por tipo, na ordem
            em que marcar.
          </p>

          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            }}
          >
            {categorias.map((cat) => (
              <CartaoDeCategoria
                key={cat.slug}
                cat={cat}
                posicao={selecionadas.indexOf(cat.slug)}
                onAlternar={() => alternarCategoria(cat.slug)}
              />
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
            <button className="btn btn-primary" type="button" onClick={avancar}>
              {selecionadas.length > 1
                ? `Continuar — ${selecionadas.length} seções a preencher`
                : "Continuar"}
            </button>
          </div>
        </>
      )}

      {/* ---------- passos 1..N: uma seção por categoria ---------- */}
      {categoriaAtual && (
        <section style={caixa({ gap: 16 })}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>
              {categoriaAtual.emoji} {categoriaAtual.titulo}
            </h2>
            {categoriasSelecionadas.length > 1 && (
              <span className="muted" style={{ fontSize: 12 }}>
                seção {passo} de {categoriasSelecionadas.length}
              </span>
            )}
          </div>
          {categoriaAtual.prazo && (
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              ⏱ {categoriaAtual.prazo}
            </p>
          )}

          {camposVisiveis(categoriaAtual).map((campo) => (
            <CampoInput
              key={campo.id}
              slug={categoriaAtual.slug}
              campo={campo}
              valor={(valores[categoriaAtual.slug] ?? {})[campo.id]}
              onChange={(v) => setValor(categoriaAtual.slug, campo.id, v)}
            />
          ))}

          <NavPassos
            onVoltar={voltar}
            onAvancar={avancar}
            rotuloAvancar={
              passo === categoriasSelecionadas.length
                ? "Revisar e enviar"
                : `Próxima seção →`
            }
          />
        </section>
      )}

      {/* ---------- passo final: revisão ---------- */}
      {naRevisao && (
        <section style={caixa({ gap: 18 })}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>Revisão</h2>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
              {categoriasSelecionadas.length > 1
                ? `${categoriasSelecionadas.length} demandas serão abertas com um mesmo protocolo. Cada uma é analisada separadamente.`
                : "Confira os dados antes de enviar."}
            </p>
          </div>

          <div style={{ fontSize: 13 }}>
            {/* ⚠️ O TELEFONE SÓ ENTRA SE FOI PERGUNTADO. Fixo, ele deixava um
                "·" pendurado no fim da revisão -- a última tela antes de
                enviar, o pior lugar para uma dúvida. O bloco logo abaixo já
                tratava área e polo assim; esta linha ficou para trás. */}
            <strong>{ident.nome}</strong> · {ident.email}
            {identificacao.telefone ? ` · ${ident.telefone}` : ""}
            <br />
            <span className="muted">
              {/* ⚠️ SÓ O QUE O FORMULÁRIO PERGUNTOU. Com "Polo" desligado,
                  isto virava " / " sozinho no meio da revisão. */}
              {[
                identificacao.area ? ident.area : "",
                identificacao.polo ? ident.polo : "",
              ]
                .filter(Boolean)
                .join(" / ")}
            </span>{" "}
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: "2px 8px" }}
              onClick={() => irPara(0)}
            >
              editar
            </button>
          </div>

          {categoriasSelecionadas.map((cat, i) => {
            const answers = montarItens()[i]?.answers ?? [];
            return (
              <div
                key={cat.slug}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 14,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <strong style={{ fontSize: 14 }}>
                    {cat.emoji} {cat.titulo}
                  </strong>
                  {cat.prazo && (
                    <span className="muted" style={{ fontSize: 11 }}>
                      ⏱ {cat.prazo}
                    </span>
                  )}
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: "2px 8px", marginLeft: "auto" }}
                    onClick={() => irPara(i + 1)}
                  >
                    editar
                  </button>
                </div>
                <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {answers.map((a, j) => (
                    <div key={j}>
                      <dt style={{ fontSize: 11, fontWeight: 600, color: "var(--text-soft)" }}>
                        {a.label}
                      </dt>
                      <dd
                        style={{
                          margin: 0,
                          fontSize: 13,
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {a.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}

          <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
            <button className="btn" type="button" onClick={voltar} disabled={enviando}>
              ← Voltar
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={enviar}
              disabled={enviando}
            >
              {enviando
                ? "Enviando…"
                : categoriasSelecionadas.length > 1
                  ? `Enviar ${categoriasSelecionadas.length} solicitações`
                  : "Enviar solicitação"}
            </button>
          </div>
        </section>
      )}

      <footer style={{ marginTop: 32, textAlign: "center" }}>
        <p className="muted" style={{ fontSize: 12 }}>
          Os prazos são estimados e contados a partir da aprovação da solicitação
          pelo time de marketing.
          {hidratado && passo > 0 && " Seu preenchimento fica salvo neste navegador."}
        </p>
      </footer>
    </Casca>
  );
}

// ---------------- componentes ----------------

function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: "32px 16px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>{children}</div>
    </div>
  );
}

function caixa(extra: React.CSSProperties = {}): React.CSSProperties {
  return {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: 24,
    display: "flex",
    flexDirection: "column",
    ...extra,
  };
}

function Obrigatorio() {
  return <span style={{ color: "var(--danger)" }}>*</span>;
}

function BannerRascunho({
  rascunho,
  onContinuar,
  onDescartar,
}: {
  rascunho: RascunhoSolicitacao;
  onContinuar: () => void;
  onDescartar: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--accent)",
        borderRadius: 12,
        padding: 14,
        marginBottom: 18,
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap",
        background: "var(--surface)",
      }}
    >
      <span style={{ fontSize: 20 }}>📝</span>
      <div style={{ flex: 1, minWidth: 200, fontSize: 13 }}>
        Encontramos um preenchimento salvo {descreverIdade(rascunho.salvoEm)} neste
        navegador
        {rascunho.selecionadas?.length
          ? ` (${rascunho.selecionadas.length} tipo${rascunho.selecionadas.length > 1 ? "s" : ""} de demanda)`
          : ""}
        .
      </div>
      <button className="btn btn-primary" onClick={onContinuar}>
        Continuar de onde parei
      </button>
      <button className="btn btn-ghost" onClick={onDescartar}>
        Começar do zero
      </button>
    </div>
  );
}

function Stepper({
  categorias,
  passo,
  onIr,
  completa,
}: {
  categorias: Categoria[];
  passo: number;
  onIr: (i: number) => void;
  completa: (cat: Categoria) => boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        marginBottom: 16,
        fontSize: 12,
      }}
    >
      <Pastilha ativo={passo === 0} onClick={() => onIr(0)} rotulo="Seus dados" />
      {categorias.map((cat, i) => (
        <Pastilha
          key={cat.slug}
          ativo={passo === i + 1}
          onClick={() => onIr(i + 1)}
          rotulo={`${cat.emoji} ${cat.titulo}`}
          ok={completa(cat)}
        />
      ))}
      <Pastilha
        ativo={passo === categorias.length + 1}
        onClick={() => onIr(categorias.length + 1)}
        rotulo="Revisão"
      />
    </div>
  );
}

function Pastilha({
  ativo,
  ok,
  rotulo,
  onClick,
}: {
  ativo: boolean;
  ok?: boolean;
  rotulo: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tappable"
      style={{
        border: `1px solid ${ativo ? "var(--accent)" : "var(--border)"}`,
        color: ativo ? "var(--accent)" : "var(--text-soft)",
        fontWeight: ativo ? 600 : 400,
        background: "transparent",
        borderRadius: 999,
        padding: "4px 10px",
        cursor: "pointer",
        font: "inherit",
        fontSize: 12,
        maxWidth: 220,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {ok ? "✓ " : ""}
      {rotulo}
    </button>
  );
}

function NavPassos({
  onVoltar,
  onAvancar,
  rotuloAvancar,
}: {
  onVoltar: () => void;
  onAvancar: () => void;
  rotuloAvancar: string;
}) {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "space-between", marginTop: 8 }}>
      <button className="btn" type="button" onClick={onVoltar}>
        ← Voltar
      </button>
      <button className="btn btn-primary" type="button" onClick={onAvancar}>
        {rotuloAvancar}
      </button>
    </div>
  );
}

function CampoInput({
  slug,
  campo,
  valor,
  onChange,
}: {
  slug: string;
  campo: Campo;
  valor: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
}) {
  const id = `campo-${slug}-${campo.id}`;

  return (
    <div className="field" id={id}>
      <label className="label" htmlFor={`${id}-input`}>
        {campo.label} {campo.obrigatorio && <Obrigatorio />}
      </label>
      {campo.ajuda && (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          {campo.ajuda}
        </p>
      )}

      {campo.tipo === "texto" && (
        <input
          id={`${id}-input`}
          className="input"
          type="text"
          placeholder={campo.placeholder}
          value={(valor as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {campo.tipo === "textoLongo" && (
        <textarea
          id={`${id}-input`}
          className="input"
          rows={4}
          placeholder={campo.placeholder}
          value={(valor as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          style={{ resize: "vertical" }}
        />
      )}

      {campo.tipo === "data" && (
        <input
          id={`${id}-input`}
          className="input"
          type="date"
          value={(valor as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          style={{ maxWidth: 220 }}
        />
      )}

      {campo.tipo === "link" && (
        <input
          id={`${id}-input`}
          className="input"
          type="url"
          placeholder="https://drive.google.com/…"
          value={(valor as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {campo.tipo === "escolha" && campo.opcoes && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {campo.opcoes.map((op) => (
            <label
              key={op}
              style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, cursor: "pointer" }}
            >
              <input
                type="radio"
                // name por SEÇÃO: sem o slug, campos de categorias
                // diferentes com mesmo id disputariam o mesmo grupo.
                name={`${slug}-${campo.id}`}
                checked={valor === op}
                onChange={() => onChange(op)}
              />
              {op}
            </label>
          ))}
        </div>
      )}

      {campo.tipo === "multi" && campo.opcoes && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {campo.opcoes.map((op) => {
            const lista = Array.isArray(valor) ? valor : [];
            const marcado = lista.includes(op);
            return (
              <label
                key={op}
                style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={marcado}
                  onChange={() =>
                    onChange(marcado ? lista.filter((x) => x !== op) : [...lista, op])
                  }
                />
                {op}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Um cartão de categoria, na escolha do que se vai pedir.
 *
 * ⚠️⚠️ VIROU COMPONENTE em 10/09 pelo CONTORNO: o cartão era um
 * `<button className="tappable">` dentro do `.map()`, e o anel duro do CSS deu
 * lugar ao traço desenhado -- gancho não se chama dentro de um `map`.
 *
 * ⚠️ `marcada` NÃO É PROP, e é derivada de `posicao`: dois campos para o mesmo
 * fato ("estou selecionada" e "sou a n-ésima") divergem no primeiro chamador
 * distraído. A posição é a verdade; a marca é uma pergunta sobre ela.
 *
 * ⚠️ `radius` 12 = o `borderRadius` de baixo. Os dois têm de andar juntos.
 */
function CartaoDeCategoria({
  cat,
  posicao,
  onAlternar,
}: {
  cat: Categoria;
  posicao: number;
  onAlternar: () => void;
}) {
  const marcada = posicao >= 0;
  const { target, outline } = useDrawnOutline();
  return (
    <button
      type="button"
      onClick={onAlternar}
      aria-pressed={marcada}
      {...target}
      style={{
        textAlign: "left",
        background: "var(--surface)",
        border: `1px solid ${marcada ? "var(--accent)" : "var(--border)"}`,
        boxShadow: marcada ? "0 0 0 1px var(--accent) inset" : undefined,
        borderRadius: 12,
        padding: 16,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        font: "inherit",
        color: "var(--text)",
        // ⚠️ É ele que faz o contorno medir ESTE cartão.
        position: "relative",
      }}
    >
      {outline}
                  {marcada && (
                    <span
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        top: 10,
                        right: 10,
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: "var(--accent)",
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 700,
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      {posicao + 1}
                    </span>
                  )}
                  <span style={{ fontSize: 22 }}>{cat.emoji}</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{cat.titulo}</span>
                  {cat.prazo && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      ⏱ {cat.prazo}
                    </span>
                  )}
    </button>
  );
}
