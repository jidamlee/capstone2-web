"use strict";

let model = null;
const state = {body:"straight", retailer:"zigzag", additionalOnly:false, sleeve:"any", garment:"any", season:"any", query:"", imageOnly:true, seasonHints:true, attribute:null, overview:false, selected:null, zoom:1, panX:0, panY:0};
const q = selector => document.querySelector(selector);
const staticData = document.querySelector('meta[name="atlas-data-mode"]')?.content === "static";
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const hash = value => {let x=2166136261; for (const char of value) {x^=char.charCodeAt(0);x=Math.imul(x,16777619);}return (x>>>0)/4294967295;};
const productLookup = new Map();
let activeProducts = [], detailSequence = 0;

function hasAttribute(product, field, value) {return product.attributes.some(a => a.field === field && a.value === value);}
function baseMatches(product) {
  if (state.additionalOnly && !product.is_additional) return false;
  if (state.retailer !== "all" && product.retailer !== state.retailer) return false;
  if (state.imageOnly && !product.image) return false;
  if (state.sleeve !== "any" && !hasAttribute(product,"sleeve_length",state.sleeve)) return false;
  if (state.garment !== "any" && !hasAttribute(product,"garment_type",state.garment)) return false;
  if (state.season !== "any" && !product.seasons.some(s => s.season === state.season && (state.seasonHints || s.status === "observed"))) return false;
  if (state.query) {
    const text = [product.name,product.brand,product.retailer_label,...product.attributes.map(a=>a.label)].join(" ").toLocaleLowerCase();
    if (!text.includes(state.query.toLocaleLowerCase())) return false;
  }
  return true;
}
function matchingProducts({ignoreAttribute=false, allBodies=false}={}) {
  return model.products.filter(p => baseMatches(p) && (allBodies || p.body === state.body) && (ignoreAttribute || !state.attribute || p.attributes.some(a => a.id === state.attribute)));
}
function sortedProducts(products) {
  return [...products].sort((a,b) => b.scores[state.body]-a.scores[state.body] || Number(a.strength==="weak_prior_only")-Number(b.strength==="weak_prior_only") || (a.collection_rank ?? 99999)-(b.collection_rank ?? 99999) || a.id.localeCompare(b.id));
}
function topFive(products) {
  const used = new Set(), result = [];
  for (const product of sortedProducts(products)) {
    const group = `${product.retailer}:${product.style_group}`;
    if (used.has(group)) continue;
    used.add(group);result.push(product);if (result.length===5) break;
  }
  return result;
}
function applyTheme() {
  const color=model.bodies[state.body].color;
  document.documentElement.style.setProperty("--body",color);
  document.documentElement.style.setProperty("--body-pale",color+"10");
}
function silhouette(body) {
  const curves = {straight:"M8 9c1 6 0 12-1 20m12-20c-1 6 0 12 1 20M7 29c5 2 9 2 13 0",wave:"M7 9c5 9 4 9 1 15-1 2-1 4-1 5m13-20c-5 9-4 9-1 15 1 2 1 4 1 5M7 29c4 2 9 2 13 0",natural:"M7 9c1 6 2 12-1 20m14-20c-1 6-2 12 1 20M6 29c5 2 10 2 15 0"};
  return `<svg class="body-symbol" viewBox="0 0 27 36" aria-hidden="true"><circle cx="13.5" cy="4" r="2.5"/><path d="M7 9h13M13.5 7v3${curves[body]}"/></svg>`;
}
function renderBodyOptions() {
  const base=model.products.filter(baseMatches);
  q("#body-options").innerHTML=Object.entries(model.bodies).map(([key,b])=>`<button class="body-option ${key===state.body?"active":""}" data-body="${key}" style="--option-color:${b.color}" aria-pressed="${key===state.body}">${silhouette(key)}<span class="body-option-text"><strong>${b.label}</strong><small>${b.english.toUpperCase()}</small></span><span class="body-count">${base.filter(p=>p.body===key).length}</span></button>`).join("");
}
function chooseBody(body) {
  state.body=body;state.attribute=null;state.overview=false;clearDetail();resetView();render();
}
function chooseAttribute(id) {
  state.attribute=state.attribute===id?null:id;clearDetail();render();
}
function clearDetail() {
  state.selected=null;detailSequence++;q("#detail-panel").hidden=true;q("#recommendation-panel").hidden=false;
}
function attributeLabel(id) {return model.graph.nodes.find(n=>n.id===id)?.label || "";}

