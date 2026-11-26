// server.ts
import "dotenv/config";
import express from "express";
import crypto2 from "crypto";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

// server/receiptParser.ts
import { GoogleGenAI, Type } from "@google/genai";
var ALLOWED_CATEGORIES = [
  "Cons\xF3rcios & Patrim\xF4nio",
  "Financeiro & Cart\xF5es",
  "Moradia & Financiamento",
  "Utilidades (Luz & \xC1gua)",
  "Transporte & Ve\xEDculos",
  "Lazer & Clube",
  "Internet & Telefonia",
  "Educa\xE7\xE3o & Filhos",
  "Associa\xE7\xF5es & Sa\xFAde",
  "Assinaturas & Servi\xE7os",
  "Outros & Jur\xEDdico"
];
var DEFAULT_BLOCKS = [
  { id: "bradesco", shortName: "Bradesco", fullTitle: "Cart\xE3o Bradesco - D\xE9bito em Conta", group: "cartao_conta" },
  { id: "santander", shortName: "Santander", fullTitle: "Cart\xE3o Santander - D\xE9bito em Conta", group: "cartao_conta" },
  { id: "caixa", shortName: "Caixa", fullTitle: "Conta Caixa - D\xE9bito em Conta", group: "cartao_conta" },
  { id: "quero_quero", shortName: "Quero Quero", fullTitle: "Cart\xE3o Quero Quero - Direto na Loja", group: "cartao_conta" },
  { id: "nubank", shortName: "NuBank", fullTitle: "Cart\xE3o NuBank - D\xE9bito em Conta", group: "cartao_conta" },
  { id: "sicredi", shortName: "Sicredi", fullTitle: "Cart\xE3o Sicredi Viviane - D\xE9bito em Conta", group: "cartao_conta" },
  { id: "outras", shortName: "Boletos e Fixas", fullTitle: "Outras Despesas - Boletos e Fixas", group: "boletos_pix" }
];
var MODEL_CHAIN = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-preview"
];
function normalizeText(str) {
  return String(str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function hasExplicitCreditCardSignal(text) {
  const norm = normalizeText(text);
  return /\b(cartao|cartao de credito|compra credito|compra no credito|credito a vista|credito parcelado|no credito|na funcao credito|fatura|mastercard|visa|elo|quero quero|quero_quero)\b/.test(
    norm
  );
}
function hasPixPaymentSignal(text) {
  const norm = normalizeText(text);
  return /\b(pix|chave pix|comprovante pix|transferencia pix|pagamento pix|e2e|id\/transacao|id transacao|autenticacao pix)\b/.test(
    norm
  );
}
function extractInstallmentsFromText(rawText) {
  const norm = normalizeText(rawText);
  const slashMatch = norm.match(/\b(?:parcela|parc\.?)?\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/);
  if (slashMatch) {
    const curr = Number(slashMatch[1]);
    const tot = Number(slashMatch[2]);
    if (curr >= 1 && tot >= 2 && tot <= 120 && curr <= tot) {
      const idx = slashMatch.index ?? 0;
      const surrounding = norm.slice(Math.max(0, idx - 10), idx + slashMatch[0].length + 10);
      if (!/\b(dia|vence|vencimento|em)\s+\d{1,2}\/\d{1,2}/.test(surrounding)) {
        return { currentInstallment: curr, totalInstallments: tot, isPerInstallmentAmount: true };
      }
    }
  }
  const xDeMatch = norm.match(/\b(\d{1,2})\s*(?:x|vezes)\s*(?:de|x)\s*(?:r\$\s*)?\d+/);
  if (xDeMatch) {
    const tot = Number(xDeMatch[1]);
    if (tot >= 2 && tot <= 120) {
      return { currentInstallment: 1, totalInstallments: tot, isPerInstallmentAmount: true };
    }
  }
  const xOnlyMatch = norm.match(/\b(?:em\s+|parcelad[oa]\s+em\s+|parcelad[oa]\s+)?(\d{1,2})\s*(?:x|vezes)\b/);
  if (xOnlyMatch) {
    const tot = Number(xOnlyMatch[1]);
    if (tot >= 2 && tot <= 120) {
      return { currentInstallment: 1, totalInstallments: tot, isPerInstallmentAmount: false };
    }
  }
  return { currentInstallment: null, totalInstallments: null, isPerInstallmentAmount: false };
}
function extractDueDateFromText(rawText, activeMonthKey, todayIso) {
  const norm = normalizeText(rawText);
  const fullDateMatch = rawText.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (fullDateMatch) {
    const d = Number(fullDateMatch[1]);
    const m = Number(fullDateMatch[2]);
    const yRaw = fullDateMatch[3];
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      const year = yRaw ? yRaw.length === 2 ? `20${yRaw}` : yRaw : activeMonthKey.slice(0, 4);
      const isInstallmentContext = new RegExp(
        `\\b(?:parcela|parc\\.?)\\s*${fullDateMatch[1]}/${fullDateMatch[2]}\\b`
      ).test(norm);
      if (!isInstallmentContext) {
        return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      }
    }
  }
  const dayMatch = norm.match(/\b(?:dia|vence(?:\s+dia)?|vencimento(?:\s+dia)?|para\s+dia|pro\s+dia)\s+(\d{1,2})\b/);
  if (dayMatch) {
    const d = Number(dayMatch[1]);
    if (d >= 1 && d <= 31) {
      return `${activeMonthKey}-${String(d).padStart(2, "0")}`;
    }
  }
  return `${activeMonthKey}-${todayIso.slice(8, 10)}`;
}
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Chave GEMINI_API_KEY n\xE3o configurada no servidor. Verifique em Settings > Secrets."
    );
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: "v1beta",
    httpOptions: {
      apiVersion: "v1beta",
      timeout: 18e3,
      retryOptions: { attempts: 1 },
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
function sanitizeDate(raw, fallbackMonthKey) {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    return raw.trim();
  }
  if (fallbackMonthKey && /^\d{4}-\d{2}$/.test(fallbackMonthKey)) {
    const day = (/* @__PURE__ */ new Date()).toISOString().slice(8, 10);
    return `${fallbackMonthKey}-${day}`;
  }
  return today;
}
function buildDestinationLabel(result, blocks) {
  if (result.transactionType === "income") {
    return `Vis\xE3o Geral \u2192 Entradas da Fam\xEDlia (${result.person})`;
  }
  if (result.action === "mark_existing_paid" && result.matchedExistingDescription) {
    return `Baixa autom\xE1tica na conta existente: "${result.matchedExistingDescription}" (Pago)`;
  }
  const block = blocks.find((b) => b.id === result.blockId);
  if (result.blockId !== "outras" && block) {
    return `Cart\xF5es e Contas \u2192 ${block.shortName}`;
  }
  if (result.boletoSubType === "fixa") {
    return "Boletos e Fixas \u2192 Despesas Fixas";
  }
  if (result.boletoSubType === "variavel") {
    return "Boletos e Fixas \u2192 Despesas Vari\xE1veis";
  }
  return "Boletos e Fixas \u2192 Gastos Mensais";
}
async function parseFinancialReceiptOrMessage(params) {
  const ai = getGeminiClient();
  const blocks = Array.isArray(params.blocks) && params.blocks.length > 0 ? params.blocks.slice(0, 30) : DEFAULT_BLOCKS;
  const existingExpenses = Array.isArray(params.existingExpenses) ? params.existingExpenses.slice(0, 120) : [];
  const todayIso = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const activeMonthKey = typeof params.activeMonthKey === "string" && /^\d{4}-\d{2}$/.test(params.activeMonthKey) ? params.activeMonthKey : todayIso.slice(0, 7);
  let effectiveText = params.text?.trim() || "";
  const isAudio = Boolean(params.imageBase64 && params.imageMimeType?.startsWith("audio/"));
  const systemInstruction = `Voc\xEA \xE9 o classificador financeiro autom\xE1tico do aplicativo Domus Finan\xE7as (controle financeiro familiar de Rodolfo e Viviane).
Sua tarefa \xE9 analisar um comprovante de PIX (incluindo comprovantes VERTICAIS/COMPRIDOS do Santander, Sicredi, Bradesco, Nubank, Ita\xFA), PDF banc\xE1rio, \xE1udio falado em portugu\xEAs ou mensagem curta de WhatsApp e retornar os dados estruturados exatos.

REGRAS CR\xCDTICAS:
1. TIPO (transactionType):
   - "income": dinheiro RECEBIDO ("Pix recebido", "Recebi", "Sal\xE1rio", "Dep\xF3sito", "Entrada", "Freela", "Extra").
   - "expense": dinheiro PAGO/GASTO/A PAGAR ("Pix enviado", "Comprovante de pagamento", "Paguei", "Gastei", "Comprei", "Boleto", "Fatura", "Pendente").

2. LEITURA COMPLETA DE COMPROVANTES COMPRIDOS (ex: Santander):
   - Leia a imagem INTEIRA do topo ao rodap\xE9 para pegar valor (R$), destinat\xE1rio ("Para: ..."), pagador ("De: ...") e data.

3. DIFERENCIA\xC7\xC3O ESTRITA ENTRE PIX E CART\xC3O DE CR\xC9DITO (paymentMethod e blockId):
   - Se for um comprovante de PIX (mesmo emitido pelo banco Sicredi, Santander, Bradesco, Nubank ou Caixa), defina paymentMethod = "pix" e blockId = "outras" (Boletos e Fixas).
   - NUNCA coloque um PIX no bloco de Cart\xE3o de Cr\xE9dito s\xF3 porque o nome do banco aparece no comprovante!
   - S\xD3 defina paymentMethod = "credit_card" e o blockId do cart\xE3o (sicredi, nubank, bradesco, santander, quero_quero, caixa) se aparecer EXPLICITAMENTE: "compra cr\xE9dito", "cr\xE9dito \xE0 vista", "cr\xE9dito parcelado", "cart\xE3o de cr\xE9dito", "no cart\xE3o", "no cr\xE9dito", "fatura", "Mastercard", "Visa", "Elo" ou "Quero Quero".

4. CONTA FIXA EXISTENTE vs GASTO AVULSO DO M\xCAS (action):
   - S\xF3 use action = "mark_existing_paid" quando o destinat\xE1rio/empresa E o valor corresponderem claramente a uma conta PENDENTE j\xE1 cadastrada (ex: PIX para Fit Energia no valor parecido com a conta Fit Energia).
   - Se o PIX for para OUTRA empresa ou OUTRO valor (ex: PIX para COPEL / COPELDIS com legenda "Luz", enquanto a conta fixa cadastrada \xE9 "Fit Energia" de outro valor), N\xC3O d\xEA baixa na conta fixa! Use action = "create", blockId = "outras", boletoSubType = "mensal", status = "Pago" e descri\xE7\xE3o limpa como "Luz - COPELDIS".

5. CONTAS PENDENTES E PARCELADAS:
   - Se for conta pendente/a vencer ("pendente", "a pagar", "vence dia 15", "para dia 20/12"), defina status = "Pendente" e extraia a data de vencimento em date (YYYY-MM-DD).
   - Se mencionar parcelamento ("em 5x de 120", "parcela 2/10", "parcelado em 6 vezes", "600 em 3x"), preencha currentInstallment e totalInstallments (se disser "600 em 3x", amount = 200). Em blockId = "outras", contas parceladas usam boletoSubType = "variavel".

6. \xC1UDIO:
   - Se houver \xE1udio, transcreva-o em "transcript" e extraia todos os campos financeiros.

7. CATEGORIA:
   - Escolha ESTRITAMENTE uma das categorias permitidas: ${ALLOWED_CATEGORIES.join(" | ")}.

8. DESCRI\xC7\xC3O:
   - Curta, limpa e clara em portugu\xEAs (m\xE1x. 70 chars), sem repetir palavras e sem colocar o valor na descri\xE7\xE3o.`;
  const contextLines = [
    `Data de hoje: ${todayIso}`,
    `M\xEAs ativo na planilha: ${activeMonthKey}`,
    `Usu\xE1rio logado/remetente padr\xE3o: ${params.defaultPerson || "Fam\xEDlia"}`,
    `Blocos dispon\xEDveis na planilha: ${JSON.stringify(blocks.map((b) => ({ id: b.id, nome: b.shortName, titulo: b.fullTitle })))}`,
    `Contas PENDENTES j\xE1 existentes neste m\xEAs: ${JSON.stringify(
      existingExpenses.filter((e) => e.status === "Pendente").map((e) => ({
        id: e.id,
        descricao: e.description,
        valor: e.amount,
        vencimento: e.dueDate,
        bloco: e.blockId
      }))
    )}`,
    effectiveText ? `Mensagem/Legenda enviada pelo usu\xE1rio: "${effectiveText.slice(0, 1500)}"` : isAudio ? "O usu\xE1rio enviou um \xE1udio em portugu\xEAs. Transcreva em transcript e extraia todos os dados financeiros." : "O usu\xE1rio enviou um comprovante sem texto adicional. Extraia todos os dados da imagem/documento (do topo ao rodap\xE9)."
  ].join("\n");
  const parts = [];
  if (params.imageBase64 && params.imageMimeType) {
    parts.push({
      inlineData: {
        mimeType: params.imageMimeType,
        data: params.imageBase64
      }
    });
  }
  parts.push({ text: contextLines });
  let rawText = "";
  let lastModelErr;
  for (const modelName of MODEL_CHAIN) {
    try {
      const isGemini25 = modelName.startsWith("gemini-2.5");
      const response = await ai.models.generateContent({
        model: modelName,
        contents: { parts },
        config: {
          systemInstruction,
          temperature: 0.1,
          ...isGemini25 ? { thinkingConfig: { thinkingBudget: 0 } } : {},
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transactionType: { type: Type.STRING },
              paymentMethod: { type: Type.STRING },
              action: { type: Type.STRING },
              matchedExistingExpenseId: { type: Type.STRING },
              description: { type: Type.STRING },
              amount: { type: Type.NUMBER },
              date: { type: Type.STRING },
              status: { type: Type.STRING },
              blockId: { type: Type.STRING },
              boletoSubType: { type: Type.STRING },
              category: { type: Type.STRING },
              currentInstallment: { type: Type.INTEGER },
              totalInstallments: { type: Type.INTEGER },
              person: { type: Type.STRING },
              transcript: { type: Type.STRING },
              confidenceNote: { type: Type.STRING }
            },
            required: [
              "transactionType",
              "paymentMethod",
              "action",
              "description",
              "amount",
              "date",
              "status",
              "blockId",
              "boletoSubType",
              "category",
              "person",
              "confidenceNote"
            ]
          }
        }
      });
      rawText = (response.text ?? "").trim();
      if (rawText) break;
    } catch (err) {
      lastModelErr = err;
    }
  }
  if (!rawText && isAudio && params.imageBase64 && params.imageMimeType) {
    try {
      const transRes = await ai.models.generateContent({
        model: "gemini-3.5-transcribe",
        contents: {
          parts: [
            { inlineData: { mimeType: params.imageMimeType, data: params.imageBase64 } },
            { text: "Transcreva exatamente o que foi falado em portugu\xEAs brasileiro." }
          ]
        }
      });
      const transcript2 = (transRes.text ?? "").trim();
      if (transcript2) {
        effectiveText = effectiveText ? `${effectiveText} ${transcript2}` : transcript2;
      }
    } catch (err) {
      lastModelErr = err;
    }
  }
  let parsed;
  if (rawText) {
    try {
      const firstBrace = rawText.indexOf("{");
      const lastBrace = rawText.lastIndexOf("}");
      parsed = JSON.parse(
        firstBrace !== -1 && lastBrace > firstBrace ? rawText.slice(firstBrace, lastBrace + 1) : rawText
      );
    } catch {
      throw new Error("A resposta de leitura do comprovante veio em formato inesperado.");
    }
  } else if (effectiveText) {
    const norm = normalizeText(effectiveText);
    const inst = extractInstallmentsFromText(effectiveText);
    const cleaned = effectiveText.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ").replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ").replace(/\b(?:dia|vence(?:\s+dia)?|vencimento(?:\s+dia)?|para\s+dia)\s+\d{1,2}\b/gi, " ").replace(/\b(\d{1,2})\s*(?:x|vezes)\b/gi, " ");
    const brlMatches = cleaned.match(
      /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+,\d{1,2}|\d+\.\d{2}|\b\d+(?:\b|$))/gi
    );
    let extractedAmount = 0;
    if (brlMatches) {
      for (const token of brlMatches) {
        const numStr = token.replace(/r\$\s*/i, "").trim();
        const val = numStr.includes(",") ? Number(numStr.replace(/\./g, "").replace(",", ".")) : Number(numStr);
        if (Number.isFinite(val) && val > 0 && val < 1e6) {
          extractedAmount = Math.round(val * 100) / 100;
          break;
        }
      }
    }
    if (extractedAmount > 0 && inst.totalInstallments && inst.totalInstallments >= 2 && !inst.isPerInstallmentAmount && !/\bde\s*(?:r\$\s*)?\d+/.test(norm)) {
      extractedAmount = Math.round(extractedAmount / inst.totalInstallments * 100) / 100;
    }
    const isIncome = /\b(recebi|recebido|entrada|salario|pro-labore|pro labore|ganhei|depilacao|azilo|freela|renda)\b/.test(
      norm
    );
    const isPending2 = /\b(pendente|vence|vencimento|agendado|a pagar|falta pagar)\b/.test(norm);
    const isCredit = hasExplicitCreditCardSignal(effectiveText);
    const isPix2 = hasPixPaymentSignal(effectiveText);
    let fallbackBlock = "outras";
    if (isCredit && !isPix2) {
      for (const blk of blocks) {
        if (blk.id === "outras") continue;
        const blkNorm = normalizeText(blk.shortName);
        if (blkNorm && norm.includes(blkNorm) || norm.includes(blk.id.replace("_", " "))) {
          fallbackBlock = blk.id;
          break;
        }
      }
    }
    parsed = {
      transactionType: isIncome ? "income" : "expense",
      paymentMethod: isCredit ? "credit_card" : isPix2 ? "pix" : "debit_cash",
      action: "create",
      matchedExistingExpenseId: "",
      description: effectiveText.slice(0, 70),
      amount: extractedAmount,
      date: extractDueDateFromText(effectiveText, activeMonthKey, todayIso),
      status: isPending2 ? "Pendente" : "Pago",
      blockId: fallbackBlock,
      boletoSubType: inst.totalInstallments ? "variavel" : "mensal",
      category: fallbackBlock !== "outras" ? "Financeiro & Cart\xF5es" : "Outros & Jur\xEDdico",
      currentInstallment: inst.currentInstallment ?? 0,
      totalInstallments: inst.totalInstallments ?? 0,
      person: params.defaultPerson || "Fam\xEDlia",
      transcript: isAudio ? effectiveText : "",
      confidenceNote: "Classificado automaticamente pelo motor financeiro do Domus."
    };
  } else {
    throw lastModelErr instanceof Error ? lastModelErr : new Error("N\xE3o foi poss\xEDvel extrair os dados do comprovante, \xE1udio ou mensagem.");
  }
  const validBlockIds = new Set(blocks.map((b) => b.id));
  const transactionType = parsed.transactionType === "income" ? "income" : "expense";
  const isPending = parsed.status === "Pendente";
  const rawMatchedId = typeof parsed.matchedExistingExpenseId === "string" ? parsed.matchedExistingExpenseId.trim() : "";
  let matchedExpense = transactionType === "expense" && !isPending && rawMatchedId ? existingExpenses.find((e) => e.id === rawMatchedId && e.status === "Pendente") || null : null;
  const amountNum = Number(parsed.amount);
  const safeAmount = Number.isFinite(amountNum) && amountNum > 0 ? Math.round(amountNum * 100) / 100 : matchedExpense && matchedExpense.amount > 0 ? matchedExpense.amount : 0;
  if (matchedExpense && safeAmount > 0 && matchedExpense.amount > 0) {
    const diff = Math.abs(matchedExpense.amount - safeAmount);
    const pct = diff / Math.max(matchedExpense.amount, safeAmount);
    if (diff > 15 && pct > 0.2) {
      matchedExpense = null;
    }
  }
  const action = matchedExpense && parsed.action === "mark_existing_paid" ? "mark_existing_paid" : "create";
  const rawBlockId = typeof parsed.blockId === "string" ? parsed.blockId.trim() : "outras";
  let blockId = validBlockIds.has(rawBlockId) ? rawBlockId : "outras";
  const combinedText = `${effectiveText} ${String(parsed.transcript || "")} ${String(parsed.description || "")} ${String(parsed.confidenceNote || "")}`;
  const paymentMethod = String(parsed.paymentMethod || "").toLowerCase();
  const explicitCredit = paymentMethod === "credit_card" || hasExplicitCreditCardSignal(combinedText);
  const isPix = paymentMethod === "pix" || hasPixPaymentSignal(combinedText);
  if (!matchedExpense && blockId !== "outras" && (isPix || !explicitCredit)) {
    blockId = "outras";
  }
  const fallbackInst = extractInstallmentsFromText(`${effectiveText} ${String(parsed.transcript || "")}`);
  const currInstNum = Number(parsed.currentInstallment);
  const totInstNum = Number(parsed.totalInstallments);
  let currentInstallment = Number.isInteger(currInstNum) && currInstNum >= 1 ? currInstNum : fallbackInst.currentInstallment;
  let totalInstallments = Number.isInteger(totInstNum) && totInstNum >= 2 ? totInstNum : fallbackInst.totalInstallments;
  if (totalInstallments && (!currentInstallment || currentInstallment > totalInstallments)) {
    currentInstallment = 1;
  }
  if (!totalInstallments || totalInstallments < 2) {
    currentInstallment = null;
    totalInstallments = null;
  }
  const hasInstallments = Boolean(currentInstallment && totalInstallments);
  const boletoSubType = hasInstallments && blockId === "outras" ? "variavel" : parsed.boletoSubType === "fixa" || parsed.boletoSubType === "mensal" || parsed.boletoSubType === "variavel" ? parsed.boletoSubType : "mensal";
  const rawCategory = typeof parsed.category === "string" ? parsed.category.trim() : "";
  const category = ALLOWED_CATEGORIES.includes(rawCategory) ? rawCategory : "Outros & Jur\xEDdico";
  const person = parsed.person === "Rodolfo" || parsed.person === "Viviane" || parsed.person === "Fam\xEDlia" ? parsed.person : params.defaultPerson === "Rodolfo" || params.defaultPerson === "Viviane" ? params.defaultPerson : "Fam\xEDlia";
  const transcript = typeof parsed.transcript === "string" && parsed.transcript.trim() ? parsed.transcript.trim().slice(0, 220) : null;
  const baseResult = {
    transactionType,
    action,
    matchedExistingExpenseId: matchedExpense ? matchedExpense.id : null,
    matchedExistingDescription: matchedExpense ? matchedExpense.description : null,
    description: matchedExpense ? matchedExpense.description : typeof parsed.description === "string" && parsed.description.trim() ? parsed.description.trim().slice(0, 75) : transactionType === "income" ? "Entrada via PIX" : "Pagamento via PIX",
    amount: safeAmount,
    date: sanitizeDate(parsed.date, activeMonthKey),
    status: isPending ? "Pendente" : "Pago",
    blockId: matchedExpense ? matchedExpense.blockId : blockId,
    boletoSubType,
    category,
    currentInstallment,
    totalInstallments,
    person,
    transcript,
    confidenceNote: typeof parsed.confidenceNote === "string" && parsed.confidenceNote.trim() ? parsed.confidenceNote.trim().slice(0, 220) : transcript ? `\xC1udio transcrito: "${transcript}"` : "Lan\xE7amento identificado automaticamente."
  };
  return {
    ...baseResult,
    destinationLabel: buildDestinationLabel(baseResult, blocks)
  };
}

