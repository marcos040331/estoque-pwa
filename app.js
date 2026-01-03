// ====== Estoque Pro (PWA Offline) v6 ======
// Inclui: filtro por grupo, campo local, foto, histórico de movimentações, CSV import/export,
// alertas de baixo estoque + notificações, e bloqueio por PIN.

const STORAGE_KEY = "estoque_pro_pwa_v6";
const GROUPS_KEY  = "estoque_pro_groups_v3";
const MOVES_KEY   = "estoque_pro_moves_v1";
const PIN_HASH_KEY = "estoque_pro_pin_hash_v1";
const NOTIF_ENABLED_KEY = "estoque_pro_notif_enabled_v1";

const DEFAULT_LOW_LIMIT = 2;
const PHOTO_MAX_WIDTH = 900;
const PHOTO_QUALITY = 0.72;
const MAX_MOVES = 2000;

const SORT_MODES = [
  { id: "low", label: "Baixo estoque" },
  { id: "az", label: "A → Z" },
  { id: "recent", label: "Recentes" },
];

let sortMode = localStorage.getItem("estoque_sort_mode") || "low";
let onlyLow = (localStorage.getItem("estoque_only_low") || "0") === "1";
let notifEnabled = (localStorage.getItem(NOTIF_ENABLED_KEY) || "0") === "1";

