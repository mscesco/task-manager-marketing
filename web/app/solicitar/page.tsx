"use client";
// /solicitar: a porta de entrada pública. Com um formulário só, abre direto
// (o link já divulgado continua levando a ele); com dois ou mais, lista.
// Cada formulário tem também `/solicitar/<slug>`.

import { useEffect, useState } from "react";

import FormularioPublico from "@/components/FormularioPublico";
import { AvisoPublico, MolduraPublica } from "@/components/MolduraPublica";
import Loading from "@/components/Loading";
import { useDrawnOutline } from "@/components/AnimatedOutline";
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
      <MolduraPublica>
        <AvisoPublico
          titulo="Não consegui carregar os formulários"
          texto="Tente de novo em instantes. Se continuar assim, avise quem enviou este link."
        />
      </MolduraPublica>
    );
  }

  if (formularios === null) {
    return (
      <MolduraPublica>
        <Loading />
      </MolduraPublica>
    );
  }

  if (formularios.length === 0) {
    // Vazio não é erro: pode ser um workspace que ainda não publicou nada.
    return (
      <MolduraPublica>
        <AvisoPublico
          titulo="Nenhum formulário disponível"
          texto="Ainda não há formulários publicados. Avise quem enviou este link se você esperava encontrar um aqui."
        />
      </MolduraPublica>
    );
  }

  if (formularios.length === 1) {
    return (
      // `<MolduraPublica>` aqui também: o carregamento e o erro do formulário aparecem dentro dela.
      <MolduraPublica>
        <FormularioPublico slug={formularios[0].slug} />
      </MolduraPublica>
    );
  }

  // Agrupado por time: "Arte" e "Acesso" soltos não dizem a quem pertencem.
  const porTime = new Map<string, FormularioPublicoResumo[]>();
  for (const f of formularios) {
    const atual = porTime.get(f.team_name) ?? [];
    atual.push(f);
    porTime.set(f.team_name, atual);
  }

  return (
    <MolduraPublica>
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
              <CartaoDeFormulario key={f.slug} f={f} />
            ))}
          </div>
        </section>
      ))}
    </MolduraPublica>
  );
}

/**
 * Um cartão de formulário público. `radius` 12 tem de bater com o
 * `borderRadius` de baixo: o contorno é um `<path>` em pixels.
 */
function CartaoDeFormulario({
  f,
}: {
  f: { slug: string; title: string; description?: string | null };
}) {
  const { target, outline } = useDrawnOutline();
  return (
    <a
      href={`/solicitar/${f.slug}`}
      {...target}
      style={{
        // `relative`: o contorno mede este cartão.
        position: "relative",
        cursor: "pointer",
        display: "block",
        padding: "14px 16px",
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      {outline}
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
  );
}

