import {
  parseFinancialReceiptOrMessage,
  ParserBlockOption,
  ParserExistingExpense,
} from '../../server/receiptParser';

const ALLOWED_MEDIA_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

export default async function handler(
  req: { method?: string; body?: Record<string, unknown> },
  res: { status: (code: number) => { json: (body: unknown) => void } }
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';
    let imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
    let imageMimeType =
      typeof body.imageMimeType === 'string'
        ? body.imageMimeType.toLowerCase().split(';')[0].trim()
        : '';

    if (!text && !imageBase64) {
      return res.status(400).json({
        error: 'Envie um comprovante PIX (imagem ou PDF) ou escreva uma mensagem.',
      });
    }

    if (imageBase64) {
      const dataUriMatch = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (dataUriMatch) {
        imageMimeType = dataUriMatch[1].toLowerCase().trim();
        imageBase64 = dataUriMatch[2];
      }
      if (imageMimeType === 'image/jpg') {
        imageMimeType = 'image/jpeg';
      }
      if (!ALLOWED_MEDIA_MIME_TYPES.has(imageMimeType)) {
        return res.status(400).json({
          error: 'Formato de arquivo não suportado. Use PNG, JPG, WEBP ou PDF.',
        });
      }
    }

    const blocks: ParserBlockOption[] = Array.isArray(body.blocks)
      ? body.blocks.slice(0, 30).map((b: Record<string, unknown>) => ({
          id: String(b?.id ?? '').slice(0, 50),
          shortName: String(b?.shortName ?? '').slice(0, 50),
          fullTitle: String(b?.fullTitle ?? '').slice(0, 90),
          group: b?.group === 'boletos_pix' ? 'boletos_pix' : 'cartao_conta',
        }))
      : [];

    const existingExpenses: ParserExistingExpense[] = Array.isArray(body.existingExpenses)
      ? body.existingExpenses.slice(0, 120).map((e: Record<string, unknown>) => ({
          id: String(e?.id ?? '').slice(0, 80),
          description: String(e?.description ?? '').slice(0, 80),
          amount: Number(e?.amount) || 0,
          dueDate: String(e?.dueDate ?? '').slice(0, 16),
          status: e?.status === 'Pago' ? 'Pago' : 'Pendente',
          blockId: String(e?.blockId ?? 'outras').slice(0, 50),
          category: String(e?.category ?? 'Outros & Jurídico').slice(0, 60),
        }))
      : [];

    const activeMonthKey =
      typeof body.activeMonthKey === 'string' ? body.activeMonthKey.slice(0, 7) : undefined;
    const defaultPerson =
      typeof body.defaultPerson === 'string' ? body.defaultPerson.slice(0, 30) : undefined;

    const parsed = await parseFinancialReceiptOrMessage({
      text: text || undefined,
      imageBase64: imageBase64 || undefined,
      imageMimeType: imageMimeType || undefined,
      blocks,
      existingExpenses,
      activeMonthKey,
      defaultPerson,
    });

    return res.status(200).json({ ok: true, parsed });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Erro ao interpretar o comprovante ou mensagem.';
    return res.status(500).json({ error: msg });
  }
}
