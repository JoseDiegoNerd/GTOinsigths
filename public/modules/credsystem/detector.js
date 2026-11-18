// Deteccao do tipo de planilha pelo conjunto de colunas. Nao "chuta": so devolve confianca alta
// quando os campos obrigatorios do tipo estao presentes E o tipo vence o segundo colocado com folga.
// Caso contrario a UI pede ao usuario para escolher o modelo e mapear colunas manualmente.

import { TIPOS_ARQUIVO } from "./constantes.js";
import { marcaPorTexto } from "./normalizacao.js";

// { campo: cabecalhoNormalizado } usando aliases. Cada cabecalho atende no maximo um campo.
export function mapearAutomatico(tipo, cabecalhos) {
  const def = TIPOS_ARQUIVO[tipo];
  if (!def) return {};
  const disponiveis = new Set(cabecalhos);
  const usados = new Set();
  const mapa = {};
  for (const campo of def.campos) {
    const achado = campo.aliases.find((a) => disponiveis.has(a) && !usados.has(a));
    if (achado) { mapa[campo.campo] = achado; usados.add(achado); }
  }
  return mapa;
}

export function requisitosAtendidos(tipo, mapa) {
  const def = TIPOS_ARQUIVO[tipo];
  const faltando = def.requisitos.filter((grupo) => !grupo.some((c) => mapa[c]));
  return { ok: faltando.length === 0, faltando: faltando.map((g) => g.map((c) => def.campos.find((x) => x.campo === c)?.rotulo || c).join(" ou ")) };
}

// Uniao dos cabecalhos das abas com dados (planilhas com uma aba por marca repetem o cabecalho).
export function cabecalhosDoArquivo(leitura) {
  const set = new Set();
  for (const aba of leitura.abas) if (aba.linhas.length) aba.cabecalho.forEach((c) => set.add(c));
  return [...set];
}

export function detectarTipo(leitura) {
  const cabecalhos = cabecalhosDoArquivo(leitura);
  const ranking = Object.entries(TIPOS_ARQUIVO).map(([tipo, def]) => {
    const mapa = mapearAutomatico(tipo, cabecalhos);
    const reconhecidos = Object.keys(mapa).length;
    const assinatura = def.assinatura.filter((c) => mapa[c]).length;
    const req = requisitosAtendidos(tipo, mapa);
    const cobertura = reconhecidos / def.campos.length;
    const pontos = (req.ok ? 100 : 0) + assinatura * 10 + cobertura * 10;
    return { tipo, mapa, reconhecidos, assinatura, cobertura, requisitosOk: req.ok, faltando: req.faltando, pontos };
  }).sort((a, b) => b.pontos - a.pontos);

  const [primeiro, segundo] = ranking;
  let confianca = "baixa";
  if (primeiro.requisitosOk) {
    const folga = primeiro.pontos - (segundo?.requisitosOk ? segundo.pontos : 0);
    confianca = primeiro.assinatura >= 2 && folga >= 15 ? "alta" : "media";
  }
  const usados = new Set(Object.values(primeiro.mapa));
  return {
    tipo: confianca === "baixa" ? null : primeiro.tipo,
    tipoSugerido: primeiro.tipo,
    confianca,
    ranking,
    cabecalhos,
    colunasReconhecidas: cabecalhos.filter((c) => usados.has(c)),
    colunasNaoReconhecidas: cabecalhos.filter((c) => !usados.has(c))
  };
}

// Pastas de trabalho "modelo" trazem, alem da tabela de dados, abas auxiliares (LEIA_ME, dicionario,
// resumo, mapa de marcas) e modelos vazios. Cada aba e classificada pelo PROPRIO cabecalho: so ficam
// as abas com linhas que atendem os campos obrigatorios do tipo predominante. As demais sao listadas
// como ignoradas (com o motivo) e nao entram na deteccao, no mapeamento nem na importacao.
// Se nenhuma aba for reconhecida, nada e descartado (segue o fluxo de mapeamento manual).
export function separarAbasDeDados(leitura) {
  const classif = leitura.abas.map((aba) => {
    if (!aba.linhas.length) return { aba, tipo: null, motivo: "Aba sem linhas de dados (modelo vazio)." };
    const candidatos = Object.entries(TIPOS_ARQUIVO)
      .map(([tipo, def]) => {
        const mapa = mapearAutomatico(tipo, aba.cabecalho);
        return { tipo, ok: requisitosAtendidos(tipo, mapa).ok, assinatura: def.assinatura.filter((c) => mapa[c]).length };
      })
      .filter((c) => c.ok)
      .sort((a, b) => b.assinatura - a.assinatura);
    return candidatos.length
      ? { aba, tipo: candidatos[0].tipo }
      : { aba, tipo: null, motivo: "Não é uma tabela de importação (ex.: leia-me, dicionário, resumo)." };
  });
  const linhasPorTipo = {};
  for (const c of classif) if (c.tipo) linhasPorTipo[c.tipo] = (linhasPorTipo[c.tipo] || 0) + c.aba.linhas.length;
  const tipos = Object.keys(linhasPorTipo);
  if (!tipos.length) return { leitura, ignoradas: [] };
  const principal = tipos.sort((a, b) => linhasPorTipo[b] - linhasPorTipo[a])[0];
  const ignoradas = classif
    .filter((c) => c.tipo !== principal)
    .map((c) => ({
      nome: c.aba.nome,
      linhas: c.aba.linhas.length,
      motivo: c.tipo ? `Dados de "${TIPOS_ARQUIVO[c.tipo].curto}": salve esta aba em um arquivo próprio e envie separadamente.` : c.motivo
    }));
  return { leitura: { ...leitura, abas: classif.filter((c) => c.tipo === principal).map((c) => c.aba) }, ignoradas };
}

// Marca indicada pelo nome de cada aba (ex.: "TESOURA DE OURO", "FREE CENTER").
export function marcasPorAba(leitura) {
  return Object.fromEntries(leitura.abas.map((a) => [a.nome, marcaPorTexto(a.nome)]));
}

// Assinatura do cabecalho para reaplicar modelos de mapeamento salvos.
export function assinaturaCabecalho(cabecalhos) {
  return [...new Set(cabecalhos)].sort().join("|");
}
