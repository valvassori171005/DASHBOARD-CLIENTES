/**
 * PLANO B — Script do Google Ads (enquanto o developer token não é aprovado)
 *
 * Onde colar: Google Ads → Ferramentas → Ações em massa → Scripts → (+) Novo script.
 * Agendar: "De hora em hora". Na primeira execução, autorize o script.
 *
 * O que faz: lê os últimos DAYS dias por campanha/dia e envia via POST para
 * /api/ingest/google do dashboard, autenticando com o INGEST_SECRET.
 *
 * ATENÇÃO: o segredo fica salvo aqui, dentro da conta do Google Ads. Use um valor
 * exclusivo para isso (openssl rand -hex 32) e troque-o se alguém sair da equipe.
 */

var ENDPOINT = 'https://dash.SEUDOMINIO.com.br/api/ingest/google';
var INGEST_SECRET = 'COLE_AQUI_O_MESMO_VALOR_DA_VERCEL';
var DAYS = 400;
// Opcional: nomes exatos das ações de conversão a contar. Vazio = coluna "Conversões".
// Deve ser igual ao GADS_CONVERSION_ACTIONS da Vercel, para a API direta bater com o script.
var CONVERSION_ACTIONS = [];

function main() {
  var tz = AdsApp.currentAccount().getTimeZone();
  var today = new Date();
  var until = Utilities.formatDate(today, tz, 'yyyy-MM-dd'); // inclui hoje (parcial)
  var since = Utilities.formatDate(new Date(today.getTime() - 86400000 * (DAYS - 1)), tz, 'yyyy-MM-dd');
  var where = "segments.date BETWEEN '" + since + "' AND '" + until + "'";

  var rows = [];
  var index = {};
  var it = AdsApp.search(
    'SELECT segments.date, campaign.id, campaign.name, campaign.status, ' +
    'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value ' +
    'FROM campaign WHERE ' + where
  );
  while (it.hasNext()) {
    var r = it.next();
    var row = {
      date: r.segments.date,
      campaignId: String(r.campaign.id),
      campaignName: r.campaign.name,
      status: r.campaign.status,
      spend: Number(r.metrics.costMicros || 0) / 1e6,
      impressions: Number(r.metrics.impressions || 0),
      clicks: Number(r.metrics.clicks || 0),
      conversions: Number(r.metrics.conversions || 0),
      revenue: Number(r.metrics.conversionsValue || 0)
    };
    index[row.date + '|' + row.campaignId] = row;
    rows.push(row);
  }

  if (CONVERSION_ACTIONS.length > 0) {
    for (var i = 0; i < rows.length; i++) { rows[i].conversions = 0; rows[i].revenue = 0; }
    var names = CONVERSION_ACTIONS.map(function (n) { return "'" + n.replace(/'/g, "\\'") + "'"; }).join(', ');
    var conv = AdsApp.search(
      'SELECT segments.date, campaign.id, segments.conversion_action_name, ' +
      'metrics.all_conversions, metrics.all_conversions_value FROM campaign WHERE ' + where +
      ' AND segments.conversion_action_name IN (' + names + ')'
    );
    while (conv.hasNext()) {
      var c = conv.next();
      var target = index[c.segments.date + '|' + String(c.campaign.id)];
      if (target) {
        target.conversions += Number(c.metrics.allConversions || 0);
        target.revenue += Number(c.metrics.allConversionsValue || 0);
      }
    }
  }

  var payload = {
    currency: AdsApp.currentAccount().getCurrencyCode(),
    from: since,
    to: until,
    rows: rows
  };
  var resp = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + INGEST_SECRET },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  Logger.log('Enviadas ' + rows.length + ' linhas (' + since + ' a ' + until + '). HTTP ' + code + ': ' + resp.getContentText());
  if (code !== 200) throw new Error('Falha no envio para o dashboard (HTTP ' + code + ')');
}
