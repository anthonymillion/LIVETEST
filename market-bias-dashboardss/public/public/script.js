const POLL_MS = 15000; // 15s auto-refresh

const $ = (s, r=document)=>r.querySelector(s);
const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
const ts = ()=> new Date().toLocaleString();

function setMeter(el,score){
  const pct=((clamp(score,-1,1)+1)/2*100).toFixed(1);
  el.style.width=pct+"%";
  el.parentElement.style.outline=`1px solid ${score>0? "#21c27755" : score<0? "#ff5a7655":"#ffcc6655"}`;
}
function rowKV(k,v,cls=""){
  const d=document.createElement("div");
  d.innerHTML=`<span class="muted">${k}</span><span class="${cls}">${v}</span>`;
  return d;
}
function fmtDelta(n){
  if(n==null || Number.isNaN(n)) return "—";
  const up = n >= 0;
  return `${up?"↑":"↓"} ${up?"+":""}${Number(n).toLocaleString()}`;
}
function pct(n,dp=2){ return (Number(n)||0).toFixed(dp)+"%"; }
function labelFromScore(s){ return s>0.25?"Bullish": s<-0.25?"Bearish":"Neutral"; }

async function load() {
  try {
    $("#liveDot").classList.remove("live");
    const res = await fetch("/api/data", { cache: "no-store" });
    if(!res.ok){ throw new Error("Backend error"); }
    const d = await res.json();

    /* GOLD - COT */
    try {
      const c = d.gold.cot;
      const kv=$("#cotGold"); kv.innerHTML="";
      kv.append(rowKV("Non‑Comm Long Δ", fmtDelta(c.weeklyDelta?.nonCommercial?.long), c.weeklyDelta?.nonCommercial?.long>=0?"up":"down"));
      kv.append(rowKV("Non‑Comm Short Δ", fmtDelta(c.weeklyDelta?.nonCommercial?.short), c.weeklyDelta?.nonCommercial?.short<=0?"up":"down"));
      kv.append(rowKV("Open Interest Δ", fmtDelta(c.weeklyDelta?.openInterestAll)));
      $("#cotGoldSrc").textContent = `Source: Quandl • ${c.date || ""} • ${c.sentiment || ""}`;
      setMeter($("#cotGoldMeter"), c.biasScore || 0);
    } catch { $("#cotGold").innerHTML = `<div class="muted">COT unavailable.</div>`; setMeter($("#cotGoldMeter"),0); }

    /* GOLD - Options */
    try {
      const o = d.gold.options;
      const kv=$("#optGold"); kv.innerHTML="";
      kv.append(rowKV("Calls", Number(o.calls||0).toLocaleString()));
      kv.append(rowKV("Puts",  Number(o.puts ||0).toLocaleString()));
      if(o.callInflow!=null || o.putInflow!=null){
        kv.append(rowKV("Inflow (est.)", `${(o.callInflow||0).toLocaleString()} / ${(o.putInflow||0).toLocaleString()}`));
      }
      $("#optGoldSrc").textContent = `Source: ${o.src}`;
      setMeter($("#optGoldMeter"), o.biasScore || 0);
    } catch { $("#optGold").innerHTML = `<div class="muted">Options flow unavailable.</div>`; setMeter($("#optGoldMeter"),0); }

    /* GOLD - Macro Overlay */
    try {
      const m = d.gold.macro;
      const inputs = d.macroInputs || {};
      const kv=$("#macroGoldKV"); kv.innerHTML="";
      kv.append(rowKV("DXY Δ%", inputs.dxy?.changePct!=null ? pct(inputs.dxy.changePct) : "—", (inputs.dxy?.changePct ?? 0) < 0 ? "up":"down"));
      kv.append(rowKV("US10Y", inputs.us10y?.value!=null ? (inputs.us10y.value.toFixed(3)+"%") : "—", (inputs.us10y?.value ?? 0) < 4 ? "up":"down"));
      kv.append(rowKV("VIX Δ%", inputs.vix?.changePct!=null ? pct(inputs.vix.changePct) : "—", (inputs.vix?.changePct ?? 0) > 0 ? "down":""));
      $("#macroGoldSrc").textContent = `Overlay: uses DXY (TwelveData), US10Y (AlphaVantage), VIX (FMP)`;
      setMeter($("#macroGoldMeter"), m.score || 0);
    } catch { $("#macroGoldKV").innerHTML = `<div class="muted">Macro overlay unavailable.</div>`; setMeter($("#macroGoldMeter"),0); }

    /* GOLD - Final */
    const gScore = d.gold.score || 0;
    $("#goldScoreLbl").textContent = `${labelFromScore(gScore)} (${gScore.toFixed(2)})`;
    setMeter($("#goldScoreMeter"), gScore);
    $("#goldUpdated").textContent = ts();

    /* NDX - COT */
    try {
      const c = d.ndx.cot;
      const kv=$("#cotNdx"); kv.innerHTML="";
      kv.append(rowKV("Non‑Comm Long Δ", fmtDelta(c.weeklyDelta?.nonCommercial?.long), c.weeklyDelta?.nonCommercial?.long>=0?"up":"down"));
      kv.append(rowKV("Non‑Comm Short Δ", fmtDelta(c.weeklyDelta?.nonCommercial?.short), c.weeklyDelta?.nonCommercial?.short<=0?"up":"down"));
      kv.append(rowKV("Open Interest Δ", fmtDelta(c.weeklyDelta?.openInterestAll)));
      $("#cotNdxSrc").textContent = `Source: Quandl • ${c.date || ""} • ${c.sentiment || ""}`;
      setMeter($("#cotNdxMeter"), c.biasScore || 0);
    } catch { $("#cotNdx").innerHTML = `<div class="muted">COT unavailable.</div>`; setMeter($("#cotNdxMeter"),0); }

    /* NDX - Options */
    try {
      const o = d.ndx.options;
      const kv=$("#optNdx"); kv.innerHTML="";
      kv.append(rowKV("Calls", Number(o.calls||0).toLocaleString()));
      kv.append(rowKV("Puts",  Number(o.puts ||0).toLocaleString()));
      if(o.callInflow!=null || o.putInflow!=null){
        kv.append(rowKV("Inflow (est.)", `${(o.callInflow||0).toLocaleString()} / ${(o.putInflow||0).toLocaleString()}`));
      }
      $("#optNdxSrc").textContent = `Source: ${o.src}`;
      setMeter($("#optNdxMeter"), o.biasScore || 0);
    } catch { $("#optNdx").innerHTML = `<div class="muted">Options flow unavailable.</div>`; setMeter($("#optNdxMeter"),0); }

    /* NDX - Breadth */
    try {
      const b = d.ndx.breadth;
      const kv=$("#breadthKV"); kv.innerHTML="";
      kv.append(rowKV("Advancers", b.adv));
      kv.append(rowKV("Decliners", b.dec));
      kv.append(rowKV("Unchanged", b.unch));
      kv.append(rowKV("Avg % Change", (b.avgChangePct||0).toFixed(2)+"%"));
      $("#breadthSrc").textContent = `Source: ${b.src} • n=${b.count}`;
      setMeter($("#breadthMeter"), b.biasScore || 0);
    } catch { $("#breadthKV").innerHTML = `<div class="muted">Breadth unavailable.</div>`; setMeter($("#breadthMeter"),0); }

    /* NDX - Macro Overlay */
    try {
      const m = d.ndx.macro;
      const inputs = d.macroInputs || {};
      const kv=$("#macroNdxKV"); kv.innerHTML="";
      kv.append(rowKV("DXY Δ%", inputs.dxy?.changePct!=null ? pct(inputs.dxy.changePct) : "—", (inputs.dxy?.changePct ?? 0) < 0 ? "up":"down"));
      kv.append(rowKV("US10Y", inputs.us10y?.value!=null ? (inputs.us10y.value.toFixed(3)+"%") : "—", (inputs.us10y?.value ?? 0) < 4.2 ? "up":"down"));
      kv.append(rowKV("VIX Δ%", inputs.vix?.changePct!=null ? pct(inputs.vix.changePct) : "—", (inputs.vix?.changePct ?? 0) < 0 ? "up":"down"));
      $("#macroNdxSrc").textContent = `Overlay: uses DXY (TwelveData), US10Y (AlphaVantage), VIX (FMP)`;
      setMeter($("#macroNdxMeter"), m.score || 0);
    } catch { $("#macroNdxKV").innerHTML = `<div class="muted">Macro overlay unavailable.</div>`; setMeter($("#macroNdxMeter"),0); }

    /* NDX - Final */
    const nScore = d.ndx.score || 0;
    $("#ndxScoreLbl").textContent = `${labelFromScore(nScore)} (${nScore.toFixed(2)})`;
    setMeter($("#ndxScoreMeter"), nScore);
    $("#ndxUpdated").textContent = ts();

    /* Calendar */
    try {
      const cal = d.calendar;
      const list=$("#calendarList"); list.innerHTML="";
      (cal.items||[]).slice(0,20).forEach(ev=>{
        const row=document.createElement("div"); row.className="row";
        const dt=new Date(ev.time||Date.now()).toLocaleString();
        row.innerHTML=`<div><strong>${ev.title}</strong><div class="muted">${ev.country||"Global"} • ${dt}</div></div>
                       <div>${ev.actual??"—"} <span class="muted">(fc ${ev.forecast??"—"} / prev ${ev.previous??"—"})</span></div>`;
        list.append(row);
      });
      $("#calSrc").textContent = `Source: ${cal.src}`;
    } catch {
      $("#calendarList").innerHTML = `<div class="muted">No calendar data.</div>`;
      $("#calSrc").textContent = "Source: (error)";
    }

    /* News */
    try {
      const news = d.news;
      const list=$("#newsList"); list.innerHTML="";
      (news.items||[]).slice(0,20).forEach(n=>{
        const row=document.createElement("div"); row.className="row";
        row.innerHTML = `<div><a href="${n.url}" target="_blank" rel="noopener">${n.title}</a>
                          <div class="muted">${n.source||"—"} • ${new Date(n.time||Date.now()).toLocaleString()}</div></div><div></div>`;
        list.append(row);
      });
      $("#newsSrc").textContent = `Source: ${news.src}`;
    } catch {
      $("#newsList").innerHTML = `<div class="muted">No news available.</div>`;
      $("#newsSrc").textContent = "Source: (error)";
    }

    $("#lastUpdated").textContent = "Updated " + ts();
    $("#liveDot").classList.add("live");
  } catch (err) {
    console.error("Load error:", err);
    $("#lastUpdated").textContent = "Backend error — check server console";
  }
}

load();
setInterval(load, POLL_MS);
