"""Previsão de tempo de primeira resposta — o que dizer a quem está esperando.

Diferente do PRAZO do SLA, que já existe e continua valendo. O prazo é uma
promessa contratual ("resposta até 14:00"); isto aqui é uma expectativa
observada ("costuma responder em cerca de 40 minutos"). Os dois convivem: o
prazo protege o cliente, a previsão informa — e quase sempre a previsão é
bem melhor que o prazo, que é o dado que acalma quem abriu agora.

Três decisões que valem registro:

- **Mediana, não média.** Um chamado esquecido por três dias no meio de
  vinte respondidos em minutos leva a média para horas e a previsão passa a
  mentir para os dois lados. A mediana ignora a cauda.

- **Silêncio quando não há amostra.** Com menos de `MINIMO_AMOSTRA`
  respostas na janela, devolve `None` e a tela não mostra nada. Uma previsão
  tirada de dois chamados é chute com cara de dado, e errar aqui custa a
  confiança na única informação que a pessoa tem enquanto espera.

- **Por EQUIPE e em horário comercial.** Suporte e Financeiro respondem em
  ritmos diferentes; uma média do desk inteiro não descreveria nenhum dos
  dois. E o relógio é o do expediente — contar a madrugada faria a previsão
  do fim da tarde parecer péssima, quando ninguém prometeu atender de
  madrugada.
"""

import datetime as dt
from statistics import median

from django.db.models import F
from django.utils import timezone

#: Abaixo disto não se responde nada — ver a segunda decisão no cabeçalho.
MINIMO_AMOSTRA = 5

#: Janela de observação. Curta o bastante para refletir a operação de agora
#: (mudou de time, entrou gente nova) e longa o bastante para juntar amostra.
JANELA_DIAS = 30


def _minutos_uteis(inicio, fim, calendario) -> float:
    """Minutos de EXPEDIENTE entre dois instantes.

    Sem calendário, cai no relógio de parede — mesma degradação que o SLA usa
    quando ninguém configurou horário comercial.
    """
    if calendario is None or not calendario.workdays:
        return (fim - inicio).total_seconds() / 60

    from apps.core.business_hours import is_open_now

    # Amostragem de 5 em 5 minutos: medir expediente exatamente exigiria
    # reimplementar `add_business_minutes` ao contrário, e o erro de até 5
    # minutos some no arredondamento com que a previsão é exibida ("cerca de
    # 40 minutos"). Teto de uma semana para não varrer um caso esquecido.
    passo = dt.timedelta(minutes=5)
    limite = inicio + dt.timedelta(days=7)
    cursor, uteis = inicio, 0.0
    while cursor < fim and cursor < limite:
        if is_open_now(calendario, at=cursor):
            uteis += 5
        cursor += passo
    return uteis


def para_equipe(team) -> tuple[int | None, int]:
    """`(minutos_medianos, tamanho_da_amostra)` da primeira resposta da equipe.

    `minutos_medianos` é `None` quando a amostra não sustenta uma previsão.
    """
    from apps.core.models import BusinessCalendar
    from apps.tickets.models import Ticket

    desde = timezone.now() - dt.timedelta(days=JANELA_DIAS)
    respondidos = (
        Ticket.objects.filter(
            team=team,
            first_response_at__isnull=False,
            created_at__gte=desde,
        )
        # defensivo: relógio torto (import, correção manual) daria negativo e
        # puxaria a mediana para baixo sem que ninguém entendesse por quê
        .filter(first_response_at__gt=F("created_at"))
        .values_list("created_at", "first_response_at")
    )

    amostras = list(respondidos)
    if len(amostras) < MINIMO_AMOSTRA:
        return None, len(amostras)

    calendario = BusinessCalendar.objects.filter(is_default=True).first()
    minutos = [_minutos_uteis(c, r, calendario) for c, r in amostras]
    return round(median(minutos)), len(amostras)


def humanizar(minutos: int | None) -> str | None:
    """Vira texto de gente. Arredonda de propósito: "cerca de 40 minutos"
    é honesto sobre a precisão do dado; "37 minutos" fingiria exatidão."""
    if minutos is None:
        return None
    if minutos < 15:
        return "poucos minutos"
    if minutos < 60:
        return f"cerca de {round(minutos / 10) * 10} minutos"
    horas = minutos / 60
    if horas < 2:
        return "cerca de 1 hora"
    if horas < 8:
        return f"cerca de {round(horas)} horas"
    return "menos de um dia útil" if horas < 24 else "mais de um dia útil"
