"""O plano do meio se chama Platinum, não Silver.

Renomear em vez de criar um plano novo é o ponto: `Company.plan` é FK, e criar
"platinum" ao lado deixaria as empresas apontando para um "silver" órfão, com o
seed reescrevendo só metade dos dados. Aqui o registro é o mesmo — muda o nome
que ele sempre deveria ter tido.

Só a IDENTIDADE muda (slug e nome). Rank, cota e franquia ficam para o
`seed_defaults`, que é o lugar onde esses números são dados de configuração e
podem ter sido ajustados à mão para um cliente específico.
"""

from django.db import migrations


def para_platinum(apps, schema_editor):
    Plan = apps.get_model("customers", "Plan")
    if Plan.objects.filter(slug="platinum").exists():
        return  # já renomeado (ou base nova, já sem "silver")
    Plan.objects.filter(slug="silver").update(slug="platinum", name="Platinum")


def para_silver(apps, schema_editor):
    Plan = apps.get_model("customers", "Plan")
    if Plan.objects.filter(slug="silver").exists():
        return
    Plan.objects.filter(slug="platinum").update(slug="silver", name="Silver")


class Migration(migrations.Migration):

    dependencies = [("customers", "0003_company_maintenance_minutes_and_more")]

    operations = [migrations.RunPython(para_platinum, para_silver)]
