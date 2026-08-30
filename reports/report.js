(()=>{
  const app=document.getElementById("reportApp");
  const selector=document.getElementById("periodSelect");
  const catalog=Array.isArray(window.FULL_REPORT_CATALOG)?window.FULL_REPORT_CATALOG:[];
  const requested=new URLSearchParams(location.search).get("period");
  const selected=catalog.find(item=>item.slug===requested)||catalog[0];
  const esc=value=>String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
  const fmt=value=>value===null||value===undefined?"—":new Intl.NumberFormat("zh-CN",{maximumFractionDigits:1}).format(value);
  const signed=value=>value===null||value===undefined?"—":`${value>0?"+":""}${fmt(value)}`;
  const pct=value=>value===null||value===undefined?"—":`${value>0?"+":""}${fmt(value)}%`;
  const cpLink=cp=>`cp.html?cp=${encodeURIComponent(cp)}`;

  if(!selected){
    selector.hidden=true;
    app.innerHTML='<section class="loading-card"><h1>暂无半年或年度报告</h1><p>可返回报告目录浏览专题报告。</p><a class="button" href="index.html">返回全部报告</a></section>';
    return;
  }

  selector.innerHTML=catalog.map(item=>`<option value="${esc(item.slug)}"${item.slug===selected.slug?' selected':''}>${esc(item.label)}</option>`).join("");
  selector.addEventListener("change",()=>{location.href=`report.html?period=${encodeURIComponent(selector.value)}`});
  const script=document.createElement("script");
  script.src=`data/report-${encodeURIComponent(selected.slug)}.js${selected.version?`?v=${encodeURIComponent(selected.version)}`:""}`;
  script.onload=()=>render(window.FULL_REPORT_DATA);
  script.onerror=()=>{app.innerHTML='<section class="loading-card"><h1>报告暂时无法加载</h1><p>请刷新重试，或查看其他报告。</p><a class="button" href="index.html">返回全部报告</a></section>'};
  document.head.append(script);

  function changeText(value){
    if(value===null||value===undefined)return "缺少同期数据";
    if(value>0)return `较同期增加 ${fmt(value)}%`;
    if(value<0)return `较同期减少 ${fmt(Math.abs(value))}%`;
    return "与同期持平";
  }

  function renderChangeChart(report){
    const rows=report.cps.filter(row=>row.works>0&&row.previous_works>0);
    if(!rows.length)return '<p class="empty-note">本报告期没有可进行同期比较的 CP。</p>';
    const width=820,height=320,left=62,right=20,top=22,bottom=48;
    const plotWidth=width-left-right,plotHeight=height-top-bottom;
    const rawMax=Math.max(10,...rows.flatMap(row=>[row.works,row.previous_works]));
    const maxValue=[10,25,50,100,250,500,1000,2000,5000,10000].find(value=>value>=rawMax)||rawMax;
    const scale=value=>Math.log1p(Math.max(0,value))/Math.log1p(maxValue);
    const x=value=>left+scale(value)*plotWidth;
    const y=value=>top+(1-scale(value))*plotHeight;
    const maxAuthors=Math.max(1,...rows.map(row=>row.authors));
    const tickPool=[0,10,50,100,250,500,1000,2000,5000,10000];
    const ticks=tickPool.filter(value=>value<=maxValue);
    const grid=ticks.map(value=>`<g class="chart-grid"><line x1="${x(value)}" y1="${top}" x2="${x(value)}" y2="${height-bottom}"></line><line x1="${left}" y1="${y(value)}" x2="${width-right}" y2="${y(value)}"></line><text x="${x(value)}" y="${height-bottom+24}" text-anchor="middle">${fmt(value)}</text><text x="${left-12}" y="${y(value)+4}" text-anchor="end">${fmt(value)}</text></g>`).join("");
    const points=rows.map(row=>{
      const state=row.work_delta>0?"rise":row.work_delta<0?"fall":"steady";
      const radius=3.5+Math.sqrt(row.authors/maxAuthors)*7;
      const aria=`${row.cp}：同期 ${row.previous_works} 篇，本期 ${row.works} 篇，${row.authors} 位作者`;
      return `<g class="chart-point ${state}" role="button" tabindex="0" aria-label="${esc(aria)}" data-cp="${esc(row.cp)}" data-current="${row.works}" data-previous="${row.previous_works}" data-change="${row.work_delta}" data-authors="${row.authors}" data-state="${state}"><circle cx="${x(row.previous_works)}" cy="${y(row.works)}" r="${radius}"><title>${esc(aria)}</title></circle></g>`;
    }).join("");
    return `<div class="change-chart-scroll"><svg class="change-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="changeChartTitle changeChartDesc"><title id="changeChartTitle">CP 本期与去年同期作品量变化图</title><desc id="changeChartDesc">只展示两个时期均有作品的 CP。横轴是去年同期作品数，纵轴是本期作品数；对角线上方表示增加，下方表示减少，圆点大小代表活跃作者数。</desc>${grid}<line class="chart-diagonal" x1="${x(0)}" y1="${y(0)}" x2="${x(maxValue)}" y2="${y(maxValue)}"></line><text class="axis-title axis-x" x="${left+plotWidth/2}" y="${height-7}" text-anchor="middle">去年同期作品数</text><text class="axis-title axis-y" x="17" y="${top+plotHeight/2}" text-anchor="middle" transform="rotate(-90 17 ${top+plotHeight/2})">本期作品数</text>${points}</svg></div><p class="mobile-chart-hint">左右滑动并点击散点</p><div class="chart-selection" id="changeSelection" aria-live="polite" hidden></div>`;
  }

  function render(report){
    if(!report||report.period?.slug!==selected.slug){
      app.innerHTML='<section class="loading-card"><h1>报告暂时无法显示</h1><p>请刷新重试，或查看其他报告。</p><a class="button" href="index.html">返回全部报告</a></section>';
      return;
    }

    document.title=`${report.period.label}全 CP 报告｜ReadAWrite Thai GL`;
    const cpMap=Object.fromEntries(report.cps.map(row=>[row.cp,row]));
    const monthMax=Math.max(...report.months.map(row=>row.works),1);
    const peakMonth=Math.max(...report.months.map(row=>row.works));
    const peakMonthRow=report.months.find(row=>row.works===peakMonth)||report.months[0];
    const peakMonthLabel=peakMonthRow.label.replace(/月$/, " 月");
    const cutoffDay=Number(report.period.cutoff.slice(-2));
    const comparable=report.cps.filter(row=>row.works>0&&row.previous_works>0);
    const rising=comparable.filter(row=>row.work_delta>0).length;
    const falling=comparable.filter(row=>row.work_delta<0).length;
    const withoutBaseline=report.cps.filter(row=>row.works>0&&row.previous_works===0).length;
    const withoutCurrent=report.cps.filter(row=>row.works===0&&row.previous_works>0).length;
    const topFiveWorks=[...report.cps].sort((a,b)=>b.works-a.works).slice(0,5).reduce((sum,row)=>sum+row.works,0);
    const topFiveShare=report.overview.period_works?topFiveWorks*100/report.overview.period_works:0;
    const newEntries=report.dimensions.new_entries||[];
    const hundredPlus=report.cps.filter(row=>row.works>=100);
    const longTail=report.cps.filter(row=>row.works>0&&row.works<100);
    const hundredPlusWorks=hundredPlus.reduce((sum,row)=>sum+row.works,0);
    const hundredPlusShare=report.overview.period_works?hundredPlusWorks*100/report.overview.period_works:0;
    const bandMembers=band=>report.cps.filter(row=>{
      if(band.key==="500+")return row.works>=500;
      if(band.key==="0")return row.works===0;
      const [minimum,maximum]=band.key.split("-").map(Number);
      return row.works>=minimum&&row.works<=maximum;
    });

    const observationDefs=[
      ["scale","创作规模","按报告期作品数排序",row=>`${fmt(row.works)} 篇`],
      ["absolute_growth","同比增量","本期与去年同期均至少 20 篇",row=>`${signed(row.work_delta)} 篇`],
      ["consistency","跨月稳定","最低月作品数 ÷ 月均作品数",row=>`${fmt(row.consistency_score)}%`],
    ];
    const observationCards=observationDefs.map(([key,title,note,value])=>{
      const names=report.dimensions[key]||[];
      return `<article class="observation-card"><header><p>${title}</p><span>${note}</span></header>${names.length?`<ol>${names.map(cp=>{const row=cpMap[cp];return `<li><a href="${cpLink(cp)}"><span>${esc(cp)}</span><b>${value(row)}</b></a></li>`}).join("")}</ol>`:'<p class="empty-note">本期没有达到统一条件的 CP。</p>'}</article>`;
    }).join("");

    const topWork=(label,work,metric)=>`<a class="work-card" href="${esc(work.link)}" target="_blank" rel="noopener"><span>${label}</span><h3 title="${esc(work.title)}">${esc(work.title)}</h3><p>${esc(work.author)} · <b>${esc(work.cp)}</b> · ${esc(work.date)}</p><strong>${metric}</strong><small>${fmt(work.likes)} 赞 · ${fmt(work.views)} 阅读 · ${fmt(work.chapters)} 章</small><em>打开作品 ↗</em></a>`;
    const eventMarkup=()=>report.events.map(event=>`<article class="event-row"><time>${esc(event.date)}</time><div><h3><a href="${cpLink(event.cp)}">${esc(event.cp)}</a> · ${esc(event.title_zh||event.title_original||"未命名事件")}</h3><p>${esc(event.title_original)}${event.note?` · ${esc(event.note)}`:""}</p></div><dl><div><dt>此前 30 日</dt><dd>${fmt(event.before_30d)}</dd></div><div><dt>此后 ${event.after_days} 日</dt><dd>${fmt(event.after_30d)}</dd></div><div><dt>变化</dt><dd>${signed(event.change)}</dd></div></dl></article>`).join("");

    app.innerHTML=`
      <section class="report-hero">
        <div class="hero-copy"><p class="eyebrow">${esc(report.period.label)}</p><h1>泰百同人<br><span>创作报告</span></h1><p>${esc(report.summary[0])}</p></div>
        <div class="hero-period"><span>统计区间</span><b>${esc(report.period.start)} - ${esc(report.period.cutoff)}</b><small>数据最新至 ${esc(report.period.source_latest)}</small></div>
        <div class="overview-grid"><article><b>${fmt(report.overview.period_works)}</b><span>本期新作</span><small>${changeText(report.overview.works_change_pct)}</small></article><article><b>${fmt(report.overview.authors)}</b><span>活跃作者</span><small>${changeText(report.overview.authors_change_pct)}</small></article><article><b>${fmt(report.overview.active_cps)}</b><span>有新作的 CP</span><small>共收录 ${fmt(report.overview.catalog_cps)} 个 CP</small></article><article><b>${fmt(report.overview.corpus_works)}</b><span>期末累计作品</span><small>含报告期之前发布的作品</small></article></div>
      </section>

      <section class="report-section month-section"><div class="section-heading"><div><p class="section-label">月度趋势</p><h2>${esc(peakMonthLabel)}作品量为本期最高</h2></div></div><div class="month-ribbon" style="--month-count:${report.months.length};--mobile-month-count:${Math.min(report.months.length,6)}">${report.months.map(month=>{const partial=!month.complete;const fullLabel=partial?`${month.label} · 至 ${cutoffDay} 日`:month.label;return `<article class="${month.works===peakMonth?'peak ':''}${partial?'partial':''}" title="${esc(fullLabel)}：${fmt(month.works)} 篇"><div class="month-bar-wrap"><i style="height:${Math.max(4,month.works/monthMax*100)}%"></i></div><b>${fmt(month.works)}</b><span>${esc(month.label)}${partial?"*":""}</span></article>`}).join("")}</div>${report.months.some(month=>!month.complete)?`<p class="period-note">* 数据截至 ${cutoffDay} 日，非完整月份。</p>`:""}</section>

      <section class="report-section change-section"><div class="section-heading"><div><p class="section-label">同期变化</p><h2>CP 同期变化</h2></div><p>仅比较两个时期均有作品的 CP；圆点大小为作者数。</p></div><div class="change-layout"><div class="chart-card">${renderChangeChart(report)}<div class="chart-legend"><span class="rise">本期增加</span><span class="fall">本期减少</span><span class="steady">持平</span><i>对角线 = 同期相同 · 坐标经压缩</i></div></div><aside class="change-notes"><dl><div><dt>同期可比</dt><dd><b>${comparable.length}</b> 个 · ${rising} 上升 · ${falling} 回落</dd></div><div><dt>未进入坐标</dt><dd>${withoutBaseline} 无同期 · ${withoutCurrent} 无新作</dd></div><div><dt>前五 CP</dt><dd>占本期 <b>${fmt(topFiveShare)}%</b></dd></div></dl></aside></div></section>

      <section class="report-section observation-section"><div class="section-heading"><div><p class="section-label">活跃方式</p><h2>从三个角度观察 CP</h2></div><p>同一 CP 可能出现在多个维度。</p></div><div class="observation-grid">${observationCards}</div>${newEntries.length?`<div class="new-entry-strip"><span>本期新记录 · 至少 10 篇</span>${newEntries.map(cp=>`<a href="${cpLink(cp)}">${esc(cp)}</a>`).join("")}</div>`:""}</section>

      <section class="report-section"><div class="section-heading"><div><p class="section-label">本期作品</p><h2>单篇作品高点</h2></div></div><div class="work-grid">${topWork("点赞数最高",report.top_works.likes,`${fmt(report.top_works.likes.likes)} 赞`)}${topWork("阅读数最高",report.top_works.views,`${fmt(report.top_works.views.views)} 阅读`)}</div></section>

      <section class="report-section"><div class="section-heading"><div><p class="section-label">整体结构</p><h2>创作集中在哪里</h2></div><p>条形长度 = 本档作品占比</p></div><p class="structure-insight"><strong>${hundredPlus.length} 个 CP</strong> 本期达到 100 篇以上，合计贡献 <strong>${fmt(hundredPlusShare)}%</strong> 的作品；其余 ${longTail.length} 个活跃 CP 合计占 ${fmt(100-hundredPlusShare)}%。</p><div class="band-list">${report.size_bands.map((row,index)=>{const members=bandMembers(row);return `<details class="band-row"><summary><span>${String(index+1).padStart(2,'0')}</span><h3>${esc(row.label)}</h3><div class="band-bar"><i style="width:${row.work_share}%"></i></div><b>${fmt(row.cps)} 个 CP</b><small>${fmt(row.works)} 篇 · ${fmt(row.work_share)}%</small><em>名单</em></summary><div class="band-members">${members.map(member=>`<a href="${cpLink(member.cp)}"><span>${esc(member.cp)}</span><small>${fmt(member.works)} 篇</small></a>`).join("")}</div></details>`}).join("")}</div></section>

      <section class="report-section"><div class="section-heading"><div><p class="section-label">事件对照</p><h2>已核实事件</h2></div><p>事件前后作品量对照，不代表因果。</p></div>${report.events.length?`<details class="event-details" id="eventDetails"><summary><span><b>${report.events.length} 条事件</b><small>前后 30 日作品量</small></span><em>展开</em></summary><div class="event-list" id="eventList"></div></details>`:'<p class="empty-note">本期没有日期精确且已核实的事件记录。</p>'}</section>

      <section class="report-section data-section"><details class="data-details"><summary><span><b>全部 CP 数据</b><small>搜索与排序</small></span><em>${report.cps.length} 个 CP</em></summary><div class="data-details-body"><div class="table-tools"><input id="cpSearch" type="search" placeholder="搜索 CP 或当前归类" aria-label="搜索 CP 或当前归类"><select id="cpSort" aria-label="选择排序指标"><option value="works">按作品数排序</option><option value="authors">按作者数排序</option><option value="work_delta">按同期增量排序</option><option value="growth_pct">按同期增长率排序</option><option value="median_likes">按点赞中位数排序</option><option value="median_views">按阅读中位数排序</option><option value="completion_rate">按完结率排序</option><option value="cp">按 CP 名称排序</option></select></div><p class="table-count" id="tableCount"></p><div class="table-scroll"><table><thead><tr><th>CP</th><th>当前归类</th><th>作品</th><th>作者</th><th>活跃月</th><th>同期作品</th><th>增量</th><th>增长率</th><th>点赞中位数</th><th>阅读中位数</th><th>完结率</th></tr></thead><tbody id="cpTableBody"></tbody></table></div></div></details></section>

      <section class="method-section"><details><summary>数据口径</summary><ul>${Object.entries(report.method).map(([key,item])=>`<li>${esc(key==="status"?"仅统计收录的有效作品。":item)}</li>`).join("")}</ul></details><div class="report-actions"><a class="button secondary" href="index.html">全部报告</a><a class="button" href="../index.html#focus">进入主看板</a></div></section>`;

    const body=document.getElementById("cpTableBody");
    const search=document.getElementById("cpSearch");
    const sort=document.getElementById("cpSort");
    const count=document.getElementById("tableCount");
    const dataDetails=document.querySelector(".data-details");
    let tableRendered=false;
    const drawTable=()=>{
      const term=search.value.trim().toLocaleLowerCase();
      const key=sort.value;
      const visible=report.cps.filter(row=>!term||`${row.cp} ${row.company}`.toLocaleLowerCase().includes(term)).sort((a,b)=>key==="cp"?a.cp.localeCompare(b.cp):((b[key]??-Infinity)-(a[key]??-Infinity)||b.works-a.works||a.cp.localeCompare(b.cp)));
      count.textContent=`显示 ${visible.length} / ${report.cps.length} 个 CP`;
      body.innerHTML=visible.map(row=>`<tr><th><a href="${cpLink(row.cp)}">${esc(row.cp)}</a></th><td>${esc(row.company)}</td><td>${fmt(row.works)}</td><td>${fmt(row.authors)}</td><td>${fmt(row.active_months)}</td><td>${fmt(row.previous_works)}</td><td>${signed(row.work_delta)}</td><td>${pct(row.growth_pct)}</td><td>${fmt(row.median_likes)}</td><td>${fmt(row.median_views)}</td><td>${row.completion_rate===null?'—':`${fmt(row.completion_rate)}%`}</td></tr>`).join("");
    };
    search.addEventListener("input",drawTable);
    sort.addEventListener("change",drawTable);
    dataDetails.addEventListener("toggle",()=>{
      if(dataDetails.open&&!tableRendered){tableRendered=true;drawTable()}
    });
    const eventDetails=document.getElementById("eventDetails");
    if(eventDetails)eventDetails.addEventListener("toggle",()=>{
      if(eventDetails.open&&!eventDetails.dataset.rendered){
        document.getElementById("eventList").innerHTML=eventMarkup();
        eventDetails.dataset.rendered="true";
      }
    });
    const changeChart=document.querySelector(".change-chart");
    const changeSelection=document.getElementById("changeSelection");
    const showPoint=point=>{
      if(!point)return;
      changeChart.querySelectorAll(".chart-point.selected").forEach(item=>item.classList.remove("selected"));
      point.classList.add("selected");
      const change=Number(point.dataset.change);
      changeSelection.hidden=false;
      changeSelection.className=`chart-selection ${point.dataset.state}`;
      changeSelection.innerHTML=`<i></i><b>${esc(point.dataset.cp)}</b><span>本期 ${fmt(point.dataset.current)} 篇 · 同期 ${fmt(point.dataset.previous)} 篇 · ${signed(change)} · ${fmt(point.dataset.authors)} 位作者</span><a href="${cpLink(point.dataset.cp)}">查看单 CP →</a>`;
    };
    if(changeChart&&changeSelection){
      changeChart.addEventListener("pointerover",event=>showPoint(event.target.closest(".chart-point")));
      changeChart.addEventListener("focusin",event=>showPoint(event.target.closest(".chart-point")));
      changeChart.addEventListener("click",event=>showPoint(event.target.closest(".chart-point")));
      changeChart.addEventListener("keydown",event=>{
        const point=event.target.closest(".chart-point");
        if(point&&(event.key==="Enter"||event.key===" ")){event.preventDefault();showPoint(point)}
      });
    }
  }
})();
