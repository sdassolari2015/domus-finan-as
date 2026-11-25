function getCandidatePhones(rawPhone: string): string[] {
  const digits = rawPhone.replace(/\D/g, '');
  const list = [digits];
  if (digits.startsWith('55') && digits.length === 12) {
    list.push(`${digits.slice(0, 4)}9${digits.slice(4)}`);
  } else if (digits.startsWith('55') && digits.length === 13 && digits[4] === '9') {
    list.push(`${digits.slice(0, 4)}${digits.slice(5)}`);
  }
  return Array.from(new Set(list));
}

export default async function handler(
  req: { method?: string; body?: Record<string, unknown> },
  res: { status: (code: number) => { json: (body: unknown) => void } }
) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim() || '';
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || '';
  const hasAccessToken = Boolean(token);
  const hasPhoneNumberId = Boolean(phoneNumberId);
  const hasVerifyToken = true;
  const hasAllowedPhones = Boolean(process.env.WHATSAPP_ALLOWED_PHONES?.trim());
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());

  if (req.method === 'POST') {
    if (!hasAccessToken || !hasPhoneNumberId) {
      return res.status(400).json({
        ok: false,
        error: 'Configure WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID na Vercel.',
      });
    }
    if (!/^[0-9]{6,20}$/.test(phoneNumberId)) {
      return res.status(400).json({
        ok: false,
        error: 'WHATSAPP_PHONE_NUMBER_ID inválido.',
      });
    }

    const rawTo =
      typeof req.body?.to === 'string' && req.body.to.trim()
        ? req.body.to.trim()
        : '5543996040935';
    const candidates = getCandidatePhones(rawTo);
    const attempts: Array<{
      to: string;
      kind: 'text' | 'template';
      status: number;
      ok: boolean;
      response: unknown;
    }> = [];

    let deliveredAny = false;

    for (const candidate of candidates) {
      if (!/^[0-9]{8,20}$/.test(candidate)) continue;

      // 1. Try direct text message (works when 24h customer care window is open)
      try {
        const textRes = await fetch(
          `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: candidate,
              type: 'text',
              text: {
                body: '✅ *Domus Finanças conectado ao seu WhatsApp!*\n\nAgora você já pode enviar:\n• Fotos ou PDFs de comprovantes PIX\n• Mensagens como: *"Paguei 150,00 mercado"* ou *"Recebi 800 extra"*',
              },
            }),
          }
        );
        const textJson = await textRes.json().catch(() => ({}));
        attempts.push({
          to: candidate,
          kind: 'text',
          status: textRes.status,
          ok: textRes.ok,
          response: textJson,
        });
        if (textRes.ok) {
          deliveredAny = true;
        }
      } catch (err) {
        attempts.push({
          to: candidate,
          kind: 'text',
          status: 500,
          ok: false,
          response: { error: err instanceof Error ? err.message : 'fetch error' },
        });
      }

      // 2. Also send hello_world template if text message was not accepted
      try {
        const tplRes = await fetch(
          `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: candidate,
              type: 'template',
              template: {
                name: 'hello_world',
                language: { code: 'en_US' },
              },
            }),
          }
        );
        const tplJson = await tplRes.json().catch(() => ({}));
        attempts.push({
          to: candidate,
          kind: 'template',
          status: tplRes.status,
          ok: tplRes.ok,
          response: tplJson,
        });
        if (tplRes.ok) {
          deliveredAny = true;
        }
      } catch {
        // Ignore template error
      }
    }

    return res.status(200).json({
      ok: deliveredAny,
      candidates,
      attempts,
    });
  }

  let metaTokenValid: boolean | null = null;
  let metaPhoneDisplay: string | null = null;
  let metaVerifiedName: string | null = null;
  let metaError: string | null = null;

  if (hasAccessToken && hasPhoneNumberId && /^[0-9]{6,20}$/.test(phoneNumberId)) {
    try {
      const checkRes = await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=display_phone_number,verified_name`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const checkJson = (await checkRes.json().catch(() => ({}))) as {
        display_phone_number?: string;
        verified_name?: string;
        error?: { message?: string; code?: number };
      };
      if (checkRes.ok) {
        metaTokenValid = true;
        metaPhoneDisplay = checkJson.display_phone_number || null;
        metaVerifiedName = checkJson.verified_name || null;
      } else {
        metaTokenValid = false;
        metaError =
          checkJson?.error?.message || `HTTP ${checkRes.status} ao validar token na Meta`;
      }
    } catch (err) {
      metaTokenValid = false;
      metaError = err instanceof Error ? err.message : 'Erro de conexão com a Meta';
    }
  }

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
    pendingInboxCount: 0,
    webhookPath: '/api/whatsapp/webhook',
  });
}
