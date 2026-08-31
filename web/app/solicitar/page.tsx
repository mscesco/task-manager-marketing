"use client";
// /solicitar -- a PORTA de entrada publica (Spec 043, fatia B).
//
// ⚠️ ELA DEIXOU DE SER O FORMULÁRIO E VIROU O CAMINHO ATÉ ELE. Até aqui esta
// rota desenhava o formulário do Marketing, lido de `lib/solicitacaoForm.ts`.
// Agora os formulários moram no banco, cada time pode ter os seus, e esta
// página resolve qual mostrar.
//
// ⚠️⚠️ COM UM FORMULÁRIO SÓ, ELA ABRE DIRETO -- e isso não é atalho, é
// preservar o que já está divulgado. O link `/solicitar` está no ar hoje e
// leva ao formulário; transformá-lo numa lista de um item só acrescentaria um
// clique para todo mundo que já o usa, sem dar nada em troca. A lista aparece
// quando ela passa a existir de verdade, com dois ou mais.
//
// A decisão da Camila foi "os dois" -- lista E URL por formulário. Isto é
// exatamente isso: a lista quando há o que listar, e `/solicitar/<slug>`
// sempre, para divulgação direta.

import { useEffect, useState } from "react";

import CarregaFormularioPublico from "@/components/CarregaFormularioPublico";
import FormularioSolicitacao from "@/components/FormularioSolicitacao";
import {
  listarFormulariosPublicos,
  type FormularioPublicoResumo,
} from "@/lib/api";

export default function SolicitarPage() {
  const [formularios, setFormularios] = useState<
    FormularioPublicoResumo[] | null
  >(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let vivo = true;
    listarFormulariosPublicos()
      .then((f) => vivo && setFormularios(f))
      .catch(() => vivo && setErro(true));
    return () => {
      vivo = false;
    };
  }, []);

  if (erro) {
    return (
      <Casca>
        <Aviso
          titulo="Não consegui carregar os formulários"
          texto="Tente de novo em instantes. Se continuar assim, avise a equipe de marketing."
        />
      </Casca>
    );
  }

  if (formularios === null) {
    return (
      <Casca>
        <p className="muted" style={{ fontSize: 14 }}>
          Carregando…
        </p>
      </Casca>
    );
  }

  if (formularios.length === 0) {
    // ⚠️ VAZIO NÃO É ERRO. Pode ser um workspace que ainda não publicou nada --
    // e o texto de falha mandaria a pessoa esperar por algo que não vai
    // aparecer sozinho.
    return (
      <Casca>
        <Aviso
          titulo="Nenhum formulário disponível"
          texto="Ainda não há formulários publicados. Avise a equipe de marketing se você esperava encontrar um aqui."
        />
      </Casca>
    );
  }

  if (formularios.length === 1) {
    return (
      // ⚠️ `<Casca>` AQUI TAMBEM. Os outros quatro ramos deste arquivo já
      // envolvem, e este não envolvia: enquanto o formulário carrega -- ou se
      // ele der 404/500 --, o texto e a caixa de aviso ficavam soltos no fundo
      // padrão do navegador, sem o fundo e o respiro do produto. A rota irmã
      // `/solicitar/[slug]` já fazia certo.
      <Casca>
        <CarregaFormularioPublico slug={formularios[0].slug}>
          {({ categorias, categoriaPorSlug, form }) => (
            <FormularioSolicitacao
              // ⚠️⚠️ `key` PELO ID DO FORMULARIO, e nao enfeite. O
              // `CarregaFormularioPublico` entrega o formulario por render
              // prop: se o `slug` mudar, este componente fica na MESMA posicao
              // da arvore e o React so troca as props -- sem remontar. O
              // efeito que le o rascunho roda so na montagem, entao o estado
              // do formulario A sobreviveria, e o efeito de GRAVACAO passaria
              // a escreve-lo sob a chave de B: o vazamento entre formularios
              // que a chave por `formId` acabou de fechar, voltando por outra
              // porta.
              //
              // ⚠️ `key` E MELHOR QUE POR `formId` NAS DEPENDENCIAS: remontar
              // zera TODO o estado (ident, selecionadas, valores, passo), e
              // nao so o que alguem lembrar de listar.
              key={form.id}
              categorias={categorias}
              categoriaPorSlug={categoriaPorSlug}
              formId={form.id}
              titulo={form.title}
              descricao={form.description}
              identificacao={{
                telefone: form.phone_label,
                area: form.department_label,
                polo: form.polo_label,
              }}
            />
          )}
        </CarregaFormularioPublico>
      </Casca>
    );
  }

  // ⚠️ AGRUPADO POR TIME, e o nome do time vem da API justamente para isto.
  // Com dois times pedindo coisas diferentes, "Arte" e "Acesso" soltos na
  // mesma lista não dizem a quem cada um pertence.
  const porTime = new Map<string, FormularioPublicoResumo[]>();
  for (const f of formularios) {
    const atual = porTime.get(f.team_name) ?? [];
    atual.push(f);
    porTime.set(f.team_name, atual);
  }

  return (
    <Casca>
      <h1 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 800 }}>
        O que você precisa?
      </h1>
      <p className="muted" style={{ margin: "0 0 22px", fontSize: 14 }}>
        Escolha o formulário do time que vai atender o seu pedido.
      </p>
      {[...porTime.entries()].map(([time, lista]) => (
        <section key={time} style={{ marginBottom: 26 }}>
          <h2
            className="muted"
            style={{
              margin: "0 0 8px",
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {time}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {lista.map((f) => (
              <a
                key={f.slug}
                href={`/solicitar/${f.slug}`}
                className="tappable"
                style={{
                  display: "block",
                  padding: "14px 16px",
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <strong style={{ fontSize: 15 }}>{f.title}</strong>
                {f.description && (
                  <span
                    className="muted"
                    style={{ display: "block", fontSize: 13, marginTop: 3 }}
                  >
                    {f.description}
                  </span>
                )}
              </a>
            ))}
          </div>
        </section>
      ))}
    </Casca>
  );
}

/** A mesma moldura do formulário, para os estados não ficarem soltos na tela. */
function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        padding: "32px 16px",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>{children}</div>
    </div>
  );
}

function Aviso({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: 20,
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      <strong style={{ fontSize: 16, display: "block", marginBottom: 6 }}>
        {titulo}
      </strong>
      <p className="muted" style={{ fontSize: 14, margin: 0, lineHeight: 1.5 }}>
        {texto}
      </p>
    </div>
  );
}
