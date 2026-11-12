"use client";
// Formulário público de solicitação de demandas: sem AppShell e sem auth.
//
// Passos: 0 = identificação + escolha de 1..N tipos; 1..N = uma seção por
// tipo, na ordem marcada; N+1 = revisão.
//
// Cada tipo vira uma solicitação independente no backend (mesmo protocolo,
// triagem separada), mas o envio é um POST só: o rate limit é por IP.
//
// Rascunho salvo no navegador a cada mudança (lib/rascunhoSolicitacao).
// Anti-bot: input honeypot "website" escondido.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDrawnOutline } from "@/components/AnimatedOutline";
import { MolduraPublica } from "@/components/MolduraPublica";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import {
  enviarSolicitacaoPublica,
  ApiError,
  type SolicitacaoAnswer,
  type SolicitacaoItemEnvio,
} from "@/lib/api";
import {
  campoVisivel,
  MAX_ITENS_POR_ENVIO,
  MAX_REPETICOES,
  novaRepeticao,
  rotuloDaRepeticao,
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
 * Os campos da etapa de identificação. Nome e e-mail são fixos e vêm
 * primeiro (a fila é por quem pediu e a resposta automática precisa do
 * endereço); os outros só se o formulário pedir.
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
 * A porta pública: desenha o formulário com as categorias recebidas por prop.
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
  titulo: string;
  descricao: string;
  /**
   * Quais campos de identificação, além de nome e e-mail, este formulário
   * pede, e com que nome.
   */
  identificacao: CamposDeIdentificacao;
  /**
   * Vai no envio: põe a solicitação na fila do time dono do formulário.
   */
  formId: string;
}) {
  // passo 0 = identificação+seleção; 1..N = seções; N+1 = revisão
  const [passo, setPasso] = useState(0);
  const [ident, setIdent] = useState<Record<string, string>>(IDENT_VAZIO);
  // Ordem de seleção preservada: é a ordem das seções e do batch_seq.
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [valores, setValores] = useState<ValoresPorCategoria>({});
  // As repetições de cada seção repetível, como chaves de `valores` (a
  // primeira é o próprio slug). Seção sem entrada aqui vale uma vez.
  const [repeticoes, setRepeticoes] = useState<Record<string, string[]>>({});
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
  // O foco vai para o título de sucesso: o botão "Enviar" deixa de existir.
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
    salvarRascunho(formId, { ident, selecionadas, valores, passo, repeticoes });
  }, [ident, selecionadas, valores, passo, repeticoes, hidratado, resultado]);

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
  // Cada repetição é uma demanda: o total de itens do envio.
  const totalDeItens = categoriasSelecionadas.reduce(
    (n, cat) => n + (cat.repetivel ? Math.max(1, repeticoes[cat.slug]?.length ?? 1) : 1),
    0
  );

  const camposVisiveis = useCallback(
    (cat: Categoria, chave: string = cat.slug) =>
      cat.campos.filter((c) => campoVisivel(c, valores[chave] ?? {}, cat.campos)),
    [valores]
  );

  /** As repetições de uma seção (chaves de `valores`). Uma, se não repete. */
  function chavesDe(cat: Categoria): string[] {
    if (!cat.repetivel) return [cat.slug];
    const r = repeticoes[cat.slug];
    return r && r.length > 0 ? r : [cat.slug];
  }

  const podeRepetir = (cat: Categoria) =>
    chavesDe(cat).length < MAX_REPETICOES && totalDeItens < MAX_ITENS_POR_ENVIO;

  function adicionarRepeticao(cat: Categoria) {
    const atuais = chavesDe(cat);
    if (!podeRepetir(cat)) return;
    setErro(null);
    setRepeticoes((p) => ({ ...p, [cat.slug]: [...atuais, novaRepeticao(cat.slug, atuais)] }));
  }

  function removerRepeticao(cat: Categoria, chave: string) {
    const atuais = chavesDe(cat);
    if (atuais.length <= 1) return;
    setErro(null);
    setRepeticoes((p) => ({ ...p, [cat.slug]: atuais.filter((k) => k !== chave) }));
    setValores((p) => {
      const { [chave]: _fora, ...resto } = p;
      return resto;
    });
  }

  function alternarCategoria(slug: string) {
    setErro(null);
    setSelecionadas((prev) =>
      prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : [...prev, slug] // append: mantém a ordem de seleção
    );
  }

  // Memoizado: recriar a lista a cada tecla faria os campos perderem o foco.
  const campos = useMemo(
    () => camposDeIdentificacao(identificacao),
    [identificacao]
  );

  function identOk(): boolean {
    // Nome e e-mail sempre; os outros só quando o formulário os pede (a tela
    // nem desenha os demais).
    if (ident.nome.trim().length < 2) return false;
    if (!/.+@.+\..+/.test(ident.email.trim())) return false;
    if (identificacao.telefone && ident.telefone.trim().length < 8) return false;
    if (identificacao.area && ident.area.trim().length === 0) return false;
    if (identificacao.polo && ident.polo.trim().length === 0) return false;
    return true;
  }

  function setValor(chave: string, campoId: string, v: string | string[]) {
    setValores((prev) => ({
      ...prev,
      [chave]: { ...(prev[chave] ?? {}), [campoId]: v },
    }));
  }

  /** Primeiro campo obrigatório vazio de UMA repetição da seção (ou null). */
  function faltandoEm(cat: Categoria, chave: string): Campo | null {
    const vals = valores[chave] ?? {};
    for (const campo of camposVisiveis(cat, chave)) {
      if (!campo.obrigatorio) continue;
      const v = vals[campo.id];
      if (v === undefined || (typeof v === "string" && !v.trim())) return campo;
      if (Array.isArray(v) && v.length === 0) return campo;
    }
    return null;
  }

  /** O primeiro que falta na seção inteira (todas as repetições), e onde. */
  function faltandoNaSecao(cat: Categoria): { campo: Campo; chave: string; n: number } | null {
    const chaves = chavesDe(cat);
    for (let i = 0; i < chaves.length; i++) {
      const campo = faltandoEm(cat, chaves[i]);
      if (campo) return { campo, chave: chaves[i], n: i + 1 };
    }
    return null;
  }

  function faltando(cat: Categoria): Campo | null {
    return faltandoNaSecao(cat)?.campo ?? null;
  }

  /** " (evento 2)" quando a seção tem mais de uma repetição. */
  function qual(cat: Categoria, n: number): string {
    return chavesDe(cat).length > 1 ? ` (${rotuloDaRepeticao(cat)} ${n})` : "";
  }

  function avancar() {
    setErro(null);
    if (passo === 0) {
      if (!identOk()) {
        setErro(
          // A mensagem sai da lista de campos que o formulário pede.
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
      const falta = faltandoNaSecao(categoriaAtual);
      if (falta) {
        setErro(
          `Campo obrigatório não preenchido: "${falta.campo.label}"${qual(categoriaAtual, falta.n)}`
        );
        document
          .getElementById(`campo-${falta.chave}-${falta.campo.id}`)
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

  /** Um item do envio por repetição de cada seção, na ordem. */
  function montarItens(): SolicitacaoItemEnvio[] {
    return categoriasSelecionadas.flatMap((cat) => chavesDe(cat).map((chave) => montarItem(cat, chave)));
  }

  function montarItem(cat: Categoria, chave: string): SolicitacaoItemEnvio {
    const vals = valores[chave] ?? {};
    const answers: SolicitacaoAnswer[] = [];
    for (const campo of camposVisiveis(cat, chave)) {
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
  }

  async function enviar() {
    setErro(null);
    // Revalida TUDO: a pessoa pode ter voltado e apagado algo.
    for (let i = 0; i < categoriasSelecionadas.length; i++) {
      const cat = categoriasSelecionadas[i];
      const falta = faltandoNaSecao(cat);
      if (falta) {
        setErro(
          `"${cat.titulo}"${qual(cat, falta.n)} está incompleta: falta "${falta.campo.label}". Clique em editar para corrigir.`
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
        // Sempre mandado: põe a solicitação na fila do time certo.
        form_id: formId,
        requester_name: ident.nome.trim(),
        requester_email: ident.email.trim(),
        // `null` no que o formulário não pergunta: "" é "perguntou e ficou em branco".
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
    setRepeticoes({});
    setPasso(0);
    jaSalvou.current = false;
  }

  // ---------------- telas ----------------

  if (resultado) {
    return (
      <MolduraPublica>
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
      </MolduraPublica>
    );
  }

  return (
    <MolduraPublica>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
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
            // Só restaura seção que ainda existe (o editor pode tê-la apagado),
            // e o `passo` volta a zero quando alguma some: é um índice nas
            // selecionadas.
            const vivas = (rascunhoAchado.selecionadas ?? []).filter(
              (slug) => categoriaPorSlug[slug]
            );
            const perdeuAlguma =
              vivas.length !== (rascunhoAchado.selecionadas ?? []).length;

            setIdent({ ...IDENT_VAZIO, ...rascunhoAchado.ident });
            setSelecionadas(vivas);
            setValores(rascunhoAchado.valores ?? {});
            setRepeticoes(
              Object.fromEntries(
                Object.entries(rascunhoAchado.repeticoes ?? {}).filter(
                  ([slug, ks]) => categoriaPorSlug[slug]?.repetivel && Array.isArray(ks)
                )
              )
            );
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

      <Stepper
        categorias={categoriasSelecionadas}
        passo={passo}
        onIr={irPara}
        completa={(cat) => faltando(cat) === null}
      />

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

          {!categoriaAtual.repetivel &&
            camposVisiveis(categoriaAtual).map((campo) => (
              <CampoInput
                key={campo.id}
                slug={categoriaAtual.slug}
                campo={campo}
                valor={(valores[categoriaAtual.slug] ?? {})[campo.id]}
                onChange={(v) => setValor(categoriaAtual.slug, campo.id, v)}
              />
            ))}

          {/* A seção repetível empilha uma caixa por repetição. */}
          {categoriaAtual.repetivel && (
            <>
              {chavesDe(categoriaAtual).map((chave, i, todas) => (
                <fieldset
                  key={chave}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 14,
                    margin: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                  }}
                >
                  <legend
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "0 6px",
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: "capitalize",
                    }}
                  >
                    {rotuloDaRepeticao(categoriaAtual)} {i + 1}
                  </legend>
                  {todas.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ alignSelf: "flex-end", fontSize: 12, padding: "2px 8px", marginTop: -8 }}
                      aria-label={`Remover ${rotuloDaRepeticao(categoriaAtual)} ${i + 1}`}
                      onClick={() => removerRepeticao(categoriaAtual, chave)}
                    >
                      Remover
                    </button>
                  )}
                  {camposVisiveis(categoriaAtual, chave).map((campo) => (
                    <CampoInput
                      key={campo.id}
                      slug={chave}
                      campo={campo}
                      valor={(valores[chave] ?? {})[campo.id]}
                      onChange={(v) => setValor(chave, campo.id, v)}
                    />
                  ))}
                </fieldset>
              ))}
              {podeRepetir(categoriaAtual) ? (
                <button
                  type="button"
                  className="btn"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => adicionarRepeticao(categoriaAtual)}
                >
                  + Adicionar outro {rotuloDaRepeticao(categoriaAtual)}
                </button>
              ) : (
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                  {totalDeItens >= MAX_ITENS_POR_ENVIO
                    ? `Limite de ${MAX_ITENS_POR_ENVIO} demandas por envio.`
                    : `Limite de ${MAX_REPETICOES} por envio.`}{" "}
                  Para mais, envie outra solicitação.
                </p>
              )}
            </>
          )}

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
              {totalDeItens > 1
                ? `${totalDeItens} demandas serão abertas com um mesmo protocolo. Cada uma é analisada separadamente.`
                : "Confira os dados antes de enviar."}
            </p>
          </div>

          <div style={{ fontSize: 13 }}>
            {/* O telefone só entra se foi perguntado. */}
            <strong>{ident.nome}</strong> · {ident.email}
            {identificacao.telefone ? ` · ${ident.telefone}` : ""}
            <br />
            <span className="muted">
              {/* Só o que o formulário perguntou. */}
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

          {categoriasSelecionadas.flatMap((cat, i) =>
            chavesDe(cat).map((chave, n, todas) => ({ cat, i, chave, n, todas }))
          ).map(({ cat, i, chave, n, todas }) => {
            const answers = montarItem(cat, chave).answers;
            return (
              <div
                key={chave}
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
                    {todas.length > 1 && (
                      <span className="muted" style={{ fontWeight: 400 }}>
                        {" "}
                        · {rotuloDaRepeticao(cat)} {n + 1}
                      </span>
                    )}
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
                : totalDeItens > 1
                  ? `Enviar ${totalDeItens} solicitações`
                  : "Enviar solicitação"}
            </button>
          </div>
        </section>
      )}

      <footer style={{ marginTop: 32, textAlign: "center" }}>
        <p className="muted" style={{ fontSize: 12 }}>
          Os prazos são estimados e contados a partir da aprovação da solicitação
          pelo time responsável.
          {hidratado && passo > 0 && " Seu preenchimento fica salvo neste navegador."}
        </p>
      </footer>
    </MolduraPublica>
  );
}

// ---------------- componentes ----------------

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
  // Passos numerados. Sem tipo marcado, o meio é um passo só ("O que
  // precisa"); cada tipo marcado vira o seu próprio passo.
  const ultimo = categorias.length + 1;
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        flexWrap: "wrap",
        marginBottom: 18,
      }}
    >
      <Pastilha numero={1} ativo={passo === 0} ok={passo > 0} onClick={() => onIr(0)} rotulo="Seus dados" />
      {categorias.length === 0 && (
        <Pastilha numero={2} ativo={false} onClick={() => onIr(0)} rotulo="O que precisa" />
      )}
      {categorias.map((cat, i) => (
        <Pastilha
          key={cat.slug}
          numero={i + 2}
          ativo={passo === i + 1}
          onClick={() => onIr(i + 1)}
          rotulo={`${cat.emoji} ${cat.titulo}`}
          ok={completa(cat)}
        />
      ))}
      <Pastilha
        numero={ultimo + 1}
        ativo={passo === ultimo}
        onClick={() => onIr(ultimo)}
        rotulo="Revisão"
      />
    </div>
  );
}