function nowIso(){ return new Date().toISOString(); }
function formatBRL(value){
  const n = Number(value || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function normalize(str){
  return (str || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function safeNum(v, fallback=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function parseOptionalMoney(v){
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return n;
}
function uniq(arr){
  const seen = new Set();
  const out = [];
  for (const x of arr){
    const k = normalize(x);
    if (!k) continue;
    if (!seen.has(k)){ seen.add(k); out.push(x); }
  }
  return out;
}
function escapeHtml(str){
  return (str || "").toString()
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function formatDate(iso){
  if (!iso) return "—";
  try{
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
  }catch{
    return "—";
  }
}

// ====== Groups ======
function loadGroups(){
  try{
    const raw = localStorage.getItem(GROUPS_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr) && arr.length) return uniq(arr.map(x => (x||"").toString()).filter(Boolean));
  }catch{}
  return ["Geral", "Sem grupo"];
}
let groups = loadGroups();

function saveGroups(){
  groups = uniq(groups.map(g => (g||"").toString().trim()).filter(Boolean));
  if (!groups.some(g => normalize(g) === "sem grupo")) groups.push("Sem grupo");
  localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
}

// ====== Moves ======
function loadMoves(){
  try{
    const raw = localStorage.getItem(MOVES_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr)) return arr;
  }catch{}
  return [];
}
let moves = loadMoves();

function saveMoves(){
  if (moves.length > MAX_MOVES) moves = moves.slice(0, MAX_MOVES);
  localStorage.setItem(MOVES_KEY, JSON.stringify(moves));
}

function addMove({ itemId, delta, note }){
  const m = {
    id: Date.now() + Math.floor(Math.random()*1000),
    itemId: safeNum(itemId),
    delta: safeNum(delta, 0),
    note: (note || "").toString().trim(),
    ts: nowIso(),
  };
  moves.unshift(m);
  saveMoves();
}

// ====== Products (migration) ======
function loadItems(){
  const tryKeys = [
    STORAGE_KEY,
    "estoque_pro_pwa_v5",
    "estoque_pro_pwa_v4",
    "estoque_pro_pwa_v3",
    "estoque_pro_pwa_v2",
    "estoque_pwa"
  ];

  for (const key of tryKeys){
    try{
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw);
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.products) ? data.products : null);
      if (!arr) continue;

      const mapped = arr.map((p, i) => {
        if (!p || typeof p !== "object") return null;

        if ("nome" in p || "modelo" in p || "grupo" in p){
          const grp = ((p.grupo || "") + "").trim() || "Sem grupo";
          return {
            id: safeNum(p.id, Date.now() + i),
            grupo: grp,
            modelo: (p.modelo || "").toString(),
            nome: (p.nome || "").toString(),
            descricao: (p.descricao || "").toString(),
            local: (p.local || "").toString(),
            foto: (p.foto || p.photo || "").toString(), // dataURL
            valor: (p.valor === null || p.valor === undefined || p.valor === "") ? null : (Number.isFinite(Number(p.valor)) ? Number(p.valor) : 0),
            quantidade: Math.max(0, safeNum(p.quantidade, 0)),
            limite: Math.max(0, safeNum(p.limite, DEFAULT_LOW_LIMIT)),
            atualizado_em: (p.atualizado_em || nowIso()).toString(),
          };
        }

        return {
          id: safeNum(p.id, Date.now() + i),
          grupo: "Geral",
          modelo: "",
          nome: (p.descricao || p.nome || "").toString(),
          descricao: "",
          local: "",
          foto: "",
          valor: ("valor" in p) ? (Number.isFinite(Number(p.valor)) ? Number(p.valor) : 0) : null,
          quantidade: Math.max(0, safeNum(p.quantidade, 0)),
          limite: DEFAULT_LOW_LIMIT,
          atualizado_em: (p.atualizado_em || nowIso()).toString(),
        };
      }).filter(Boolean);

      return mapped;
    }catch{}
  }
  return [];
}

let items = loadItems();
let searchText = "";
let groupFilterValue = localStorage.getItem("estoque_group_filter") || "ALL";

(function hydrateGroupsFromItems(){
  const fromItems = items.map(p => (p.grupo||"").toString().trim()).filter(Boolean);
  groups = uniq([...groups, ...fromItems]);
  saveGroups();
})();

// ====== UI refs ======
const elList = document.getElementById("list");
const elSearch = document.getElementById("search");
const btnSearch = document.getElementById("btnSearch");
const groupFilter = document.getElementById("groupFilter");

const kpiItens = document.getElementById("kpiItens");
const kpiQtd = document.getElementById("kpiQtd");
const kpiBaixo = document.getElementById("kpiBaixo");
const kpiValor = document.getElementById("kpiValor");

const lowPanel = document.getElementById("lowPanel");
const lowList = document.getElementById("lowList");
const lowCount = document.getElementById("lowCount");
const btnNotif = document.getElementById("btnNotif");

const btnSort = document.getElementById("btnSort");
const sortLabel = document.getElementById("sortLabel");
const btnOnlyLow = document.getElementById("btnOnlyLow");
const onlyLowLabel = document.getElementById("onlyLowLabel");
const fabAdd = document.getElementById("fabAdd");

const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalSubtitle = document.getElementById("modalSubtitle");
const btnClose = document.getElementById("btnClose");
const btnCancel = document.getElementById("btnCancel");
const btnDelete = document.getElementById("btnDelete");
const btnMinus = document.getElementById("btnMinus");
const btnPlus = document.getElementById("btnPlus");
const btnHistory = document.getElementById("btnHistory");
const historyBox = document.getElementById("historyBox");
const historyList = document.getElementById("historyList");
const btnHistoryClose = document.getElementById("btnHistoryClose");
const moveNote = document.getElementById("moveNote");
const btnAddVenda = document.getElementById("btnAddVenda");
const btnAddRepo = document.getElementById("btnAddRepo");

const form = document.getElementById("form");
const itemId = document.getElementById("itemId");
const grupo = document.getElementById("grupo");
const modelo = document.getElementById("modelo");
const nome = document.getElementById("nome");
const localField = document.getElementById("local");
const descricao = document.getElementById("descricao");
const valor = document.getElementById("valor");
const quantidade = document.getElementById("quantidade");
const limite = document.getElementById("limite");

const fotoFile = document.getElementById("fotoFile");
const btnClearFoto = document.getElementById("btnClearFoto");
const fotoStatus = document.getElementById("fotoStatus");
let currentFotoDataUrl = "";

const btnBackup = document.getElementById("btnBackup");
const fileRestore = document.getElementById("fileRestore");
const btnExportCSV = document.getElementById("btnExportCSV");
const fileImportCSV = document.getElementById("fileImportCSV");

const btnGroups = document.getElementById("btnGroups");
const groupsModal = document.getElementById("groupsModal");
const btnGroupsClose = document.getElementById("btnGroupsClose");
const btnGroupsOk = document.getElementById("btnGroupsOk");
const groupNewName = document.getElementById("groupNewName");
const btnGroupAdd = document.getElementById("btnGroupAdd");
const groupsList = document.getElementById("groupsList");

const btnMoves = document.getElementById("btnMoves");
const movesModal = document.getElementById("movesModal");
const btnMovesClose = document.getElementById("btnMovesClose");
const btnMovesOk = document.getElementById("btnMovesOk");
const btnMovesCSV = document.getElementById("btnMovesCSV");
const btnMovesClear = document.getElementById("btnMovesClear");
const movesList = document.getElementById("movesList");

const btnConfig = document.getElementById("btnConfig");
const configModal = document.getElementById("configModal");
const btnConfigClose = document.getElementById("btnConfigClose");
const btnConfigOk = document.getElementById("btnConfigOk");
const pinNew = document.getElementById("pinNew");
const btnSetPin = document.getElementById("btnSetPin");
const btnRemovePin = document.getElementById("btnRemovePin");
const btnEnableNotif = document.getElementById("btnEnableNotif");
const btnTestNotif = document.getElementById("btnTestNotif");

const lock = document.getElementById("lock");
const pinInput = document.getElementById("pinInput");
const btnUnlock = document.getElementById("btnUnlock");
const lockMsg = document.getElementById("lockMsg");

// ====== Storage ======
function saveItems(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}
function nextId(){
  const max = items.reduce((acc, p) => Math.max(acc, safeNum(p.id, 0)), 0);
  return max + 1;
}

// ====== Rules ======
function getLowLimit(p){
  const lim = safeNum(p.limite, DEFAULT_LOW_LIMIT);
  return Math.max(0, lim);
}
function isLow(p){
  const q = safeNum(p.quantidade, 0);
  const lim = getLowLimit(p);
  return q > 0 && q <= lim;
}
function isZero(p){
  return safeNum(p.quantidade, 0) === 0;
}
function itemTitle(p){
  const g = (p.grupo || "").trim();
  const m = (p.modelo || "").trim();
  const n = (p.nome || "").trim();
  const left = m ? `${m} • ${n}` : n;
  return g ? `${g} — ${left}` : left;
}
function itemSub(p){
  const parts = [];
  if ((p.local || "").trim()) parts.push(`Local: ${p.local.trim()}`);
  if ((p.descricao || "").trim()) parts.push(p.descricao.trim());
  return parts.length ? parts.join(" • ") : "—";
}
function matchesSearch(p, q){
  if (!q) return true;
  const blob = normalize([p.grupo, p.modelo, p.nome, p.local, p.descricao].join(" "));
  return blob.includes(q);
}

// ====== Sorting ======
function applySort(arr){
  if (sortMode === "az"){
    return arr.sort((a,b) => normalize(itemTitle(a)).localeCompare(normalize(itemTitle(b))));
  }
  if (sortMode === "recent"){
    return arr.sort((a,b) => (b.atualizado_em || "").localeCompare(a.atualizado_em || ""));
  }
  return arr.sort((a,b) => {
    const aRank = isLow(a) ? 0 : (isZero(a) ? 1 : 2);
    const bRank = isLow(b) ? 0 : (isZero(b) ? 1 : 2);
    if (aRank !== bRank) return aRank - bRank;
    return normalize(itemTitle(a)).localeCompare(normalize(itemTitle(b)));
  });
}
function filteredItems(){
  const q = normalize(searchText);
  let arr = items.filter(p => matchesSearch(p, q));
  if (groupFilterValue !== "ALL"){
    arr = arr.filter(p => normalize(p.grupo) === normalize(groupFilterValue));
  }
  if (onlyLow) arr = arr.filter(p => isLow(p) || isZero(p));
  return applySort(arr);
}

// ====== Group select / filter ======
const GROUP_ADD_VALUE = "__ADD_GROUP__";

function ensureGroupExists(name){
  const g = (name || "").toString().trim();
  if (!g) return "Sem grupo";
  if (!groups.some(x => normalize(x) === normalize(g))){
    groups.unshift(g);
    saveGroups();
  }
  return groups.find(x => normalize(x) === normalize(g)) || g;
}

function sortedGroups(){
  return [...groups].sort((a,b) => {
    if (normalize(a) === "sem grupo") return 1;
    if (normalize(b) === "sem grupo") return -1;
    return normalize(a).localeCompare(normalize(b));
  });
}

function rebuildGroupSelect(selected){
  const selNorm = normalize(selected || grupo.value || "");
  grupo.innerHTML = "";
  for (const g of sortedGroups()){
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = g;
    if (selNorm && normalize(g) === selNorm) opt.selected = true;
    grupo.appendChild(opt);
  }
  const addOpt = document.createElement("option");
  addOpt.value = GROUP_ADD_VALUE;
  addOpt.textContent = "+ Novo grupo...";
  grupo.appendChild(addOpt);

  if (!grupo.value || grupo.value === GROUP_ADD_VALUE){
    grupo.value = groups.some(g => normalize(g)==="geral") ? "Geral" : (sortedGroups()[0] || "Sem grupo");
  }
}

function rebuildGroupFilter(){
  const current = groupFilterValue || "ALL";
  groupFilter.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "ALL";
  optAll.textContent = "Todos os grupos";
  groupFilter.appendChild(optAll);

  for (const g of sortedGroups()){
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = g;
    groupFilter.appendChild(opt);
  }
  groupFilter.value = current;
}

groupFilter.addEventListener("change", () => {
  groupFilterValue = groupFilter.value || "ALL";
  localStorage.setItem("estoque_group_filter", groupFilterValue);
  renderList();
});

grupo.addEventListener("change", () => {
  if (grupo.value !== GROUP_ADD_VALUE) return;
  const name = prompt("Nome do novo grupo:");
  if (!name){
    rebuildGroupSelect("Sem grupo");
    return;
  }
  const created = ensureGroupExists(name);
  rebuildGroupSelect(created);
  rebuildGroupFilter();
  renderGroupsList();
  renderAll();
});

// ====== Photo ======
function setFotoStatus(){
  fotoStatus.textContent = currentFotoDataUrl ? "Foto adicionada" : "Sem foto";
}
async function fileToDataUrlResized(file){
  // read
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("img"));
    i.src = dataUrl;
  });

  const scale = Math.min(1, PHOTO_MAX_WIDTH / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
}

