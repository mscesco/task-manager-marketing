"use client";
// components/PainelDoMembro.tsx
// O painel do membro — Spec 047, fatia D.
//
// ⚠️⚠️ ELE EXISTE PORQUE O CARGO MORA NO VÍNCULO, e não na pessoa:
// `UNIQUE (user_id, team_id)` dá um cargo por time. "Operador em Mídias,
// supervisor em SEO" é o caso normal, e uma linha de tabela com um cargo só
// não consegue nem exibir isso.
//
// ⚠️ MORA EM `components/`, e não em `app/`: o `include` do vitest cobre
// `components/**`, então este arquivo PODE ganhar teste — ao contrário das
// páginas. A §7 da spec pede isso com todas as letras.
//
// A divisão da §4.4: a tabela mostra · o lápis define em QUAIS subtimes · o
// painel define COM QUE CARGO em cada um.

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import Badge from "@/components/Badge";
import {
  ApiError,
  changeMemberRole,
  changeOrganizationRole,
  deactivateMember,
  listMemberTeams,
  removeMemberFromTeam,
  type Member,
  type MemberRole,
  type MemberTeamComCadeado,
  type OrgRole,
  type Team,
} from "@/lib/api";
import {
  consequenciaDoCargo,
  vinculosDoPainel,
  type VinculoDoPainel,
} from "@/lib/painelDoMembro";
import {
  papeisAtribuiveis,
  podeDesativarConta,
  type Alcance,
} from "@/lib/permissoesMembros";

const PAPEL: Record<MemberRole, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};

const PAPEL_ORG: Record<OrgRole, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
};

