"use client";
// Tabela de pessoas da tela de time. A gaveta é da tela, não da tabela: o lápis só avisa.

import { type ReactNode } from "react";
import { Pencil } from "lucide-react";
import Badge from "@/components/Badge";
import { type Member, type MemberRole } from "@/lib/api";
import { type TeamRow } from "@/lib/teamScreen";

export const ROLE_LABEL: Record<MemberRole, string> = {
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};

export default function MembersTable({
  rows,
  middleColumn,
  count,
  podeAbrir,
  onOpenMember,
}: {
  rows: TeamRow[];
  /** O título e o conteúdo da coluna do meio — o que muda entre as telas. */
  middleColumn: { title: string; render: (row: TeamRow) => ReactNode };
  /** Texto do contador; diz o total (quem filtra passa "12 de 15"). */
  count?: string;
  /** Esta linha tem o que fazer na gaveta? Por linha: um supervisor alcança uns vínculos e não outros. */
  podeAbrir: (row: TeamRow) => boolean;
  /** A tabela não abre a gaveta; só avisa a tela. */
  onOpenMember: (member: Member) => void;
}) {
  return (
    <>
      {/* `overflow-x-auto`: a coluna de cápsulas cresce com o número de vínculos. */}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-sm">
          <caption className="muted border-b border-border px-3 py-2 text-left text-xs">
            {/* Diz o total; quem filtra passa "N de M". */}
            {count ??
              `${rows.length} ${rows.length === 1 ? "pessoa" : "pessoas"}`}
          </caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="label px-3 py-2 text-left">
                Membro
              </th>
              <th scope="col" className="label px-3 py-2 text-left">
                E-mail
              </th>
              <th scope="col" className="label px-3 py-2 text-left">
                {middleColumn.title}
              </th>
              <th scope="col" className="label px-3 py-2 text-left">
                Times
              </th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Linha
                key={row.member.id}
                row={row}
                middleColumn={middleColumn}
                onOpen={podeAbrir(row) ? () => onOpenMember(row.member) : null}
              />
            ))}
          </tbody>
        </table>
      </div>

    </>
  );
}

function Linha({
  row,
  middleColumn,
  onOpen,
}: {
  row: TeamRow;
  middleColumn: { title: string; render: (row: TeamRow) => ReactNode };
  /** `null` = não há nada a fazer com esta pessoa; a coluna fica vazia. */
  onOpen: (() => void) | null;
}) {
  const { member, subteams, otherRoots } = row;

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-3 py-2 align-middle">
        <strong className="font-semibold">{member.name}</strong>
      </td>

      <td className="muted px-3 py-2 align-middle text-xs">{member.email}</td>

      <td className="px-3 py-2 align-middle">{middleColumn.render(row)}</td>

      <td className="px-3 py-2 align-middle">
        <span className="flex flex-wrap gap-1.5">
          {subteams.length === 0 && otherRoots === 0 && (
            <span className="muted text-xs">—</span>
          )}
          {subteams.map((c) => (
            <Badge key={c.team.id} tone="soft" size="sm" color="var(--accent)">
              {c.team.name} · {ROLE_LABEL[c.role]}
            </Badge>
          ))}
          {otherRoots > 0 && (
            <Badge tone="outline" size="sm">
              +{otherRoots} {otherRoots === 1 ? "time" : "times"}
            </Badge>
          )}
        </span>
      </td>

      {/* Só aparece se a linha tem o que fazer na gaveta (`podeAbrir`). */}
      <td className="whitespace-nowrap px-3 py-2 text-right align-middle">
        {onOpen && (
          <button
            className="btn btn-ghost"
            aria-label={`Editar ${member.name}`}
            onClick={onOpen}
          >
            <Pencil size={14} aria-hidden="true" />
          </button>
        )}
      </td>
    </tr>
  );
}
