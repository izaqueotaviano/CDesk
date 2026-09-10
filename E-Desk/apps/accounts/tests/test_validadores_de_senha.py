import pytest
from django.core.exceptions import ValidationError

from apps.accounts.validators import VariedadeDeCaracteresValidator


@pytest.mark.parametrize("senha", ["senhasenhasenha", "12345678901234", "SENHASENHASENHA1"])
def test_recusa_senha_com_menos_de_tres_classes(senha):
    with pytest.raises(ValidationError):
        VariedadeDeCaracteresValidator().validate(senha)


@pytest.mark.parametrize("senha", ["Cavalo verde 42", "abc-DEF-ghi", "minha senha! 9"])
def test_aceita_tres_classes_inclusive_frase_com_espaco(senha):
    VariedadeDeCaracteresValidator().validate(senha)
