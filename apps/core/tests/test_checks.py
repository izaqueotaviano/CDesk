"""System checks de deploy que ainda não tinham teste dedicado.

`antivirus_configured` já é coberto em `apps.tickets.tests.test_antivirus`
(o check nasceu perto do código que ele protege). Este arquivo cobre o que
sobrou de `apps.core.checks`: o alerta de Base de Conhecimento desligada.
"""

import pytest
from django.test import override_settings

from apps.core.checks import base_de_conhecimento_desligada

pytestmark = pytest.mark.django_db


class TestBaseDeConhecimentoDesligada:
    """GAPS.md item 5: WORDPRESS_KB_ENABLED=False é escolha operacional
    válida — mas precisa parar de ser silenciosa no checklist de subida."""

    def test_flag_desligada_emite_aviso(self):
        with override_settings(WORDPRESS_KB_ENABLED=False):
            problemas = base_de_conhecimento_desligada(None)
        assert [p.id for p in problemas] == ["resolv.W014"]
        # é aviso, não erro: desligado em dev/homologação é decisão válida
        assert problemas[0].is_serious() is False

    def test_flag_ligada_fica_em_silencio(self):
        with override_settings(WORDPRESS_KB_ENABLED=True):
            assert base_de_conhecimento_desligada(None) == []
