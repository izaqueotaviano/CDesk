"""Validadores de senha além dos que o Django traz.

O Django já barra senha curta, parecida com o e-mail, comum ou só numérica.
O que falta é exigir VARIEDADE: `senhasenha12` passa em todos os quatro.
"""

import re

from django.core.exceptions import ValidationError


class VariedadeDeCaracteresValidator:
    """Exige pelo menos três de quatro classes: minúscula, maiúscula, dígito e
    símbolo. Três, não quatro, de propósito: uma frase longa com espaços e
    números é mais forte que `Abc!1234`, e exigir símbolo empurra a pessoa
    para o `!` no fim — que os dicionários de ataque já contemplam."""

    CLASSES = (
        re.compile(r"[a-z]"),
        re.compile(r"[A-Z]"),
        re.compile(r"\d"),
        re.compile(r"[^\w\s]|_"),
    )

    def __init__(self, minimo=3):
        self.minimo = minimo

    def validate(self, password, user=None):
        presentes = sum(1 for classe in self.CLASSES if classe.search(password))
        if presentes < self.minimo:
            raise ValidationError(
                "A senha precisa misturar pelo menos três tipos de caractere: "
                "letras minúsculas, maiúsculas, números e símbolos.",
                code="password_sem_variedade",
            )

    def get_help_text(self):
        return (
            "Misture pelo menos três tipos de caractere: letras minúsculas, "
            "maiúsculas, números e símbolos."
        )
