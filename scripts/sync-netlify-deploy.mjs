// netlify-deploy/ e o que o site publicado no Netlify realmente serve - nao e gerado por build,
// e uma copia literal de public/ que precisa ser atualizada manualmente a cada deploy. Ela ficou
// congelada desde o commit inicial do projeto por quase 3 semanas (19 commits de defasagem) porque
// ninguem lembrava de sincronizar. Este script existe pra essa sincronizacao nunca mais depender de
// memoria: roda como build command do Netlify (ver netlify.toml) e tambem pode ser chamado a mao via
// `npm run sync:netlify` antes de qualquer deploy manual.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const src = resolve('public');
const dest = resolve('netlify-deploy');

if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true });
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });

const arquivos = readdirSync(dest);
console.log(`netlify-deploy/ sincronizado com public/ (${arquivos.length} arquivo(s)): ${arquivos.join(', ')}`);
