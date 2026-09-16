"""Spec 050, fatia C -- o servidor aceita cada emoji do catalogo da tela?

⚠️⚠️ ESTE E O TESTE QUE IMPEDE O DEFEITO MAIS PROVAVEL DESTA FATIA: o seletor
oferecer um emoji que o `PUT` recusa com 422, ou que ele GRAVA em outra forma
-- a pessoa clica no 👍 e a pilula volta com outro caractere invisivel dentro.

As duas metades sao diferentes:
  - o guardiao do front (`emojiCatalogo.generated.test.ts`) pergunta se o
    arquivo esta em dia com a FONTE (`emojibase-data`);
  - este pergunta se cada emoji dele sobrevive a `normalize_emoji` SEM MUDAR,
    que e a unica forma de garantir que as duas bases concordam.

⚠️ E ELE FALHA, E NAO PULA, quando o arquivo nao existe -- mesma razao do
`test_permissions_generated_ts`: no container `api-dev` o `web/lib` so existe
porque o compose o monta, e quem rodar sem a montagem precisa saber.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.modules.tasks.domain.comment_reaction import normalize_emoji

#: `backend/tests/` -> raiz do repositorio -> `web/lib/`.
CATALOGO = (
    Path(__file__).resolve().parents[2] / "web" / "lib" / "emojiCatalogo.generated.ts"
)

_EMOJI_NA_LINHA = re.compile(r'\{ emoji: "((?:[^"\\]|\\.)+)"')


def _emojis_do_catalogo() -> list[str]:
    texto = CATALOGO.read_text(encoding="utf-8")
    achados = [
        m.group(1).encode().decode("unicode_escape")
        if "\\u" in m.group(1)
        else m.group(1)
        for m in _EMOJI_NA_LINHA.finditer(texto)
    ]
    return achados


def test_o_catalogo_existe_e_nao_esta_vazio() -> None:
    assert CATALOGO.parent.is_dir(), (
        f"{CATALOGO.parent} nao existe. No container `api-dev`, o "
        "`docker-compose.yml` precisa montar `./web/lib:/web/lib`; no CI, o "
        "checkout e do repositorio inteiro."
    )
    assert CATALOGO.is_file(), (
        f"{CATALOGO} nao existe. Gere com, de `web/`: "
        "node scripts/gen-emoji-catalogo.mjs"
    )
    # A fonte tem ~1.9 mil sem tom de pele; um numero muito menor significa
    # gerador quebrado, e nao catalogo enxuto.
    assert len(_emojis_do_catalogo()) > 1500


def test_o_servidor_aceita_cada_emoji_do_catalogo_sem_mudar() -> None:
    """⭐ O teste que a fatia existe para ter.

    `normalize_emoji` levanta se nao for emoji, e devolve a forma
    fully-qualified. Se ela mudar o que veio do catalogo, o seletor esta
    mandando uma forma e o banco guardando outra.
    """
    problemas: list[tuple[str, str]] = []
    for emoji in _emojis_do_catalogo():
        try:
            gravado = normalize_emoji(emoji)
        except Exception as erro:  # noqa: BLE001 -- o teste reporta, nao trata
            problemas.append((emoji, type(erro).__name__))
            continue
        if gravado != emoji:
            problemas.append((emoji, f"gravaria {gravado!r}"))

    assert not problemas, (
        "o catalogo da tela tem emoji que o servidor recusa ou reescreve "
        f"({len(problemas)} de {len(_emojis_do_catalogo())}): {problemas[:10]}"
    )
