// OP Swiss (Bo1) — GitHub Pages (no server)
// Features:
// - Best of 1 (no draws)
// - Swiss score groups + downpairing (float worst of group down)
// - Avoid rematches (backtracking; rematch only if impossible)
// - BYE only when active players odd
//   - Round 1: random BYE
//   - Next: lowest-ranked without BYE (no repeats)
// - Drop / Undo drop
// - Tiebreak: Pts -> OMW% -> SOS -> MW% -> Name
// - End when exactly 1 undefeated (0 losses)
// - Export / Import

const KEY = "op_swiss_bo1_v2";
const WIN_PTS = 3, LOSS_PTS = 0;

const el = (id)=>document.getElementById(id);

function pid(){ return Math.random().toString(16).slice(2) + Date.now().toString(16); }

function load() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function save(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

function recommendRounds(n){
  if (n <= 1) return 0;
  if (n <= 4) return 2;
  if (n <= 8) return 3;
  if (n <= 16) return 4;
  if (n <= 32) return 5;
  if (n <= 64) return 6;
  return 7;
}

function freshTournament(name) {
  return {
    name,
    suggestedRounds: 0,
    currentRound: 0,
    players: [], // {id, name, dropped:false, hadBye:false}
    matches: []  // {roundNo, p1Id, p2Id|null, winnerId, reported}
  };
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function getPlayer(t, id){ return t.players.find(p => p.id === id); }
function playerName(t, id){ const p = getPlayer(t,id); return p ? p.name : "(?)"; }

function activePlayers(t){ return t.players.filter(p => !p.dropped); }

function playerMatches(t, playerId){
  return t.matches.filter(m => m.p1Id === playerId || m.p2Id === playerId);
}
function opponents(t, playerId){
  return playerMatches(t, playerId)
    .filter(m => m.p2Id !== null)
    .map(m => (m.p1Id === playerId ? m.p2Id : m.p1Id));
}

function recordAndPoints(t, playerId){
  let w=0,l=0,pts=0;
  for (const m of playerMatches(t, playerId)){
    if (!m.reported) continue;

    if (m.p2Id === null){
      w++; pts += WIN_PTS;
      continue;
    }

    if (m.winnerId === playerId){
      w++; pts += WIN_PTS;
    } else {
      l++; pts += LOSS_PTS;
    }
  }
  return {w,l,pts};
}

function mwPercent(t, playerId){
  const {w,l} = recordAndPoints(t, playerId);
  const played = w + l;
  if (played === 0) return 0;
  return w / played;
}

function omwPercent(t, playerId){
  const opps = opponents(t, playerId);
  if (!opps.length) return 0;
  const vals = opps.map(o => mwPercent(t, o));
  return vals.reduce((a,b)=>a+b,0) / vals.length;
}

function sosPoints(t, playerId){
  const opps = opponents(t, playerId);
  if (!opps.length) return 0;
  return opps.reduce((sum, oid) => sum + recordAndPoints(t, oid).pts, 0);
}

function standings(t){
  const rows = activePlayers(t).map(p => {
    const rec = recordAndPoints(t, p.id);
    return {
      id: p.id,
      player: p.name,
      ...rec,
      mw: mwPercent(t, p.id),
      omw: omwPercent(t, p.id),
      sos: sosPoints(t, p.id)
    };
  });

  rows.sort((a,b)=>{
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.omw !== a.omw) return b.omw - a.omw;
    if (b.sos !== a.sos) return b.sos - a.sos;
    if (b.mw !== a.mw) return b.mw - a.mw;
    return a.player.toLowerCase().localeCompare(b.player.toLowerCase());
  });
  return rows;
}

function playedBefore(t, aId, bId){
  return t.matches.some(m =>
    m.p2Id !== null &&
    ((m.p1Id===aId && m.p2Id===bId) || (m.p1Id===bId && m.p2Id===aId))
  );
}

function chooseByeCandidate(t, orderedIds){
  // Round 1: random among active
  if (t.currentRound === 0){
    return orderedIds[Math.floor(Math.random() * orderedIds.length)];
  }
  // Round 2+: lowest-ranked who hasn't had BYE
  for (let i = orderedIds.length - 1; i >= 0; i--){
    const p = getPlayer(t, orderedIds[i]);
    if (p && !p.hadBye) return p.id;
  }
  // last resort
  return orderedIds[orderedIds.length - 1];
}

function pairGroupNoRematch(t, groupIds){
  // Backtracking to avoid rematches
  function bt(list){
    if (!list.length) return [];
    const a = list[0];

    // Try closest first (keeps Swiss feel)
    for (let i=1; i<list.length; i++){
      const b = list[i];
      if (playedBefore(t, a, b)) continue;
      const rest = list.slice(1, i).concat(list.slice(i+1));
      const sub = bt(rest);
      if (sub !== null) return [[a,b], ...sub];
    }
    return null;
  }

  const res = bt([...groupIds]);
  if (res) return res;

  // If impossible, allow rematches minimally (still deterministic-ish)
  const out = [];
  const g = [...groupIds];
  while (g.length){
    const a = g.shift();
    let j = g.findIndex(b => !playedBefore(t, a, b));
    if (j === -1) j = 0;
    const b = g.splice(j,1)[0];
    out.push([a,b]);
  }
  return out;
}

function swissPairingsNextRound(t){
  const rows = standings(t);
  const orderedIds = rows.map(r => r.id);

  const activeCount = orderedIds.length;
  if (activeCount < 2) throw new Error("Necesitas al menos 2 jugadores activos.");

  let pool = [...orderedIds];

  // BYE only if active players odd
  let byeId = null;
  if (pool.length % 2 === 1){
    byeId = chooseByeCandidate(t, pool);
    pool = pool.filter(x => x !== byeId);
  }

  // Score groups by points
  const ptsMap = new Map();
  for (const id of pool){
    const pts = recordAndPoints(t, id).pts;
    if (!ptsMap.has(pts)) ptsMap.set(pts, []);
    ptsMap.get(pts).push(id);
  }
  const levels = [...ptsMap.keys()].sort((a,b)=>b-a);

  let carry = null; // floated from above group (worst of that group)
  const pairs = [];

  for (const pts of levels){
    let group = ptsMap.get(pts);

    // downpair: carry becomes best of this group (plays vs best available here)
    if (carry){
      group = [carry, ...group];
      carry = null;
    }

    // If odd, float the worst (last) down
    if (group.length % 2 === 1){
      carry = group.pop();
    }

    // Pair within group avoiding rematches
    pairs.push(...pairGroupNoRematch(t, group));
  }

  // If carry remains (rare), make it BYE if none already
  if (carry){
    if (byeId === null) byeId = carry;
    else {
      // As absolute last resort, pair carry with the lowest remaining (should be extremely rare)
      pairs.push([carry, pool[pool.length - 1]]);
    }
  }

  const nextRound = t.currentRound + 1;
  const matches = pairs.map(([a,b]) => ({
    roundNo: nextRound,
    p1Id: a,
    p2Id: b,
    winnerId: null,
    reported: false
  }));

  if (byeId !== null){
    matches.push({
      roundNo: nextRound,
      p1Id: byeId,
      p2Id: null,
      winnerId: byeId,
      reported: true
    });
    const p = getPlayer(t, byeId);
    if (p) p.hadBye = true; // bye never repeats
  }

  return matches;
}

function isUndefeated(t, playerId){
  const { l } = recordAndPoints(t, playerId);
  return l === 0;
}
function undefeatedActivePlayers(t){
  return activePlayers(t).filter(p => isUndefeated(t, p.id));
}
function tournamentEnded(t){
  if (!t || t.currentRound === 0) return false;
  return undefeatedActivePlayers(t).length === 1;
}

function allReportedCurrentRound(t){
  if (!t || t.currentRound === 0) return true;
  const ms = t.matches.filter(m => m.roundNo === t.currentRound && m.p2Id !== null);
  return ms.every(m => m.reported);
}

// ---- UI ----

function refreshDropSelect(t){
  const sel = el("dropSelect");
  if (!sel) return;
  sel.innerHTML = "";
  if (!t) return;

  const sorted = [...t.players].sort((a,b)=>{
    if ((a.dropped?1:0) !== (b.dropped?1:0)) return (a.dropped?1:0) - (b.dropped?1:0);
    return a.name.localeCompare(b.name);
  });

  for (const p of sorted){
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.dropped ? `❌ ${p.name} (dropped)` : p.name;
    sel.appendChild(opt);
  }
}

function setStatus(t){
  const pill = el("statusPill");
  const text = el("statusText");
  const champLabel = el("champLabel");

  if (!t){
    pill.textContent = "Sin torneo";
    text.textContent = "Crea o importa un torneo.";
    champLabel.textContent = "";
    el("playersCount").textContent = "0 jugadores";
    return;
  }

  const active = activePlayers(t).length;
  const total = t.players.length;
  const inv = undefeatedActivePlayers(t).length;

  pill.textContent = `${t.name} • Ronda ${t.currentRound} • Activos ${active}/${total}`;
  text.textContent = `Rondas sugeridas: ${t.suggestedRounds || "-"} • Invictos: ${inv}`;

  if (tournamentEnded(t)){
    const champ = undefeatedActivePlayers(t)[0];
    champLabel.textContent = `🏆 Campeón invicto: ${champ.name}`;
  } else {
    champLabel.textContent = "";
  }

  el("playersCount").textContent = `${total} jugadores (${active} activos)`;

  const roundsInput = el("tRounds");
  if (roundsInput){
    roundsInput.value = t.suggestedRounds || "";
  }
}

function renderStandings(t){
  const tbody = el("standingsTable").querySelector("tbody");
  tbody.innerHTML = "";
  if (!t) return;

  const rows = standings(t);
  rows.forEach((r, idx)=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx+1}</td>
      <td>${escapeHtml(r.player)}</td>
      <td class="right">${r.pts}</td>
      <td class="right">${r.w}-${r.l}</td>
      <td class="right">${(r.mw*100).toFixed(1)}%</td>
      <td class="right">${(r.omw*100).toFixed(1)}%</td>
      <td class="right">${r.sos}</td>
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

  ms.forEach((m)=>{
    const div = document.createElement("div");
    div.className = "match";

    const left = document.createElement("div");
    const p1 = playerName(t, m.p1Id);
    const p2 = (m.p2Id === null) ? "BYE" : playerName(t, m.p2Id);

    left.innerHTML = `
      <div><strong>${escapeHtml(p1)}</strong>
      <span class="muted"> vs </span>
      <strong>${escapeHtml(p2)}</strong></div>
      <div class="meta">${m.p2Id === null ? "Auto-win" : "Best of 1 (sin empates)"}</div>
    `;

    const right = document.createElement("div");

    if (m.p2Id === null){
      right.innerHTML = `<div class="ok">✅ BYE</div>`;
    } else if (!m.reported){
      right.innerHTML = `
        <div class="pending">⏳</div>
        <div class="row">
          <button data-mid="${m._id || ""}" data-win="P1">Gana P1</button>
          <button data-mid="${m._id || ""}" data-win="P2">Gana P2</button>
        </div>
      `;
    } else {
      const winName = playerName(t, m.winnerId);
      right.innerHTML = `
        <div class="ok">✅</div>
        <div class="meta">Gana ${escapeHtml(winName)}</div>
        <button class="ghost" data-mid="${m._id || ""}" data-win="UNDO">Editar</button>
      `;
    }

    div.appendChild(left);
    div.appendChild(right);
    list.appendChild(div);
  });

  // Attach actions:
  // We need stable match identity; if missing, create runtime IDs for current round only.
  // (We keep it simple: we locate match by round + p1Id + p2Id)
  list.querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const win = btn.getAttribute("data-win");
      const parent = btn.closest(".match");
      if (!parent) return;

      // Figure which match this is by reading the text? Better: rebuild handlers with index.
      // We'll instead bind via dataset stored on buttons in a second pass:
    });
  });

  // Better binding: rebuild with index datasets
  const buttons = list.querySelectorAll("button");
  buttons.forEach(btn=>{
    // Find the match block index by traversing DOM order
    const matchDiv = btn.closest(".match");
    const idx = Array.from(list.children).indexOf(matchDiv);
    const match = ms[idx];
    if (!match) return;

    btn.onclick = ()=>{
      if (match.p2Id === null) return;

      if (win === "UNDO"){
        match.reported = false;
        match.winnerId = null;
      } else if (win === "P1"){
        match.reported = true;
        match.winnerId = match.p1Id;
      } else if (win === "P2"){
        match.reported = true;
        match.winnerId = match.p2Id;
      } else {
        return;
      }

      save(t);
      renderAll(t);
    };

    // capture win per button
    const win = btn.getAttribute("data-win");
    btn.onclick = ()=>{
      if (match.p2Id === null) return;

      if (win === "UNDO"){
        match.reported = false;
        match.winnerId = null;
      } else if (win === "P1"){
        match.reported = true;
        match.winnerId = match.p1Id;
      } else if (win === "P2"){
        match.reported = true;
        match.winnerId = match.p2Id;
      } else {
        return;
      }
      save(t);
      renderAll(t);
    };
  });
}

