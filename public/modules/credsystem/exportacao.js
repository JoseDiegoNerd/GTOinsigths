// Exportacao de tabelas (CSV / Excel) com protecao contra CSV/formula injection: qualquer texto
// que comece com = + - @ TAB ou CR recebe um apostrofo na frente, para o Excel tratar como texto.

export function neutralizarCelula(valor) {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : "";
  const s = String(valor);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function gerarCsv(colunas, linhas, separador = ";") {
  const esc = (v) => {
    const s = String(neutralizarCelula(v));
    return /["\n\r;,]/.test(s) || s.includes(separador) ? `"${s.replace(/"/g, "\"\"")}"` : s;
  };
  const cab = colunas.map((c) => esc(c.rotulo)).join(separador);
  const corpo = linhas.map((l) => colunas.map((c) => {
    const v = typeof c.valor === "function" ? c.valor(l) : l[c.campo];
    // numero com virgula decimal (Excel pt-BR)
    return typeof v === "number" ? String(v).replace(".", ",") : esc(v);
  }).join(separador));
  return "﻿" + [cab, ...corpo].join("\r\n");
}

export function gerarMatriz(colunas, linhas) {
  return [
    colunas.map((c) => c.rotulo),
    ...linhas.map((l) => colunas.map((c) => neutralizarCelula(typeof c.valor === "function" ? c.valor(l) : l[c.campo])))
  ];
}

export function baixarArquivo(nome, conteudo, tipo) {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportarExcel(nome, colunas, linhas, carregarXLSX) {
  const XLSX = await carregarXLSX();
  const ws = XLSX.utils.aoa_to_sheet(gerarMatriz(colunas, linhas));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Dados");
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  baixarArquivo(nome, new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}
