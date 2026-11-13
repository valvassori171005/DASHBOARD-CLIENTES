/**
 * PLANO B — Script do Google Ads → Google Sheets (enquanto o developer token não é aprovado)
 *
 * 1. Crie uma planilha no Google Sheets (com a mesma conta Google que acessa o Google Ads).
 * 2. Google Ads → Ferramentas → Ações em massa → Scripts → (+) Novo script → cole este código.
 * 3. Preencha SHEET_URL abaixo → Autorizar → Visualizar → Executar.
 * 4. Agende: "De hora em hora".
 * 5. Na planilha: Arquivo → Compartilhar → Publicar na Web → escolha a aba "dados" e o
 *    formato "Valores separados por vírgula (.csv)" → Publicar. Esse link vai na Vercel em
 *    GADS_SHEET_CSV_URL.
 *
 * O dashboard só lê a planilha; não edite a aba "dados" à mão (o script a reescreve toda hora).
 */

var SHEET_URL = 'https://docs.google.com/spreadsheets/d/COLE_O_ID_AQUI/edit';
var TAB = 'dados';
var DAYS = 400;
// Opcional: nomes exatos das ações de conversão a contar. Vazio = coluna "Conversões".
var CONVERSION_ACTIONS = [];

function main() {
  var account = AdsApp.currentAccount();
  var tz = account.getTimeZone();
  var now = new Date();
  var until = Utilities.formatDate(now, tz, 'yyyy-MM-dd'); // inclui hoje (parcial)
  var since = Utilities.formatDate(new Date(now.getTime() - 86400000 * (DAYS - 1)), tz, 'yyyy-MM-dd');
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
    var row = [
      r.segments.date,
      String(r.campaign.id),
      r.campaign.name,
      r.campaign.status,
      Number(r.metrics.costMicros || 0) / 1e6,
      Number(r.metrics.impressions || 0),
      Number(r.metrics.clicks || 0),
      Number(r.metrics.conversions || 0),
      Number(r.metrics.conversionsValue || 0)
    ];
    index[row[0] + '|' + row[1]] = row;
    rows.push(row);
  }

  if (CONVERSION_ACTIONS.length > 0) {
    for (var i = 0; i < rows.length; i++) { rows[i][7] = 0; rows[i][8] = 0; }
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
        target[7] += Number(c.metrics.allConversions || 0);
        target[8] += Number(c.metrics.allConversionsValue || 0);
      }
    }
  }

  rows.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  // Tudo como texto com ponto decimal: o CSV publicado não depende da localidade da planilha.
  var values = [['date', 'campaignId', 'campaignName', 'status', 'spend', 'impressions', 'clicks', 'conversions', 'revenue']];
  for (var j = 0; j < rows.length; j++) {
    values.push(rows[j].map(function (v, k) { return k >= 4 ? String(Math.round(v * 100) / 100) : String(v); }));
  }

  var ss = SpreadsheetApp.openByUrl(SHEET_URL);
  var sheet = ss.getSheetByName(TAB) || ss.insertSheet(TAB);
  sheet.clear();
  var range = sheet.getRange(1, 1, values.length, values[0].length);
  range.setNumberFormat('@');
  range.setValues(values);
  var meta = sheet.getRange(1, 11, 3, 2);
  meta.setNumberFormat('@');
  meta.setValues([
    ['atualizado_em', new Date().toISOString()],
    ['moeda', account.getCurrencyCode()],
    ['desde', since]
  ]);
  Logger.log('Planilha atualizada: ' + rows.length + ' linhas (' + since + ' a ' + until + ').');
}
