// One Piece Swiss (Bo1) — client-side app for GitHub Pages
// Storage: localStorage key "op_swiss_v1"

const KEY = "op_swiss_v1";

const WIN_PTS = 3, DRAW_PTS = 1, LOSS_PTS = 0;

function load() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function save(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

function freshTournament(name, rounds) {
  return {
    name,
    rounds,
    currentRound: 0,
    players: [],
    matches: [] // {roundNo, p1, p2|null, result:"P1"|"P2"|"D"|"" , reported:boolean}
  };
}

function uniq(arr){ return [...new Set(arr)]; }

function playerMatches(t, player){
  return t.matches.filter(m => m.p1 === player || m.p2 === player);
}

function opponents(t, player){
  return playerMatches(t, player)
    .filter(m => m.p2 !== null)
    .map(m => (m.p1 === player ? m.p2 : m.p1));
}

function recordAndPoints(t, player){
  let w=0,l=0,d=0,pts=0;
  for (const m of playerMatches(t, player)){
    if (!m.reported) continue;
    if (m.p2 === null){
      w++; pts += WIN_PTS;
      continue;
    }
    if (m.result === "D"){
      d++; pts += DRAW_PTS;
    } else if ((m.result === "P1" && m.p1 === player) || (m.result === "P2" && m.p2 === player)){
      w++; pts += WIN_PTS;
    } else {
      l++; pts += LOSS_PTS;
    }
  }
  return {w,l,d,pts};
}

function mwPercent(t, player){
  const {w,l,d} = recordAndPoints(t, player);
  const played = w+l+d;
  if (played === 0) return 0;
  return (w + 0.5*d) / played;
}

function omwPercent(t, player){
  const opps = opponents(t, player);
  if (!opps.length) return 0;
  const vals = opps.map(o => mwPercent(t, o));
  return vals.reduce((a,b)=>a+b,0) / vals.length;
}

function standings(t){
  const rows = t.players.map(p => {
    const rec = recordAndPoints(t,p);
    return {player:p, ...rec, mw:mwPercent(t,p), omw:omwPercent(t,p)};
  });
  rows.sort((a,b)=>{
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.omw !== a.omw) return b.omw - a.omw;
    if (b.mw !== a.mw) return b.mw - a.mw;
    return a.player.toLowerCase().localeCompare(b.player.toLowerCase());
  });
  return rows;
}

function playedBefore(t, a, b){
  return t.matches.some(m => m.p2 !== null && ((m.p1===a && m.p2===b) || (m.p1===b && m.p2===a)));
}

function hadBye(t, player){
  return playerMatches(t, player).some(m => m.p2 === null && m.reported);
}

function chooseByeCandidate(t, ordered){
  for (let i=ordered.length-1; i>=0; i--){
    if (!hadBye(t, ordered[i])) return ordered[i];
  }
  return ordered[ordered.length-1];
}

function swissPairingsNextRound(t){
  if (t.currentRound >= t.rounds) throw new Error("El torneo ya terminó.");
  const order = standings(t).map(r=>r.player);
  let pool = [...order];
  let byePlayer = null;

  if (pool.length % 2 === 1){
    byePlayer = chooseByeCandidate(t, pool);
    pool = pool.filter(p => p !== byePlayer);
  }

  // Backtracking pairing
  function backtrack(players){
    if (!players.length) return [];
    const a = players[0];
    const candidates = players.slice(1);

    for (let i=0; i<candidates.length; i++){
      const b = candidates[i];
      if (playedBefore(t,a,b)) continue;
      const remaining = players.slice(1, i+1).concat(players.slice(i+2));
      const res = backtrack(remaining);
      if (res !== null) return [[a,b], ...res];
    }
    // last resort allow rematch
    if (players.length >= 2){
      const b = players[1];
      const res = backtrack(players.slice(2));
      if (res !== null) return [[players[0], b], ...res];
    }
    return null;
  }

  const pairs = backtrack(pool);
  if (!pairs) throw new Error("No se pudo generar pairings.");

  const nextRound = t.currentRound + 1;
  const matches = pairs.map(([a,b]) => ({
    roundNo: nextRound, p1:a, p2:b, result:"", reported:false
  }));

  if (byePlayer){
    matches.push({ roundNo: nextRound, p1: byePlayer, p2: null, result:"P1", reported:true });
  }

  return matches;
}

// --- UI ---
const el = (id)=>document.getElementById(id);

function setStatus(t){
  const pill = el("statusPill");
  const text = el("statusText");
  if (!t){
    pill.textContent = "Sin torneo";
    text.textContent = "Crea o carga un torneo.";
    return;
  }
  pill.textContent = `${t.name} • Ronda ${t.currentRound}/${t.rounds}`;
  text.textContent = `Jugadores: ${t.players.length}. Datos guardados localmente.`;
  el("playersCount").textContent = `${t.players.length} jugadores`;
}

