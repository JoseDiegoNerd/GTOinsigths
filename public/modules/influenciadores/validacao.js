// Validacao e normalizacao dos formularios do modulo. Espelha as constraints da migration 039
// (o banco continua sendo a barreira real); aqui o objetivo e dar mensagem em portugues antes do
// round-trip. Funcoes puras.

export const REDES = ["Instagram", "TikTok", "YouTube"];
export const STATUS = ["Ativo", "Pausado", "Encerrado"];
export const FORMATOS = ["Reel", "Feed", "Story", "Video", "Short"];
export const MARCAS_VALIDAS = ["Tesoura de Ouro", "Magazine da Economia", "Free Center Calçados"];

const TIPOS_AVATAR = ["image/jpeg", "image/png", "image/webp"];
const LIMITE_AVATAR = 1048576;
const LIMITE_NUMERIC = 9999999999.99;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function dataValida(texto) {
  if (!ISO.test(String(texto ?? ""))) return false;
  const [a, m, d] = texto.split("-").map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  return data.getUTCFullYear() === a && data.getUTCMonth() === m - 1 && data.getUTCDate() === d;
}

// "10.000,50" -> 10000.5 | "10.000" -> 10000 (padrao de milhar) | "10000.5" -> 10000.5
export function parseNumeroBR(texto) {
  let t = String(texto ?? "").replace(/R\$/gi, "").replace(/\s/g, "");
  if (t === "") return NaN;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

// Inteiro nao negativo; vazio conta como 0 (metricas sao opcionais).
export function parseInteiro(texto) {
  const t = String(texto ?? "").replace(/\s/g, "").replace(/\./g, "");
  if (t === "") return 0;
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

export function detectarPlataforma(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const e = (dominio) => host === dominio || host.endsWith(`.${dominio}`);
  if (e("instagram.com")) return "Instagram";
  if (e("tiktok.com")) return "TikTok";
  if (e("youtube.com") || e("youtu.be")) return "YouTube";
  return null;
}

function resultado(erros, valor) {
  return { ok: Object.keys(erros).length === 0, erros, valor };
}

export function validarInfluenciador(dados, marcasValidas = MARCAS_VALIDAS) {
  const erros = {};
  const nome = String(dados.nome ?? "").trim();
  if (nome.length < 2 || nome.length > 120) erros.nome = "Informe o nome (2 a 120 caracteres).";

  let handle = String(dados.handle ?? "").trim();
  if (handle && !handle.startsWith("@")) handle = `@${handle}`;
  if (!/^@[A-Za-z0-9._]{2,50}$/.test(handle)) {
    erros.handle = "Use o @ do perfil com letras, números, ponto ou sublinhado (2 a 50 caracteres).";
  }

  if (!REDES.includes(dados.rede_social)) erros.rede_social = "Escolha a rede social.";
  if (!STATUS.includes(dados.status)) erros.status = "Escolha o status.";
  if (!marcasValidas.includes(dados.marca)) erros.marca = "Escolha a bandeira.";

  const nicho = String(dados.nicho ?? "").trim();
  if (nicho.length > 60) erros.nicho = "Máximo de 60 caracteres.";

  const cupom = String(dados.cupom_codigo ?? "").trim().toUpperCase();
  if (cupom && !/^[A-Z0-9_-]{2,30}$/.test(cupom)) {
    erros.cupom_codigo = "Use 2 a 30 letras, números, hífen ou sublinhado.";
  }
  const exclusivo = Boolean(dados.cupom_exclusivo);
  if (exclusivo && !cupom) erros.cupom_codigo = "Informe o código do cupom exclusivo.";

  return resultado(erros, {
    marca: dados.marca,
    nome,
    handle,
    rede_social: dados.rede_social,
    verificado: Boolean(dados.verificado),
    nicho: nicho || null,
    cupom_codigo: cupom || null,
    cupom_exclusivo: exclusivo,
    status: dados.status
  });
}

function valorMonetario(texto, erros, campo) {
  if (String(texto ?? "").trim() === "") return 0;
  const n = parseNumeroBR(texto);
  if (!Number.isFinite(n) || n < 0 || n > LIMITE_NUMERIC) {
    erros[campo] = "Informe um valor em reais maior ou igual a zero.";
    return 0;
  }
  return Math.round(n * 100) / 100;
}

export function validarCampanha(dados) {
  const erros = {};
  const nome = String(dados.nome ?? "").trim();
  if (nome.length < 1 || nome.length > 120) erros.nome = "Informe o nome da campanha (até 120 caracteres).";

  const inicio = String(dados.data_inicio ?? "").trim();
  if (!dataValida(inicio)) erros.data_inicio = "Informe uma data de início válida.";

  const fim = String(dados.data_fim ?? "").trim();
  if (fim && !dataValida(fim)) erros.data_fim = "Informe uma data de fim válida.";
  else if (fim && !erros.data_inicio && fim < inicio) erros.data_fim = "A data de fim não pode ser anterior ao início.";

  const cache_valor = valorMonetario(dados.cache_valor, erros, "cache_valor");
  const voucher_valor = valorMonetario(dados.voucher_valor, erros, "voucher_valor");

  return resultado(erros, { nome, data_inicio: inicio, data_fim: fim || null, cache_valor, voucher_valor });
}

const CAMPOS_METRICA = ["views", "alcance", "curtidas", "comentarios", "salvos", "compartilhamentos"];

export function validarMidia(dados) {
  const erros = {};
  const titulo = String(dados.titulo ?? "").trim();
  if (titulo.length < 1 || titulo.length > 160) erros.titulo = "Informe o título (até 160 caracteres).";

  const url = String(dados.url ?? "").trim();
  let urlOk = false;
  try {
    const u = new URL(url);
    urlOk = u.protocol === "https:" && url.length <= 500 && !/\s/.test(url);
  } catch {
    urlOk = false;
  }
  if (!urlOk) erros.url = "Informe uma URL https:// válida (até 500 caracteres).";

  let plataforma = String(dados.plataforma ?? "").trim();
  if (!plataforma && urlOk) plataforma = detectarPlataforma(url) ?? "";
  if (!REDES.includes(plataforma)) erros.plataforma = "Não reconheci a rede pela URL. Escolha a plataforma.";

  const formato = String(dados.formato ?? "").trim();
  if (!FORMATOS.includes(formato)) erros.formato = "Escolha o formato.";

  const publicada_em = String(dados.publicada_em ?? "").trim();
  if (!dataValida(publicada_em)) erros.publicada_em = "Informe a data de publicação.";

  const valor = { titulo, url, plataforma, formato, publicada_em, campanha_id: String(dados.campanha_id ?? "").trim() || null };
  for (const campo of CAMPOS_METRICA) {
    const n = parseInteiro(dados[campo]);
    if (!Number.isSafeInteger(n)) {
      erros[campo] = "Use apenas números inteiros.";
      valor[campo] = 0;
    } else {
      valor[campo] = n;
    }
  }
  return resultado(erros, valor);
}

export function validarSeguidores({ data, seguidores }, hoje) {
  const erros = {};
  const dia = String(data ?? "").trim();
  if (!dataValida(dia)) erros.data = "Informe uma data válida.";
  else if (dia > hoje) erros.data = "A data não pode ser futura.";

  const texto = String(seguidores ?? "").trim();
  const n = texto === "" ? NaN : parseInteiro(texto);
  if (!Number.isSafeInteger(n)) erros.seguidores = "Informe o total de seguidores (número inteiro).";

  return resultado(erros, { data: dia, seguidores: Number.isSafeInteger(n) ? n : 0 });
}

export function validarAvatar(arquivo) {
  if (!arquivo || !TIPOS_AVATAR.includes(arquivo.type)) {
    return { ok: false, erro: "Envie uma imagem JPG, PNG ou WebP." };
  }
  if (arquivo.size > LIMITE_AVATAR) {
    return { ok: false, erro: "A imagem deve ter no máximo 1 MB." };
  }
  return { ok: true, erro: "" };
}