export default function PainelDoMembro({
  membro,
  times,
  alcance,
  souAdmin,
  podeMexerNaOrganizacao,
  souEu,
  onFechar,
  onMudou,
}: {
  membro: Member;
  times: Team[];
  alcance: Alcance;
  souAdmin: boolean;
  podeMexerNaOrganizacao: boolean;
  souEu: boolean;
  onFechar: () => void;
  onMudou: (aviso: string) => Promise<void>;
}) {
  const [vinculos, setVinculos] = useState<MemberTeamComCadeado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    listMemberTeams(membro.id)
      .then((v) => vivo && setVinculos(v))
      .catch((e) =>
        vivo ? setErro((e as ApiError).message || "Não consegui carregar.") : null,
      );
    return () => {
      vivo = false;
    };
  }, [membro.id]);

  const linhas = vinculos ? vinculosDoPainel(vinculos, times) : [];

  return (
    <div
      className="modal-scrim"
      // ⚠️ POSICIONAMENTO INLINE: `.modal-scrim` no `globals.css` carrega SÓ a
      // animação de entrada. Confiar nela para posicionar deixaria a caixa no
      // fluxo da página — está registrado em `FormNovaColuna`, medido em 13/08.
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(16,24,40,0.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "8vh 16px 24px",
      }}
      onMouseDown={(e) => {
        // ⚠️ SÓ O CLIQUE NO PRÓPRIO FUNDO FECHA. Sem esta conferência, soltar
        // o botão fora depois de selecionar texto dentro fecharia o painel.
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      <div
        className="modal-card w-full max-w-[520px] overflow-hidden rounded-lg border border-border bg-surface"
        role="dialog"
        aria-modal="true"
        aria-label={`Detalhes de ${membro.name}`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onFechar();
        }}
      >
        <div className="flex items-start gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <strong className="truncate text-base">{membro.name}</strong>
              <Badge
                tone={membro.is_active ? "soft" : "outline"}
                size="sm"
                color={membro.is_active ? "var(--accent)" : undefined}
              >
                {membro.is_active ? "Ativo" : "Inativo"}
              </Badge>
            </div>
            <div className="muted truncate text-xs">{membro.email}</div>
          </div>
          <button className="btn btn-ghost" aria-label="Fechar" onClick={onFechar}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-4">
          {erro && <div className="error-box mb-3 text-xs">{erro}</div>}

          {/* ---- PAPEL NA ORGANIZAÇÃO -------------------------------------
              ⚠️ NO TOPO E SEPARADO DOS TIMES, porque ele não TEM time. É a
              outra pertença (Spec 045): quem administra a organização não
              administra "um time", administra tudo. */}
          {podeMexerNaOrganizacao && (
            <section className="mb-5">
              <h3 className="label mb-2">Na organização</h3>
              <PapelDeOrganizacaoDoPainel
                membro={membro}
                souEu={souEu}
                onMudou={onMudou}
              />
            </section>
          )}

          {/* ---- OS VÍNCULOS DE TIME -------------------------------------- */}
          <section>
            <h3 className="label mb-2">Nos times</h3>
            {vinculos === null ? (
              <div className="muted text-xs">Carregando…</div>
            ) : linhas.length === 0 ? (
              <div className="muted text-xs">
                Sem vínculo de time. A pessoa existe na organização, mas não
                está em nenhum time.
              </div>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {linhas.map((linha) => (
                  <LinhaDeVinculo
                    key={linha.team.id}
                    linha={linha}
                    membro={membro}
                    alcance={alcance}
                    souAdmin={souAdmin}
                    onMudou={onMudou}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* ---- DESATIVAR --------------------------------------------------
              ⚠️ NO RODAPÉ E SEPARADO, porque não é sobre um time: desativar
              desliga a pessoa da organização inteira. Numa tela com o nome de
              UM time no topo, isso lê como "tirar deste time" se estiver
              misturado com o resto (§4.2). */}
          {/* ⚠️⚠️ `podeDesativarConta` FALTAVA AQUI, e a ausência oferecia a
              ação a quem o servidor recusa: a Spec 028 (D4) não abriu
              desativar ao supervisor, então ele via o botão, confirmava e
              levava 403. É o padrão "botão que a tela oferece e o servidor
              recusa" que a Spec 044 registrou -- e que o resto deste painel
              já evitava usando o `can_edit_role` do backend.
              ⚠️ A pergunta vem de `lib/permissoesMembros`, que é testada, e
              NÃO de um `roles.includes(...)` escrito aqui. */}
          {membro.is_active && podeDesativarConta(alcance) && (
            <Desativar membro={membro} souEu={souEu} onMudou={onMudou} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Um vínculo: o time, o cargo e o que dá para fazer. */
function LinhaDeVinculo({
  linha,
  membro,
  alcance,
  souAdmin,
  onMudou,
}: {
  linha: VinculoDoPainel;
  membro: Member;
  alcance: Alcance;
  souAdmin: boolean;
  onMudou: (aviso: string) => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // ⚠️ AS OPÇÕES VÊM DE `papeisAtribuiveis`, que já cruza NÍVEL (invariante da
  // Spec 045) com ALCANCE de quem edita (matriz da Spec 016). Reescrever a
  // regra aqui criaria uma segunda cópia dela no front.
  const opcoes = papeisAtribuiveis(alcance, souAdmin, linha.ehArea).filter(
    (p) => p !== linha.role,
  );

  async function aplicar(novo: MemberRole) {
    setSalvando(true);
    try {
      await changeMemberRole(membro.id, linha.team.id, novo);
      setAberto(false);
      await onMudou(
        `${membro.name} agora é ${PAPEL[novo].toLowerCase()} em ${linha.team.name}.`,
      );
    } catch (e) {
      const a = e as ApiError;
      setErro(
        a.status === 403
          ? "Você não alcança este vínculo."
          : a.message || "Não consegui trocar o cargo.",
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <li className="rounded border border-border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">{linha.team.name}</strong>
        {linha.team.parent_team_id === null && (
          <Badge tone="outline" size="sm">
            Área
          </Badge>
        )}

        {/* ⚠️⚠️ QUANDO O PAPEL VEM DE CIMA, SOME O SELETOR. Para quem tem
            comando na área, a linha do subtime não é cargo — é ALOCAÇÃO, e
            pela invariante de nível ela nunca conseguirá repetir ali o papel
            da raiz. Oferecer um seletor seria oferecer uma escolha que não
            existe. Foi este detalhe que fez a Camila querer apagar o próprio
            vínculo, olhando a tela antiga. */}
        {linha.autoridadeVemDe ? (
          <span className="muted ml-auto text-xs">
            Alocado · autoridade de {linha.autoridadeVemDe.name}
          </span>
        ) : linha.podeEditarCargo ? (
          <button
            className="tappable ml-auto"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
          >
            <Badge tone="soft" size="sm" color="var(--accent)">
              {PAPEL[linha.role]}
            </Badge>
          </button>
        ) : (
          // ⚠️ O CADEADO VEM DO BACKEND (`can_edit_role`, fatia A). A tela NÃO
          // recalcula escopo — a Spec 034 já desfez essa tentativa uma vez.
          <span className="ml-auto" title="Você não administra este vínculo">
            <Badge tone="neutral" size="sm" className="border">
              {PAPEL[linha.role]}
            </Badge>
          </span>
        )}
      </div>

      {aberto && (
        <div className="mt-2 border-t border-border pt-2">
          {/* ⚠️ NÃO APLICA NO CLIQUE, ao contrário da pílula de prioridade:
              prioridade erra e você desfaz; cargo erra e a pessoa ganha
              alcance no sistema inteiro, em silêncio. Cada opção diz o que
              muda — e nomeia o TIME, porque "tem permissões de supervisor"
              não diz nada a quem está decidindo. */}
          {opcoes.length === 0 ? (
            <div className="muted text-xs">
              Não há outro cargo possível aqui.
            </div>
          ) : (
            opcoes.map((p) => (
              <button
                key={p}
                className="tappable mb-1 block w-full rounded border border-border p-2 text-left"
                disabled={salvando}
                onClick={() => void aplicar(p)}
              >
                <span className="text-sm font-semibold">{PAPEL[p]}</span>
                <span className="muted mt-0.5 block text-xs">
                  {consequenciaDoCargo(p, linha.team.name)}
                </span>
              </button>
            ))
          )}
          {erro && <div className="error-box mt-1 text-xs">{erro}</div>}
        </div>
      )}
    </li>
  );
}

/** O papel de organização, dentro do painel. */
function PapelDeOrganizacaoDoPainel({
  membro,
  souEu,
  onMudou,
}: {
  membro: Member;
  souEu: boolean;
  onMudou: (aviso: string) => Promise<void>;
}) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function aplicar(novo: OrgRole | null) {
    setSalvando(true);
    try {
      await changeOrganizationRole(membro.id, novo);
      await onMudou(
        novo === null
          ? `${membro.name} deixou de administrar a organização. A conta e os times continuam como estavam.`
          : `${membro.name} agora é ${PAPEL_ORG[novo].toLowerCase()} da organização.`,
      );
    } catch (e) {
      const a = e as ApiError;
      setErro(
        a.status === 409
          ? "A organização precisa de pelo menos um administrador."
          : a.message || "Não consegui mudar o papel.",
      );
    } finally {
      setSalvando(false);
    }
  }

  const atual = membro.org_role ?? null;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {(["ADMIN", "GESTOR"] as OrgRole[]).map((p) => (
          <button
            key={p}
            className="tappable"
            disabled={salvando || atual === p}
            onClick={() => void aplicar(p)}
          >
            <Badge
              tone={atual === p ? "soft" : "outline"}
              size="sm"
              color={atual === p ? "var(--accent)" : undefined}
            >
              {PAPEL_ORG[p]}
            </Badge>
          </button>
        ))}
        {atual && !souEu && (
          <button
            className="btn btn-ghost text-xs"
            disabled={salvando}
            onClick={() => void aplicar(null)}
          >
            Tirar da administração
          </button>
        )}
      </div>
      <div className="muted mt-1 text-xs">
        {atual === "ADMIN"
          ? "Define a organização: renomeia, apaga área e promove gestores."
          : atual === "GESTOR"
          ? "Opera a organização: cria área, cadastra pessoas e distribui papéis de time."
          : "Não administra a organização — só os times em que está."}
      </div>
      {souEu && atual && (
        <div className="muted mt-1 text-xs">
          Você não pode tirar o próprio papel — peça a outro administrador.
        </div>
      )}
      {erro && <div className="error-box mt-2 text-xs">{erro}</div>}
    </div>
  );
}

/** Desativar a pessoa na organização inteira. */
function Desativar({
  membro,
  souEu,
  onMudou,
}: {
  membro: Member;
  souEu: boolean;
  onMudou: (aviso: string) => Promise<void>;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (souEu) return null;

  return (
    <div className="mt-5 border-t border-border pt-3">
      {!confirmando ? (
        <button className="btn btn-ghost text-xs" onClick={() => setConfirmando(true)}>
          Desativar na organização
        </button>
      ) : (
        <div>
          <div className="text-xs">
            <strong>{membro.name}</strong> deixa de acessar o sistema — em
            TODOS os times, não só neste. As tarefas dela ficam.
          </div>
          {erro && <div className="error-box mt-2 text-xs">{erro}</div>}
          <div className="mt-2 flex gap-2">
            <button
              className="btn btn-danger"
              disabled={salvando}
              onClick={async () => {
                setSalvando(true);
                try {
                  await deactivateMember(membro.id);
                  await onMudou(`${membro.name} foi desativado na organização.`);
                } catch (e) {
                  setErro((e as ApiError).message || "Não consegui desativar.");
                } finally {
                  setSalvando(false);
                }
              }}
            >
              Desativar
            </button>
            <button
              className="btn btn-ghost"
              disabled={salvando}
              onClick={() => setConfirmando(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ⚠️ `removeMemberFromTeam` NÃO é usado aqui de propósito: tirar de um time é
// ação do LÁPIS (o seletor de subtimes), que já trata a perda de cargo com
// confirmação. Duas portas para a mesma escrita seriam duas chances de
// esquecer aquele aviso.
void removeMemberFromTeam;
