/**
 * FIRESTORE DATA LAYER
 * Sistema Financeiro Multi-Filial
 */

const FS_COLLECTIONS = [
  "cp","cr","despesas","vendas","escala",
  "forn","colab","prest","atrac","hosp",
  "pousada","voo",
  "prod","ent","said","cont","pedidos",
  "rh_func","rh_folha","rh_ferias","rh_ponto"
];

const FS_GLOBAL = [
  "filiais",
  "usuarios",
  "planoContas",
  "config"
];

const FS_CACHE = {
  data:{},
  global:{},
  loaded:new Set(),

  get(filial,col){
    if(!this.data[filial]) return [];
    return this.data[filial][col] || [];
  },

  set(filial,col,data){
    if(!this.data[filial]) this.data[filial]={};
    this.data[filial][col]=data;
  },

  getGlobal(key){
    return this.global[key] || [];
  },

  setGlobal(key,data){
    this.global[key]=data;
  },

  clear(){
    this.data={}
    this.global={}
    this.loaded.clear()
  }
}

function fsPath(filial,col){
  return `filiais/${filial}/dados/${col}`
}

const FS={

ready:false,

async init(){

  if(!FB || !FB.ready || !FB.db){
    console.warn("Firebase não inicializado")
    return false
  }

  try{

    await this.loadGlobal()

    this.ready=true

    console.info("Firestore conectado")

    return true

  }catch(e){

    console.error("Erro Firestore init",e)

    return false
  }

},

async loadGlobal(){

  const db=FB.db

  try{

    const filiais=await db.doc("sistema/filiais").get()
    const usuarios=await db.doc("sistema/usuarios").get()
    const plano=await db.doc("sistema/planoContas").get()
    const config=await db.doc("sistema/config").get()

    FS_CACHE.setGlobal("filiais",filiais.exists ? filiais.data().lista || [] : [])
    FS_CACHE.setGlobal("usuarios",usuarios.exists ? usuarios.data().lista || [] : [])
    FS_CACHE.setGlobal("planoContas",plano.exists ? plano.data().lista || [] : [])
    FS_CACHE.setGlobal("config",config.exists ? config.data() || {} : {})

  }catch(e){

    console.warn("Erro carregando dados globais",e)

  }

},

async loadFilial(filial){

  if(FS_CACHE.loaded.has(filial)) return

  const db=FB.db

  for(const col of FS_COLLECTIONS){

    try{

      const snap=await db.doc(fsPath(filial,col)).get()

      const data=snap.exists ? snap.data().lista || [] : []

      FS_CACHE.set(filial,col,data)

    }catch(e){

      FS_CACHE.set(filial,col,[])

    }

  }

  FS_CACHE.loaded.add(filial)

},

get(filial,col){

  return FS_CACHE.get(filial,col)

},

async set(filial,col,data){

  FS_CACHE.set(filial,col,data)

  if(!FS.ready) return

  try{

    await FB.db.doc(fsPath(filial,col)).set({lista:data})

  }catch(e){

    console.warn("Erro salvando",col,e)

  }

},

async add(filial,col,item){

  const lista=[...FS.get(filial,col),item]

  await this.set(filial,col,lista)

},

async update(filial,col,id,updates){

  const lista=FS.get(filial,col).map(i=>
    i.id===id ? {...i,...updates} : i
  )

  await this.set(filial,col,lista)

},

async remove(filial,col,id){

  const lista=FS.get(filial,col).filter(i=>i.id!==id)

  await this.set(filial,col,lista)

},

findById(filial,col,id){

  return FS.get(filial,col).find(i=>i.id===id) || null

},

async batch(filial,updates){

  if(!FS.ready) return

  const batch=FB.db.batch()

  Object.entries(updates).forEach(([col,data])=>{

    FS_CACHE.set(filial,col,data)

    const ref=FB.db.doc(fsPath(filial,col))

    batch.set(ref,{lista:data})

  })

  try{

    await batch.commit()

  }catch(e){

    console.warn("Erro batch",e)

  }

},

cleanup(){

  FS_CACHE.clear()

  FS.ready=false

}

}

async function initFirestoreLayer(){

  if(!FB || !FB.ready) return

  fbOnAuthChange(async(user)=>{

    if(user){

      const ok=await FS.init()

      if(ok){

        const filiais=FS_CACHE.getGlobal("filiais")

        if(filiais.length){

          await FS.loadFilial(filiais[0].id)

        }

      }

    }else{

      FS.cleanup()

    }

  })

}

window.FS=FS
window.FS_CACHE=FS_CACHE
window.initFirestoreLayer=initFirestoreLayer

document.addEventListener("DOMContentLoaded",()=>{

  if(typeof FB!=="undefined" && FB.ready){

    initFirestoreLayer()

  }

})