fotoFile.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try{
    currentFotoDataUrl = await fileToDataUrlResized(file);
    setFotoStatus();
  }catch{
    alert("Falha ao carregar foto.");
  }finally{
    e.target.value = "";
  }
});
btnClearFoto.addEventListener("click", () => {
  currentFotoDataUrl = "";
  setFotoStatus();
});

// ====== Low stock panel + Notifications ======
function lowItems(){
  return items.filter(p => isLow(p) || isZero(p))
    .sort((a,b) => safeNum(a.quantidade,0) - safeNum(b.quantidade,0));
}

function renderLowPanel(){
  const lows = lowItems();
  if (lows.length === 0){
    lowPanel.classList.add("hidden");
    return;
  }
  lowPanel.classList.remove("hidden");
  lowCount.textContent = String(lows.length);
  lowList.innerHTML = "";
  lows.slice(0, 12).forEach(p => {
    const q = safeNum(p.quantidade,0);
    const pill = document.createElement("div");
    pill.className = "lowpill";
    pill.textContent = `${itemTitle(p)} • Qtd: ${q}`;
    pill.addEventListener("click", () => openEdit(p.id));
    lowList.appendChild(pill);
  });
}

async function maybeNotifyLowStock(){
  if (!notifEnabled) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const lows = lowItems();
  if (lows.length === 0) return;

  // prevent spam: notify at most once per 12h
  const key = "estoque_last_low_notif";
  const last = safeNum(localStorage.getItem(key), 0);
  const now = Date.now();
  if (now - last < 12*60*60*1000) return;

  const top = lows[0];
  const q = safeNum(top.quantidade,0);
  new Notification("Baixo estoque", {
    body: `${itemTitle(top)} (Qtd: ${q}) • +${Math.max(0,lows.length-1)} outro(s)`,
    silent: true
  });
  localStorage.setItem(key, String(now));
}

