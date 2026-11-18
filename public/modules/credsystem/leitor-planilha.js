// Leitura de planilhas (XLSX, XLS, CSV) para uma estrutura neutra:
//   { abas: [{ nome, cabecalhoOriginal[], cabecalho[] (normalizado), linhaCabecalho, linhas: [{ numero, valores: {chave: bruto} }], vazias }] }
//
// Seguranca / robustez:
//   - nunca avalia formulas: le so o valor em cache da celula (cellFormula:false); texto que
//     "parece formula" fica literal e e neutralizado na exportacao.
//   - corta o intervalo da aba pelas celulas que realmente tem valor (abas "formatadas" ate a
//     linha 1.048.576 nao sao varridas inteiras).
//   - limites de linhas/colunas para evitar arquivos-bomba.
//   - CSV lido por parser proprio (RFC 4180) mantendo tudo como texto: datas "01/06/2026" nao
//     sao reinterpretadas no formato americano.

import { LIMITES } from "./constantes.js";
import { normalizarCabecalho, vazio } from "./normalizacao.js";
import { TIPOS_ARQUIVO } from "./constantes.js";

// Todos os aliases conhecidos (de todos os tipos) - usados para achar a linha de cabecalho.
const ALIASES_CONHECIDOS = new Set(
  Object.values(TIPOS_ARQUIVO).flatMap((t) => t.campos.flatMap((c) => c.aliases))
);

export function decodificarTexto(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let inicio = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) inicio = 3;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(inicio));
  } catch {
    return new TextDecoder("windows-1252").decode(bytes.subarray(inicio));
  }
}

function detectarSeparador(primeiraLinha) {
  const contagens = [";", ",", "\t", "|"].map((sep) => {
    let n = 0, aspas = false;
    for (const ch of primeiraLinha) {
      if (ch === "\"") aspas = !aspas;
      else if (ch === sep && !aspas) n++;
    }
    return [sep, n];
  });
  contagens.sort((a, b) => b[1] - a[1]);
  return contagens[0][1] > 0 ? contagens[0][0] : ",";
}

// Parser CSV RFC 4180 (aspas, aspas escapadas, quebras de linha dentro de aspas).
export function parseCsv(texto, limiteLinhas = LIMITES.linhasPorArquivo + LIMITES.linhasBuscaCabecalho) {
  const primeira = texto.slice(0, texto.indexOf("\n") >= 0 ? texto.indexOf("\n") : texto.length);
  const sep = detectarSeparador(primeira);
  const linhas = [];
  let campo = "", linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === "\"") {
        if (texto[i + 1] === "\"") { campo += "\""; i++; } else aspas = false;
      } else campo += ch;
      continue;
    }
    if (ch === "\"" && campo === "") { aspas = true; continue; }
    if (ch === sep) { linha.push(campo); campo = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      linhas.push(linha); linha = [];
      if (linhas.length > limiteLinhas) throw new Error(`Arquivo com mais de ${LIMITES.linhasPorArquivo.toLocaleString("pt-BR")} linhas.`);
      continue;
    }
    campo += ch;
  }
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  return { linhas, separador: sep };
}

// Escolhe a linha de cabecalho: a que tem mais celulas batendo com campos conhecidos; empate ou
// nenhuma conhecida => a com mais valores distintos (titulos mesclados repetem o mesmo texto).
export function acharLinhaCabecalho(matriz) {
  let melhor = 0, melhorPontos = -1;
  const limite = Math.min(matriz.length, LIMITES.linhasBuscaCabecalho);
  for (let i = 0; i < limite; i++) {
    const celulas = (matriz[i] || []).map((c) => normalizarCabecalho(c)).filter(Boolean);
    const conhecidas = celulas.filter((c) => ALIASES_CONHECIDOS.has(c)).length;
    const distintas = new Set(celulas).size;
    const pontos = conhecidas * 1000 + distintas;
    if (pontos > melhorPontos) { melhorPontos = pontos; melhor = i; }
  }
  return melhor;
}

