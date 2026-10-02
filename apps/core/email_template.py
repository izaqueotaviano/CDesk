# ruff: noqa: E501 — o HTML do modelo tem linhas longas de propósito (estilos em linha)
"""O modelo HTML padrão dos e-mails — o ponto de partida que o admin edita em
Configurações → Sistema → E-mail.

Vive no core (e não em notifications) porque é o DEFAULT de um campo do
`SystemConfig`; notifications importa daqui na hora de montar a mensagem.

Marcadores que o envio substitui:
- `{{assunto}}`  — o assunto do e-mail;
- `{{conteudo}}` — o texto do aviso já convertido em parágrafos (links
  viram links clicáveis);
- `{{ano}}`      — o ano corrente, para o rodapé.
"""

TEMPLATE_HTML_PADRAO = """<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{assunto}}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f2;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2933;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f2;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e0;">
            <tr>
              <td style="padding:24px 32px 8px;">
                <p style="margin:0;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;">Central de Suporte</p>
                <h1 style="margin:8px 0 0;font-size:20px;line-height:1.3;color:#111827;">{{assunto}}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px;font-size:15px;line-height:1.6;color:#1f2933;">
                {{conteudo}}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 24px;border-top:1px solid #e4e4e0;font-size:12px;line-height:1.5;color:#6b7280;">
                Este e-mail é automático e não recebe respostas. Para falar com o suporte, use o portal.
                <br>&copy; {{ano}}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""
