"use strict";(()=>{var L="https://api.seerum.ai",P=`${L}/match`,N=`${L}/prices`,H=10,k=500,I=5e3,U=15,w=30,C="https://api.seerum.ai",h="seerum_access",M=24*60*60*1e3,b="seerum_match_stats",y="seerum_paused";function D(e,t,n){let s=e.querySelector(".predict-market-bar");if(s){let l=parseFloat(s.dataset.confidence||"0");if(t.confidence<=l)return;s.remove()}if(t.markets.length===0){let l=document.createElement("div");l.className="predict-market-bar predict-loading",l.dataset.confidence=String(t.confidence),l.innerHTML=`
      <div class="predict-bar-collapsed">
        <span class="predict-dot">\u25CF</span>
        <span class="predict-market-title">Finding market...</span>
      </div>
    `,O(e,l);return}let r=t.markets[0],i=t.markets.length===1,o=r.eventTitle||r.title,d=r.closeTime?Q(r.closeTime):null,a=r.volume?Z(r.volume):null,u=[];a&&u.push(`Vol: ${a}`),d&&u.push(d);let c=document.createElement("div");c.className="predict-market-bar",c.dataset.confidence=String(t.confidence),c.dataset.expanded="false",c.dataset.marketIds=t.markets.map(l=>l.marketId).join(","),i?c.innerHTML=K(r,o,u):c.innerHTML=J(t.markets,o,u,t.totalMarkets),c.addEventListener("click",l=>l.stopPropagation()),c.querySelector(".predict-bar-collapsed").addEventListener("click",l=>{l.preventDefault();let f=c.querySelector(".predict-bar-expanded"),g=c.querySelector(".predict-expand-arrow");if(c.dataset.expanded==="true")f.style.display="none",g.textContent="\u25B2",c.dataset.expanded="false";else{f.style.display="block",g.textContent="\u25BC",c.dataset.expanded="true";let R=parseInt(c.dataset.pricesAt||"0",10);Date.now()-R>1e4&&j(c,i,n)}}),O(e,c)}async function j(e,t,n){let s=(e.dataset.marketIds||"").split(",").filter(Boolean);if(s.length===0)return;let r=await n.fetchPrices(s);if(e.dataset.pricesAt=String(Date.now()),Object.keys(r).length!==0)if(t){let i=s[0],o=r[i];o&&V(e,o)}else for(let i of s){let o=r[i];o&&G(e,i,o)}}function V(e,t){let n=p(t.buyYesPriceUsd),s=p(t.buyNoPriceUsd),r=v(t.buyYesPriceUsd,t.buyNoPriceUsd),i=e.querySelector(".predict-yes"),o=e.querySelector(".predict-no");i&&r&&(i.textContent=`YES ${r.yes}%`,m(i)),o&&r&&(o.textContent=`NO ${r.no}%`,m(o));let d=e.querySelector(".predict-buy-yes span"),a=e.querySelector(".predict-buy-no span");d&&n!==null&&(d.textContent=`${n}\xA2`,m(d)),a&&s!==null&&(a.textContent=`${s}\xA2`,m(a))}function G(e,t,n){let s=e.querySelector(`.predict-outcome-row[data-market-id="${t}"]`);if(!s)return;let r=p(n.buyYesPriceUsd),i=p(n.buyNoPriceUsd),o=v(n.buyYesPriceUsd,n.buyNoPriceUsd),d=s.querySelector(".predict-outcome-pct");d&&o&&(d.textContent=`${o.yes}%`,m(d));let a=s.querySelector(".predict-pill-yes");a&&r!==null&&(a.textContent=`Yes ${r}\xA2`,m(a));let u=s.querySelector(".predict-pill-no");u&&i!==null&&(u.textContent=`No ${i}\xA2`,m(u))}function m(e){e.classList.remove("predict-price-updated"),e.offsetWidth,e.classList.add("predict-price-updated"),setTimeout(()=>e.classList.remove("predict-price-updated"),600)}function K(e,t,n){let s=p(e.buyYesPriceUsd),r=p(e.buyNoPriceUsd),i=v(e.buyYesPriceUsd,e.buyNoPriceUsd),o=`${C}/api/actions/trade/${e.marketId}`,d=`https://dial.to/?action=solana-action:${encodeURIComponent(o+"?amount=2000000&side=yes")}`,a=`https://dial.to/?action=solana-action:${encodeURIComponent(o+"?amount=2000000&side=no")}`;return`
    <div class="predict-bar-collapsed">
      <span class="predict-dot">\u25CF</span>
      <span class="predict-market-title">${T(t)}</span>
      <span class="predict-prices">
        ${i?`<span class="predict-yes">YES ${i.yes}%</span>`:""}
        ${i?`<span class="predict-no">NO ${i.no}%</span>`:""}
      </span>
      <span class="predict-expand-arrow">\u25B2</span>
    </div>
    <div class="predict-bar-expanded" style="display:none">
      <div class="predict-expanded-header">
        <div class="predict-expanded-title-group">
          <span class="predict-expanded-title">${T(t)}</span>
        </div>
      </div>
      <div class="predict-trade-buttons">
        <a class="predict-buy-yes" href="${d}" target="_blank" rel="noopener noreferrer">
          Buy YES <span>${s!==null?`${s}\xA2`:""}</span>
        </a>
        <a class="predict-buy-no" href="${a}" target="_blank" rel="noopener noreferrer">
          Buy NO <span>${r!==null?`${r}\xA2`:""}</span>
        </a>
      </div>
      ${B(n)}
    </div>
  `}function J(e,t,n,s){let r=e.map(a=>{let u=p(a.buyYesPriceUsd),c=p(a.buyNoPriceUsd),x=v(a.buyYesPriceUsd,a.buyNoPriceUsd),l=x?`${x.yes}%`:"",f=`${C}/api/actions/trade/${a.marketId}`,g=`https://dial.to/?action=solana-action:${encodeURIComponent(f+"?amount=2000000&side=yes")}`,$=`https://dial.to/?action=solana-action:${encodeURIComponent(f+"?amount=2000000&side=no")}`;return`
      <div class="predict-outcome-row" data-market-id="${a.marketId}">
        <span class="predict-outcome-name">${T(a.title)}</span>
        <span class="predict-outcome-pct">${l}</span>
        <div class="predict-outcome-actions">
          <a class="predict-pill-yes" href="${g}" target="_blank" rel="noopener noreferrer">
            Yes ${u!==null?`${u}\xA2`:""}
          </a>
          ${c!==null?`<a class="predict-pill-no" href="${$}" target="_blank" rel="noopener noreferrer">
            No ${c}\xA2
          </a>`:""}
        </div>
      </div>
    `}).join(""),i=s??e.length,o=i-e.length,d=o>0?`<div class="predict-outcome-row predict-outcome-more"><span class="predict-outcome-name">+${o} more outcome${o>1?"s":""}</span></div>`:"";return`
    <div class="predict-bar-collapsed">
      <span class="predict-dot">\u25CF</span>
      <span class="predict-market-title">${T(t)}</span>
      <span class="predict-outcome-count">${i} outcomes</span>
      <span class="predict-expand-arrow">\u25B2</span>
    </div>
    <div class="predict-bar-expanded" style="display:none">
      <div class="predict-expanded-header">
        <div class="predict-expanded-title-group">
          <span class="predict-expanded-title">${T(t)}</span>
        </div>
      </div>
      <div class="predict-outcome-list">
        ${r}
        ${d}
      </div>
      ${B(n)}
    </div>
  `}function B(e){return`
    <div class="predict-footer">
      ${e.length>0?`<span class="predict-meta">${e.join(" \xB7 ")}</span>`:""}
      <a href="https://x.com/seerumai" target="_blank" rel="noopener noreferrer" class="predict-powered-header">
        <svg class="seerum-icon" viewBox="0 0 100 100" width="16" height="16" xmlns="http://www.w3.org/2000/svg">
          <path fill="#FFFF00" d="M96 50 C80 75 55 90 30 90 L20 100 L25 85 C15 75 5 60 5 50 C5 40 15 25 25 15 L20 0 L30 10 C55 10 80 25 96 50 Z" />
          <circle cx="45" cy="50" r="20" fill="#000" />
          <circle cx="50" cy="45" r="5" fill="#FFF" />
        </svg>
        Powered by @seerumAI
      </a>
    </div>
  `}function O(e,t){let n=e.isConnected?e:W(e);if(!n)return;let s=n.querySelector('[data-testid="tweetText"]');if(s?.parentElement){s.parentElement.insertAdjacentElement("afterend",t);return}n.appendChild(t)}function W(e){let t=e.querySelector('[data-testid="tweetText"]')?.textContent?.trim();if(!t)return null;let n=document.querySelectorAll('article[data-testid="tweet"]');for(let s of n)if(s.querySelector('[data-testid="tweetText"]')?.textContent?.trim()===t)return s;return null}function T(e){let t=document.createElement("div");return t.textContent=e,t.innerHTML}function p(e){if(e==null||e===0)return null;let t=Math.round(e/1e4);return t<=0?"<1":String(t)}function v(e,t){if(!e||!t)return null;let n=Math.round(e/(e+t)*100),s=100-n;return{yes:String(n),no:String(s)}}function Z(e){return e>=1e6?`$${(e/1e6).toFixed(1)}M`:e>=1e3?`$${(e/1e3).toFixed(1)}K`:`$${e}`}function Q(e){let t=new Date(e*1e3),n=new Date,s=t.getTime()-n.getTime();if(s<0)return"Closed";let r=Math.floor(s/(1e3*60*60*24));if(r<=1){let o=Math.floor(s/36e5);return o<=1?"Closes <1h":`Closes in ${o}h`}return r<=30?`Closes in ${r}d`:`Closes ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][t.getMonth()]} ${t.getFullYear()}`}var E=class{queue=[];processed=new Set;visibleTweets=new Set;scrollTimer=null;intersectionObserver;apiClient;paused=!1;constructor(t){this.apiClient=t,chrome.storage.local.get(y,n=>{this.paused=n[y]===!0}),chrome.storage.onChanged.addListener((n,s)=>{s==="local"&&n[y]&&(this.paused=n[y].newValue===!0)}),this.intersectionObserver=new IntersectionObserver(n=>{for(let s of n){let r=s.target.dataset.predictId;r&&(s.isIntersecting?this.visibleTweets.add(r):this.visibleTweets.delete(r))}},{threshold:.3}),window.addEventListener("scroll",()=>this.onScroll(),{passive:!0})}addTweet(t,n,s){this.processed.has(t)||(s.dataset.predictId=t,this.intersectionObserver.observe(s),this.queue.push({id:t,text:n,element:s,addedAt:Date.now()}),this.queue.length>=H&&this.flush())}onScroll(){this.scrollTimer&&clearTimeout(this.scrollTimer),this.scrollTimer=setTimeout(()=>this.flush(),k)}async flush(){if(this.paused||this.queue.length===0)return;let t=Date.now(),n=this.queue.filter(r=>!this.processed.has(r.id)&&(this.visibleTweets.has(r.id)||t-r.addedAt<I)).slice(0,U);for(let r of n)this.processed.add(r.id);if(this.queue=this.queue.filter(r=>!this.processed.has(r.id)),n.length===0)return;let s=await this.apiClient.match(n.map(r=>({id:r.id,text:r.text})));for(let r of s.matches){let i=n.find(o=>o.id===r.id);i&&r.markets.length>0&&(D(i.element,r,this.apiClient),this.recordMatch(i.text,r.markets[0]))}}recordMatch(t,n){let s=new Date().toISOString().slice(0,10);chrome.storage.local.get(b,r=>{let i=r[b]||{},d=(i.matchedDate||"")===s?(i.matchedToday||0)+1:1;chrome.storage.local.set({[b]:{matchedToday:d,matchedDate:s,lastMatch:{tweetText:t.slice(0,200),marketTitle:n.eventTitle||n.title,marketId:n.marketId,buyYesPriceUsd:n.buyYesPriceUsd,buyNoPriceUsd:n.buyNoPriceUsd,matchedAt:Date.now()}}})})}};var S=class{async match(t){try{let n=await fetch(P,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tweets:t})});return n.ok?await n.json():(console.warn(`[Predict] Backend returned ${n.status}`),{matches:[],latencyMs:0})}catch(n){return console.warn("[Predict] Backend unreachable:",n),{matches:[],latencyMs:0}}}async fetchPrices(t){try{let n=await fetch(N,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({marketIds:t})});return n.ok?(await n.json()).prices??{}:{}}catch{return{}}}};var F=new Set;function _(e){document.querySelectorAll('article[data-testid="tweet"]').forEach(s=>A(s,e)),new MutationObserver(s=>{for(let r of s)for(let i of r.addedNodes){if(!(i instanceof HTMLElement))continue;i.matches?.('article[data-testid="tweet"]')&&A(i,e);let o=i.querySelectorAll?.('article[data-testid="tweet"]');o&&o.forEach(d=>A(d,e))}}).observe(document.body,{childList:!0,subtree:!0})}function A(e,t){let n=e.querySelector('[data-testid="tweetText"]');if(!n)return;let s=n.textContent||"";if(s.length<w)return;let r=s.replace(/https?:\/\/\S+/g,"").replace(/\S+\.\S+\/\S+/g,"").trim();if(r.length<w)return;let i=X(s);F.has(i)||(F.add(i),t.addTweet(i,r,e))}function X(e){let t=0;for(let n=0;n<e.length;n++){let s=e.charCodeAt(n);t=(t<<5)-t+s|0}return`t_${t.toString(36)}`}var q=!1;async function z(){return new Promise(e=>{chrome.storage.local.get(h,t=>{let n=t[h];if(!n||!n.code){e(!1);return}let s=Date.now()-(n.validatedAt||0);e(s<M)})})}function Y(){if(q)return;q=!0;let e=new S,t=new E(e);document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>{_(t)}):_(t)}async function ee(){await z()&&Y()}chrome.storage.onChanged.addListener((e,t)=>{if(t==="local"&&e[h]){let n=e[h].newValue;n?.code&&Date.now()-(n.validatedAt||0)<M&&Y()}});ee();})();
