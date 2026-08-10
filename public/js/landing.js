// landing.js — Ana sayfa mantığı (Supabase & Vercel API uyumlu)

document.addEventListener("DOMContentLoaded", async () => {
  const roomCode = localStorage.getItem('roomCode');
  const playerId = localStorage.getItem('playerId');
  if (roomCode && playerId) {
    try {
      const res = await fetch('/api/get-room-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: roomCode, playerId })
      });
      if (res.ok) {
        const data = await res.json();
        // Oda aktifse (lobi, oyun, sonuç) geri dön
        if (data.success && data.state && data.state !== 'end') {
          window.location.href = `/game.html?room=${roomCode}`;
          return;
        }
      }
    } catch (e) { /* Bağlantı hatası — ana sayfada kal */ }
    // Oda yok, silinmiş veya 'end' state'inde — eski oturumu temizle
    localStorage.removeItem('roomCode');
    localStorage.removeItem('playerId');
    localStorage.removeItem('isHost');
    localStorage.removeItem('playerName');
  }
});


const previewDilemmas = [
  "Önünde gizemli bir buton var. Her bastığında bugüne kadar iletişime geçtiğin <u>herhangi biri ölecek</u> — sokakta selam verdiğin biri de olabilir, annen de. Ancak karşılığında tam <strong>1 milyar dolar</strong> alacaksın. Butona basar mıydın?",
  "Dünya üzerinde <strong>ölümsüz</strong> olabilirsin ama bunun bedeli olarak sevdiğin <u>herkes 30 yıl içinde ölecek</u>. Sonsuz bir yalnızlık karşılığında ölümsüzlüğü kabul eder miydin?",
  "Tam <strong>10 milyon dolar</strong> karşılığında hayatının geri kalanında kimseyle <u>fiziksel temas kuramayacaksın</u> — el sıkışma, sarılma veya dokunma asla olmayacak. Kabul eder miydin?",
  "Ömrünün sonuna kadar çalışmadan <strong>aylık 100.000 TL</strong> maaş alacaksın ancak hayattaki en sevdiğin <u>favori 3 yemeğini</u> bir daha asla yiyemeyeceksin. Kabul eder miydin?",
  "İstediğin her türlü <strong>insanüstü süper güce</strong> sahip olabileceksin ancak kazandığın her güç için merhamet gibi <u>insani bir duygunu tamamen kaybedeceksin</u>. Yapar mıydın?"
];

let previewIndex = 0;

// Tab switching
window.switchTab = function(id) {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  document.getElementById('panel-' + id).classList.add('active');
};

// Code input: auto uppercase
document.getElementById('code-input').addEventListener('input', function() {
  this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// Preview rotation
setInterval(() => {
  const el = document.getElementById('preview-text');
  const dotsEl = document.getElementById('dots');
  el.classList.add('fade-out');

  setTimeout(() => {
    previewIndex = (previewIndex + 1) % previewDilemmas.length;
    el.innerHTML = previewDilemmas[previewIndex];
    el.classList.remove('fade-out');
    dotsEl.querySelectorAll('.dot').forEach((d, i) => {
      d.classList.toggle('on', i === previewIndex);
    });
  }, 380);
}, 5500);

// Stats
async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    if (res.ok) {
      const data = await res.json();
      document.getElementById('s-players').textContent = data.players || 0;
      document.getElementById('s-rooms').textContent = data.rooms || 0;
      if (data.dilemmas) {
        document.getElementById('s-dilemmas').textContent = data.dilemmas;
      }
    }
  } catch (e) { /* ignore */ }
}
fetchStats();
setInterval(fetchStats, 10000);

// Error
function showError(msg) {
  if (!msg) return;
  const toast = document.getElementById('error-toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 5000);
}

// Handlers
window.handleCreate = async function() {
  const name = document.getElementById('create-name').value.trim();
  const btn = document.getElementById('create-btn');
  btn.textContent = 'Oluşturuluyor...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/create-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    
    let data;
    try {
      data = await res.json();
    } catch (e) {
      const text = await res.text();
      throw new Error(`Sunucu yanıtı (500): Ortam değişkenleri (Environment variables) eklenmemiş veya Redeploy yapılmamış olabilir.`);
    }

    if (res.ok && data.type === 'room_created') {
      localStorage.setItem('playerId', data.playerId);
      localStorage.setItem('roomCode', data.roomCode);
      localStorage.setItem('isHost', 'true');
      localStorage.setItem('playerName', name || 'Anonim');
      window.location.href = `/game.html?room=${data.roomCode}`;
    } else {
      showError(data.message || data.error || `Oda oluşturulamadı (Hata: ${res.status})`);
      btn.textContent = 'Oda Oluştur';
      btn.disabled = false;
    }
  } catch (err) {
    showError(err.message || 'Bağlantı hatası, tekrar dene.');
    btn.textContent = 'Oda Oluştur';
    btn.disabled = false;
  }
};

window.handleJoin = async function() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('code-input').value.trim().toUpperCase();
  const btn = document.getElementById('join-btn');

  if (code.length < 4) {
    document.getElementById('code-input').style.borderColor = 'rgba(255,45,85,0.7)';
    setTimeout(() => { document.getElementById('code-input').style.borderColor = ''; }, 1500);
    return;
  }

  btn.textContent = 'Katılınıyor...';
  btn.disabled = true;

  // localStorage'da bu oda için kayıtlı player_id var mı kontrol et
  const savedPlayerId = localStorage.getItem('playerId');
  const savedRoomCode = localStorage.getItem('roomCode');
  const isRejoining = savedPlayerId && savedRoomCode === code;

  try {
    // Eğer aynı oda için kayıtlı ID varsa rejoin-room kullan
    const endpoint = isRejoining ? '/api/rejoin-room' : '/api/join-room';
    const body = isRejoining
      ? { code, playerId: savedPlayerId, name }
      : { name, code, playerId: savedPlayerId }; // join-room da ID ile kontrol edebilsin

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error('Sunucu ile bağlantı koptu veya yapılandırma hatası (500).');
    }

    if (res.ok && data.type === 'room_joined') {
      localStorage.setItem('playerId', data.playerId);
      localStorage.setItem('roomCode', data.roomCode);
      localStorage.setItem('isHost', data.isHost ? 'true' : 'false');
      localStorage.setItem('playerName', name || 'Anonim');
      window.location.href = `/game.html?room=${data.roomCode}`;
    } else {
      showError(data.message || data.error || 'Odaya girilemedi.');
      btn.textContent = 'Odaya Gir';
      btn.disabled = false;
    }
  } catch (err) {
    showError(err.message || 'Bağlantı hatası, tekrar dene.');
    btn.textContent = 'Odaya Gir';
    btn.disabled = false;
  }
};

// Enter key support
document.getElementById('create-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleCreate();
});
document.getElementById('code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleJoin();
});