function renderResults(products) {
  const selected=topFive(products), body=model.bodies[state.body];
  q("#candidate-count").textContent=`${products.length}개 중`;
  const parts=[body.label,model.sources.find(s=>s.id===state.retailer)?.label || "전체 컬렉션"];
  if(state.sleeve!=="any") parts.push(model.sleeves[state.sleeve]);
  if(state.attribute)parts.push(attributeLabel(state.attribute));
  q("#results-subtitle").textContent=parts.join(" · ");
  q("#results").innerHTML=selected.map((p,i)=>{
    const tags=p.attributes.filter(a=>["neckline","fit","garment_length"].includes(a.field)).slice(0,2);
    return `<li><button class="result-card ${i===0?"first":""}" data-product="${escapeHtml(p.id)}"><span class="result-photo">${p.image?`<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy">`:'<span class="photo-placeholder">♧</span>'}<span class="result-rank">${String(i+1).padStart(2,"0")}</span></span><span class="result-info"><span class="result-brand">${escapeHtml(p.retailer_label)} · ${escapeHtml(p.brand)}</span><span class="result-name">${escapeHtml(p.name)}</span><span class="result-tags">${tags.map(a=>`<span class="${a.basis!=="observed"?"inferred":""}">${escapeHtml(a.label)}${a.basis!=="observed"?" · 추정":""}</span>`).join("")}${p.multi_option?'<span class="inferred">옵션 혼합</span>':""}</span><span class="result-score">${p.strength==="weak_prior_only"?"보조 단서로 연결":"스타일 연결 점수"}<strong>${p.scores[state.body].toFixed(1)}</strong></span></span></button></li>`;
  }).join("");
  q("#results-empty").hidden=selected.length>0;
  q("#shortage").hidden=selected.length===0 || selected.length===5;
  q("#shortage").textContent=`조건을 충족하는 서로 다른 상품 ${selected.length}개를 보여드려요. 다른 소매나 품목으로 채우지 않았어요.`;
  return selected;
}

