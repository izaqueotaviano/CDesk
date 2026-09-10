"""A decisão de qual coluna sobrevive, na migração 0008 — testada como função
pura, sem banco.

O cenário é o que apareceu numa máquina real: `garantir_colunas_de_status`
resolvia colisão de NOME dando sufixo à coluna nova, sem checar se o STATUS
de destino já tinha dono — um quadro antigo acabava com duas colunas
"closed". A constraint (0009) sozinha só travaria o SINTOMA (um IntegrityError
no meio do `migrate`, sem dizer o que fazer); quem resolve é esta função.

Não dá para testar isso rodando a migração de verdade contra o banco de
teste: ele já nasce com a constraint aplicada (é o estado atual do projeto),
então a duplicata que a função precisa desfazer nem chega a existir — o
INSERT da segunda coluna já seria recusado pelo Postgres antes de a função
rodar. Por isso a lógica de decisão mora numa função sem banco (`import`ável
direto do arquivo da migração), e é ela que este arquivo testa.
"""

import importlib
from dataclasses import dataclass

_migracao = importlib.import_module("apps.kanban.migrations.0008_coluna_status_unico")
escolher_sobrevivente = _migracao.escolher_sobrevivente


@dataclass
class ColunaFake:
    pk: int
    name: str


def test_a_com_sufixo_de_colisao_sai_a_com_nome_normal_fica():
    """`garantir_colunas_de_status` marca a coluna que criou sozinha com
    " (status)" quando o nome colide — é o sinal de que NINGUÉM escolheu
    aquele nome de propósito, então é ela que sai na duplicata."""
    normal = ColunaFake(pk=1, name="Concluído")
    da_garantia = ColunaFake(pk=2, name="Concluído (status)")

    assert escolher_sobrevivente([normal, da_garantia]) is normal
    # a ordem de entrada não deveria importar
    assert escolher_sobrevivente([da_garantia, normal]) is normal


def test_empate_fica_a_mais_antiga():
    """Sem sufixo em nenhuma das duas (as duas "de propósito", improvável
    mas possível), a decisão cai para a mais antiga — não para a aleatória."""
    mais_velha = ColunaFake(pk=1, name="Feito")
    mais_nova = ColunaFake(pk=2, name="Encerrado")

    assert escolher_sobrevivente([mais_velha, mais_nova]) is mais_velha
    assert escolher_sobrevivente([mais_nova, mais_velha]) is mais_velha


def test_tres_colunas_do_mesmo_status_ainda_escolhe_a_normal():
    normal = ColunaFake(pk=5, name="Concluído")
    grupo = [
        ColunaFake(pk=6, name="Concluído (status)"),
        normal,
        ColunaFake(pk=7, name="Concluído (status)"),
    ]

    assert escolher_sobrevivente(grupo) is normal


def test_duas_com_sufixo_decide_pela_mais_antiga():
    """As duas nasceram da garantia (nenhuma "de propósito") — mesma regra
    de empate, agora entre duas automáticas."""
    primeira = ColunaFake(pk=3, name="Concluído (status)")
    segunda = ColunaFake(pk=4, name="Concluído (status)")

    assert escolher_sobrevivente([segunda, primeira]) is primeira
