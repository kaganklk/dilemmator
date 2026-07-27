// src/supabase-admin.js — Supabase Sunucu Client ve Realtime Broadcast Helper
import { createClient } from '@supabase/supabase-js';

// Vercel panelinde kullanıcı tırnak ("), boşluk veya sonuna /rest/v1/ eklediyse OTOMATİK TEMİZLE
function sanitizeUrl(url) {
  if (!url) return 'https://placeholder.supabase.co';
  return url
    .trim()
    .replace(/^["']|["']$/g, '') // Tırnakları temizle
    .replace(/\/rest\/v1\/?$/i, '') // Yanlışlıkla /rest/v1/ eklendiyse sil
    .replace(/\/$/, ''); // Sondaki slash / işaretini kaldır
}

function sanitizeKey(key) {
  if (!key) return 'placeholder-api-key';
  return key.trim().replace(/^["']|["']$/g, ''); // Tırnakları temizle
}

const SUPABASE_URL = sanitizeUrl(process.env.SUPABASE_URL);
const SUPABASE_KEY = sanitizeKey(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

if (!process.env.SUPABASE_URL || (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_ANON_KEY)) {
  console.warn('⚠️ SUPABASE_URL veya SUPABASE_KEY tanımı eksik. Lütfen Vercel ortam değişkenlerini kontrol edin.');
}

export function getSupabaseError() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_URL.includes('.supabase.')) {
    return 'Vercel ortam değişkenleri eksik veya geçersiz: SUPABASE_URL tanınamadı! Vercel Settings -> Environment Variables kontrol et ve mutlaka Redeploy yap.';
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_ANON_KEY) {
    return 'Vercel ortam değişkenleri eksik: SUPABASE_ANON_KEY veya SERVICE_ROLE_KEY tanınamadı! Ayarladıktan sonra mutlaka Redeploy yap.';
  }
  return null;
}

export function formatSupabaseError(err) {
  if (!err) return 'Bilinmeyen hata';
  const cause = err.cause;
  let causeStr = '';
  if (cause) {
    if (cause.code === 'ENOTFOUND') {
      causeStr = ` (Sebep: Supabase adresi bulanamadı - SUPABASE_URL içinde harf hatası olabilir!)`;
    } else {
      causeStr = ` (Sebep: ${cause.code || ''} ${cause.message || JSON.stringify(cause)})`;
    }
  }
  return `${err.message || JSON.stringify(err)}${causeStr}`;
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

/**
 * Supabase Realtime Broadcast REST API üzerinden belirtilen odaya gerçek zamanlı etkinlik gönderir.
 * ÖNEMLİ: Supabase REST API yapısı mutlaka "messages" dizisi içinde ve "topic" parametresiyle olmalıdır!
 */
export async function broadcast(roomCode, eventType, payload = {}) {
  if (getSupabaseError() || !roomCode) return;
  const url = `${SUPABASE_URL}/realtime/v1/api/broadcast`;

  const bodyData = {
    messages: [
      {
        topic: `room:${roomCode}`,
        event: eventType,
        payload: { type: eventType, ...payload },
      }
    ]
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
      },
      body: JSON.stringify(bodyData),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`❌ Broadcast Hatası (${eventType} -> room:${roomCode}):`, errText);
    }
  } catch (error) {
    console.error(`❌ Broadcast Ağ Hatası (${eventType} -> room:${roomCode}):`, error);
  }
}