function Pastilha({
  numero,
  ativo,
  ok,
  rotulo,
  onClick,
}: {
  numero: number;
  ativo: boolean;
  ok?: boolean;
  rotulo: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ativo ? "step" : undefined}
      className="tappable"
      style={{
        border: "none",
        background: "transparent",
        padding: 0,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        // `fontFamily`, não `font: inherit`: o atalho junto do `fontWeight`
        // variável gera aviso do React.
        fontFamily: "inherit",
        fontSize: 12,
        fontWeight: 700,
        color: ativo ? "var(--accent)" : ok ? "var(--teal)" : "var(--text-faint)",
        maxWidth: 240,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          flexShrink: 0,
          display: "inline-grid",
          placeItems: "center",
          fontSize: 11,
          border: `1.5px solid ${ativo ? "var(--accent)" : ok ? "var(--teal)" : "var(--border)"}`,
          background: ativo ? "var(--accent)" : ok ? "var(--teal)" : "transparent",
          color: ativo || ok ? "#fff" : "var(--text-faint)",
        }}
      >
        {ok && !ativo ? "✓" : numero}
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {rotulo}
      </span>
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
 * Um cartão de categoria, na escolha do que se vai pedir. Componente próprio
 * por causa do gancho do contorno. `marcada` deriva de `posicao`. `radius` 12
 * tem de andar junto com o `borderRadius` de baixo.
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
        // Marcada = fundo azul suave.
        background: marcada ? "var(--accent-soft)" : "var(--surface)",
        border: `1.5px solid ${marcada ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 12,
        padding: 16,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        font: "inherit",
        color: "var(--text)",
        // Faz o contorno medir este cartão.
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
