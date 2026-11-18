// Normalizacao de valores vindos de planilha. Regras centrais:
//   - celula vazia => null (NUNCA zero). Zero so quando a planilha traz 0 de fato.
//   - toda conversao relevante devolve tambem o que foi feito, para registrar em "transformacoes".
//   - texto e mantido literal (formulas/HTML viram texto inerte); escape acontece na exibicao.

import { MARCAS } from "./constantes.js";

export function normalizarCabecalho(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// Espelha public.gto_cs_norm() do banco (chave natural): sem acento, minusculo, espacos colapsados.
export function normalizarTexto(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");
  return s === "" ? null : s;
}

export function vazio(raw) {
  return raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");
}

// Remove caracteres de controle (mantem \t \n \r) e limita tamanho - igual a gto_cs_texto().
export function textoLimpo(raw, max = 500) {
  if (vazio(raw)) return null;
  const s = String(raw).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim().slice(0, max);
  return s === "" ? null : s;
}

// Conteudo que uma planilha interpretaria como formula se reexportado (CSV injection).
export function pareceFormula(raw) {
  return typeof raw === "string" && /^[=+\-@\t\r]/.test(raw.trim()) && !/^[-+]?\d/.test(raw.trim());
}

// ---- numeros ------------------------------------------------------------------------------------
// Aceita number (celula numerica do Excel) ou texto em formato brasileiro ("1.234,56", "R$ 10,00",
// "12,5%") ou internacional ("1,234.56"). Devolve { valor, erro, percentual }.
export function parseNumero(raw) {
  if (vazio(raw)) return { valor: null, erro: null, percentual: false };
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { valor: raw, erro: null, percentual: false } : { valor: null, erro: "NUMERO_INVALIDO", percentual: false };
  }
  let s = String(raw).trim();
  const percentual = s.includes("%");
  s = s.replace(/R\$|%|\s| /gi, "");
  let negativo = false;
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { negativo = !negativo; s = s.slice(1); }
  if (s === "" || !/^[\d.,]+$/.test(s)) return { valor: null, erro: "NUMERO_INVALIDO", percentual };

  const temPonto = s.includes(".");
  const temVirgula = s.includes(",");
  let normal;
  if (temPonto && temVirgula) {
    // o ultimo separador e o decimal
    normal = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (temVirgula) {
    // "1,234,567" = milhar internacional; caso contrario virgula decimal (padrao BR)
    normal = /^\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
    if ((normal.match(/\./g) || []).length > 1) return { valor: null, erro: "NUMERO_INVALIDO", percentual };
  } else if (temPonto) {
    // "1.234" / "1.234.567" = milhar BR; "12.5" = decimal
    normal = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
    if ((normal.match(/\./g) || []).length > 1) return { valor: null, erro: "NUMERO_INVALIDO", percentual };
  } else {
    normal = s;
  }
  const valor = Number(normal) * (negativo ? -1 : 1);
  return Number.isFinite(valor) ? { valor, erro: null, percentual } : { valor: null, erro: "NUMERO_INVALIDO", percentual };
}

// Valor monetario/decimal como string com 2 casas para o servidor (evita erro de ponto flutuante).
export function decimalParaServidor(valor, casas = 2) {
  if (valor === null || valor === undefined) return null;
  return (Math.round(valor * 10 ** casas) / 10 ** casas).toFixed(casas);
}

// ---- datas --------------------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");

function dataValida(a, m, d) {
  if (a < 1900 || a > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Serial do Excel (1900, com o bug do 29/02/1900) -> componentes, sem passar pelo fuso local.
export function serialExcelParaData(serial) {
  if (typeof serial !== "number" || !Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return {
    data: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    hora: serial % 1 === 0 ? null : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  };
}

// Devolve { data: "YYYY-MM-DD"|null, hora: "HH:MM:SS"|null, erro, formato }.
export function parseData(raw) {
  if (vazio(raw)) return { data: null, hora: null, erro: null, formato: null };
  if (typeof raw === "number") {
    if (raw > 19000101 && raw < 21001231 && Number.isInteger(raw)) return parseData(String(raw));
    const r = serialExcelParaData(raw);
    return r && Number(r.data.slice(0, 4)) >= 1990 ? { ...r, erro: null, formato: "serial_excel" } : { data: null, hora: null, erro: "DATA_INVALIDA", formato: null };
  }
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return { data: null, hora: null, erro: "DATA_INVALIDA", formato: null };
    return { data: `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}`, hora: null, erro: null, formato: "date" };
  }
  const s = String(raw).trim();
  let m;
  let a, mes, d, h = null, mi = null, se = null, formato;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/))) {
    [, a, mes, d, h, mi, se] = m; formato = "iso";
  } else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/))) {
    [, d, mes, a, h, mi, se] = m; formato = "dd/mm/aaaa";
    if (a.length === 2) a = String(2000 + Number(a));
  } else if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    [, a, mes, d] = m; formato = "aaaammdd";
  } else {
    return { data: null, hora: null, erro: "DATA_INVALIDA", formato: null };
  }
  a = Number(a); mes = Number(mes); d = Number(d);
  if (!dataValida(a, mes, d)) return { data: null, hora: null, erro: "DATA_INVALIDA", formato };
  let hora = null;
  if (h !== null && h !== undefined) {
    const hh = Number(h), mm = Number(mi), ss = Number(se || 0);
    if (hh > 23 || mm > 59 || ss > 59) return { data: null, hora: null, erro: "DATA_INVALIDA", formato };
    hora = `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
    if (hora === "00:00:00") hora = null;
  }
  return { data: `${a}-${pad(mes)}-${pad(d)}`, hora, erro: null, formato };
}

const MESES_PT = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export function parseMes(raw) {
  if (vazio(raw)) return null;
  const n = parseNumero(raw).valor;
  if (n !== null && Number.isInteger(n) && n >= 1 && n <= 12) return n;
  const t = normalizarTexto(raw);
  if (!t) return null;
  const idx = MESES_PT.findIndex((nome) => nome === t || nome.slice(0, 3) === t.slice(0, 3));
  return idx >= 0 ? idx + 1 : null;
}

export function parseAno(raw) {
  const n = parseNumero(raw).valor;
  return n !== null && Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
}

export function parseFlag(raw) {
  if (vazio(raw)) return null;
  const t = normalizarTexto(raw);
  if (["1", "s", "sim", "true", "verdadeiro", "y", "yes", "x"].includes(t)) return 1;
  if (["0", "n", "nao", "false", "falso", "no"].includes(t)) return 0;
  return null;
}

export function parseBin(raw) {
  if (vazio(raw)) return null;
  const digitos = typeof raw === "number" ? String(Math.trunc(raw)) : String(raw).replace(/\D/g, "");
  return digitos.length >= 6 && digitos.length <= 8 ? digitos : (digitos === "" ? null : digitos);
}

// BIN de 6 digitos embutido num texto ("960358 TESOURA DE OURO") - so aceita se estiver cadastrado.
export function binEmbutido(texto, mapaBins) {
  if (vazio(texto)) return null;
  const achados = String(texto).match(/(?<!\d)\d{6}(?!\d)/g) || [];
  const conhecidos = [...new Set(achados.filter((b) => mapaBins[b]))];
  return conhecidos.length === 1 ? conhecidos[0] : null;
}

// ---- marcas -------------------------------------------------------------------------------------
// Reconhece a marca pelo nome da aba ou por um texto livre de coluna "marca". Devolve null se nao
// reconhecer ou se o texto bater com mais de uma marca (nao adivinha).
export function marcaPorTexto(raw) {
  const t = normalizarTexto(raw);
  if (!t) return null;
  const exata = MARCAS.find((m) => normalizarTexto(m) === t);
  if (exata) return exata;
  const candidatos = new Set();
  if (/tesoura|\bouro\b/.test(t)) candidatos.add("Tesoura de Ouro");
  if (/magazine|economia/.test(t)) candidatos.add("Magazine da Economia");
  if (/free ?center|calcados/.test(t)) candidatos.add("Free Center Calçados");
  return candidatos.size === 1 ? [...candidatos][0] : null;
}

// ---- canal / categoria (espelham gto_cs_canal / gto_cs_cluster no banco) -------------------------
export function canalNormalizado(raw) {
  const t = normalizarTexto(raw);
  if (!t) return null;
  const compacto = t.replace(/[-\s]/g, "");
  if (["email", "emkt", "emailmarketing"].includes(compacto)) return "E-mail";
  if (t.startsWith("whats") || ["wpp", "zap"].includes(t)) return "WhatsApp";
  if (t.startsWith("sms")) return "SMS";
  if (t.startsWith("push")) return "Push";
  if (t.startsWith("rcs")) return "RCS";
  if (["ura", "voz", "ligacao", "telefone", "call center", "callcenter"].includes(t)) return "Voz/URA";
  const s = String(raw).trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function categoriaNormalizada(raw) {
  const t = normalizarTexto(raw);
  if (!t) return null;
  if (t.includes("reativa")) return "Reativação";
  if (t.includes("ativa")) return "Ativação";
  if (t.includes("aniver")) return "Aniversário";
  if (/boas.*vindas|onboard/.test(t)) return "Boas-vindas";
  if (t.includes("recompra") || t.includes("recorr")) return "Recompra";
  if (t.includes("fatura") || t.includes("cobran")) return "Fatura/Cobrança";
  const s = String(raw).trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ---- hash ---------------------------------------------------------------------------------------
export async function sha256Hex(buffer) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// md5 nao existe em WebCrypto; para a chave natural de pre-visualizacao (deteccao de duplicidade
// DENTRO do arquivo) basta uma string canonica - o banco calcula o md5 oficial.
export function chaveNaturalCRM(r) {
  // Planilhas com identificador proprio por linha (id_registro) usam-no como chave: duas linhas com
  // mesma campanha/data/canal e metricas diferentes sao registros distintos, nao duplicidade.
  if (r.id_registro) return [r.marca, "id", r.id_registro].join("|");
  return [
    r.marca,
    r.dh_disparo || "",
    normalizarTexto(r.ds_campanha) || "",
    normalizarTexto(r.ds_canal) || "",
    normalizarTexto(r.ds_step) || "",
    normalizarTexto(r.ds_cluster_campanha) || "",
    normalizarTexto(r.fl_regua) || "",
    normalizarTexto(r.ds_titulo_push) || "",
    normalizarTexto(r.ds_frase) || ""
  ].join("|");
}
