# Dashboard de tráfego pago (Meta Ads + Google Ads)

Dashboard web que consulta **direto as APIs oficiais** do Meta e do Google Ads e se mantém
atualizado sozinho. Sem ferramentas intermediárias, sem banco de dados e sem cron: as funções
serverless consultam as APIs na hora e a CDN da Vercel guarda a resposta por até 1h
(`Cache-Control: s-maxage=3600, stale-while-revalidate`).

```
GitHub (privado) ──push──► Vercel
  /                 public/ (HTML/CSS/JS, responsivo, pt-BR)
  /api/config       configuração pública (nome do cliente, rótulo de conversão)
  /api/meta         Meta Marketing API  → /act_{ID}/insights
  /api/google       Google Ads API (REST + GAQL)  ou  planilha do plano B
  middleware.js     exige o login do Cloudflare Access (também na URL *.vercel.app)
Cloudflare: DNS (dash.dominio.com.br) + Access (login por e-mail/OTP)
```

## Estrutura

| Caminho | O que é |
|---|---|
| `public/` | Front-end (sem framework; Chart.js via CDN) |
| `api/` | Funções serverless (Node 20+, sem dependências) |
| `lib/` | Código compartilhado: Meta, Google Ads, planilha, normalização, datas |
| `middleware.js` | Validação do JWT do Cloudflare Access |
| `scripts/google-ads-para-sheets.js` | Script para colar no Google Ads (plano B → Google Sheets) |
| `scripts/dev-server.js` | Servidor local (`npm run dev`) |
| `test/` | Testes sem rede (`npm test`) |
| `.env.example` | Todas as variáveis de ambiente, comentadas |

## Rodar localmente

```bash
cp .env.example .env
```

```bash
DEMO_MODE=1 npm run dev
```

Abra http://localhost:3000. Com `DEMO_MODE=1` o dash usa **dados sintéticos** (com aviso na tela),
útil para mexer no layout antes de ter os tokens. Para dados reais, preencha o `.env` e use
`DEMO_MODE=0`.

```bash
npm test
```

## Contrato das APIs

`GET /api/meta` e `GET /api/google` aceitam `since`, `until` (AAAA-MM-DD) e, opcionalmente,
`prev_since`/`prev_until` (sem eles, usa o período anterior de mesmo tamanho). Ambos devolvem
o mesmo formato, por isso trocar o Google do plano B para a API direta não muda o front:

```json
{ "platform": "meta", "mode": "api|script|demo", "source": "...", "currency": "BRL",
  "since": "...", "until": "...", "generatedAt": "...", "dataUpdatedAt": "...",
  "totals": { "spend": 0, "impressions": 0, "clicks": 0, "conversions": 0, "revenue": 0 },
  "previous": { "since": "...", "until": "...", "totals": { } },
  "daily": [ { "date": "...", "spend": 0 } ], "campaigns": [ { "id": "...", "name": "...", "status": "ativa" } ],
  "notes": [] }
```

CTR, CPC, CPM, CPL/CPA e ROAS são calculados no front a partir desses totais.

## Credenciais

Tokens ficam **só** nas variáveis de ambiente da Vercel (ou no `.env` local, que está no
`.gitignore`). Nada chega ao navegador.