function renderAll(t){
  setStatus(t);
  renderStandings(t);
  renderRound(t);
  refreshDropSelect(t);

  const btnNext = el("btnNextRound");
  if (btnNext){
    btnNext.disabled = !t || tournamentEnded(t);
  }
}

// ---- Actions ----

let T = load();
renderAll(T);

el("btnCreate").addEventListener("click", ()=>{
  const name = el("tName").value.trim() || "One Piece Local";
  T = freshTournament(name);
  save(T);
  renderAll(T);
});

el("btnAdd").addEventListener("click", ()=>{
  if (!T){ alert("Primero crea el torneo."); return; }
  const name = el("playerName").value.trim();
  if (!name) return;

  // avoid duplicates by name (simple)
  if (T.players.some(p => p.name.toLowerCase() === name.toLowerCase())){
    alert("Ese jugador ya existe (mismo nombre).");
    return;
  }

  T.players.push({ id: pid(), name, dropped:false, hadBye:false });
  el("playerName").value = "";

  // auto suggested rounds before tournament starts
  if (T.currentRound === 0){
    T.suggestedRounds = recommendRounds(activePlayers(T).length);
  }

  save(T);
  renderAll(T);
});

el("btnDrop").addEventListener("click", ()=>{
  if (!T) return;
  const sel = el("dropSelect");
  const id = sel?.value;
  if (!id) return;

  // don't allow dropping if they have a pending match in current round
  const pending = T.matches.some(m =>
    m.roundNo === T.currentRound &&
    !m.reported &&
    (m.p1Id === id || m.p2Id === id)
  );
  if (pending){
    alert("Ese jugador tiene un match pendiente en la ronda actual. Reporta primero.");
    return;
  }

  const p = getPlayer(T, id);
  if (p) p.dropped = true;

  // update suggested rounds only if tournament not started
  if (T.currentRound === 0){
    T.suggestedRounds = recommendRounds(activePlayers(T).length);
  }

  save(T);
  renderAll(T);
});