btnNotif.addEventListener("click", () => openConfigModal());

// ====== Render ======
function renderKpis(){
  const total = items.length;
  const totalQtd = items.reduce((acc,p) => acc + safeNum(p.quantidade, 0), 0);
  const baixo = items.filter(p => isLow(p) || isZero(p)).length;
  const valorEst = items.reduce((acc,p) => {
    const money = (p.valor === null || p.valor === undefined) ? 0 : safeNum(p.valor, 0);
    return acc + (money * safeNum(p.quantidade,0));
  }, 0);

  kpiItens.textContent = String(total);
  kpiQtd.textContent = String(totalQtd);
  kpiBaixo.textContent = String(baixo);
  kpiValor.textContent = formatBRL(valorEst);
}

function renderList(){
  const arr = filteredItems();
  elList.innerHTML = "";

  if (arr.length === 0){
    const li = document.createElement("li");
    li.className = "card";
    li.innerHTML = `<div class="title">Nada encontrado</div><div class="subtitle">Tente outro termo ou adicione um item.</div>`;
    elList.appendChild(li);
    return;
  }

  arr.forEach(p => {
    const li = document.createElement("li");
    li.className = "card" + (isZero(p) ? " zero" : (isLow(p) ? " low" : ""));

    const q = safeNum(p.quantidade, 0);
    const lim = getLowLimit(p);

    const badges = [];
    badges.push(`<span class="badge">Qtd: <b>${q}</b></span>`);
    badges.push(p.valor === null || p.valor === undefined || p.valor === "" ? `<span class="badge">Sem preço</span>` : `<span class="badge">${formatBRL(p.valor)}</span>`);
    if ((p.local||"").trim()) badges.push(`<span class="badge">${escapeHtml(p.local.trim())}</span>`);
    if (isZero(p)) badges.push(`<span class="badge danger">ZERADO</span>`);
    else if (isLow(p)) badges.push(`<span class="badge warn">BAIXO (≤ ${lim})</span>`);
    if ((p.foto||"").startsWith("data:image")) badges.push(`<span class="badge">📷</span>`);

    li.innerHTML = `
      <div class="card-top">
        <div class="titlewrap">
          <div class="title">${escapeHtml(itemTitle(p) || "Sem nome")}</div>
          <div class="subtitle">${escapeHtml(itemSub(p))}</div>
        </div>
        <div class="badges">${badges.join("")}</div>
      </div>

      <div class="card-actions">
        <div class="quick">
          <button class="smallbtn" data-act="minus" data-id="${p.id}">-1</button>
          <button class="smallbtn" data-act="plus" data-id="${p.id}">+1</button>
          <button class="smallbtn" data-act="edit" data-id="${p.id}">Editar</button>
        </div>
        <div class="meta">
          <span>ID: ${p.id}</span>
          <span>Atualizado: ${formatDate(p.atualizado_em)}</span>
        </div>
      </div>
    `;

    li.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (btn) return;
      openEdit(p.id);
    });

    elList.appendChild(li);
  });

  elList.querySelectorAll("button[data-act]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      const act = btn.getAttribute("data-act");
      if (act === "minus") quickAdjust(id, -1, "Venda");
      if (act === "plus") quickAdjust(id, +1, "Reposição");
      if (act === "edit") openEdit(id);
    });
  });
}

function renderAll(){
  renderKpis();
  renderLowPanel();
  renderList();
  updateUiLabels();
  maybeNotifyLowStock();
}

// ====== Quick adjust ======
function quickAdjust(id, delta, note){
  const idx = items.findIndex(p => String(p.id) === String(id));
  if (idx < 0) return;
  const q = safeNum(items[idx].quantidade, 0);
  items[idx].quantidade = Math.max(0, q + delta);
  items[idx].atualizado_em = nowIso();
  saveItems();
  addMove({ itemId: items[idx].id, delta, note });
  renderAll();
}

// ====== Modal Item ======
function openModal(){
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
}
function closeModal(){
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
  hideHistory();
}

function openNew(){
  modalTitle.textContent = "Novo item";
  modalSubtitle.textContent = "Cadastro rápido";
  itemId.value = "";
  rebuildGroupSelect(groups.some(g=>normalize(g)==="geral") ? "Geral" : "Sem grupo");
  modelo.value = "";
  nome.value = "";
  localField.value = "";
  descricao.value = "";
  valor.value = "";
  quantidade.value = "0";
  limite.value = String(DEFAULT_LOW_LIMIT);
  currentFotoDataUrl = "";
  setFotoStatus();

  btnDelete.classList.add("hidden");
  btnMinus.disabled = true;
  btnPlus.disabled = true;
  btnHistory.disabled = true;

  openModal();
  setTimeout(() => nome.focus(), 60);
}

function openEdit(id){
  const p = items.find(x => String(x.id) === String(id));
  if (!p) return;

  modalTitle.textContent = "Editar item";
  modalSubtitle.textContent = `ID: ${p.id}`;

  itemId.value = p.id;
  rebuildGroupSelect(p.grupo || "Sem grupo");
  modelo.value = (p.modelo || "");
  nome.value = (p.nome || "");
  localField.value = (p.local || "");
  descricao.value = (p.descricao || "");
  valor.value = (p.valor === null || p.valor === undefined) ? "" : String(p.valor);
  quantidade.value = safeNum(p.quantidade, 0);
  limite.value = String(getLowLimit(p));
  currentFotoDataUrl = (p.foto || "");
  setFotoStatus();

  btnDelete.classList.remove("hidden");
  btnMinus.disabled = false;
  btnPlus.disabled = false;
  btnHistory.disabled = false;

  openModal();
  setTimeout(() => nome.focus(), 60);
}

