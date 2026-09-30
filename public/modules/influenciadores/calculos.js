// Funcoes puras do modulo Influenciadores: formatacao pt-BR, KPIs, agregados, busca e paginacao.
// Sem acesso a DOM nem a rede - tudo testavel com node --test.

const ESPACOS = /[  ]/g;
const MENOS_UNICODE = /−/g;

function numeroOuNull(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function paraNumero(valor) {
  return numeroOuNull(valor) ?? 0;
}

function limpar(texto) {
  return texto.replace(ESPACOS, " ").replace(MENOS_UNICODE, "-");
}

function soma(lista, campo) {
  return lista.reduce((total, item) => total + paraNumero(item[campo]), 0);
}

// Formatacao -------------------------------------------------------------------------------------
export function formatBRL(valor) {
  const n = numeroOuNull(valor);
  if (n === null) return "—";
  return limpar(new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n));
}

export function formatBRLInteiro(valor) {
  const n = numeroOuNull(valor);
  if (n === null) return "—";
  return limpar(new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0
  }).format(n));
}

export function formatInt(valor) {
  const n = numeroOuNull(valor);
  if (n === null) return "—";
  return limpar(new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n));
}

// valor ja em porcentagem (4.12 => "4,12%").
export function formatPct(valor, casas = 1) {
  const n = numeroOuNull(valor);
  if (n === null) return "—";
  return `${limpar(new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(n))}%`;
}

export function formatVariacao(valor) {
  const n = numeroOuNull(valor);
  if (n === null) return "—";
  const texto = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero"
  }).format(n);
  return `${limpar(texto)}%`;
}

export function formatSincronizadoEm(timestamp, agora = new Date()) {
  if (!timestamp) return "Nunca sincronizado";
  const diffMs = agora.getTime() - new Date(timestamp).getTime();
  const minutos = Math.floor(diffMs / 60000);
  if (minutos < 1) return "Sincronizado agora mesmo";
  if (minutos < 60) return `Sincronizado há ${minutos} ${minutos === 1 ? "minuto" : "minutos"}`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `Sincronizado há ${horas} ${horas === 1 ? "hora" : "horas"}`;
  const dias = Math.floor(horas / 24);
  return `Sincronizado há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

// Datas (strings ISO YYYY-MM-DD) ------------------------------------------------------------------
export function mesChave(dataISO) {
  return String(dataISO ?? "").slice(0, 7);
}

export function mesAnteriorChave(chave) {
  const [ano, mes] = chave.split("-").map(Number);
  const anterior = new Date(Date.UTC(ano, mes - 2, 1));
  return `${anterior.getUTCFullYear()}-${String(anterior.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function hojeISO(agora = new Date()) {
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

export function diasEntre(aISO, bISO) {
  return Math.round((Date.parse(`${bISO}T00:00:00Z`) - Date.parse(`${aISO}T00:00:00Z`)) / 86400000);
}

export function campanhaAtiva(campanha, hoje) {
  return campanha.data_inicio <= hoje && (!campanha.data_fim || campanha.data_fim >= hoje);
}

// KPIs do topo -----------------------------------------------------------------------------------
function variacao(atual, anterior) {
  if (atual === null || anterior === null || anterior === 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

function totaisDoMes(campanhas, midias, mes) {
  const investimento = soma(campanhas.filter((c) => mesChave(c.data_inicio) === mes), "investimento_total");
  const doMes = midias.filter((m) => mesChave(m.publicada_em) === mes);
  const alcance = soma(doMes, "alcance");
  const interacoes = doMes.reduce(
    (total, m) => total + paraNumero(m.curtidas) + paraNumero(m.comentarios) + paraNumero(m.salvos) + paraNumero(m.compartilhamentos),
    0
  );
  return {
    investimento,
    alcance,
    interacoes,
    engajamento: alcance > 0 ? (interacoes / alcance) * 100 : null,
    cpe: interacoes > 0 ? investimento / interacoes : null
  };
}

export function calcularKpis({ campanhas, midias, mes }) {
  const atual = totaisDoMes(campanhas, midias, mes);
  const anterior = totaisDoMes(campanhas, midias, mesAnteriorChave(mes));
  const par = (chave) => ({ atual: atual[chave], anterior: anterior[chave], variacao: variacao(atual[chave], anterior[chave]) });
  return {
    investimento: par("investimento"),
    alcance: par("alcance"),
    engajamento: par("engajamento"),
    cpe: par("cpe"),
    interacoes: par("interacoes")
  };
}

// Por influenciador ------------------------------------------------------------------------------
function ordenarSnapshots(snapshots) {
  return [...snapshots].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

export function agregarInfluenciador({ campanhas, midias, snapshots }, hoje) {
  const ordenados = ordenarSnapshots(snapshots);
  const ultimo = ordenados.length > 0 ? ordenados[ordenados.length - 1] : null;

  // Base do crescimento: snapshot mais recente com >= 7 dias de distancia do ultimo.
  let base = null;
  if (ultimo) {
    for (let i = ordenados.length - 2; i >= 0; i -= 1) {
      if (diasEntre(ordenados[i].data, ultimo.data) >= 7) {
        base = ordenados[i];
        break;
      }
    }
  }

  const seguidores = ultimo ? paraNumero(ultimo.seguidores) : null;
  const baseSeguidores = base ? paraNumero(base.seguidores) : null;
  const crescimentoAbs = base ? seguidores - baseSeguidores : null;
  const crescimentoPct = base && baseSeguidores > 0 ? (crescimentoAbs / baseSeguidores) * 100 : null;

  return {
    seguidores,
    crescimentoAbs,
    crescimentoPct,
    campanhasAtivas: campanhas.filter((c) => campanhaAtiva(c, hoje)).length,
    cacheTotal: soma(campanhas, "cache_valor"),
    voucherTotal: soma(campanhas, "voucher_valor"),
    investimentoTotal: soma(campanhas, "investimento_total"),
    alcanceTotal: soma(midias, "alcance"),
    totalMidias: midias.length
  };
}

export function agruparPorInfluenciador({ influenciadores, campanhas, midias, snapshots }) {
  const mapa = new Map(influenciadores.map((i) => [i.id, { campanhas: [], midias: [], snapshots: [] }]));
  for (const c of campanhas) mapa.get(c.influenciador_id)?.campanhas.push(c);
  for (const m of midias) mapa.get(m.influenciador_id)?.midias.push(m);
  for (const s of snapshots) mapa.get(s.influenciador_id)?.snapshots.push(s);
  return mapa;
}

export function pontosCrescimento(snapshots, quantidade = 7) {
  return ordenarSnapshots(snapshots)
    .slice(-quantidade)
    .map((s) => ({ data: s.data, seguidores: paraNumero(s.seguidores) }));
}

// Texto, busca e paginacao -----------------------------------------------------------------------
export function iniciais(nome) {
  const partes = String(nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export function normalizarTexto(texto) {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function filtrarInfluenciadores(lista, busca) {
  const termo = normalizarTexto(busca);
  if (!termo) return lista;
  return lista.filter((i) => normalizarTexto(`${i.nome} ${i.handle} ${i.nicho ?? ""}`).includes(termo));
}

export function paginar(lista, pagina, tamanho) {
  const total = lista.length;
  const totalPaginas = Math.max(1, Math.ceil(total / tamanho));
  const atual = Math.min(Math.max(1, Number(pagina) || 1), totalPaginas);
  return { itens: lista.slice((atual - 1) * tamanho, atual * tamanho), pagina: atual, totalPaginas, total };
}

export function pluralCampanhas(n) {
  return `${n} ${n === 1 ? "campanha" : "campanhas"}`;
}