el("btnUndrop").addEventListener("click", ()=>{
  if (!T) return;
  const sel = el("dropSelect");
  const id = sel?.value;
  if (!id) return;

  const p = getPlayer(T, id);
  if (p) p.dropped = false;

  if (T.currentRound === 0){
    T.suggestedRounds = recommendRounds(activePlayers(T).length);
  }

  save(T);
  renderAll(T);
});

el("btnNextRound").addEventListener("click", ()=>{
  if (!T){ alert("Primero crea el torneo."); return; }

  if (tournamentEnded(T)){
    const champ = undefeatedActivePlayers(T)[0];
    alert(`Torneo terminado ✅\nCampeón invicto: ${champ.name}`);
    return;
  }

  if (T.currentRound > 0 && !allReportedCurrentRound(T)){
    alert("Aún hay matches sin reportar en la ronda actual.");
    return;
  }

  const actives = activePlayers(T).length;
  if (actives < 2){
    alert("Necesitas al menos 2 jugadores activos.");
    return;
  }

  // Generate matches
  try{
    const matches = swissPairingsNextRound(T);
    T.currentRound += 1;
    T.matches.push(...matches);

    save(T);
    renderAll(T);

    // Post-round check (after generating new round, still fine)
  }catch(e){
    alert("No se pudo generar pairings: " + e.message);
  }
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

    if (!obj || !Array.isArray(obj.players) || !Array.isArray(obj.matches)){
      throw new Error("JSON inválido.");
    }

    // minimal normalization
    if (typeof obj.currentRound !== "number") obj.currentRound = 0;
    if (typeof obj.suggestedRounds !== "number") obj.suggestedRounds = recommendRounds(obj.players.filter(p=>!p.dropped).length);

    T = obj;
    save(T);
    renderAll(T);
  }catch(err){
    alert("No se pudo importar: " + err.message);
  }finally{
    e.target.value = "";
  }
});