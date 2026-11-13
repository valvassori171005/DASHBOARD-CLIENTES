// Leitura centralizada das variáveis de ambiente.
const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
export const list = (k, d = '') => env(k, d).split(',').map((s) => s.trim()).filter(Boolean);

export const isDemo = () => env('DEMO_MODE') === '1' || env('DEMO_MODE').toLowerCase() === 'true';

export function metaConfig() {
  let account = env('META_AD_ACCOUNT_ID');
  if (account && !account.startsWith('act_')) account = `act_${account}`;
  return {
    token: env('META_ACCESS_TOKEN'),
    account,
    version: env('META_API_VERSION', 'v23.0'),
    conversionActions: list('META_CONVERSION_ACTIONS', 'lead'),
    revenueActions: list('META_REVENUE_ACTIONS', 'offsite_conversion.fb_pixel_purchase'),
    clicksField: env('META_CLICKS_FIELD', 'inline_link_clicks') === 'clicks' ? 'clicks' : 'inline_link_clicks',
  };
}

export const metaReady = () => {
  const c = metaConfig();
  return Boolean(c.token && c.account);
};

const digits = (s) => s.replace(/\D/g, '');

export function googleConfig() {
  return {
    developerToken: env('GADS_DEVELOPER_TOKEN'),
    clientId: env('GADS_CLIENT_ID'),
    clientSecret: env('GADS_CLIENT_SECRET'),
    refreshToken: env('GADS_REFRESH_TOKEN'),
    customerId: digits(env('GADS_CUSTOMER_ID')),
    loginCustomerId: digits(env('GADS_LOGIN_CUSTOMER_ID')),
    version: env('GADS_API_VERSION', 'v23'),
    conversionActions: list('GADS_CONVERSION_ACTIONS'),
  };
}

export const googleSheetUrl = () => env('GADS_SHEET_CSV_URL');

// api = Google Ads API direta; sheet = plano B (script → Google Sheets).
export function googleMode() {
  const forced = env('GADS_MODE').toLowerCase();
  if (forced === 'api' || forced === 'sheet') return forced;
  return env('GADS_DEVELOPER_TOKEN') ? 'api' : 'sheet';
}

export function googleReady() {
  if (googleMode() === 'api') {
    const c = googleConfig();
    return Boolean(c.developerToken && c.clientId && c.clientSecret && c.refreshToken && c.customerId);
  }
  return /^https:\/\/docs\.google\.com\/spreadsheets\//.test(googleSheetUrl());
}

export const clientName = () => env('CLIENT_NAME', 'Cliente');
export const conversionLabel = () => env('CONVERSION_LABEL', 'Conversões');