### Meta Ads
1. [Meta for Developers](https://developers.facebook.com/apps) → criar app do tipo **Empresa**,
   ligado ao Gerenciador de Negócios do cliente; adicionar o produto **Marketing API**.
2. Gerenciador de Negócios → Configurações → **Usuários do sistema** → adicionar (função Admin ou
   Funcionário) → **Atribuir ativos**: a conta de anúncios, com permissão de visualização.
3. No usuário do sistema → **Gerar token**: escolha o app, validade **Nunca**, permissão
   `ads_read` (o `read_insights` não é necessário para anúncios).
4. ID da conta: Gerenciador de Anúncios → número da conta → `act_XXXXXXXX`.
5. Variáveis: `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`.

Ajustes de critério (confirmar com o cliente):
- `META_CONVERSION_ACTIONS`: action_types somados como conversão. `lead` já soma leads do
  formulário instantâneo e do pixel. Para conversas: `onsite_conversion.messaging_conversation_started_7d`.
- `META_CLICKS_FIELD`: `inline_link_clicks` (cliques no link, padrão) ou `clicks` (todos).
- A atribuição usada é a mesma configurada na conta (`use_unified_attribution_setting`),
  para os números baterem com o Gerenciador.

### Google Ads (API direta)
1. **Developer token**: na conta **MCC** → Administrador → Centro de API. Peça o
   **Basic access** já — a aprovação leva alguns dias. Enquanto isso, use o plano B.
2. **OAuth client**: Google Cloud Console → novo projeto → ativar **Google Ads API** →
   Tela de consentimento OAuth (tipo Externo; publique o app para o refresh token não expirar
   em 7 dias) → Credenciais → ID do cliente OAuth do tipo **App para computador**.
3. **Refresh token**: com uma conta Google que tenha acesso à MCC, gere o token com o
   escopo `https://www.googleapis.com/auth/adwords` (ex.: OAuth Playground com
   "Use your own OAuth credentials", ou o exemplo `generate_user_credentials` das libs oficiais).
4. **Customer ID** da conta do cliente e **login-customer-id** da MCC (com ou sem hífens).
5. Variáveis: `GADS_DEVELOPER_TOKEN`, `GADS_CLIENT_ID`, `GADS_CLIENT_SECRET`,
   `GADS_REFRESH_TOKEN`, `GADS_CUSTOMER_ID`, `GADS_LOGIN_CUSTOMER_ID`.
6. `GADS_API_VERSION` (padrão `v23`): o Google desativa versões antigas com frequência;
   confira a versão vigente nas [notas de versão](https://developers.google.com/google-ads/api/docs/release-notes)
   antes do deploy.

Conversões: por padrão, a coluna **Conversões** (ações marcadas como principais). Para contar
ações específicas, liste os nomes em `GADS_CONVERSION_ACTIONS`.

### Google Ads — plano B: Script → Google Sheets (enquanto o developer token não sai)
O Script do Google Ads grava, de hora em hora, os últimos 400 dias por campanha/dia numa
planilha; o `/api/google` lê essa planilha publicada como CSV.

1. Crie uma planilha vazia no Google Sheets (ex.: "HSJ – Google Ads – dados").
2. Google Ads da conta do cliente → Ferramentas → Ações em massa → **Scripts** → (+) → cole
   `scripts/google-ads-para-sheets.js`, troque `SHEET_URL` pelo link da planilha →
   **Autorizar** → **Visualizar** → **Executar**. Confira se a aba `dados` foi preenchida.
3. No script, **Frequência: de hora em hora**.
4. Na planilha: Arquivo → Compartilhar → **Publicar na Web** → aba `dados`, formato
   **CSV** → Publicar. Copie o link para `GADS_SHEET_CSV_URL` na Vercel.
5. Sem `GADS_DEVELOPER_TOKEN`, o `/api/google` já lê a planilha (ou force com `GADS_MODE=sheet`).
   O rodapé do dash mostra o horário da última atualização.
6. Quando o token for aprovado: preencha as `GADS_*`, remova `GADS_MODE` (ou `GADS_MODE=api`)
   e pause o script. O front não muda.

> **Atenção:** "Publicar na Web" deixa o CSV acessível a quem tiver o link (que é longo e
> impossível de adivinhar, e não aparece no front nem no repositório — fica só na Vercel).
> O conteúdo são métricas de campanha (investimento, cliques, conversões), sem dados de
> pacientes. Se isso não for aceitável para o cliente, a alternativa é ler a planilha privada
> com uma conta de serviço do Google Cloud.

## Deploy (Vercel)
1. Vercel → Add New Project → importar este repositório (Framework: **Other**; sem build).
   O `vercel.json` já define `public/` como saída.
2. Settings → Environment Variables → cadastrar as variáveis do `.env.example`
   (Production e Preview). Redeploy depois de mudar variáveis.
3. Cada push na branch principal publica sozinho.

> **Plano:** o Hobby (grátis) da Vercel é só para uso **não comercial**. Para dashboard de
> cliente, use o **Pro** — ou migre para Cloudflare Pages (grátis e permite uso comercial; as
> funções de `api/` precisariam ser adaptadas para o formato de Pages Functions).

## Cloudflare (DNS + Access)
1. DNS do domínio → registro **CNAME** `dash` → `cname.vercel-dns.com`, **proxy ativado**
   (nuvem laranja, necessário para o Access). Na Vercel: Settings → Domains → adicionar
   `dash.dominio.com.br`. SSL/TLS na Cloudflare em **Full (strict)**.
2. Zero Trust → Access → Applications → **Self-hosted** → domínio `dash.dominio.com.br` →
   política **Allow** com os e-mails autorizados → login por **One-time PIN** (grátis até 50 usuários).
3. Na aplicação criada, copie o **Application Audience (AUD) Tag** e o domínio da equipe
   (`<equipe>.cloudflareaccess.com`) para `CF_ACCESS_AUD` e `CF_ACCESS_TEAM_DOMAIN` na Vercel.
Por que o passo 3: sem ele, qualquer um acessaria o dash pela URL `*.vercel.app`, contornando
o Cloudflare. O `middleware.js` valida o JWT assinado pelo Access em toda requisição (antes do
cache da CDN) e devolve 403 sem ele.

## Checagem final
Compare os totais do dash com o Gerenciador de Anúncios e com o Google Ads, no mesmo período e
fuso. Diferenças comuns: cliques (link × todos), janela de atribuição, ações de conversão
diferentes e dados do dia corrente ainda em processamento.
