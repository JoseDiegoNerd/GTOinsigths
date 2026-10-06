// Classificacao de comentarios com Google Gemini (sentimento, reclamacao de preco e categoria).
// Envia para a IA APENAS o texto do comentario: nome do autor e identificadores nunca saem do banco.
import { getAdminClient, getRequiredEnv } from "./google.ts";

export const SENTIMENTOS = ["positivo", "neutro", "negativo"] as const;
export const CATEGORIAS = ["preco", "atendimento", "qualidade_produto", "trocas", "outro"] as const;

export type Classificacao = {
  sentiment: (typeof SENTIMENTOS)[number];
  is_price_complaint: boolean;
  category_tag: (typeof CATEGORIAS)[number];
};

const MAX_TENTATIVAS = 4;
const ATRASO_BASE_MS = 2000;

const INSTRUCAO = `Você classifica comentários de clientes de lojas de varejo no Brasil.
Responda somente com o JSON do esquema, seguindo estas regras:
- sentiment: "positivo", "neutro" ou "negativo" (o tom geral do cliente).
- is_price_complaint: true somente quando o cliente reclama de preço, valor cobrado, custo alto ou falta de promoção. Reclamação de outra coisa é false.
- category_tag: "preco" (preço/valor), "atendimento" (funcionário, loja, espera), "qualidade_produto" (defeito, material, acabamento), "trocas" (troca, devolução, reembolso) ou "outro".
Não invente informações que não estejam no texto.`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sha256Hex(texto: string) {
  const bytes = new TextEncoder().encode(texto);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function validarClassificacao(payload: unknown): Classificacao {
  const obj = payload as Record<string, unknown>;
  if (!SENTIMENTOS.includes(obj?.sentiment as never)) throw new Error("Sentimento invalido na resposta da IA.");
  if (typeof obj.is_price_complaint !== "boolean") throw new Error("is_price_complaint invalido na resposta da IA.");
  if (!CATEGORIAS.includes(obj.category_tag as never)) throw new Error("Categoria invalida na resposta da IA.");
  return {
    sentiment: obj.sentiment as Classificacao["sentiment"],
    is_price_complaint: obj.is_price_complaint,
    category_tag: obj.category_tag as Classificacao["category_tag"],
  };
}

// Chama o Gemini com saida em JSON estruturado. A chave vai no header (nao na URL) para nao
// aparecer em logs de acesso.
export async function classificarTexto(texto: string): Promise<{ classificacao: Classificacao; modelo: string }> {
  const modelo = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;

  const corpo = {
    systemInstruction: { parts: [{ text: INSTRUCAO }] },
    contents: [{ role: "user", parts: [{ text: `Comentário:\n"""${texto}"""` }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          sentiment: { type: "STRING", enum: [...SENTIMENTOS] },
          is_price_complaint: { type: "BOOLEAN" },
          category_tag: { type: "STRING", enum: [...CATEGORIAS] },
        },
        required: ["sentiment", "is_price_complaint", "category_tag"],
      },
    },
  };

  for (let tentativa = 1; ; tentativa++) {
    const resposta = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": getRequiredEnv("GEMINI_API_KEY"),
      },
      body: JSON.stringify(corpo),
    });

    if (resposta.ok) {
      const dados = await resposta.json();
      const textoJson = dados?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textoJson) throw new Error("Resposta vazia da IA.");
      return { classificacao: validarClassificacao(JSON.parse(textoJson)), modelo };
    }

    const reenviavel = resposta.status === 429 || resposta.status >= 500;
    if (!reenviavel || tentativa >= MAX_TENTATIVAS) {
      throw new Error(`Falha na IA (HTTP ${resposta.status}).`);
    }
    await sleep(ATRASO_BASE_MS * 2 ** (tentativa - 1) + Math.random() * 500);
  }
}

// Classifica os comentarios pendentes das marcas informadas. Textos repetidos reaproveitam a
// classificacao ja feita (pelo hash), para nao pagar duas vezes pelo mesmo comentario.
export async function classificarPendentes(marcas: string[], limite = 40) {
  const supabase = getAdminClient();
  const marcasUnicas = [...new Set(marcas)].filter(Boolean);
  if (!marcasUnicas.length) return { classificados: 0, reaproveitados: 0, erros: 0 };

  const { data: pendentes, error } = await supabase
    .from("comments_reputation")
    .select("id,content")
    .in("marca", marcasUnicas)
    .is("classified_at", null)
    .not("content", "is", null)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) throw error;

  let classificados = 0;
  let reaproveitados = 0;
  let erros = 0;

  for (const linha of pendentes || []) {
    const texto = String(linha.content || "").trim();
    if (!texto) continue;

    const hash = await sha256Hex(texto);
    const { data: existente } = await supabase
      .from("comments_reputation")
      .select("sentiment,is_price_complaint,category_tag,ai_model")
      .eq("content_hash", hash)
      .not("classified_at", "is", null)
      .limit(1)
      .maybeSingle();

    try {
      let classificacao: Classificacao;
      let modelo: string | null;

      if (existente?.sentiment) {
        classificacao = {
          sentiment: existente.sentiment,
          is_price_complaint: existente.is_price_complaint,
          category_tag: existente.category_tag,
        };
        modelo = existente.ai_model;
        reaproveitados += 1;
      } else {
        const resultado = await classificarTexto(texto);
        classificacao = resultado.classificacao;
        modelo = resultado.modelo;
      }

      const { error: updateError } = await supabase
        .from("comments_reputation")
        .update({
          ...classificacao,
          content_hash: hash,
          ai_model: modelo,
          classified_at: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
        })
        .eq("id", linha.id);
      if (updateError) throw updateError;
      classificados += 1;
    } catch (classificacaoError) {
      erros += 1;
      console.error("Falha ao classificar comentario", linha.id, classificacaoError);
    }
  }

  return { classificados, reaproveitados, erros };
}
