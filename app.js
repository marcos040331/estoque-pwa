const KEY='estoque_pwa';
let produtos=JSON.parse(localStorage.getItem(KEY)||'[]');

const list=document.getElementById('list');
const search=document.getElementById('search');
const modal=document.getElementById('modal');

function salvar(){localStorage.setItem(KEY,JSON.stringify(produtos));render();}
function render(){
  list.innerHTML='';
  produtos.filter(p=>p.descricao.toLowerCase().includes(search.value.toLowerCase()))
  .forEach(p=>{
    const li=document.createElement('li');
    li.innerHTML=`${p.descricao} | Qtd:${p.quantidade} | R$${p.valor}`;
    li.onclick=()=>editar(p.id);
    list.appendChild(li);
  });
}
function editar(id){
  const p=produtos.find(x=>x.id==id);
  productId.value=p.id;
  descricao.value=p.descricao;
  valor.value=p.valor;
  quantidade.value=p.quantidade;
  modal.classList.remove('hidden');
}
btnAdd.onclick=()=>{form.reset();productId.value='';modal.classList.remove('hidden');}
btnCancel.onclick=()=>modal.classList.add('hidden');
form.onsubmit=e=>{
  e.preventDefault();
  if(productId.value){
    Object.assign(produtos.find(p=>p.id==productId.value),{
      descricao:descricao.value,valor:valor.value,quantidade:quantidade.value
    });
  }else{
    produtos.push({id:Date.now(),descricao:descricao.value,valor:valor.value,quantidade:quantidade.value});
  }
  salvar();modal.classList.add('hidden');
}
btnDelete.onclick=()=>{
  produtos=produtos.filter(p=>p.id!=productId.value);
  salvar();modal.classList.add('hidden');
}
search.oninput=render;
render();

if('serviceWorker'in navigator){
  navigator.serviceWorker.register('sw.js');
}