function makeCurve(a,b,bend=0) {
  const mx=(a.x+b.x)/2,my=(a.y+b.y)/2,dx=b.x-a.x,dy=b.y-a.y;
  return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${(mx-dy*bend).toFixed(1)},${(my+dx*bend).toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
}
function graphParts(products,featured) {
  const nodes=[],edges=[],featuredRank=new Map(featured.map((p,i)=>[p.id,i+1]));
  const bodies=state.overview?Object.keys(model.bodies):[state.body];
  const compact=innerWidth<650;
  const centers={straight:{x:250,y:255},wave:{x:670,y:255},natural:{x:460,y:550}};
  for (const body of bodies) {
    const meta=model.bodies[body],center=state.overview?centers[body]:{x:460,y:355};
    const bodyProducts=products.filter(p=>p.body===body);
    const bodyBase=state.overview?bodyProducts:matchingProducts({ignoreAttribute:true});
    const styleEdges=model.graph.edges.filter(e=>e.source===`body:${body}` && e.relation==="PREFERS_ATTRIBUTE");
    const attrs=styleEdges.map(edge=>({edge,node:model.graph.nodes.find(n=>n.id===edge.target),count:bodyBase.filter(p=>p.attributes.some(a=>a.id===edge.target)).length})).filter(a=>a.node && a.count>0).sort((a,b)=>b.edge.weight-a.edge.weight || b.count-a.count).slice(0,state.overview?4:compact?6:9);
    const overviewFeatured=[...bodyProducts].sort((a,b)=>b.scores[body]-a.scores[body]).slice(0,2).map(p=>p.id);
    nodes.push({id:`body:${body}`,kind:"body",body,label:meta.label,english:meta.english,color:meta.color,count:bodyProducts.length,...center});
    const attrPositions=new Map();
    attrs.forEach((item,i)=>{
      const angle=-Math.PI/2+i*2*Math.PI/Math.max(attrs.length,1),radius=state.overview?115:compact?157:200;
      const point={x:center.x+Math.cos(angle)*radius,y:center.y+Math.sin(angle)*radius*.79};
      const node={...item.node,id:`${body}|${item.node.id}`,attributeId:item.node.id,color:meta.color,count:item.count,angle,...point};
      nodes.push(node);attrPositions.set(item.node.id,node);
      edges.push({source:`body:${body}`,target:node.id,kind:"style",color:meta.color,...makeEdge(center,point),active:state.attribute===item.node.id});
    });
    bodyProducts.forEach(product=>{
      const supports=attrs.filter(a=>product.attributes.some(pa=>pa.id===a.node.id));
      const strongest=supports[0];
      const angle=(strongest?attrPositions.get(strongest.node.id).angle:hash(product.id)*Math.PI*2)+(hash(product.id+"angle")-.5)*(state.overview?1.4:1.15);
      const rank=featuredRank.get(product.id),isFeatured=state.overview?overviewFeatured.includes(product.id):!!rank;
      const featuredAngles=[-2.56,-1.48,-.42,.64,2.06];
      const theta=state.overview&&isFeatured?[-2.25,-.7][overviewFeatured.indexOf(product.id)]:rank && !state.overview?featuredAngles[rank-1]:angle;
      const radius=state.overview?147+hash(product.id+"radius")*24:compact?220+hash(product.id+"radius")*38:274+hash(product.id+"radius")*48;
      const point={x:center.x+Math.cos(theta)*radius,y:center.y+Math.sin(theta)*radius*(state.overview ? .88 : .84)};
      const pnode={id:`product:${product.id}`,productId:product.id,kind:"product",body,color:meta.color,product,rank,featured:isFeatured,...point};
      nodes.push(pnode);
      const count=state.overview?1:2;
      for (const a of supports.slice(0,count)) {
        const attr=product.attributes.find(pa=>pa.id===a.node.id),target=attrPositions.get(a.node.id);
        edges.push({source:pnode.id,target:target.id,kind:attr.basis!=="observed"?"provisional":"fact",color:meta.color,...makeEdge(point,target),featured:!!rank,active:state.selected===product.id || state.attribute===a.node.id});
      }
      if(!supports.length)edges.push({source:pnode.id,target:`body:${body}`,kind:"provisional",color:meta.color,...makeEdge(point,center),featured:!!rank,active:state.selected===product.id});
    });
  }
  return {nodes,edges};
}
function makeEdge(a,b) {return {path:makeCurve(a,b,.04)};}
function renderGraph(products,featured) {
  q("#map").setAttribute("viewBox",innerWidth<650&&!state.overview?"160 75 600 560":"0 0 920 720");
  const {nodes,edges}=graphParts(products,featured);
  q("#edge-layer").innerHTML=edges.map(e=>`<path class="graph-edge ${e.kind}" d="${e.path}" stroke="${e.color}" opacity="${state.selected?(e.active?.85:e.kind==="style"?.25:.07):(e.active?.6:e.kind==="style"?.31:e.featured?.25:.10)}" ${e.active?'style="stroke-width:1.8"':""}/>`).join("");
  const productNodes=nodes.filter(n=>n.kind==="product"&&!n.featured),attrs=nodes.filter(n=>n.kind==="attribute"),bodies=nodes.filter(n=>n.kind==="body"),photos=nodes.filter(n=>n.kind==="product"&&n.featured);
  q("#node-layer").innerHTML=[...productNodes,...attrs,...bodies,...photos].map(node=>{
    if(node.kind==="body") {
      const r=state.overview?32:45;
      return `<g class="graph-node body-node" transform="translate(${node.x},${node.y})" data-body="${node.body}" role="button" tabindex="0" aria-label="${node.label} 연결 보기"><circle class="body-ring" r="${r+12}" stroke="${node.color}"/><circle class="body-core" r="${r}" fill="${node.color}" filter="url(#node-shadow)"/><text class="body-name" y="-1" style="font-size:${state.overview?15:20}px">${node.english}</text><text class="body-name-ko" y="17" style="font-size:${state.overview?8:11}px">${node.label}</text>${state.overview?"":`<text class="body-label" y="${r+32}" style="paint-order:stroke;stroke:#fff;stroke-width:4px">${node.count}개의 스타일 연결</text>`}</g>`;
    }
    if(node.kind==="attribute") {
      const width=Math.max(103,Math.min(190,node.label.length*13+72)),active=state.attribute===node.attributeId;
      return `<g class="graph-node attribute-node ${active?"active":""}" transform="translate(${node.x},${node.y})" data-attribute="${escapeHtml(node.attributeId)}" data-attribute-body="${node.id.split("|")[0]}" role="button" tabindex="0" aria-label="${escapeHtml(node.label)} 상품 ${node.count}개"><rect x="${-width/2}" y="-19" width="${width}" height="38" rx="19"/><circle class="attribute-dot" cx="${-width/2+14}" cy="0" r="2.4"/><text x="-13" y="5">${escapeHtml(node.label)}</text><rect class="count-bg" x="${width/2-31}" y="-10" width="23" height="20" rx="10"/><text class="attribute-count" x="${width/2-19.5}" y="4">${node.count}</text></g>`;
    }
    const selected=state.selected===node.productId, dim=state.selected&&!selected?.2:1;
    if(node.featured && node.product.image) {
      const radius=state.overview?21:29,clip="clip-"+node.productId.replace(/[^a-z0-9]/gi,"-");
      return `<g class="graph-node product-node featured ${selected?"selected":""}" transform="translate(${node.x},${node.y})" data-product="${escapeHtml(node.productId)}" role="button" tabindex="0" aria-label="${node.rank?`추천 ${node.rank}위 `:""}${escapeHtml(node.product.name)}" opacity="${dim}"><defs><clipPath id="${clip}"><circle r="${radius-2}"/></clipPath></defs><circle class="node-hover" r="${radius+7}" fill="none" stroke="${node.color}" opacity=".3"/><circle class="product-image-frame" r="${radius}" stroke="${node.color}"/><image href="${escapeHtml(node.product.image)}" x="${-radius+2}" y="${-radius+2}" width="${radius*2-4}" height="${radius*2-4}" clip-path="url(#${clip})" preserveAspectRatio="xMidYMid meet"/>${node.rank?`<circle class="rank-ring" cx="${radius-3}" cy="${radius-3}" r="9"/><text class="rank-text" x="${radius-3}" y="${radius-3}">${node.rank}</text>`:""}</g>`;
    }
    const radius=state.overview?3.1:4.2;
    return `<g class="graph-node product-node ${selected?"selected":""}" transform="translate(${node.x},${node.y})" data-product="${escapeHtml(node.productId)}" role="button" tabindex="-1" aria-label="${escapeHtml(node.product.name)}" opacity="${dim}"><circle class="node-hover" r="${radius+6}" fill="none" stroke="${node.color}"/><circle r="${selected?7:radius}" fill="${node.color}" opacity="${selected?1:.55}"/></g>`;
  }).join("");
  q("#map-empty").hidden=products.length>0;
  q("#visible-count").textContent=`${products.length}개 상품 표시 중`;
  q("#overview-toggle").setAttribute("aria-pressed",String(state.overview));
  const b=model.bodies[state.body];
  q("#active-path").innerHTML=`<span>${state.overview?"세 가지 체형":escapeHtml(b.label)}</span><i>→</i><span>${state.attribute?escapeHtml(attributeLabel(state.attribute)):"스타일 속성"}</span><i>←</i><span>상품</span>`;
  q("#selected-attribute").hidden=!state.attribute;
  q("#selected-attribute span").textContent=state.attribute?attributeLabel(state.attribute):"";
  updateView();
}
function render() {
  if(!model)return;
  applyTheme();renderBodyOptions();
  activeProducts=matchingProducts();
  if(state.selected&&!activeProducts.some(p=>p.id===state.selected))clearDetail();
  const featured=renderResults(activeProducts);
  const graphProducts=state.overview?matchingProducts({allBodies:true,ignoreAttribute:true}):activeProducts;
  renderGraph(graphProducts,featured);
}

async function openProduct(id) {
  const card=productLookup.get(id);if(!card)return;
  if(card.body!==state.body) {state.body=card.body;state.attribute=null;state.overview=false;render();}
  state.selected=id;renderGraph(state.overview?matchingProducts({allBodies:true,ignoreAttribute:true}):activeProducts,topFive(activeProducts));
  const sequence=++detailSequence;
  q("#recommendation-panel").hidden=true;q("#detail-panel").hidden=false;
  q("#detail-panel").innerHTML='<p class="detail-footnote">상품과 연결된 근거를 읽고 있어요…</p>';
  try {
    const endpoint=staticData?"./data/products/"+encodeURIComponent(id.replace(":","-"))+".json":"/api/product?id="+encodeURIComponent(id);
    const response=await fetch(endpoint);if(!response.ok)throw new Error("연결 근거를 불러오지 못했어요.");
    const detail=await response.json();if(sequence!==detailSequence)return;
    const p=detail.product,a=detail.assignment,b=model.bodies[a.body];
    const paths=detail.paths.slice(0,4);
    const max=Math.max(1,...Object.values(a.scores).map(Math.abs));
    q("#detail-panel").innerHTML=`<button class="detail-back" data-detail-back>← Top 5로 돌아가기</button>${p.image?`<img class="detail-photo" src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}">`:""}<p class="detail-retailer">${escapeHtml(p.retailer_label)} · ${escapeHtml(p.brand)}</p><h2 class="detail-name">${escapeHtml(p.name)}</h2><span class="detail-body-tag">가까운 스타일 · ${b.label}</span>${p.multi_option?'<p class="detail-footnote">여러 소매·색상 옵션이 한 상품에 함께 있어요. 대표사진과 원하는 옵션이 같은지 판매 페이지에서 확인해주세요.</p>':""}<p class="detail-price">${p.price!=null?Number(p.price).toLocaleString("ko-KR")+'<small>원부터</small>':"가격 미확인"}</p><p class="detail-source-note">${escapeHtml(p.source_note)}</p><a class="shop-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">판매 페이지에서 자세히 보기 ↗</a><h3 class="connection-title">이 상품이 연결된 이유 <span>${detail.paths.length}개의 단서</span></h3>${paths.length?paths.map(path=>{
      const e=path.evidence[0],inferred=e.basis!=="observed";
      const quote=e.basis==="image_proposal"?`대표사진에서 ‘${path.attribute.label}’ 단서를 확인한 임시 제안입니다.`:e.quote || e.matched_text;
      return `<div class="connection-path"><div class="path-pills"><span>${b.label}</span><i>→</i><span>${escapeHtml(path.attribute.label)}</span><i>←</i><span>이 상품</span></div><p>${escapeHtml(path.reason)}</p><blockquote>${escapeHtml(quote)}</blockquote><p class="basis-tag">${inferred?(e.basis==="image_proposal"?"사진 검토 · 추정 단서":"판매자 용어 해석 · 추정 단서"):"상품 원문에서 확인"} · 연결 가중치 ${path.weight.toFixed(2)}</p></div>`;
    }).join(""):`<div class="connection-path"><p>직접 연결할 스타일 속성이 부족해 품목의 보조값으로 가장 가까운 체형을 제안했어요.</p><p class="basis-tag">${escapeHtml(a.priors.filter(pr=>pr.body===a.body).map(pr=>pr.reason).join(" · "))}</p></div>`}<div class="score-comparison"><h4>세 가지 체형과의 연결 비교</h4>${Object.entries(model.bodies).map(([key,body])=>`<div class="score-row"><span>${body.label}</span><span class="score-track"><i style="--bar-color:${body.color};width:${Math.max(0,a.scores[key])/max*100}%"></i></span><span>${a.scores[key].toFixed(1)}</span></div>`).join("")}</div><p class="detail-footnote">${escapeHtml(detail.classification_note)}${a.strength!=="attribute_supported"?" 여러 체형의 점수가 가깝거나 보조 단서의 비중이 큰 상품입니다.":""}</p>`;
    if(paths[0])q("#active-path").innerHTML=`<span>${b.label}</span><i>→</i><span>${escapeHtml(paths[0].attribute.label)}</span><i>←</i><span>선택한 상품</span>`;
    if(innerWidth<980)q(".results-panel").scrollIntoView({behavior:matchMedia("(prefers-reduced-motion:reduce)").matches?"instant":"smooth",block:"start"});
  } catch(error) {if(sequence===detailSequence)q("#detail-panel").innerHTML=`<button class="detail-back" data-detail-back>← Top 5로</button><p class="detail-footnote">${escapeHtml(error.message)}</p>`;}
}

function resetView() {state.zoom=1;state.panX=0;state.panY=0;updateView();}
function updateView() {q("#viewport").setAttribute("transform",`translate(${state.panX} ${state.panY}) translate(460 360) scale(${state.zoom}) translate(-460 -360)`);}
function zoomBy(factor) {state.zoom=Math.min(2.8,Math.max(.6,state.zoom*factor));updateView();}
function resetFilters() {
  Object.assign(state,{sleeve:"any",garment:"any",season:"any",query:"",attribute:null,imageOnly:true,seasonHints:true});
  for(const id of ["sleeve","garment","season"])q("#"+id).value="any";
  q("#search").value="";q("#image-only").checked=true;q("#season-hints").checked=true;clearDetail();resetView();render();
}
function showClassifications() {
  const hasNew=model.products.some(p=>p.is_additional);
  const products=model.products.filter(p=>hasNew?p.is_additional:p.retailer==="zigzag").sort((a,b)=>a.retailer.localeCompare(b.retailer)||a.collection_rank-b.collection_rank);
  q("#classification-counts").innerHTML=Object.entries(model.bodies).map(([key,b])=>`<button data-classification-body="${key}" style="color:${b.color}"><span>${b.label}<small>${b.english}</small></span><strong>${products.filter(p=>p.body===key).length}</strong></button>`).join("");
  q("#classification-table").innerHTML=products.map(p=>{
    const b=model.bodies[p.body],strength={attribute_supported:"속성 연결",close_alternatives:"근접 후보 비교",weak_prior_only:"품목 보조 분류"}[p.strength];
    return `<tr><td><button class="classification-product" data-classification-product="${escapeHtml(p.id)}">${p.image?`<img src="${escapeHtml(p.image)}" alt="" loading="lazy">`:""}<span>${escapeHtml(p.retailer_label)} ${String(p.collection_rank).padStart(3,"0")} · ${escapeHtml(p.name)}</span></button></td><td><span class="classification-body" style="color:${b.color};background:${b.color}12">${b.label}</span></td><td class="classification-strength">${strength}</td></tr>`;
  }).join("");
  q("#classification-modal").showModal();
}

document.addEventListener("click",event=>{
  const body=event.target.closest("[data-body]");if(body){chooseBody(body.dataset.body);return;}
  const attr=event.target.closest("[data-attribute]");if(attr){if(state.overview){state.body=attr.dataset.attributeBody;state.overview=false;resetView();}chooseAttribute(attr.dataset.attribute);return;}
  const product=event.target.closest("[data-product]");if(product){openProduct(product.dataset.product);return;}
  if(event.target.closest("[data-detail-back]")){clearDetail();render();return;}
  const classification=event.target.closest("[data-classification-product]");
  if(classification){q("#classification-modal").close();const p=productLookup.get(classification.dataset.classificationProduct);state.retailer=p.retailer;q("#retailer").value=p.retailer;state.additionalOnly=!!p.is_additional;q("#additional-only").checked=state.additionalOnly;resetFilters();chooseBody(p.body);openProduct(p.id);return;}
  const cb=event.target.closest("[data-classification-body]");if(cb){q("#classification-modal").close();state.retailer=model.products.some(p=>p.is_additional)?"all":"zigzag";q("#retailer").value=state.retailer;state.additionalOnly=model.products.some(p=>p.is_additional);q("#additional-only").checked=state.additionalOnly;resetFilters();chooseBody(cb.dataset.classificationBody);return;}
});
q("#map").addEventListener("keydown",e=>{if(["Enter"," "].includes(e.key)&&e.target.matches("[role=button]")){e.preventDefault();e.target.dispatchEvent(new MouseEvent("click",{bubbles:true}));}});
q("#selected-attribute button").addEventListener("click",()=>chooseAttribute(state.attribute));
q("#overview-toggle").addEventListener("click",()=>{state.overview=!state.overview;state.attribute=null;clearDetail();resetView();render();});
q("#reset-filters").addEventListener("click",resetFilters);q("#empty-reset").addEventListener("click",resetFilters);
q("#zoom-in").addEventListener("click",()=>zoomBy(1.18));q("#zoom-out").addEventListener("click",()=>zoomBy(1/1.18));q("#zoom-reset").addEventListener("click",resetView);
for(const id of ["retailer","sleeve","garment","season"])q("#"+id).addEventListener("change",e=>{state[id]=e.target.value;state.attribute=null;clearDetail();resetView();render();});
q("#image-only").addEventListener("change",e=>{state.imageOnly=e.target.checked;clearDetail();render();});
q("#additional-only").addEventListener("change",e=>{state.additionalOnly=e.target.checked;clearDetail();resetView();render();});
q("#season-hints").addEventListener("change",e=>{state.seasonHints=e.target.checked;clearDetail();render();});
let searchTimer;q("#search").addEventListener("input",e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.query=e.target.value.trim();clearDetail();render();},140);});
q("#classification-open").addEventListener("click",()=>model&&showClassifications());q("#about-open").addEventListener("click",()=>q("#about-modal").showModal());
q("#map-nav").addEventListener("click",()=>{clearDetail();resetView();render();});
for(const dialog of document.querySelectorAll("dialog")){dialog.querySelector(".dialog-close").addEventListener("click",()=>dialog.close());dialog.addEventListener("click",e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});}
document.addEventListener("keydown",e=>{if(e.key==="/"&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)){e.preventDefault();q("#search").focus();}if(e.key==="Escape"&&state.selected&&!document.querySelector("dialog[open]")){clearDetail();render();}});

let drag=null;
q("#map").addEventListener("pointerdown",e=>{if(e.target.closest(".graph-node"))return;drag={x:e.clientX,y:e.clientY,panX:state.panX,panY:state.panY};q("#map").setPointerCapture(e.pointerId);q("#map").classList.add("dragging");q("#map-tooltip").hidden=true;});
q("#map").addEventListener("pointermove",e=>{
  if(drag){const rect=q("#map").getBoundingClientRect(),box=q("#map").viewBox.baseVal,scale=Math.min(rect.width/box.width,rect.height/box.height);state.panX=drag.panX+(e.clientX-drag.x)/scale;state.panY=drag.panY+(e.clientY-drag.y)/scale;updateView();return;}
  const target=e.target.closest("[data-product]");if(!target){q("#map-tooltip").hidden=true;return;}
  const product=productLookup.get(target.dataset.product);if(!product)return;
  const rect=q("#map-stage").getBoundingClientRect(),tip=q("#map-tooltip");tip.innerHTML=`<small>${escapeHtml(product.retailer_label)} · ${model.bodies[product.body].label}</small>${escapeHtml(product.name)}`;tip.hidden=false;tip.style.left=Math.min(rect.width-245,Math.max(8,e.clientX-rect.left+12))+"px";tip.style.top=Math.min(rect.height-90,Math.max(8,e.clientY-rect.top+14))+"px";
});
for(const name of ["pointerup","pointercancel"])q("#map").addEventListener(name,()=>{drag=null;q("#map").classList.remove("dragging");});
q("#map").addEventListener("pointerleave",()=>{q("#map-tooltip").hidden=true;});
q("#map").addEventListener("wheel",e=>{e.preventDefault();zoomBy(e.deltaY>0?.92:1.08);},{passive:false});
let resizeTimer;window.addEventListener("resize",()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(model)render();},80);});

async function initialize() {
  try {
    const response=await fetch(staticData?"./data/atlas.json":"/api/atlas");if(!response.ok)throw new Error("스타일 맵 데이터를 불러오지 못했어요.");
    model=await response.json();for(const product of model.products)productLookup.set(product.id,product);
    const newCount=model.products.filter(p=>p.is_additional).length;
    q("#additional-filter").hidden=!newCount;q("#additional-label").textContent=`새로 수집한 ${newCount}개만`;
    if(newCount){state.additionalOnly=true;state.retailer="all";q("#additional-only").checked=true;}
    const classificationCount=newCount||model.products.filter(p=>p.retailer==="zigzag").length;
    q("#classification-badge").textContent=classificationCount;
    q("#classification-title").textContent=`${classificationCount}벌을 세 가지 스타일로.`;
    q("#classification-eyebrow").textContent=newCount?"NEW COLLECTION / MUSINSA + ZIGZAG":"COLLECTION / ZIGZAG";
    q("#classification-csv").download=newCount?"additional-tops-body-classifications.csv":"zigzag-body-classifications.csv";
    q("#total-products").textContent=model.stats.products.toLocaleString("ko-KR");
    const options=(rows)=>rows.map(([value,label])=>`<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
    q("#sleeve").insertAdjacentHTML("beforeend",options(Object.entries(model.sleeves)));
    q("#garment").insertAdjacentHTML("beforeend",options(Object.entries(model.types)));
    q("#season").insertAdjacentHTML("beforeend",options(Object.entries(model.seasons)));
    q("#retailer").innerHTML=`<option value="zigzag">지그재그 · ${model.sources.find(s=>s.id==="zigzag").count}개</option><option value="all">전체 컬렉션 · ${model.stats.products}개</option>`+model.sources.filter(s=>s.id!=="zigzag").map(s=>`<option value="${s.id}">${s.label} · ${s.count}개</option>`).join("");
    q("#retailer").value=state.retailer;
    q("#loading").hidden=true;q("#workspace").hidden=false;render();
  } catch(error) {q("#loading").hidden=true;q("#load-error").hidden=false;q("#load-error").textContent=error.message;}
}
globalThis.AtlasApp={getState:()=>({...state}),getData:()=>model,matchingProducts,topFive,chooseBody,chooseAttribute,openProduct,resetFilters,render};
initialize();
