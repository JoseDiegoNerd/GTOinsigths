import { readFileSync, existsSync } from 'node:fs';

const requiredFiles = [
  'src/lib/supabaseClient.ts',
  'src/services/credsystemService.ts',
  'src/services/importService.ts',
  'src/hooks/useCredsystemDashboard.ts',
  'src/hooks/useCredsystemBI.ts',
  'src/hooks/useStageImport.ts',
  'src/App.tsx',
  'supabase/checks/20260703_check_data_stage_policies_final.sql',
  'supabase/migrations/20260706_004_credsystem_bi_views.sql',
  'supabase/checks/20260706_check_credsystem_bi_views.sql',
  'supabase/migrations/20260707_005_marketing_channels_bi_views.sql',
  'supabase/checks/20260707_check_marketing_channels_bi_views.sql',
  'supabase/migrations/20260707_006_email_marketing_bi_views.sql',
  'supabase/checks/20260707_check_email_marketing_bi_views.sql',
  'supabase/migrations/20260707_007_meta_social_bi_views.sql',
  'supabase/checks/20260707_check_meta_social_bi_views.sql',
  'supabase/migrations/20260708_008_social_format_metrics.sql',
  'supabase/checks/20260708_check_social_format_metrics.sql'
];

const requiredTables = [
  'dados_cartoes_credsystem',
  'stage_credsystem_propostas',
  'stage_rd_station_marketing',
  'stage_meta_business_analytics',
  'stage_google_business_profile',
  'stage_social_format_metrics'
];

// vw_email_marketing_campanhas/vw_email_marketing_resumo_marca ficaram de fora desta lista de
// proposito (migration 20260818_033): a tela de Email Marketing passou a ler de
// vw_campanha_disparos_resumo (campanhas_email/campanha_disparos/campanha_analise_estrategica),
// nao mais dessas duas. As views antigas continuam existindo no banco (historico pre-033), so
// deixaram de ser obrigatorias no frontend.
const requiredViews = [
  'vw_credsystem_resumo_geral',
  'vw_credsystem_por_marca',
  'vw_credsystem_por_loja',
  'vw_credsystem_motivos_rejeicao',
  'vw_credsystem_funil_propostas_emissoes',
  'vw_rd_station_resumo',
  'vw_meta_business_resumo',
  'vw_google_business_resumo',
  'vw_marketing_canais_por_marca',
  'vw_meta_social_periodos',
  'vw_meta_social_resumo_marca',
  'vw_meta_social_ranking_conteudo',
  'vw_instagram_metricas_formato',
  'vw_facebook_metricas_formato'
];

const missingFiles = requiredFiles.filter((file) => !existsSync(file));
if (missingFiles.length > 0) {
  console.error(`Missing files: ${missingFiles.join(', ')}`);
  process.exit(1);
}

const serviceText = readFileSync('src/services/importService.ts', 'utf8');
const dashboardText = readFileSync('src/services/credsystemService.ts', 'utf8');
const policySql = readFileSync('supabase/fixes/20260703_fix_data_stage_policies.sql', 'utf8');
const biSql = readFileSync('supabase/migrations/20260706_004_credsystem_bi_views.sql', 'utf8');
const channelBiSql = readFileSync('supabase/migrations/20260707_005_marketing_channels_bi_views.sql', 'utf8');
const emailBiSql = readFileSync('supabase/migrations/20260707_006_email_marketing_bi_views.sql', 'utf8');
const metaSocialBiSql = readFileSync('supabase/migrations/20260707_007_meta_social_bi_views.sql', 'utf8');
const socialFormatBiSql = readFileSync('supabase/migrations/20260708_008_social_format_metrics.sql', 'utf8');
const publicAppText = readFileSync('public/index.html', 'utf8');

for (const table of requiredTables) {
  if (!serviceText.includes(table) && !dashboardText.includes(table) && !publicAppText.includes(table)) {
    console.error(`Table is not referenced by services: ${table}`);
    process.exit(1);
  }
}

if (!policySql.includes('public.gto_tem_acesso_marca(marca)')) {
  console.error('Policy SQL is not using public.gto_tem_acesso_marca(marca).');
  process.exit(1);
}

for (const view of requiredViews) {
  if (!publicAppText.includes(view) && !dashboardText.includes(view)) {
    console.error(`BI view is not referenced by frontend/service code: ${view}`);
    process.exit(1);
  }

  if (!biSql.includes(view) && !channelBiSql.includes(view) && !emailBiSql.includes(view) && !metaSocialBiSql.includes(view) && !socialFormatBiSql.includes(view)) {
    console.error(`BI view is not referenced by migrations: ${view}`);
    process.exit(1);
  }
}

if (!biSql.includes('security_invoker = true') || !channelBiSql.includes('security_invoker = true') || !emailBiSql.includes('security_invoker = true') || !metaSocialBiSql.includes('security_invoker = true') || !socialFormatBiSql.includes('security_invoker = true')) {
  console.error('BI views are not configured with security_invoker = true.');
  process.exit(1);
}

console.log('Contract check passed: services, hooks, policy SQL and BI views reference the expected Supabase objects.');