btnMinus.addEventListener("click", async () => {
  if (!itemId.value) return;
  const note = prompt("Observação (opcional):", "Venda") || "Venda";
  quickAdjust(itemId.value, -1, note);
  const p = items.find(x => String(x.id) === String(itemId.value));
  if (p) quantidade.value = safeNum(p.quantidade, 0);
});
btnPlus.addEventListener("click", async () => {
  if (!itemId.value) return;
  const note = prompt("Observação (opcional):", "Reposição") || "Reposição";
  quickAdjust(itemId.value, +1, note);
  const p = items.find(x => String(x.id) === String(itemId.value));
  if (p) quantidade.value = safeNum(p.quantidade, 0);
});

btnClose.addEventListener("click", closeModal);
btnCancel.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const id = itemId.value ? safeNum(itemId.value) : null;
  const g = ensureGroupExists(grupo.value);
  const m = (modelo.value || "").trim();
  const n = (nome.value || "").trim();
  const loc = (localField.value || "").trim();
  const d = (descricao.value || "").trim();

  const money = parseOptionalMoney(valor.value);
  const q = Math.max(0, safeNum(quantidade.value, NaN));
  const lim = Math.max(0, safeNum(limite.value, DEFAULT_LOW_LIMIT));

  if (!n){ alert("Informe o nome."); return; }
  if (!Number.isFinite(q) || q < 0){ alert("Informe uma quantidade válida."); return; }
  if (Number.isNaN(money)){ alert("Valor inválido (ou deixe em branco)."); return; }

  if (id === null){
    const newItem = { id: nextId(), grupo: g, modelo: m, nome: n, local: loc, descricao: d, foto: currentFotoDataUrl, valor: money, quantidade: q, limite: lim, atualizado_em: nowIso() };
    items.push(newItem);
    addMove({ itemId: newItem.id, delta: 0, note: "Cadastro" });
  }else{
    const idx = items.findIndex(p => safeNum(p.id) === id);
    if (idx >= 0){
      items[idx] = { ...items[idx], grupo: g, modelo: m, nome: n, local: loc, descricao: d, foto: currentFotoDataUrl, valor: money, quantidade: q, limite: lim, atualizado_em: nowIso() };
      addMove({ itemId: id, delta: 0, note: "Edição" });
    }
  }

  saveGroups();
  saveItems();
  rebuildGroupFilter();
  closeModal();
  renderAll();
});

btnDelete.addEventListener("click", () => {
  const id = itemId.value ? safeNum(itemId.value) : null;
  if (id === null) return;
  const p = items.find(x => safeNum(x.id) === id);
  if (!confirm(`Excluir "${itemTitle(p)}"?`)) return;

  items = items.filter(x => safeNum(x.id) !== id);
  saveItems();

  moves = moves.filter(m => safeNum(m.itemId) !== id);
  saveMoves();

  closeModal();
  renderAll();
});

// ====== History per item ======
function itemMoves(id){
  const iid = safeNum(id);
  return moves.filter(m => safeNum(m.itemId) === iid).slice(0, 60);
}
function renderHistory(){
  const id = itemId.value ? safeNum(itemId.value) : null;
  if (id === null) return;
  const arr = itemMoves(id);
  historyList.innerHTML = "";
  if (arr.length === 0){
    historyList.innerHTML = `<div class="minihelp">Sem movimentações ainda.</div>`;
    return;
  }
  arr.forEach(m => {
    const delta = safeNum(m.delta,0);
    const chipClass = delta < 0 ? "neg" : (delta > 0 ? "pos" : "");
    const chipText = delta === 0 ? "0" : (delta > 0 ? `+${delta}` : `${delta}`);
    const item = document.createElement("div");
    item.className = "hist-item";
    item.innerHTML = `
      <div class="hist-left">
        <div class="hist-title">${escapeHtml(m.note || "Movimentação")}</div>
        <div class="hist-sub">${formatDate(m.ts)}</div>
      </div>
      <div class="hist-chip ${chipClass}">${chipText}</div>
    `;
    historyList.appendChild(item);
  });
}
function showHistory(){
  historyBox.classList.remove("hidden");
  renderHistory();
}
function hideHistory(){
  historyBox.classList.add("hidden");
}
btnHistory.addEventListener("click", () => showHistory());
btnHistoryClose.addEventListener("click", () => hideHistory());

btnAddVenda.addEventListener("click", () => {
  if (!itemId.value) return;
  const note = (moveNote.value || "Venda").trim() || "Venda";
  moveNote.value = "";
  quickAdjust(itemId.value, -1, note);
  showHistory();
});
btnAddRepo.addEventListener("click", () => {
  if (!itemId.value) return;
  const note = (moveNote.value || "Reposição").trim() || "Reposição";
  moveNote.value = "";
  quickAdjust(itemId.value, +1, note);
  showHistory();
});

// ====== Search ======
elSearch.addEventListener("input", (e) => {
  searchText = e.target.value || "";
  renderList();
});
function searchAction(){
  const arr = filteredItems();
  if (arr.length > 0) openEdit(arr[0].id);
  else openNew();
}
elSearch.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  searchAction();
});
btnSearch.addEventListener("click", searchAction);