function matrizParaAba(nome, matriz) {
  const idx = acharLinhaCabecalho(matriz);
  const cabecalhoOriginal = (matriz[idx] || []).map((c) => String(c ?? "").trim());
  if (cabecalhoOriginal.length > LIMITES.colunasPorAba) throw new Error(`A aba "${nome}" tem mais de ${LIMITES.colunasPorAba} colunas.`);
  // cabecalhos duplicados recebem sufixo para nao sobrescrever valores
  const vistos = new Map();
  const cabecalho = cabecalhoOriginal.map((c, i) => {
    let k = normalizarCabecalho(c) || `coluna_${i + 1}`;
    if (vistos.has(k)) { vistos.set(k, vistos.get(k) + 1); k = `${k}_${vistos.get(k)}`; } else vistos.set(k, 1);
    return k;
  });
  const linhas = [];
  let vazias = 0;
  for (let r = idx + 1; r < matriz.length; r++) {
    const bruta = matriz[r] || [];
    if (!bruta.some((c) => !vazio(c))) { vazias++; continue; }
    const valores = {};
    cabecalho.forEach((k, i) => { valores[k] = bruta[i] === undefined ? null : bruta[i]; });
    linhas.push({ numero: r + 1, valores });
  }
  return { nome, cabecalhoOriginal, cabecalho, linhaCabecalho: idx + 1, linhas, vazias };
}

// Intervalo real (so celulas com valor) - evita varrer 1 milhao de linhas formatadas e vazias.
function intervaloUsado(XLSX, ws) {
  let maxR = -1, maxC = -1, minR = Infinity, minC = Infinity;
  for (const chave of Object.keys(ws)) {
    if (chave[0] === "!") continue;
    const cel = ws[chave];
    if (!cel || cel.v === undefined || cel.v === null || cel.v === "") continue;
    const { r, c } = XLSX.utils.decode_cell(chave);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
    if (r < minR) minR = r;
    if (c < minC) minC = c;
  }
  if (maxR < 0) return null;
  return XLSX.utils.encode_range({ s: { r: Math.min(minR, 0), c: Math.min(minC, 0) }, e: { r: maxR, c: maxC } });
}

export function lerPlanilha({ nomeArquivo, buffer, XLSX }) {
  const nome = String(nomeArquivo || "").toLowerCase();
  if (nome.endsWith(".csv") || nome.endsWith(".txt")) {
    const texto = decodificarTexto(buffer);
    const { linhas, separador } = parseCsv(texto);
    const aba = matrizParaAba(nomeArquivo.replace(/\.[^.]+$/, ""), linhas);
    return { formato: "csv", separador, abas: [aba] };
  }
  if (!XLSX) throw new Error("Leitor de planilhas indisponível.");
  const wb = XLSX.read(buffer, {
    type: "array", cellFormula: false, cellHTML: false, cellNF: false, cellStyles: false,
    cellDates: false, sheetStubs: false, bookVBA: false, WTF: false
  });
  const abas = [];
  let totalLinhas = 0;
  for (const nomeAba of wb.SheetNames) {
    const ws = wb.Sheets[nomeAba];
    if (!ws) continue;
    const ref = intervaloUsado(XLSX, ws);
    if (!ref) { abas.push({ nome: nomeAba, cabecalhoOriginal: [], cabecalho: [], linhaCabecalho: 0, linhas: [], vazias: 0 }); continue; }
    ws["!ref"] = ref;
    const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    totalLinhas += matriz.length;
    if (totalLinhas > LIMITES.linhasPorArquivo) throw new Error(`Arquivo com mais de ${LIMITES.linhasPorArquivo.toLocaleString("pt-BR")} linhas.`);
    abas.push(matrizParaAba(nomeAba, matriz));
  }
  return { formato: nome.endsWith(".xls") ? "xls" : "xlsx", abas };
}
