// ====== Estoque Pro (PWA Offline) v3 ======
const STORAGE_KEY = "estoque_pro_pwa_v3";
const DEFAULT_LOW_LIMIT = 2;

const SORT_MODES = [
  { id: "low", label: "Baixo estoque" },
  { id: "az", label: "A → Z" },
  { id: "recent", label: "Recentes" },
];

let sortMode = localStorage.getItem("estoque_sort_mode") || "low";
let onlyLow = (localStorage.getItem("estoque_only_low") || "0") === "1";

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

// ====== Load with migration (v1/v2) ======
function loadProducts(){
  const tryKeys = [STORAGE_KEY, "estoque_pro_pwa_v2", "estoque_pwa"];
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
          return {
            id: safeNum(p.id, Date.now() + i),
            grupo: (p.grupo || "").toString(),
            modelo: (p.modelo || "").toString(),
            nome: (p.nome || "").toString(),
            descricao: (p.descricao || "").toString(),
            valor: (p.valor === null || p.valor === undefined || p.valor === "") ? null : (Number.isFinite(Number(p.valor)) ? Number(p.valor) : 0),
            quantidade: Math.max(0, safeNum(p.quantidade, 0)),
            limite: Math.max(0, safeNum(p.limite, DEFAULT_LOW_LIMIT)),
            atualizado_em: (p.atualizado_em || nowIso()).toString(),
          };
        }

        // v1: {descricao, valor, quantidade}
        return {
          id: safeNum(p.id, Date.now() + i),
          grupo: "Películas",
          modelo: "",
          nome: (p.descricao || p.nome || "").toString(),
          descricao: "",
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

let products = loadProducts();
let searchText = "";

// ====== UI refs ======
const elList = document.getElementById("list");
const elSearch = document.getElementById("search");

const kpiProdutos = document.getElementById("kpiProdutos");
const kpiQtd = document.getElementById("kpiQtd");
const kpiBaixo = document.getElementById("kpiBaixo");
const kpiValor = document.getElementById("kpiValor");

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

const form = document.getElementById("form");
const productId = document.getElementById("productId");
const grupo = document.getElementById("grupo");
const modelo = document.getElementById("modelo");
const nome = document.getElementById("nome");
const descricao = document.getElementById("descricao");
const valor = document.getElementById("valor");
const quantidade = document.getElementById("quantidade");
const limite = document.getElementById("limite");

const btnBackup = document.getElementById("btnBackup");
const fileRestore = document.getElementById("fileRestore");

// ====== Storage ======
function saveProducts(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
}
function nextId(){
  const max = products.reduce((acc, p) => Math.max(acc, safeNum(p.id, 0)), 0);
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
function productTitle(p){
  const g = (p.grupo || "").trim();
  const m = (p.modelo || "").trim();
  const n = (p.nome || "").trim();
  const left = m ? `${m} • ${n}` : n;
  return g ? `${g} — ${left}` : left;
}
function productSub(p){
  const d = (p.descricao || "").trim();
  return d || "—";
}
function matchesSearch(p, q){
  if (!q) return true;
  const blob = normalize([p.grupo, p.modelo, p.nome, p.descricao].join(" "));
  return blob.includes(q);
}

// ====== Sorting ======
function applySort(arr){
  if (sortMode === "az"){
    return arr.sort((a,b) => normalize(productTitle(a)).localeCompare(normalize(productTitle(b))));
  }
  if (sortMode === "recent"){
    return arr.sort((a,b) => (b.atualizado_em || "").localeCompare(a.atualizado_em || ""));
  }
  return arr.sort((a,b) => {
    const aRank = isLow(a) ? 0 : (isZero(a) ? 1 : 2);
    const bRank = isLow(b) ? 0 : (isZero(b) ? 1 : 2);
    if (aRank !== bRank) return aRank - bRank;
    return normalize(productTitle(a)).localeCompare(normalize(productTitle(b)));
  });
}
function filteredProducts(){
  const q = normalize(searchText);
  let arr = products.filter(p => matchesSearch(p, q));
  if (onlyLow) arr = arr.filter(p => isLow(p) || isZero(p));
  return applySort(arr);
}

// ====== Helpers ======
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

// ====== Render ======
function renderKpis(){
  const totalProdutos = products.length;
  const totalQtd = products.reduce((acc,p) => acc + safeNum(p.quantidade, 0), 0);
  const baixo = products.filter(p => isLow(p) || isZero(p)).length;
  const valorEst = products.reduce((acc,p) => {
    const money = (p.valor === null || p.valor === undefined) ? 0 : safeNum(p.valor, 0);
    return acc + (money * safeNum(p.quantidade,0));
  }, 0);

  kpiProdutos.textContent = String(totalProdutos);
  kpiQtd.textContent = String(totalQtd);
  kpiBaixo.textContent = String(baixo);
  kpiValor.textContent = formatBRL(valorEst);
}

function renderList(){
  const arr = filteredProducts();
  elList.innerHTML = "";

  if (arr.length === 0){
    const li = document.createElement("li");
    li.className = "card";
    li.innerHTML = `<div class="title">Nada encontrado</div><div class="subtitle">Tente outro termo ou adicione um produto.</div>`;
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
    if (p.valor === null || p.valor === undefined || p.valor === ""){
      badges.push(`<span class="badge">Sem preço</span>`);
    }else{
      badges.push(`<span class="badge">${formatBRL(p.valor)}</span>`);
    }
    if (isZero(p)) badges.push(`<span class="badge danger">ZERADO</span>`);
    else if (isLow(p)) badges.push(`<span class="badge warn">BAIXO (≤ ${lim})</span>`);

    li.innerHTML = `
      <div class="card-top">
        <div class="titlewrap">
          <div class="title">${escapeHtml(productTitle(p) || "Sem nome")}</div>
          <div class="subtitle">${escapeHtml(productSub(p))}</div>
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
      if (act === "minus") quickAdjust(id, -1);
      if (act === "plus") quickAdjust(id, +1);
      if (act === "edit") openEdit(id);
    });
  });
}

function renderAll(){
  renderKpis();
  renderList();
  updateUiLabels();
}

// ====== Quick adjust ======
function quickAdjust(id, delta){
  const idx = products.findIndex(p => String(p.id) === String(id));
  if (idx < 0) return;
  const q = safeNum(products[idx].quantidade, 0);
  products[idx].quantidade = Math.max(0, q + delta);
  products[idx].atualizado_em = nowIso();
  saveProducts();
  renderAll();
}

// ====== Modal ======
function openModal(){
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
}
function closeModal(){
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
}
function openNew(){
  modalTitle.textContent = "Novo produto";
  modalSubtitle.textContent = "Cadastro rápido";
  productId.value = "";
  grupo.value = "Películas";
  modelo.value = "";
  nome.value = "";
  descricao.value = "";
  valor.value = "";
  quantidade.value = "0";
  limite.value = String(DEFAULT_LOW_LIMIT);
  btnDelete.classList.add("hidden");
  btnMinus.disabled = true;
  btnPlus.disabled = true;
  openModal();
  setTimeout(() => nome.focus(), 50);
}
function openEdit(id){
  const p = products.find(x => String(x.id) === String(id));
  if (!p) return;

  modalTitle.textContent = "Editar produto";
  modalSubtitle.textContent = `ID: ${p.id}`;

  productId.value = p.id;
  grupo.value = (p.grupo || "");
  modelo.value = (p.modelo || "");
  nome.value = (p.nome || "");
  descricao.value = (p.descricao || "");
  valor.value = (p.valor === null || p.valor === undefined) ? "" : String(p.valor);
  quantidade.value = safeNum(p.quantidade, 0);
  limite.value = String(getLowLimit(p));

  btnDelete.classList.remove("hidden");
  btnMinus.disabled = false;
  btnPlus.disabled = false;
  openModal();
  setTimeout(() => nome.focus(), 50);
}

btnMinus.addEventListener("click", () => {
  if (!productId.value) return;
  quickAdjust(productId.value, -1);
  const p = products.find(x => String(x.id) === String(productId.value));
  if (p) quantidade.value = safeNum(p.quantidade, 0);
});
btnPlus.addEventListener("click", () => {
  if (!productId.value) return;
  quickAdjust(productId.value, +1);
  const p = products.find(x => String(x.id) === String(productId.value));
  if (p) quantidade.value = safeNum(p.quantidade, 0);
});

btnClose.addEventListener("click", closeModal);
btnCancel.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

// ====== Submit ======
form.addEventListener("submit", (e) => {
  e.preventDefault();

  const id = productId.value ? safeNum(productId.value) : null;
  const g = (grupo.value || "").trim();
  const m = (modelo.value || "").trim();
  const n = (nome.value || "").trim();
  const d = (descricao.value || "").trim();

  const money = parseOptionalMoney(valor.value);
  const q = Math.max(0, safeNum(quantidade.value, NaN));
  const lim = Math.max(0, safeNum(limite.value, DEFAULT_LOW_LIMIT));

  if (!n){ alert("Informe o nome do produto."); return; }
  if (!Number.isFinite(q) || q < 0){ alert("Informe uma quantidade válida."); return; }
  if (Number.isNaN(money)){ alert("Valor inválido (ou deixe em branco)."); return; }

  if (id === null){
    products.push({ id: nextId(), grupo: g, modelo: m, nome: n, descricao: d, valor: money, quantidade: q, limite: lim, atualizado_em: nowIso() });
  }else{
    const idx = products.findIndex(p => safeNum(p.id) === id);
    if (idx >= 0){
      products[idx] = { ...products[idx], grupo: g, modelo: m, nome: n, descricao: d, valor: money, quantidade: q, limite: lim, atualizado_em: nowIso() };
    }
  }

  saveProducts();
  closeModal();
  renderAll();
});

btnDelete.addEventListener("click", () => {
  const id = productId.value ? safeNum(productId.value) : null;
  if (id === null) return;
  const p = products.find(x => safeNum(x.id) === id);
  if (!confirm(`Excluir "${productTitle(p)}"?`)) return;
  products = products.filter(x => safeNum(x.id) !== id);
  saveProducts();
  closeModal();
  renderAll();
});

// ====== Search behavior ======
elSearch.addEventListener("input", (e) => {
  searchText = e.target.value || "";
  renderList();
});

// Enter opens first result
elSearch.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const arr = filteredProducts();
  if (arr.length > 0) openEdit(arr[0].id);
  else openNew();
});

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

// ====== Backup / Restore ======
btnBackup.addEventListener("click", () => {
  const payload = { app: "estoque-pro-pwa", version: 3, exported_at: nowIso(), products };
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
    const incoming = Array.isArray(data) ? data : data.products;
    if (!Array.isArray(incoming)) throw new Error("inv");
    const sanitized = incoming.map((p,i) => {
      if (p && typeof p === "object"){
        if ("nome" in p || "modelo" in p || "grupo" in p){
          return {
            id: safeNum(p.id, Date.now() + i),
            grupo: (p.grupo || "").toString(),
            modelo: (p.modelo || "").toString(),
            nome: (p.nome || "").toString(),
            descricao: (p.descricao || "").toString(),
            valor: (p.valor === null || p.valor === undefined || p.valor === "") ? null : (Number.isFinite(Number(p.valor)) ? Number(p.valor) : 0),
            quantidade: Math.max(0, safeNum(p.quantidade, 0)),
            limite: Math.max(0, safeNum(p.limite, DEFAULT_LOW_LIMIT)),
            atualizado_em: (p.atualizado_em || nowIso()).toString(),
          };
        }
        return {
          id: safeNum(p.id, Date.now() + i),
          grupo: "Películas",
          modelo: "",
          nome: (p.descricao || p.nome || "").toString(),
          descricao: "",
          valor: ("valor" in p) ? (Number.isFinite(Number(p.valor)) ? Number(p.valor) : 0) : null,
          quantidade: Math.max(0, safeNum(p.quantidade, 0)),
          limite: DEFAULT_LOW_LIMIT,
          atualizado_em: (p.atualizado_em || nowIso()).toString(),
        };
      }
      return null;
    }).filter(Boolean);
    if (!confirm(`Restaurar ${sanitized.length} produto(s)? Isso substitui seu estoque atual.`)) return;
    products = sanitized;
    saveProducts();
    searchText = "";
    elSearch.value = "";
    renderAll();
    alert("Restaurado com sucesso!");
  }catch{
    alert("Falha ao restaurar. Verifique se o arquivo é um backup válido.");
  }finally{
    e.target.value = "";
  }
});

if ("serviceWorker" in navigator){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

renderAll();
