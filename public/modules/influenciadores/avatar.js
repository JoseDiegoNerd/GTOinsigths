import { escapeHtml } from "./html.js";
import { iniciais } from "./calculos.js";

// [fundo, texto] - familias de cor suaves para o circulo de iniciais.
const PALETA = [
  ["#dbeafe", "#1d4ed8"], ["#fce7f3", "#be185d"], ["#dcfce7", "#15803d"],
  ["#fef3c7", "#b45309"], ["#ede9fe", "#6d28d9"], ["#e0f2fe", "#0369a1"]
];

export function corAvatar(nome) {
  let hash = 0;
  for (const caractere of String(nome ?? "")) hash = (hash * 31 + caractere.codePointAt(0)) >>> 0;
  return PALETA[hash % PALETA.length];
}

// url vem de URL assinada do Supabase Storage. So aceita https:// (a CSP ja bloqueia o resto).
export function avatarHtml({ nome, url, tamanho = "md", destaque = false }) {
  const classes = `inf-avatar inf-avatar-${tamanho}${destaque ? " destaque" : ""}`;
  if (typeof url === "string" && url.startsWith("https://")) {
    return `<img class="${classes}" src="${escapeHtml(url)}" alt="${escapeHtml(nome)}" />`;
  }
  const [fundo, texto] = corAvatar(nome);
  return `<span class="${classes}" style="background:${fundo};color:${texto}" aria-label="${escapeHtml(nome)}">${escapeHtml(iniciais(nome))}</span>`;
}
