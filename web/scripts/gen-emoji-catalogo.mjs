// Gera `web/lib/emojiCatalogo.generated.ts` a partir do `emojibase-data` (pt),
// que tem nome em português e grupo. Uso (de `web/`):
//
//     node scripts/gen-emoji-catalogo.mjs
//
// O arquivo é commitado (o `emojibase-data` é dependência de desenvolvimento).
// `emojiCatalogo.generated.test.ts` confere que está em dia e
// `backend/tests/test_emoji_catalogo_front.py` passa cada emoji pela validação
// do servidor.

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const AQUI = dirname(fileURLToPath(import.meta.url));

export const DESTINO = join(AQUI, "..", "lib", "emojiCatalogo.generated.ts");

/** O grupo dos modificadores de tom de pele -- o servidor recusa componentes. */
const GRUPO_COMPONENTES = "component";

/**
 * A forma que o servidor grava (`normalize_emoji`, fully-qualified). Quem
 * decide o U+FE0F é o `type`:
 *
 *   type 1 (apresentacao de emoji) -> a sequencia do proprio `hexcode`;
 *   type 0 (apresentacao de texto: ❤ ☺ ©) -> o `hexcode` + U+FE0F.
 */
export function formaCanonica({ hexcode, type }) {
  const base = hexcode
    .split("-")
    .map((h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .join("");
  return type === 0 ? `${base}️` : base;
}

/** Monta o catalogo (puro -- recebe os dados, nao le disco). */
export function montarCatalogo(dados, mensagens) {
  const nomeDoGrupo = new Map(
    (mensagens.groups ?? []).map((g) => [g.key, g.message]),
  );
  const itens = [];
  for (const item of dados) {
    const grupoKey = mensagens.groups?.[item.group]?.key;
    const grupo = nomeDoGrupo.get(grupoKey);
    // Sem grupo (dado incompleto) ou componente: fora. Componente sozinho nao
    // e reacao -- o servidor recusa `🏽` com 422.
    if (!grupo || grupoKey === GRUPO_COMPONENTES) continue;
    itens.push({
      emoji: formaCanonica(item),
      nome: item.label,
      tags: [...new Set(item.tags ?? [])].sort(),
      grupo,
    });
  }
  return itens;
}

/** O conteudo do arquivo, deterministico. */
export function render() {
  const dados = require("emojibase-data/pt/data.json");
  const mensagens = require("emojibase-data/pt/messages.json");
  const itens = montarCatalogo(dados, mensagens);
  const linhas = itens
    .map(
      (i) =>
        `  { emoji: ${JSON.stringify(i.emoji)}, nome: ${JSON.stringify(
          i.nome,
        )}, tags: ${JSON.stringify(i.tags)}, grupo: ${JSON.stringify(
          i.grupo,
        )} },`,
    )
    .join("\n");
  return [
    "// ⚠️ GERADO por `web/scripts/gen-emoji-catalogo.mjs` -- NAO EDITE A MAO.",
    "//",
    "// Fonte: `emojibase-data/pt` (MIT), dependencia de DESENVOLVIMENTO. Mudou",
    "// a fonte? Rode, de `web/`:",
    "//",
    "//     node scripts/gen-emoji-catalogo.mjs",
    "//",
    "// Guardioes: `web/lib/__tests__/emojiCatalogo.generated.test.ts` (o arquivo",
    "// esta em dia?) e `backend/tests/test_emoji_catalogo_front.py` (o servidor",
    "// aceita cada emoji daqui, sem normalizar de novo?).",
    "",
    'import type { EmojiDoCatalogo } from "./reacoes";',
    "",
    `/** ${itens.length} emojis, na ordem do Unicode (a do arquivo de origem). */`,
    "export const CATALOGO_DE_EMOJI: readonly EmojiDoCatalogo[] = [",
    linhas,
    "];",
    "",
  ].join("\n");
}

function principal() {
  const conteudo = render();
  writeFileSync(DESTINO, conteudo, { encoding: "utf-8" });
  const quantos = conteudo.split("\n").filter((l) => l.startsWith("  { emoji:")).length;
  console.log(`escrito: ${DESTINO} (${quantos} emojis)`);
}

// Só roda quando chamado direto (`node scripts/gen-emoji-catalogo.mjs`) --
// o guardião importa `render` sem gerar nada.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal();
}
