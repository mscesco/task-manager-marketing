"use client";
// components/NotificationPreferences.tsx
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
// rótulo acessível vem de `lib/notificationPreferences.ts` e não do desenho.
//
// ⚠️ MORA EM `components/` e não em `app/`, para ter guardião: o `include` do
// vitest não lê `app/`. A regra (linhas, colunas, rótulos, o que a ausência
// significa) está em `lib/notificationPreferences.ts` -- aqui só se desenha.

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
  COLUMNS,
  SECTIONS,
  type PreferenceRow,
  type Role,
  type ToggleMap,
  indexToggles,
  isEnabled,
  summary,
  toggleKey,
  toggleLabel,
} from "@/lib/notificationPreferences";

export default function NotificationPreferences() {
  const avisar = useAvisar();
  const [toggles, setToggles] = useState<NotificationToggle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Quais células estão no ar agora. Duas podem estar: a pessoa clica numa
  // linha e noutra sem esperar, e travar a grade inteira a cada clique faria
  // a tela parecer lenta num gesto que é instantâneo.
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    listNotificationPreferences()
      .then(setToggles)
      .catch(() => setError("Não consegui carregar suas preferências de notificação."));
  }, []);

  async function change(row: PreferenceRow, role: Role, enabled: boolean) {
    const key = toggleKey(row.group, role);
    // ⚠️ OTIMISTA (D7): o interruptor vira agora. Numa grade, esperar a
    // resposta a cada clique faria a pastilha "voltar" por um instante --
    // e o gesto aqui é sempre uma sequência de vários.
    const before = toggles;
    setToggles((current) =>
      current?.map((t) =>
        t.type_group === row.group && t.role === role ? { ...t, enabled } : t,
      ) ?? current,
    );
    setInFlight((s) => new Set(s).add(key));
    try {
      // O servidor devolve a lista INTEIRA: os grupos que governam dois tipos
      // (arquivar+desarquivar, pôr+tirar) mudam junto, e assim a tela mostra o
      // que ficou gravado em vez de deduzir.
      const saved = await setNotificationPreference({
        type_group: row.group,
        role,
        enabled,
      });
      setToggles(saved);
      avisar("Preferência salva.");
    } catch (e) {
      // ⚠️ VOLTA ATRÁS E DIZ (D7): sem isto o interruptor ficaria mostrando um
      // silêncio que o servidor não gravou, e a pessoa descobriria ao não
      // receber -- ou ao receber -- semanas depois.
      setToggles(before);
      avisar((e as ApiError).message || "Não consegui salvar a preferência.");
    } finally {
      setInFlight((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  }

  if (error) {
    return (
      <div className="error-box" role="alert">
        {error}
      </div>
    );
  }
  if (!toggles) return <Loading tamanho="linha" rotulo="Carregando suas preferências" />;

  const map = indexToggles(toggles);

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
          {summary(toggles)}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-base">
          <thead>
            <tr>
              <th scope="col" className="p-0 text-left">
                <span className="sr-only">Aviso</span>
              </th>
              {COLUMNS.map((c) => (
                <th
                  key={c.role}
                  scope="col"
                  className="w-[88px] px-1 pb-2 text-sm font-semibold text-ink-faint"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          {SECTIONS.map((section) => (
            <tbody key={section.title}>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={1 + COLUMNS.length}
                  className="pt-3 pb-1 text-left text-sm font-semibold uppercase tracking-[0.06em] text-ink-faint"
                >
                  {section.title}
                </th>
              </tr>
              {section.rows.map((row) => (
                <tr key={row.group} className="border-t border-border">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {row.label}
                    {row.help && (
                      <span id={`ajuda-${row.group}`} className="muted mt-0.5 block text-sm">
                        {row.help}
                      </span>
                    )}
                  </th>
                  {row.roles[0] === "none" ? (
                    // Um interruptor só, no meio das três colunas: a linha não
                    // se divide por papel (reação, pôr/tirar, e as travadas).
                    <td colSpan={COLUMNS.length} className="py-2 text-center">
                      <Cell
                        row={row}
                        role="none"
                        map={map}
                        inFlight={inFlight}
                        onChange={change}
                      />
                    </td>
                  ) : (
                    COLUMNS.map((c) => (
                      <td key={c.role} className="py-2 text-center">
                        {row.roles.includes(c.role) ? (
                          <Cell
                            row={row}
                            role={c.role}
                            map={map}
                            inFlight={inFlight}
                            onChange={change}
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

function Cell({
  row,
  role,
  map,
  inFlight,
  onChange,
}: {
  row: PreferenceRow;
  role: Role;
  map: ToggleMap;
  inFlight: ReadonlySet<string>;
  onChange: (row: PreferenceRow, role: Role, enabled: boolean) => void;
}) {
  const enabled = row.locked || isEnabled(map, row.group, role);
  return (
    <Switch
      checked={enabled}
      // Travado fica LIGADO e desabilitado (D6): a linha existe para mostrar
      // que o aviso existe, e a explicação ao lado diz por que não se desliga.
      disabled={row.locked || inFlight.has(toggleKey(row.group, role))}
      aria-label={toggleLabel(row, role)}
      aria-describedby={row.help ? `ajuda-${row.group}` : undefined}
      onChange={(next) => onChange(row, role, next)}
    />
  );
}
