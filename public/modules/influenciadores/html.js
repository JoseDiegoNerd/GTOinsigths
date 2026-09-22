// Copia do escapeHtml de public/index.html (mesmo comportamento) para manter os componentes do
// modulo puros e testaveis sem injecao de dependencia.
export function escapeHtml(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