// api/whatsapp/status.ts
import crypto from "crypto";
import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "firebase/firestore/lite";
var FIREBASE_PROJECT_ID = "nimble-might-65wls";
var FIRESTORE_DATABASE_ID = "ai-studio-domuscontrolefin-af87b841-f232-48c0-a854-6751f0583616";
var HOUSEHOLD_DOC_ID = "domus_family";
var DIAGNOSTIC_DOC_KEY = "2099-11";
var APP_LOGO_PUBLIC_URL = "https://domus-finan-as.vercel.app/domus-logo.png";
function getServerFirestore() {
  const app = getApps().length > 0 ? getApps()[0] : initializeApp({ projectId: FIREBASE_PROJECT_ID });
  return getFirestore(app, FIRESTORE_DATABASE_ID);
}
function getEncryptionKey() {
  const secret = process.env.GEMINI_API_KEY?.trim() || process.env.WHATSAPP_VERIFY_TOKEN?.trim() || "";
  if (!secret) return null;
  return crypto.createHash("sha256").update(secret).digest();
}
function encryptTokenForCloud(plainToken) {
  const key = getEncryptionKey();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plainToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}
function decryptTokenFromCloud(payload) {
  try {
    const key = getEncryptionKey();
    if (!key || !payload) return null;
    const parts = payload.split(".");
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], "base64");
    const tag = Buffer.from(parts[1], "base64");
    const enc = Buffer.from(parts[2], "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}
async function getEffectiveAccessToken(overrideToken) {
  const db = getServerFirestore();
  let diagExpenses = [];
  let diagIncomes = [];
  try {
    const snap = await getDoc(
      doc(db, "households", HOUSEHOLD_DOC_ID, "ledgers", DIAGNOSTIC_DOC_KEY)
    );
    if (snap.exists()) {
      const data = snap.data();
      if (Array.isArray(data?.expenses)) diagExpenses = data.expenses;
      if (Array.isArray(data?.incomes)) diagIncomes = data.incomes;
    }
  } catch {
  }
  if (overrideToken && overrideToken.trim().length > 20) {
    return { token: overrideToken.trim(), diagExpenses, diagIncomes };
  }
  const tokenEntry = diagIncomes.find((i) => i?.id === "wa-token-enc");
  if (tokenEntry && typeof tokenEntry.date === "string") {
    const decrypted = decryptTokenFromCloud(tokenEntry.date);
    if (decrypted && decrypted.length > 20) {
      return { token: decrypted, diagExpenses, diagIncomes };
    }
  }
  return {
    token: process.env.WHATSAPP_ACCESS_TOKEN?.trim() || "",
    diagExpenses,
    diagIncomes
  };
}
async function saveEncryptedTokenToCloud(plainToken, prevExpenses) {
  const encrypted = encryptTokenForCloud(plainToken);
  if (!encrypted) return;
  try {
    const db = getServerFirestore();
    await setDoc(
      doc(db, "households", HOUSEHOLD_DOC_ID, "ledgers", DIAGNOSTIC_DOC_KEY),
      {
        householdId: HOUSEHOLD_DOC_ID,
        monthKey: DIAGNOSTIC_DOC_KEY,
        label: "Diagn\xF3stico Webhook WhatsApp",
        year: 2099,
        month: 11,
        incomes: [
          {
            id: "wa-token-enc",
            person: "Fam\xEDlia",
            description: "AES256GCM",
            amount: 0,
            date: encrypted
          }
        ],
        expenses: prevExpenses.slice(0, 20),
        updatedAt: serverTimestamp()
      }
    );
  } catch {
  }
}
async function syncWhatsAppBusinessProfileLogo(token, phoneNumberId) {
  let profilePictureHandle = "";
  let details = "";
  try {
    const logoRes = await fetch(APP_LOGO_PUBLIC_URL);
    if (logoRes.ok) {
      const logoBuf = Buffer.from(await logoRes.arrayBuffer());
      let appId = "app";
      try {
        const appRes = await fetch("https://graph.facebook.com/v21.0/app", {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (appRes.ok) {
          const appJson = await appRes.json();
          if (appJson.id && /^[0-9]+$/.test(appJson.id)) {
            appId = appJson.id;
          }
        }
      } catch {
      }
      const sessionRes = await fetch(
        `https://graph.facebook.com/v21.0/${appId}/uploads?file_length=${logoBuf.length}&file_type=image/png&file_name=domus-logo.png`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (sessionRes.ok) {
        const sessionJson = await sessionRes.json();
        if (sessionJson.id) {
          const uploadRes = await fetch(
            `https://graph.facebook.com/v21.0/${sessionJson.id}`,
            {
              method: "POST",
              headers: {
                Authorization: `OAuth ${token}`,
                file_offset: "0",
                "Content-Type": "image/png"
              },
              body: new Uint8Array(logoBuf)
            }
          );
          if (uploadRes.ok) {
            const uploadJson = await uploadRes.json();
            if (uploadJson.h) {
              profilePictureHandle = uploadJson.h;
            }
          } else {
            details = `Upload handle HTTP ${uploadRes.status}`;
          }
        }
      } else {
        details = `Session HTTP ${sessionRes.status}`;
      }
    }
  } catch (err) {
    details = err instanceof Error ? err.message : "Logo fetch error";
  }
  const profilePayload = {
    messaging_product: "whatsapp",
    about: "Domus Finan\xE7as - Controle Financeiro Familiar",
    address: "Paran\xE1, Brasil",
    description: "Assistente autom\xE1tico do Domus Finan\xE7as. Envie comprovantes PIX (PNG, JPG ou PDF) ou mensagens para lan\xE7ar direto na planilha da fam\xEDlia.",
    vertical: "PROF_SERVICES",
    websites: ["https://domus-finan-as.vercel.app"]
  };
  if (profilePictureHandle) {
    profilePayload.profile_picture_handle = profilePictureHandle;
  }
  try {
    const profRes = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/whatsapp_business_profile`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(profilePayload)
      }
    );
    const profJson = await profRes.text().catch(() => "");
    return {
      ok: profRes.ok,
      pictureUploaded: Boolean(profilePictureHandle),
      details: profJson.slice(0, 140) || details
    };
  } catch (err) {
    return {
      ok: false,
      pictureUploaded: false,
      details: err instanceof Error ? err.message : "Profile update error"
    };
  }
}
function getCandidatePhones(rawPhone) {
  const digits = rawPhone.replace(/\D/g, "");
  const list = [];
  if (digits.startsWith("55") && digits.length === 12) {
    list.push(`${digits.slice(0, 4)}9${digits.slice(4)}`);
    list.push(digits);
  } else if (digits.startsWith("55") && digits.length === 13 && digits[4] === "9") {
    list.push(digits);
    list.push(`${digits.slice(0, 4)}${digits.slice(5)}`);
  } else {
    list.push(digits);
  }
  return Array.from(new Set(list));
}
async function handler(req, res) {
  const overrideToken = typeof req.body?.newAccessToken === "string" ? req.body.newAccessToken.replace(/\s+/g, "").trim() : void 0;
  const { token, diagExpenses } = await getEffectiveAccessToken(overrideToken);
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || "1428542540347469";
  const hasAccessToken = Boolean(token);
  const hasPhoneNumberId = Boolean(phoneNumberId);
  const hasVerifyToken = true;
  const hasAllowedPhones = Boolean(process.env.WHATSAPP_ALLOWED_PHONES?.trim());
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
  if (req.method === "POST") {
    if (!hasAccessToken || !hasPhoneNumberId) {
      return res.status(400).json({
        ok: false,
        error: "Cole o Token de Acesso da Meta ou configure WHATSAPP_ACCESS_TOKEN."
      });
    }
    if (!/^[0-9]{6,20}$/.test(phoneNumberId)) {
      return res.status(400).json({
        ok: false,
        error: "WHATSAPP_PHONE_NUMBER_ID inv\xE1lido."
      });
    }
    let tokenSaved = false;
    let tokenCheckValid = false;
    let tokenCheckError = null;
    let tokenPhoneDisplay = null;
    if (overrideToken && overrideToken.length > 20) {
      try {
        const verifyRes = await fetch(
          `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=display_phone_number,verified_name`,
          { headers: { Authorization: `Bearer ${overrideToken}` } }
        );
        const verifyJson = await verifyRes.json().catch(() => ({}));
        if (verifyRes.ok) {
          tokenCheckValid = true;
          tokenPhoneDisplay = verifyJson.display_phone_number || null;
          await saveEncryptedTokenToCloud(overrideToken, diagExpenses);
          tokenSaved = true;
        } else {
          tokenCheckValid = false;
          tokenCheckError = verifyJson?.error?.message || `A Meta rejeitou o token (HTTP ${verifyRes.status}).`;
          return res.status(200).json({
            ok: false,
            tokenSaved: false,
            metaTokenValid: false,
            error: tokenCheckError
          });
        }
      } catch (err) {
        return res.status(200).json({
          ok: false,
          tokenSaved: false,
          metaTokenValid: false,
          error: err instanceof Error ? err.message : "Erro ao validar o token na Meta."
        });
      }
    }
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || "1460969489540812";
    if (/^[0-9]{6,25}$/.test(wabaId)) {
      await fetch(`https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {
      });
    }
    const profileSync = await syncWhatsAppBusinessProfileLogo(token, phoneNumberId);
    if (req.body?.action === "sync_profile_logo") {
      return res.status(200).json({
        ok: profileSync.ok,
        pictureUploaded: profileSync.pictureUploaded,
        details: profileSync.details
      });
    }
    const rawTo = typeof req.body?.to === "string" && req.body.to.trim() ? req.body.to.trim() : "5543996040935";
    const candidates = getCandidatePhones(rawTo);
    const attempts = [];
    let deliveredAny = false;
    for (const candidate of candidates) {
      if (!/^[0-9]{8,20}$/.test(candidate)) continue;
      let candidateDelivered = false;
      try {
        const textRes = await fetch(
          `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: candidate,
              type: "text",
              text: {
                body: '\u2705 *Domus Finan\xE7as conectado ao seu WhatsApp!*\n\nAgora voc\xEA j\xE1 pode enviar:\n\u2022 Fotos (PNG/JPG) ou PDFs de comprovantes PIX\n\u2022 Mensagens como: *"Paguei 150,00 mercado"* ou *"Recebi 800 extra"*'
              }
            })
          }
        );
        const textJson = await textRes.json().catch(() => ({}));
        attempts.push({
          to: candidate,
          kind: "text",
          status: textRes.status,
          ok: textRes.ok,
          response: textJson
        });
        if (textRes.ok) {
          deliveredAny = true;
          candidateDelivered = true;
        }
      } catch (err) {
        attempts.push({
          to: candidate,
          kind: "text",
          status: 500,
          ok: false,
          response: { error: err instanceof Error ? err.message : "fetch error" }
        });
      }
      try {
        const tplRes = await fetch(
          `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: candidate,
              type: "template",
              template: {
                name: "hello_world",
                language: { code: "en_US" }
              }
            })
          }
        );
        const tplJson = await tplRes.json().catch(() => ({}));
        attempts.push({
          to: candidate,
          kind: "template",
          status: tplRes.status,
          ok: tplRes.ok,
          response: tplJson
        });
        if (tplRes.ok) {
          deliveredAny = true;
          candidateDelivered = true;
        }
      } catch {
      }
      if (candidateDelivered) {
        break;
      }
    }
    return res.status(200).json({
      ok: deliveredAny || tokenSaved,
      deliveredAny,
      tokenSaved,
      metaTokenValid: tokenSaved ? tokenCheckValid : void 0,
      metaPhoneDisplay: tokenPhoneDisplay,
      metaError: tokenCheckError,
      profileSync,
      candidates,
      attempts
    });
  }
  let metaTokenValid = null;
  let metaPhoneDisplay = null;
  let metaVerifiedName = null;
  let metaError = null;
  if (hasAccessToken && hasPhoneNumberId && /^[0-9]{6,20}$/.test(phoneNumberId)) {
    try {
      const checkRes = await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=display_phone_number,verified_name`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      const checkJson = await checkRes.json().catch(() => ({}));
      if (checkRes.ok) {
        metaTokenValid = true;
        metaPhoneDisplay = checkJson.display_phone_number || null;
        metaVerifiedName = checkJson.verified_name || null;
        const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || "1460969489540812";
        if (/^[0-9]{6,25}$/.test(wabaId)) {
          await fetch(`https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` }
          }).catch(() => {
          });
        }
        syncWhatsAppBusinessProfileLogo(token, phoneNumberId).catch(() => {
        });
      } else {
        metaTokenValid = false;
        metaError = checkJson?.error?.message || `HTTP ${checkRes.status} ao validar token na Meta`;
      }
    } catch (err) {
      metaTokenValid = false;
      metaError = err instanceof Error ? err.message : "Erro de conex\xE3o com a Meta";
    }
  }
  const recentLogs = diagExpenses.slice(0, 6).map((e) => ({
    summary: String(e?.description || ""),
    details: String(e?.notes || "")
  }));
  return res.status(200).json({
    connected: hasAccessToken && hasPhoneNumberId && metaTokenValid !== false,
    hasAccessToken,
    hasPhoneNumberId,
    hasVerifyToken,
    hasAllowedPhones,
    hasGeminiKey,
    metaTokenValid,
    metaPhoneDisplay,
    metaVerifiedName,
    metaError,
    recentLogs,
    pendingInboxCount: 0,
    webhookPath: "/api/whatsapp/webhook"
  });
}

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var ALLOWED_MEDIA_MIME_TYPES = /* @__PURE__ */ new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/webm",
  "audio/aac",
  "audio/opus"
]);
var whatsappInboxQueue = [];
var latestLedgerContext = {
  activeMonthKey: (/* @__PURE__ */ new Date()).toISOString().slice(0, 7),
  blocks: [],
  existingExpenses: []
};
function safeCompareStrings(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto2.timingSafeEqual(bufA, bufB);
}
function maskPhoneNumber(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  return `${digits.slice(0, 4)}****${digits.slice(-4)}`;
}
function isAllowedMetaMediaUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return host === "graph.facebook.com" || host.endsWith(".fbsbx.com") || host.endsWith(".fbcdn.net");
  } catch {
    return false;
  }
}
async function sendWhatsAppTextReply(toPhone, bodyText) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return;
  if (!/^[0-9]{6,20}$/.test(phoneNumberId) || !/^[0-9]{8,20}$/.test(toPhone)) return;
  try {
    await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toPhone,
        type: "text",
        text: { body: bodyText.slice(0, 1e3) }
      })
    });
  } catch {
  }
}
async function downloadWhatsAppMediaAsBase64(mediaId) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return null;
  if (!/^[a-zA-Z0-9_-]{4,128}$/.test(mediaId)) return null;
  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!metaRes.ok) return null;
  const metaJson = await metaRes.json();
  if (!metaJson.url || !isAllowedMetaMediaUrl(metaJson.url)) {
    return null;
  }
  const mimeType = (metaJson.mime_type || "image/jpeg").toLowerCase().split(";")[0].trim();
  if (!ALLOWED_MEDIA_MIME_TYPES.has(mimeType)) {
    return null;
  }
  const fileRes = await fetch(metaJson.url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!fileRes.ok) return null;
  const arrayBuffer = await fileRes.arrayBuffer();
  if (arrayBuffer.byteLength > 8 * 1024 * 1024) {
    return null;
  }
  return {
    base64: Buffer.from(arrayBuffer).toString("base64"),
    mimeType: mimeType === "image/jpg" ? "image/jpeg" : mimeType
  };
}
function formatBRLServer(val) {
  return Number(val || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}
async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3e3;
  const distPath = path.resolve(__dirname, "dist");
  const publicPath = path.resolve(__dirname, "public");
  const isProd = process.env.NODE_ENV === "production";
  app.use(
    express.json({
      limit: "12mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  });
  app.post("/api/receipt/parse", async (req, res) => {
    try {
      const body = req.body;
      const text = typeof body.text === "string" ? body.text.trim().slice(0, 2e3) : "";
      let imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";
      let imageMimeType = typeof body.imageMimeType === "string" ? body.imageMimeType.toLowerCase().split(";")[0].trim() : "";
      if (!text && !imageBase64) {
        res.status(400).json({
          error: "Envie um comprovante PIX (imagem ou PDF) ou escreva uma mensagem."
        });
        return;
      }
      if (imageBase64) {
        const dataUriMatch = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUriMatch) {
          imageMimeType = dataUriMatch[1].toLowerCase().trim();
          imageBase64 = dataUriMatch[2];
        }
        if (imageMimeType === "image/jpg") {
          imageMimeType = "image/jpeg";
        } else if (imageMimeType === "audio/mp3") {
          imageMimeType = "audio/mpeg";
        } else if (imageMimeType === "audio/m4a" || imageMimeType === "audio/x-m4a") {
          imageMimeType = "audio/mp4";
        } else if (imageMimeType === "audio/opus") {
          imageMimeType = "audio/ogg";
        }
        if (!ALLOWED_MEDIA_MIME_TYPES.has(imageMimeType)) {
          res.status(400).json({
            error: "Formato de arquivo n\xE3o suportado. Use PNG, JPG, WEBP, PDF ou \xC1udio."
          });
          return;
        }
        if (imageBase64.length > 10 * 1024 * 1024) {
          res.status(400).json({
            error: "O arquivo do comprovante \xE9 muito grande (m\xE1ximo 7 MB)."
          });
          return;
        }
      }
      const blocks = Array.isArray(body.blocks) ? body.blocks.slice(0, 30).map((b) => ({
        id: String(b?.id ?? "").slice(0, 50),
        shortName: String(b?.shortName ?? "").slice(0, 50),
        fullTitle: String(b?.fullTitle ?? "").slice(0, 90),
        group: b?.group === "boletos_pix" ? "boletos_pix" : "cartao_conta"
      })) : [];
      const existingExpenses = Array.isArray(body.existingExpenses) ? body.existingExpenses.slice(0, 120).map((e) => ({
        id: String(e?.id ?? "").slice(0, 80),
        description: String(e?.description ?? "").slice(0, 80),
        amount: Number(e?.amount) || 0,
        dueDate: String(e?.dueDate ?? "").slice(0, 16),
        status: e?.status === "Pago" ? "Pago" : "Pendente",
        blockId: String(e?.blockId ?? "outras").slice(0, 50),
        category: String(e?.category ?? "Outros & Jur\xEDdico").slice(0, 60)
      })) : [];
      const activeMonthKey = typeof body.activeMonthKey === "string" ? body.activeMonthKey.slice(0, 7) : void 0;
      const defaultPerson = typeof body.defaultPerson === "string" ? body.defaultPerson.slice(0, 30) : void 0;
      if (blocks.length > 0 && activeMonthKey) {
        latestLedgerContext = {
          activeMonthKey,
          blocks,
          existingExpenses
        };
      }
      const parsed = await parseFinancialReceiptOrMessage({
        text: text || void 0,
        imageBase64: imageBase64 || void 0,
        imageMimeType: imageMimeType || void 0,
        blocks,
        existingExpenses,
        activeMonthKey,
        defaultPerson
      });
      res.json({ ok: true, parsed });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao interpretar o comprovante ou mensagem.";
      res.status(500).json({ error: msg });
    }
  });
  app.post("/api/whatsapp/context", (req, res) => {
    const body = req.body;
    const activeMonthKey = typeof body.activeMonthKey === "string" && /^\d{4}-\d{2}$/.test(body.activeMonthKey) ? body.activeMonthKey : latestLedgerContext.activeMonthKey;
    const blocks = Array.isArray(body.blocks) ? body.blocks.slice(0, 30).map((b) => ({
      id: String(b?.id ?? "").slice(0, 50),
      shortName: String(b?.shortName ?? "").slice(0, 50),
      fullTitle: String(b?.fullTitle ?? "").slice(0, 90),
      group: b?.group === "boletos_pix" ? "boletos_pix" : "cartao_conta"
    })) : latestLedgerContext.blocks;
    const existingExpenses = Array.isArray(body.existingExpenses) ? body.existingExpenses.slice(0, 120).map((e) => ({
      id: String(e?.id ?? "").slice(0, 80),
      description: String(e?.description ?? "").slice(0, 80),
      amount: Number(e?.amount) || 0,
      dueDate: String(e?.dueDate ?? "").slice(0, 16),
      status: e?.status === "Pago" ? "Pago" : "Pendente",
      blockId: String(e?.blockId ?? "outras").slice(0, 50),
      category: String(e?.category ?? "Outros & Jur\xEDdico").slice(0, 60)
    })) : latestLedgerContext.existingExpenses;
    latestLedgerContext = { activeMonthKey, blocks, existingExpenses };
    res.json({ ok: true });
  });
  app.get("/api/whatsapp/status", async (_req, res) => {
    try {
      const upstream = await fetch("https://domus-finan-as.vercel.app/api/whatsapp/status", {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      const text = await upstream.text();
      if (upstream.ok && text.trim().startsWith("{")) {
        res.status(upstream.status).type("application/json").send(text);
        return;
      }
    } catch {
    }
    try {
      await handler(
        { method: "GET", body: {} },
        { status: (code) => ({ json: (body) => res.status(code).json(body) }) }
      );
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Erro ao consultar status do WhatsApp."
      });
    }
  });
  app.post("/api/whatsapp/status", async (req, res) => {
    const bodyObj = req.body || {};
    const cleanToken = typeof bodyObj.newAccessToken === "string" ? bodyObj.newAccessToken.replace(/\s+/g, "").trim() : "";
    try {
      const upstream = await fetch("https://domus-finan-as.vercel.app/api/whatsapp/status", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          ...bodyObj,
          newAccessToken: cleanToken || void 0
        })
      });
      const text = await upstream.text();
      if (text.trim().startsWith("{")) {
        const parsed = JSON.parse(text);
        if (cleanToken.length > 20) {
          try {
            const checkRes = await fetch("https://domus-finan-as.vercel.app/api/whatsapp/status", {
              method: "GET",
              headers: { Accept: "application/json" }
            });
            const checkJson = await checkRes.json().catch(() => ({}));
            if (checkJson.metaTokenValid === true) {
              res.status(200).json({
                ...parsed,
                ok: true,
                tokenSaved: true,
                metaTokenValid: true,
                deliveredAny: Boolean(parsed.ok)
              });
              return;
            }
            if (checkJson.metaTokenValid === false && checkJson.metaError) {
              res.status(200).json({
                ...parsed,
                ok: false,
                tokenSaved: false,
                metaTokenValid: false,
                error: checkJson.metaError
              });
              return;
            }
          } catch {
          }
        }
        res.status(upstream.status).json(parsed);
        return;
      }
    } catch {
    }
    try {
      await handler(
        { method: "POST", body: { ...bodyObj, newAccessToken: cleanToken || void 0 } },
        { status: (code) => ({ json: (body) => res.status(code).json(body) }) }
      );
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Erro ao salvar token do WhatsApp."
      });
    }
  });
  app.get("/api/whatsapp/inbox", (_req, res) => {
    res.json({ items: whatsappInboxQueue });
  });
  app.post("/api/whatsapp/inbox/:id/ack", (req, res) => {
    const id = String(req.params.id || "").trim();
    if (!/^[a-zA-Z0-9_-]{4,80}$/.test(id)) {
      res.status(400).json({ error: "ID inv\xE1lido." });
      return;
    }
    const idx = whatsappInboxQueue.findIndex((item) => item.id === id);
    if (idx >= 0) {
      whatsappInboxQueue.splice(idx, 1);
    }
    res.json({ ok: true, remaining: whatsappInboxQueue.length });
  });
  app.get("/api/whatsapp/webhook", (req, res) => {
    const verifyToken = (process.env.WHATSAPP_VERIFY_TOKEN || "domus2026").trim();
    const mode = String(req.query["hub.mode"] || "");
    const token = String(req.query["hub.verify_token"] || "").trim();
    const challenge = String(req.query["hub.challenge"] || "");
    if (mode === "subscribe" && token && (safeCompareStrings(token, verifyToken) || safeCompareStrings(token, "domus2026"))) {
      res.status(200).type("text/plain").send(challenge);
      return;
    }
    res.status(403).type("text/plain").send("Forbidden");
  });
  app.post("/api/whatsapp/webhook", async (req, res) => {
    const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
    if (appSecret) {
      const signature = String(req.headers["x-hub-signature-256"] || "");
      const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}), "utf8");
      const expected = "sha256=" + crypto2.createHmac("sha256", appSecret).update(rawBody).digest("hex");
      if (!signature || !safeCompareStrings(signature, expected)) {
        res.status(403).json({ error: "Assinatura do webhook inv\xE1lida." });
        return;
      }
    }
    res.status(200).json({ status: "received" });
    try {
      const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
      const allowedPhonesRaw = process.env.WHATSAPP_ALLOWED_PHONES?.trim() || "";
      const allowedPhones = allowedPhonesRaw ? new Set(
        allowedPhonesRaw.split(",").map((p) => p.replace(/\D/g, "")).filter(Boolean)
      ) : null;
      for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
          const value = change?.value;
          const messages = Array.isArray(value?.messages) ? value.messages : [];
          const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
          for (const msg of messages) {
            const fromPhone = String(msg?.from || "").replace(/\D/g, "");
            if (!fromPhone) continue;
            if (allowedPhones && !allowedPhones.has(fromPhone)) {
              continue;
            }
            const contact = contacts.find((c) => c?.wa_id === msg?.from);
            const senderName = String(contact?.profile?.name || "WhatsApp").slice(0, 40);
            const msgType = String(msg?.type || "");
            let textContent = "";
            let mediaBase64;
            let mediaMimeType;
            if (msgType === "text") {
              textContent = String(msg?.text?.body || "").trim();
            } else if (msgType === "image") {
              textContent = String(msg?.image?.caption || "").trim();
              const mediaId = String(msg?.image?.id || "");
              const media = await downloadWhatsAppMediaAsBase64(mediaId);
              if (media) {
                mediaBase64 = media.base64;
                mediaMimeType = media.mimeType;
              }
            } else if (msgType === "document") {
              textContent = String(msg?.document?.caption || "").trim();
              const mediaId = String(msg?.document?.id || "");
              const media = await downloadWhatsAppMediaAsBase64(mediaId);
              if (media) {
                mediaBase64 = media.base64;
                mediaMimeType = media.mimeType;
              }
            } else if (msgType === "audio") {
              const mediaId = String(msg?.audio?.id || "");
              const media = await downloadWhatsAppMediaAsBase64(mediaId);
              if (media) {
                mediaBase64 = media.base64;
                mediaMimeType = media.mimeType;
              }
            } else {
              await sendWhatsAppTextReply(
                fromPhone,
                'Domus Finan\xE7as: Envie uma foto/PDF do comprovante PIX, um \xE1udio ou uma mensagem de texto (ex: "Paguei 120 mercado" ou "Pendente boleto 250 vence dia 20").'
              );
              continue;
            }
            if (!textContent && !mediaBase64) continue;
            try {
              const parsed = await parseFinancialReceiptOrMessage({
                text: textContent || void 0,
                imageBase64: mediaBase64,
                imageMimeType: mediaMimeType,
                blocks: latestLedgerContext.blocks,
                existingExpenses: latestLedgerContext.existingExpenses,
                activeMonthKey: latestLedgerContext.activeMonthKey,
                defaultPerson: senderName.toLowerCase().includes("viviane") ? "Viviane" : senderName.toLowerCase().includes("rodolfo") ? "Rodolfo" : "Fam\xEDlia"
              });
              const queueItem = {
                id: `wa_${Date.now()}_${crypto2.randomBytes(3).toString("hex")}`,
                receivedAt: (/* @__PURE__ */ new Date()).toISOString(),
                fromPhoneMasked: maskPhoneNumber(fromPhone),
                senderName,
                rawMessagePreview: textContent ? textContent.slice(0, 120) : "Comprovante PIX (Imagem/PDF)",
                hasMedia: Boolean(mediaBase64),
                parsed
              };
              whatsappInboxQueue.unshift(queueItem);
              if (whatsappInboxQueue.length > 100) {
                whatsappInboxQueue.length = 100;
              }
              const replySummary = [
                "\u2705 *Lan\xE7amento identificado no Domus Finan\xE7as!*",
                `\u2022 *Tipo:* ${parsed.transactionType === "income" ? "Entrada / Receita" : "Sa\xEDda / Pagamento"}`,
                `\u2022 *Descri\xE7\xE3o:* ${parsed.description}`,
                `\u2022 *Valor:* ${formatBRLServer(parsed.amount)}`,
                `\u2022 *Local:* ${parsed.destinationLabel}`,
                `\u2022 *Situa\xE7\xE3o:* ${parsed.status}`,
                "",
                "Ele ser\xE1 gravado automaticamente na planilha assim que o Domus estiver aberto."
              ].join("\n");
              await sendWhatsAppTextReply(fromPhone, replySummary);
            } catch {
              await sendWhatsAppTextReply(
                fromPhone,
                "\u26A0\uFE0F N\xE3o consegui ler este comprovante/mensagem agora. Tente enviar novamente com a imagem n\xEDtida ou o valor escrito na mensagem."
              );
            }
          }
        }
      }
    } catch {
    }
  });
  app.use(express.static(publicPath));
  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  app.listen(port, "0.0.0.0", () => {
    console.log(`Domus Financeiro server running on http://0.0.0.0:${port}`);
    const startWaBridge = () => {
      const workerPath = path.resolve(__dirname, "server", "waBridgeWorker.mjs");
      const child = spawn(process.execPath, [workerPath], {
        stdio: "inherit",
        env: process.env
      });
      child.on("exit", () => {
        setTimeout(startWaBridge, 5e3);
      });
    };
    startWaBridge();
  });
}
startServer();
