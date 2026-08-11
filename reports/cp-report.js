(function(){
  const all=window.CP_REPORT_DATA||{};
  const requested=new URLSearchParams(location.search).get("cp")||"LenaMiu";
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const data=all[requested];
  if(!data){
    document.title=`${requested} 暂无报告数据｜ReadAWrite`;
    document.querySelector("main").innerHTML=`<section class="hero compact-hero"><h1 class="report-title"><span class="cp-name">${esc(requested)}</span><small>暂无报告数据</small></h1><p class="lead">当前链接对应的 CP 不在本次报告数据范围内。</p><div class="actions"><a class="button" href="../index.html#focus">返回主看板</a></div></section>`;
    return;
  }
  const fmt=n=>Number(n||0).toLocaleString("zh-CN");
  const maxMonth=Math.max(1,...Object.values(data.months));
  const yearEntries=Object.entries(data.years); const maxYear=Math.max(1,...yearEntries.map(x=>x[1]));
  const monthValues=Array.from({length:8},(_,i)=>data.months[`2026-${String(i+1).padStart(2,"0")}`]||0);
  const monthPoints=monthValues.map((v,i)=>({x:50+i*100,y:142-(v/maxMonth)*94,v,label:`${i+1}月${i===7?'*':''}`}));
  const solidPoints=monthPoints.slice(0,7).map(p=>`${p.x},${p.y}`).join(' ');
  const partialPoints=monthPoints.slice(6).map(p=>`${p.x},${p.y}`).join(' ');
  const months=`<div class="month-chart-wrap"><svg class="month-line-chart" viewBox="0 0 800 198" role="img" aria-label="${esc(data.cp)} 2026 年 1 月至 8 月新增作品走势"><g class="month-grid"><line x1="50" y1="48" x2="750" y2="48"/><line x1="50" y1="95" x2="750" y2="95"/><line x1="50" y1="142" x2="750" y2="142"/></g><polyline class="month-line" points="${solidPoints}"/><polyline class="month-line partial-line" points="${partialPoints}"/>${monthPoints.map((p,i)=>`<g class="month-point ${i===7?'partial-point':''}"><circle cx="${p.x}" cy="${p.y}" r="5"/><text class="month-value" x="${p.x}" y="${Math.max(18,p.y-13)}">${fmt(p.v)}</text><text class="month-label" x="${p.x}" y="177">${p.label}</text></g>`).join('')}</svg></div>`;
  const years=yearEntries.map(([y,v])=>`<article class="year"><i style="--h:${Math.max(2,Math.round(v/maxYear*100))}%"></i><strong>${y}</strong><b>${fmt(v)}</b><span>${y==='2026'?'截至8月10日':'年度新增'}</span></article>`).join("");
  const works=data.works.map(w=>`<a class="work compact-work discovery-work" href="${esc(w.url)}" target="_blank" rel="noopener"><em>${esc(w.label)}</em><h3 title="${esc(w.title)}">${esc(w.title)}</h3><p class="work-author" title="${esc(w.author)}">${esc(w.author)}</p><div class="work-data"><span><b>${fmt(w.likes)}</b> 赞</span><span><b>${fmt(w.views)}</b> 阅读</span></div><div class="work-bottom"><span>${fmt(w.chapters)} 章 · ${w.ended?'已完结':'连载中'}</span><i aria-hidden="true">↗</i></div></a>`).join("")||`<p class="empty-copy">当前数据范围内暂无有效作品。</p>`;
  const authors=data.authorCards.map(a=>{const titles=(a.representativeWorks||[]).map(w=>`<a href="${esc(w.url)}" target="_blank" rel="noopener" title="${esc(w.title)}">“${esc(w.title)}”</a>`).join('<i>·</i>');return `<article class="fact compact-author author-profile"><div class="author-head"><b class="author-name" title="${esc(a.name)}">${esc(a.name)}</b>${titles?`<span class="author-works">${titles}</span>`:''}</div><div class="author-stats"><span><b>${fmt(a.works)}</b>作品</span><span><b>${fmt(a.avgLikes)}</b>篇均赞</span><span><b>${fmt(a.avgViews)}</b>篇均阅读</span></div><div class="author-sparks">${['产出','点赞','阅读'].map((label,i)=>`<span><em>${label}</em><i><b style="width:${a.scores[i]}%"></b></i></span>`).join('')}</div></article>`}).join("")||`<p class="empty-copy">有效作者样本较少，暂不展示作者卡。</p>`;
  const events=data.events.length?data.events.map(e=>`<article class="case"><small>${esc(e.date)} · ${e.type==='broadcast'?'泰国剧播节点':'前置发布节点'}</small><h3>${esc(e.title)}</h3><p>${esc(e.note)}。</p></article>`).join(''):`<article class="pending"><small>剧播参照</small><h3>${esc(data.eventStatus||'暂无已整理的对应节点')}</h3><p>本页仍保留完整创作趋势；未找到可靠日期不代表该 CP 没有合作项目，后续更新时继续核实。</p></article>`;
  document.title=`${data.cp} 创作趋势分析｜ReadAWrite`;
  document.querySelector('meta[name="description"]').content=`${data.cp} ReadAWrite 同人创作趋势分析`;
  document.querySelector("main").innerHTML=`
  <section class="hero compact-hero"><h1 class="report-title"><span class="cp-name" title="${esc(data.cp)}">${esc(data.cp)}</span><small>创作趋势</small></h1><p class="lead">${data.start} - ${data.end} · 首次发布时间</p><div class="kpis"><div class="kpi"><b>${fmt(data.total)}</b><span>累计有效作品</span></div><div class="kpi"><b>${fmt(data.authors)}</b><span>累计创作者</span></div><div class="kpi"><b>${fmt(data.currentYear)}</b><span>2026 年新增</span></div><div class="kpi"><b>${fmt(data.activeMonths)}</b><span>有新作月份</span></div></div></section>
  <section class="section compact-section"><div class="heading compact-heading"><div><span class="kicker">01 · 2026 月度变化</span></div><p>1-7 月走势 · 8 月截至 10 日</p></div>${months}<p class="note">2026 年截至 8 月 10 日共有 ${fmt(data.currentYear)} 篇新作。</p></section>
  <section class="section compact-section"><div class="heading compact-heading"><div><span class="kicker">02 · 剧播参照</span></div><p>按当前 CP 自动匹配</p></div><details class="broadcast-details"><summary><span>${data.events.length?`${data.events.length} 个已整理节点`:esc(data.eventStatus||'暂无已核实节点')}</span><small>查看时间线</small></summary><div class="broadcast">${events}</div><details class="source-note"><summary>来源与时间口径</summary><p>本数据由 AI 自动化检索官方及公开网络信息汇总生成，仅供参考，请以官方最终公布为准；中文剧名采用 B 站主流译名；档期与时间重合仅作关联性观察，不作因果推导。</p></details></details></section>
  <section class="section timeline-section compact-section"><div class="heading compact-heading"><div><span class="kicker">03 · 完整时间轴</span></div><p>年度新增 · 2026 截至 8 月 10 日</p></div><div class="year-grid dynamic-years">${years}</div></section>
  <section class="section compact-section"><div class="heading compact-heading"><div><span class="kicker">04 · 作品发现</span></div><p>${data.start} - ${data.end}</p></div><div class="works">${works}</div></section>
  <section class="section compact-section"><div class="heading compact-heading"><div><span class="kicker">05 · 创作者观察</span></div><p>${data.start} - ${data.end}</p></div><div class="facts author-facts">${authors}</div></section>
  <section class="end"><div class="actions"><a class="button secondary" href="index.html">查看全 CP 报告</a><a class="button" href="../index.html#focus">进入主看板</a></div><p class="method">ReadAWrite 有效作品 · ${data.start} - ${data.end} · 同链接去重 · 抓取时点快照</p><p class="created-by">Created by <strong>Atypical</strong> · With <strong>Codex</strong></p></section>`;
})();