function renderStandings(t){
  const tbody = el("standingsTable").querySelector("tbody");
  tbody.innerHTML = "";
  if (!t){ return; }
  const rows = standings(t);
  rows.forEach((r, idx)=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx+1}</td>
      <td>${escapeHtml(r.player)}</td>
      <td class="right">${r.pts}</td>
      <td class="right">${r.w}-${r.l}-${r.d}</td>
      <td class="right">${(r.mw*100).toFixed(1)}%</td>
      <td class="right">${(r.omw*100).toFixed(1)}%</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderRound(t){
  const list = el("matchesList");
  const label = el("roundLabel");
  list.innerHTML = "";
  if (!t || t.currentRound === 0){
    label.textContent = "Aún no has generado rondas.";
    return;
  }
  label.textContent = `Ronda ${t.currentRound}`;

  const ms = t.matches.filter(m => m.roundNo === t.currentRound);
  ms.forEach((m, idx)=>{
    const div = document.createElement("div");
    div.className = "match";

    const left = document.createElement("div");
    left.innerHTML = `
      <div><strong>${escapeHtml(m.p1)}</strong>
      <span class="muted"> vs </span>
      <strong>${m.p2 === null ? "BYE" : escapeHtml(m.p2)}</strong></div>
      <div class="meta">${m.p2 === null ? "Auto-win" : "Best of 1"}</div>
    `;

    const right = document.createElement("div");
    if (m.p2 === null){
      right.innerHTML = `<div class="ok">✅ BYE</div>`;
    } else if (!m.reported){
      right.innerHTML = `
        <div class="pending">⏳</div>
        <div class="row">
          <button data-i="${idx}" data-r="P1">Gana P1</button>
          <button data-i="${idx}" data-r="P2">Gana P2</button>
          <button data-i="${idx}" data-r="D">Draw</button>
        </div>
      `;
    } else {
      const res = (m.result==="D") ? "Empate" : (m.result==="P1" ? `Gana ${m.p1}` : `Gana ${m.p2}`);
      right.innerHTML = `
        <div class="ok">✅</div>
        <div class="meta">${escapeHtml(res)}</div>
        <button class="ghost" data-i="${idx}" data-r="UNDO">Editar</button>
      `;
    }

    div.appendChild(left);
    div.appendChild(right);
    list.appendChild(div);
  });

  // Buttons actions inside matches
  list.querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const i = Number(btn.getAttribute("data-i"));
      const r = btn.getAttribute("data-r");
      const msNow = t.matches.filter(m => m.roundNo === t.currentRound);
      const match = msNow[i];
      if (!match || match.p2 === null) return;

      if (r === "UNDO"){
        match.result = "";
        match.reported = false;
      } else {
        match.result = r;
        match.reported = true;
      }

      // write back to t.matches (same object ref already, but keep safe)
      save(t);
      renderAll(t);
    });
  });
}

function allReportedCurrentRound(t){
  if (!t || t.currentRound === 0) return true;
  const ms = t.matches.filter(m => m.roundNo === t.currentRound && m.p2 !== null);
  return ms.every(m => m.reported);
}

function renderAll(t){
  setStatus(t);
  renderStandings(t);
  renderRound(t);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// --- Wire up ---
let T = load();
renderAll(T);

el("btnCreate").addEventListener("click", ()=>{
  const name = el("tName").value.trim() || "One Piece Local";
  const rounds = Number(el("tRounds").value || 3);
  T = freshTournament(name, Math.max(1, rounds));
  save(T);
  renderAll(T);
});

el("btnAdd").addEventListener("click", ()=>{
  if (!T){ alert("Primero crea el torneo."); return; }
  const p = el("playerName").value.trim();
  if (!p) return;
  if (T.players.includes(p)){ alert("Ese jugador ya existe."); return; }
  T.players.push(p);
  el("playerName").value = "";
  save(T);
  renderAll(T);
});

el("btnNextRound").addEventListener("click", ()=>{
  if (!T){ alert("Primero crea el torneo."); return; }
  if (T.players.length < 2){ alert("Necesitas al menos 2 jugadores."); return; }
  if (T.currentRound > 0 && !allReportedCurrentRound(T)){
    alert("Aún hay matches sin reportar en la ronda actual.");
    return;
  }
  if (T.currentRound >= T.rounds){
    alert("El torneo ya terminó.");
    return;
  }
  const newMatches = swissPairingsNextRound(T);
  T.currentRound += 1;
  T.matches.push(...newMatches);
  save(T);
  renderAll(T);
});

el("btnShowRound").addEventListener("click", ()=>{
  if (!T){ alert("Primero crea el torneo."); return; }
  renderRound(T);
});

el("btnRefresh").addEventListener("click", ()=>{
  T = load();
  renderAll(T);
});

el("btnReset").addEventListener("click", ()=>{
  if (!confirm("¿Borrar el torneo guardado en este dispositivo?")) return;
  localStorage.removeItem(KEY);
  T = null;
  renderAll(T);
});

el("btnExport").addEventListener("click", ()=>{
  if (!T){ alert("No hay torneo."); return; }
  const blob = new Blob([JSON.stringify(T, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(T.name || "tournament").replace(/\s+/g,"_")}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

el("importFile").addEventListener("change", async (e)=>{
  const file = e.target.files?.[0];
  if (!file) return;
  try{
    const text = await file.text();
    const obj = JSON.parse(text);
    // basic validation
    if (!obj || !Array.isArray(obj.players) || !Array.isArray(obj.matches)) throw new Error("JSON inválido");
    T = obj;
    save(T);
    renderAll(T);
  }catch(err){
    alert("No se pudo importar: " + err.message);
  }finally{
    e.target.value = "";
  }
});