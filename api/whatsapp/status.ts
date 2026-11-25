export default function handler(
  _req: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void } }
) {
  const hasAccessToken = Boolean(process.env.WHATSAPP_ACCESS_TOKEN?.trim());
  const hasPhoneNumberId = Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID?.trim());
  const hasVerifyToken = true;
  const hasAllowedPhones = Boolean(process.env.WHATSAPP_ALLOWED_PHONES?.trim());
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());

  return res.status(200).json({
    connected: hasAccessToken && hasPhoneNumberId,
    hasAccessToken,
    hasPhoneNumberId,
    hasVerifyToken,
    hasAllowedPhones,
    hasGeminiKey,
    pendingInboxCount: 0,
    webhookPath: '/api/whatsapp/webhook',
  });
}
