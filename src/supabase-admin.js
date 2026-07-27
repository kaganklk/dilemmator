// src/supabase-admin.js — Supabase Sunucu Client ve Realtime Broadcast Helper
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
// Sunucu tarafında SERVICE_ROLE_KEY tercih edilir; yoksa ANON_KEY ile çalışır (local test için)
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('⚠️ SUPABASE_URL veya SUPABASE_KEY tanımı eksik. Lütfen ortam değişkenlerini kontrol edin.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

/**
 * Supabase Realtime Broadcast REST API üzerinden belirtilen odaya gerçek zamanlı etkinlik gönderir.
 * WebSocket bağlantısı gerektirmeden HTTP POST üzerinden anında iletir (Serverless için en ideal çözüm).
 * 
 * @param {string} roomCode Oda kodu
 * @param {string} eventType Olay tipi (örn. 'player_joined', 'game_started')
 * @param {object} payload Gönderilecek ek veri (type: eventType otomatik eklenir)
 */
export async function broadcast(roomCode, eventType, payload = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !roomCode) return;
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
