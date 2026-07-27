// src/supabase-admin.js — Supabase Sunucu Client ve Realtime Broadcast Helper
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
// Sunucu tarafında SERVICE_ROLE_KEY tercih edilir; yoksa ANON_KEY ile çalışır
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'placeholder-api-key';

if (!process.env.SUPABASE_URL || (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_ANON_KEY)) {
  console.warn('⚠️ SUPABASE_URL veya SUPABASE_KEY tanımı eksik. Lütfen Vercel ortam değişkenlerini (Environment Variables) kontrol edin.');
}

export function getSupabaseError() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_URL.startsWith('http')) {
    return 'Vercel ortam değişkenleri eksik: SUPABASE_URL tanınamadı! Vercel Settings -> Environment Variables kontrol et ve mutlaka Redeploy yap.';
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_ANON_KEY) {
    return 'Vercel ortam değişkenleri eksik: SUPABASE_ANON_KEY veya SERVICE_ROLE_KEY tanınamadı! Ayarladıktan sonra mutlaka Redeploy yap.';
  }
  return null;
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

/**
 * Supabase Realtime Broadcast REST API üzerinden belirtilen odaya gerçek zamanlı etkinlik gönderir.
 */
export async function broadcast(roomCode, eventType, payload = {}) {
  if (getSupabaseError() || !roomCode) return;
  const baseUrl = SUPABASE_URL.replace(/\/$/, '');
  const url = `${baseUrl}/realtime/v1/api/broadcast`;

  const bodyData = {
    channel: `room:${roomCode}`,
    event: eventType,
    payload: { type: eventType, ...payload },
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