// ====== Sort + Low filter ======
function updateUiLabels(){
  const mode = SORT_MODES.find(m => m.id === sortMode) || SORT_MODES[0];
  sortLabel.textContent = mode.label;
  onlyLowLabel.textContent = onlyLow ? "Só baixo" : "Todos";
}
btnSort.addEventListener("click", () => {
  const idx = SORT_MODES.findIndex(m => m.id === sortMode);
  const next = SORT_MODES[(idx + 1) % SORT_MODES.length];
  sortMode = next.id;
  localStorage.setItem("estoque_sort_mode", sortMode);
  renderList();
  updateUiLabels();
});
btnOnlyLow.addEventListener("click", () => {
  onlyLow = !onlyLow;
  localStorage.setItem("estoque_only_low", onlyLow ? "1" : "0");
  renderList();
  updateUiLabels();
});
fabAdd.addEventListener("click", openNew);

// ====== Groups modal ======
function openGroupsModal(){
  groupsModal.classList.remove("hidden");
  groupsModal.setAttribute("aria-hidden","false");
  groupNewName.value = "";
  renderGroupsList();
  setTimeout(() => groupNewName.focus(), 60);
}
function closeGroupsModal(){
  groupsModal.classList.add("hidden");
  groupsModal.setAttribute("aria-hidden","true");
}
function renderGroupsList(){
  const sorted = sortedGroups();
  groupsList.innerHTML = "";
  sorted.forEach(g => {
    const row = document.createElement("div");
    row.className = "group-item";

    const name = document.createElement("div");
    name.className = "group-name";
    name.textContent = g;

    const actions = document.createElement("div");
    actions.className = "group-actions";

    const btnRename = document.createElement("button");
    btnRename.className = "btn ghost";
    btnRename.type = "button";
    btnRename.textContent = "Renomear";
    btnRename.addEventListener("click", () => renameGroup(g));

    const btnDel = document.createElement("button");
    btnDel.className = "btn danger";
    btnDel.type = "button";
    btnDel.textContent = "Excluir";
    btnDel.addEventListener("click", () => deleteGroup(g));

    actions.appendChild(btnRename);
    actions.appendChild(btnDel);

    row.appendChild(name);
    row.appendChild(actions);
    groupsList.appendChild(row);
  });
}
function renameGroup(oldName){
  const oldNorm = normalize(oldName);
  const proposed = prompt(`Renomear grupo "${oldName}" para:`, oldName);
  if (!proposed) return;
  const newName = proposed.toString().trim();
  if (!newName){ alert("Nome inválido."); return; }
  if (groups.some(g => normalize(g) === normalize(newName)) && normalize(newName) !== oldNorm){
    alert("Já existe um grupo com esse nome.");
    return;
  }
  groups = groups.map(g => normalize(g) === oldNorm ? newName : g);
  saveGroups();
  items = items.map(p => normalize(p.grupo) === oldNorm ? { ...p, grupo: newName, atualizado_em: nowIso() } : p);
  saveItems();
  rebuildGroupSelect(newName);
  rebuildGroupFilter();
  renderGroupsList();
  renderAll();
}
function deleteGroup(name){
  const norm = normalize(name);
  if (norm === "sem grupo"){
    alert("O grupo “Sem grupo” não pode ser excluído.");
    return;
  }
  const count = items.filter(p => normalize(p.grupo) === norm).length;
  if (!confirm(`Excluir "${name}"?\nItens nesse grupo: ${count}\nEles serão movidos para “Sem grupo”.`)) return;

  items = items.map(p => normalize(p.grupo) === norm ? { ...p, grupo: "Sem grupo", atualizado_em: nowIso() } : p);
  saveItems();
  groups = groups.filter(g => normalize(g) !== norm);
  saveGroups();

  rebuildGroupSelect("Sem grupo");
  rebuildGroupFilter();
  renderGroupsList();
  renderAll();
}
btnGroups.addEventListener("click", openGroupsModal);
btnGroupsClose.addEventListener("click", closeGroupsModal);
btnGroupsOk.addEventListener("click", closeGroupsModal);
groupsModal.addEventListener("click", (e) => { if (e.target === groupsModal) closeGroupsModal(); });
btnGroupAdd.addEventListener("click", () => {
  const name = (groupNewName.value || "").trim();
  if (!name) return;
  const created = ensureGroupExists(name);
  groupNewName.value = "";
  rebuildGroupSelect(created);
  rebuildGroupFilter();
  renderGroupsList();
  renderAll();
});
groupNewName.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  btnGroupAdd.click();
});

// ====== Moves modal (global) ======
function openMovesModal(){
  movesModal.classList.remove("hidden");
  movesModal.setAttribute("aria-hidden","false");
  renderMovesList();
}
function closeMovesModal(){
  movesModal.classList.add("hidden");
  movesModal.setAttribute("aria-hidden","true");
}
function findItemById(id){
  return items.find(x => safeNum(x.id) === safeNum(id));
}
function renderMovesList(){
  movesList.innerHTML = "";
  const arr = moves.slice(0, 120);
  if (arr.length === 0){
    movesList.innerHTML = `<div class="minihelp">Sem movimentações registradas.</div>`;
    return;
  }
  arr.forEach(m => {
    const it = findItemById(m.itemId);
    const title = it ? itemTitle(it) : `Item #${m.itemId}`;
    const delta = safeNum(m.delta,0);
    const chipClass = delta < 0 ? "neg" : (delta > 0 ? "pos" : "");
    const chipText = delta === 0 ? "0" : (delta > 0 ? `+${delta}` : `${delta}`);
    const row = document.createElement("div");
    row.className = "hist-item";
    row.innerHTML = `
      <div class="hist-left">
        <div class="hist-title">${escapeHtml(m.note || "Movimentação")} • <span style="opacity:.85">${escapeHtml(title)}</span></div>
        <div class="hist-sub">${formatDate(m.ts)}</div>
      </div>
      <div class="hist-chip ${chipClass}">${chipText}</div>
    `;
    row.addEventListener("click", () => { if (it) openEdit(it.id); });
    movesList.appendChild(row);
  });
}
btnMoves.addEventListener("click", openMovesModal);
btnMovesClose.addEventListener("click", closeMovesModal);
btnMovesOk.addEventListener("click", closeMovesModal);
movesModal.addEventListener("click", (e) => { if (e.target === movesModal) closeMovesModal(); });

