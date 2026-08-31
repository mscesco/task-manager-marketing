"""Aviso de mudanca de status ao solicitante, via n8n (Spec 043, fatia F).

⚠️⚠️ **ESTA E A PRIMEIRA CHAMADA DE SAIDA DO BACKEND.** Tudo o que ele fazia
ate aqui era responder a quem chamou; agora ele chama alguem. As quatro regras
do §8 da spec existem porque cada uma delas, sozinha, transforma um servico
externo lento ou fora do ar num defeito NOSSO:

1. **FORA DA TRANSACAO, E DEPOIS DO COMMIT.** Dentro dela, um n8n lento segura
   a linha no banco; um n8n fora do ar **desfaz a aprovacao**. Por isso quem
   chama isto chama DEPOIS do `uow.commit()`, e este modulo nao recebe sessao
   nenhuma -- ele nao tem como tocar no banco nem por engano.
2. **TIMEOUT CURTO E OBRIGATORIO.** Sem ele, quem clicou "Aprovar" fica
   pendurado no tempo de resposta de outro servico.
3. **FALHA NAO DERRUBA A OPERACAO.** Mesmo espirito do `_emit_safely` das
   notificacoes: best-effort, e `logger.exception` para o traceback aparecer
   no log do deploy.
4. **URL AUSENTE = RECURSO DESLIGADO**, e nao erro. E o oposto do
   `system_api_token`, que e fail CLOSED porque protege uma porta de ENTRADA.
   Aqui e uma saida opcional: sem `N8N_WEBHOOK_URL`, o ambiente de teste e o
   de quem clona o repo simplesmente nao avisam ninguem.

⚠️ **E O PRECO DISSO ESTA ESCRITO NA SPEC:** o aviso e best-effort. Se o n8n
estiver fora do ar naquele minuto, aquele e-mail **nao sai e ninguem sabera**.
A alternativa e uma fila de reenvio, que e maior que esta fatia e esta em §9,
fora de escopo.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx
import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)

#: Rotulo humano de cada status -- e o que o e-mail mostra.
#:
#: ⚠️ MANDADO PRONTO, e nao deixado para o n8n traduzir. O rotulo e decisao do
#: produto (a tela diz "Em andamento", nao "IN_PROGRESS"); se o n8n montasse a
#: sua propria tabela, ela divergiria da tela na primeira mudanca -- e seria a
#: pessoa de fora recebendo o nome errado.
ROTULO_DO_STATUS: dict[str, str] = {
    "PENDING": "Pendente",
    "APPROVED": "Aprovada",
    "IN_PROGRESS": "Em andamento",
    "DONE": "Concluída",
    "REJECTED": "Recusada",
}


@dataclass(frozen=True, slots=True)
class AvisoDeStatus:
    """Tudo o que o n8n precisa para escrever o e-mail, ja resolvido.

    ⚠️ MONTADO ANTES DO COMMIT E ENVIADO DEPOIS. Ele carrega VALORES, e nao
    ids para o n8n consultar: depois do commit a sessao pode nao existir mais,
    e um dataclass congelado nao tem como disparar lazy load por acidente.
    """

    solicitation_id: uuid.UUID
    protocolo: str
    status_anterior: str
    status_novo: str
    resumo: str
    categoria: str
    categoria_titulo: str
    categoria_prazo: str | None
    motivo_recusa: str | None
    criada_em: datetime
    requester_name: str
    requester_email: str
    requester_phone: str | None
    requester_department: str | None
    requester_polo: str | None
    form_slug: str | None
    form_titulo: str | None
    form_time: str | None

    def corpo(self, agora: datetime) -> dict:
        """O JSON do contrato combinado com a Camila em 27/08."""
        return {
            "evento": "solicitacao.status_mudou",
            "enviado_em": agora.isoformat(),
            "solicitacao": {
                "id": str(self.solicitation_id),
                "protocolo": self.protocolo,
                "status_anterior": self.status_anterior,
                "status_novo": self.status_novo,
                "status_novo_label": ROTULO_DO_STATUS.get(
                    self.status_novo, self.status_novo
                ),
                "resumo": self.resumo,
                "categoria": self.categoria,
                # ⚠️ NUNCA NULO -- cai no slug cru se a secao sumir. Foi
                # prometido assim para o template do n8n nao precisar proteger
                # cada linha.
                "categoria_titulo": self.categoria_titulo or self.categoria,
                "categoria_prazo": self.categoria_prazo,
                # ⚠️ SO TEM CONTEUDO NA RECUSA, e e o unico retorno que o
                # solicitante recebe: ele nao tem conta para consultar nada.
                "motivo_recusa": (
                    self.motivo_recusa
                    if self.status_novo == "REJECTED"
                    else None
                ),
                "criada_em": self.criada_em.isoformat(),
            },
            "solicitante": {
                "nome": self.requester_name,
                "email": self.requester_email,
                # ⚠️ OS TRES PODEM SER `null` desde a fatia G: o formulario
                # decide se pergunta. `nome` e `email` nunca sao.
                "telefone": self.requester_phone,
                "area": self.requester_department,
                "polo": self.requester_polo,
            },
            # ⚠️ `null` NAS SOLICITACOES ORFAS -- as anteriores a esta spec, e
            # as de formulario apagado.
            "formulario": (
                {
                    "slug": self.form_slug,
                    "titulo": self.form_titulo,
                    "time": self.form_time,
                }
                if self.form_slug is not None
                else None
            ),
        }


def esta_ligado() -> bool:
    """Ha n8n configurado? Sem URL, o recurso simplesmente nao existe."""
    return bool(settings.n8n_webhook_url.strip())


async def avisar(aviso: AvisoDeStatus) -> bool:
    """Avisa o n8n. **Nunca levanta.** Devolve se o aviso saiu.

    ⚠️ O `bool` E PARA TESTE E LOG, e nao para quem chama decidir alguma
    coisa: nenhum caminho de negocio pode mudar por causa disto. Se pudesse,
    o n8n fora do ar viraria um defeito no gerenciador.
    """
    if not esta_ligado():
        return False

    corpo = aviso.corpo(datetime.now(UTC))
    cabecalhos = {"Content-Type": "application/json"}
    if settings.n8n_webhook_token:
        cabecalhos["X-Webhook-Token"] = settings.n8n_webhook_token

    try:
        async with httpx.AsyncClient(
            timeout=settings.n8n_webhook_timeout_seconds
        ) as cliente:
            resposta = await cliente.post(
                settings.n8n_webhook_url, json=corpo, headers=cabecalhos
            )
        # ⚠️ 4xx/5xx DO N8N TAMBEM E BEST-EFFORT. Um workflow desativado
        # responde 404, e isso nao pode derrubar a aprovacao de ninguem -- mas
        # tem de aparecer no log, senao ninguem descobre que os avisos pararam.
        if resposta.status_code >= 400:
            logger.warning(
                "solicitacao.aviso_recusado",
                solicitation_id=str(aviso.solicitation_id),
                status_novo=aviso.status_novo,
                http_status=resposta.status_code,
            )
            return False
    except Exception:
        # ⚠️ `except Exception` E NAO `httpx.HTTPError`, de proposito: DNS
        # ruim, TLS invalido e URL malformada levantam coisas diferentes, e
        # NENHUMA delas pode subir daqui. Mesmo espirito do `_emit_safely`.
        logger.exception(
            "solicitacao.aviso_falhou",
            solicitation_id=str(aviso.solicitation_id),
            status_novo=aviso.status_novo,
        )
        return False

    logger.info(
        "solicitacao.aviso_enviado",
        solicitation_id=str(aviso.solicitation_id),
        status_anterior=aviso.status_anterior,
        status_novo=aviso.status_novo,
    )
    return True
