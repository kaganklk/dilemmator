// landing.js — Ana sayfa mantığı (Supabase & Vercel API uyumlu)

const previewDilemmas = [
  "Önünde bir buton var. Her bastığında bugüne kadar iletişime geçtiğin herhangi biri ölecek — sokakta yol sorduğun biri de olabilir, annen de. Ama karşılığında 1 milyar dolar alacaksın. Butona basar mıydın?",
  "Ölümsüz olabilirsin ama dünyada tek sen olursun — sevdiğin herkes 30 yıl içinde ölecek. Sonsuz yalnızlık karşılığında ölümsüzlüğü kabul eder miydin?",
  "Bir ilaç seni ömür boyu gerçek mutlu eder ama tüm anıların silinir. Ailenin kim olduğunu bile hatırlamazsın. Alır mıydın?",
  "50 milyon dolar karşılığında rastgele bir ülkede 1000 kişi ölecek — haberlerde bile çıkmayacak. Kabul eder miydin?",
  "Dünyadaki açlığı bitirebilirsin ama karşılığında sen hayatının geri kalanında sadece ekmek ve su tüketebileceksin. Yapar mıydın?"
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
    el.textContent = previewDilemmas[previewIndex];
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
    }
  } catch (e) { /* ignore */ }
}
fetchStats();
setInterval(fetchStats, 10000);

// Error
function showError(msg) {
  const toast = document.getElementById('error-toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
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
    const data = await res.json();

    if (res.ok && data.type === 'room_created') {
      sessionStorage.setItem('playerId', data.playerId);
      sessionStorage.setItem('roomCode', data.roomCode);
      sessionStorage.setItem('isHost', 'true');
      sessionStorage.setItem('playerName', name || 'Anonim');
      window.location.href = `/game.html?room=${data.roomCode}`;
    } else {
      showError(data.message || data.error || 'Oda oluşturulamadı.');
      btn.textContent = 'Oda Oluştur';
      btn.disabled = false;
    }
  } catch (err) {
    showError('Bağlantı hatası, tekrar dene.');
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

  try {
    const res = await fetch('/api/join-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, code })
    });
    const data = await res.json();

    if (res.ok && data.type === 'room_joined') {
      sessionStorage.setItem('playerId', data.playerId);
      sessionStorage.setItem('roomCode', data.roomCode);
      sessionStorage.setItem('isHost', data.isHost ? 'true' : 'false');
      sessionStorage.setItem('playerName', name || 'Anonim');
      window.location.href = `/game.html?room=${data.roomCode}`;
    } else {
      showError(data.message || data.error || 'Odaya girilemedi.');
      btn.textContent = 'Odaya Gir';
      btn.disabled = false;
    }
  } catch (err) {
    showError('Bağlantı hatası, tekrar dene.');
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