btnMovesClear.addEventListener("click", () => {
  if (!confirm("Limpar todo o histórico de movimentações?")) return;
  moves = [];
  saveMoves();
  renderMovesList();
});

// ====== CSV ======
function toCsv(rows){
  const esc = (v) => {
    const s = (v ?? "").toString().replaceAll('"', '""');
    return `"${s}"`;
  };
  return rows.map(r => r.map(esc).join(",")).join("\n");
}

function downloadText(filename, text, mime){
  const blob = new Blob([text], { type: mime || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

btnExportCSV.addEventListener("click", () => {
  const header = ["id","grupo","modelo","nome","local","descricao","valor","quantidade","limite","atualizado_em"];
  const rows = [header];
  items.forEach(p => {
    rows.push([
      p.id, p.grupo, p.modelo, p.nome, p.local, p.descricao,
      (p.valor === null || p.valor === undefined) ? "" : p.valor,
      p.quantidade, p.limite, p.atualizado_em
    ]);
  });
  downloadText(`estoque-itens-${new Date().toISOString().slice(0,10)}.csv`, toCsv(rows), "text/csv");
});

btnMovesCSV.addEventListener("click", () => {
  const header = ["id","itemId","delta","note","ts"];
  const rows = [header];
  moves.forEach(m => rows.push([m.id, m.itemId, m.delta, m.note, m.ts]));
  downloadText(`estoque-movs-${new Date().toISOString().slice(0,10)}.csv`, toCsv(rows), "text/csv");
});

function parseCsv(text){
  // minimal CSV parser for quoted fields
  const rows = [];
  let i = 0, field = "", row = [], inQ = false;
  while (i < text.length){
    const c = text[i];
    if (inQ){
      if (c === '"'){
        if (text[i+1] === '"'){ field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }else{
      if (c === '"'){ inQ = true; i++; continue; }
      if (c === ','){ row.push(field); field=""; i++; continue; }
      if (c === '\n' || c === '\r'){
        if (c === '\r' && text[i+1] === '\n') i++;
        row.push(field); field="";
        if (row.some(x => x.length>0)) rows.push(row);
        row = [];
        i++; continue;
      }
      field += c; i++; continue;
    }
  }
  row.push(field);
  if (row.some(x => x.length>0)) rows.push(row);
  return rows;
}

fileImportCSV.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try{
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error("empty");
    const header = rows[0].map(h => normalize(h));
    const idx = (name) => header.indexOf(normalize(name));

    const get = (r, name) => {
      const k = idx(name);
      return k >= 0 ? (r[k] ?? "") : "";
    };

    const incoming = [];
    for (let ri=1; ri<rows.length; ri++){
      const r = rows[ri];
      const nomeV = get(r,"nome").trim();
      if (!nomeV) continue;
      const obj = {
        id: safeNum(get(r,"id"), Date.now()+ri),
        grupo: ensureGroupExists(get(r,"grupo").trim() || "Sem grupo"),
        modelo: get(r,"modelo").trim(),
        nome: nomeV,
        local: get(r,"local").trim(),
        descricao: get(r,"descricao").trim(),
        foto: "", // CSV não inclui foto
        valor: (() => {
          const v = get(r,"valor").trim();
          if (!v) return null;
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        })(),
        quantidade: Math.max(0, safeNum(get(r,"quantidade"), 0)),
        limite: Math.max(0, safeNum(get(r,"limite"), DEFAULT_LOW_LIMIT)),
        atualizado_em: get(r,"atualizado_em").trim() || nowIso(),
      };
      incoming.push(obj);
    }

    if (!incoming.length){ alert("Nenhum item válido no CSV."); return; }
    if (!confirm(`Importar ${incoming.length} item(ns)? Isso substitui seu estoque atual.`)) return;

    items = incoming;
    saveGroups();
    saveItems();
    rebuildGroupFilter();
    renderAll();
    alert("Importado com sucesso!");
  }catch{
    alert("Falha ao importar CSV. Verifique o arquivo.");
  }finally{
    e.target.value = "";
  }
});

// ====== Backup / Restore ======
btnBackup.addEventListener("click", () => {
  const payload = { app: "estoque-pro-pwa", version: 6, exported_at: nowIso(), groups, items, moves };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `estoque-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

fileRestore.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try{
    const data = JSON.parse(await file.text());
    const incomingItems = data?.items || data?.products || (Array.isArray(data) ? data : null);
    const incomingGroups = data?.groups;
    const incomingMoves = data?.moves;

    if (!Array.isArray(incomingItems)) throw new Error("inv");

    const sanitized = incomingItems.map((p,i) => {
      if (p && typeof p === "object"){
        return {
          id: safeNum(p.id, Date.now() + i),
          grupo: ((p.grupo || "") + "").trim() || "Sem grupo",
          modelo: (p.modelo || "").toString(),
          nome: (p.nome || "").toString(),
          local: (p.local || "").toString(),
          descricao: (p.descricao || "").toString(),
          foto: (p.foto || p.photo || "").toString(),
          valor: (p.valor === null || p.valor === undefined || p.valor === "") ? null : (Number.isFinite(Number(p.valor)) ? Number(p.valor) : 0),
          quantidade: Math.max(0, safeNum(p.quantidade, 0)),
          limite: Math.max(0, safeNum(p.limite, DEFAULT_LOW_LIMIT)),
          atualizado_em: (p.atualizado_em || nowIso()).toString(),
        };
      }
      return null;
    }).filter(Boolean);

    if (!confirm(`Restaurar ${sanitized.length} item(ns)? Isso substitui seu estoque atual.`)) return;

    items = sanitized;

    if (Array.isArray(incomingGroups) && incomingGroups.length){
      groups = uniq(incomingGroups.map(x => (x||"").toString()).filter(Boolean));
      saveGroups();
    }else{
      const fromItems = items.map(p => (p.grupo||"").toString().trim()).filter(Boolean);
      groups = uniq(["Geral","Sem grupo", ...fromItems]);
      saveGroups();
    }

    if (Array.isArray(incomingMoves)){
      moves = incomingMoves.slice(0, MAX_MOVES);
      saveMoves();
    }

    saveItems();
    searchText = "";
    elSearch.value = "";
    groupFilterValue = "ALL";
    localStorage.setItem("estoque_group_filter", groupFilterValue);
    rebuildGroupFilter();
    rebuildGroupSelect("Geral");
    renderAll();
    alert("Restaurado com sucesso!");
  }catch{
    alert("Falha ao restaurar. Verifique se o arquivo é um backup válido.");
  }finally{
    e.target.value = "";
  }
});

// ====== Config + PIN ======
function openConfigModal(){
  configModal.classList.remove("hidden");
  configModal.setAttribute("aria-hidden","false");
  pinNew.value = "";
  setTimeout(() => pinNew.focus(), 60);
}
function closeConfigModal(){
  configModal.classList.add("hidden");
  configModal.setAttribute("aria-hidden","true");
}
btnConfig.addEventListener("click", openConfigModal);
btnConfigClose.addEventListener("click", closeConfigModal);
btnConfigOk.addEventListener("click", closeConfigModal);
configModal.addEventListener("click", (e) => { if (e.target === configModal) closeConfigModal(); });

async function sha256(text){
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map(b => b.toString(16).padStart(2,"0")).join("");
}

async function setPin(pin){
  const h = await sha256(pin);
  localStorage.setItem(PIN_HASH_KEY, h);
}
function hasPin(){ return !!localStorage.getItem(PIN_HASH_KEY); }
async function checkPin(pin){
  const h = await sha256(pin);
  return h === localStorage.getItem(PIN_HASH_KEY);
}

btnSetPin.addEventListener("click", async () => {
  const p = (pinNew.value || "").trim();
  if (!/^\d{4,8}$/.test(p)){ alert("PIN inválido. Use 4 a 8 dígitos."); return; }
  await setPin(p);
  pinNew.value = "";
  alert("PIN salvo!");
});

btnRemovePin.addEventListener("click", () => {
  if (!hasPin()){ alert("Nenhum PIN definido."); return; }
  if (!confirm("Remover o PIN?")) return;
  localStorage.removeItem(PIN_HASH_KEY);
  alert("PIN removido.");
});

function showLock(){
  lock.classList.remove("hidden");
  lock.setAttribute("aria-hidden","false");
  pinInput.value = "";
  lockMsg.textContent = "";
  setTimeout(() => pinInput.focus(), 60);
}
function hideLock(){
  lock.classList.add("hidden");
  lock.setAttribute("aria-hidden","true");
}
async function unlock(){
  const p = (pinInput.value || "").trim();
  if (!p){ lockMsg.textContent = "Informe o PIN."; return; }
  if (await checkPin(p)){
    hideLock();
  }else{
    lockMsg.textContent = "PIN incorreto.";
    pinInput.value = "";
    pinInput.focus();
  }
}
btnUnlock.addEventListener("click", unlock);
pinInput.addEventListener("keydown", (e) => { if (e.key==="Enter"){ e.preventDefault(); unlock(); }});

// ====== Notifications config ======
btnEnableNotif.addEventListener("click", async () => {
  if (!("Notification" in window)){
    alert("Seu navegador não suporta notificações.");
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted"){
    alert("Permissão não concedida.");
    return;
  }
  notifEnabled = true;
  localStorage.setItem(NOTIF_ENABLED_KEY, "1");
  alert("Notificações ativadas.");
  maybeNotifyLowStock();
});

btnTestNotif.addEventListener("click", () => {
  if (!("Notification" in window)){ alert("Sem suporte."); return; }
  if (Notification.permission !== "granted"){ alert("Ative as permissões primeiro."); return; }
  new Notification("Teste", { body: "Notificação do Estoque Pro." });
});

// ====== PWA ======
if ("serviceWorker" in navigator){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// ====== Init ======
saveGroups();
rebuildGroupSelect(groups.some(g=>normalize(g)==="geral") ? "Geral" : "Sem grupo");
rebuildGroupFilter();
renderAll();

// Apply lock if PIN set
if (hasPin()) showLock();
