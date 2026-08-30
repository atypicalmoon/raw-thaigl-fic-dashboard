(function(){
  const all=window.CP_REPORT_DATA||{};
  const requested=new URLSearchParams(location.search).get("cp")||"LenaMiu";
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  
  // ────────────────────────────────────────────────────────────
  // 🚀 高性能 DOM 批量实体解码（100% 解析所有 HTML5 实体）
  // ────────────────────────────────────────────────────────────
  const _decodeScratch = document.createElement('textarea');
  const _DECODE_SEP = '\uE000\uE001';

  function decodeHtmlSingle(str, maxDepth = 3) {
      if (typeof str !== 'string' || !str) return str;
      let current = str;
      for (let i = 0; i < maxDepth; i++) {
          _decodeScratch.innerHTML = current;
          const decoded = _decodeScratch.value;
          if (decoded === current) break;
          current = decoded;
      }
      return current.trim();
  }

  function batchDecodeHtml(strings, maxDepth = 3) {
      let current = strings.map(s => (typeof s === 'string' ? s : ''));
      for (let pass = 0; pass < maxDepth; pass++) {
          const joined = current.join(_DECODE_SEP);
          _decodeScratch.innerHTML = joined;
          const decodedJoined = _decodeScratch.value;
          const parts = decodedJoined.split(_DECODE_SEP);
          if (parts.length !== current.length) {
              return current.map(s => decodeHtmlSingle(s, maxDepth - pass));
          }
          let changed = false;
          for (let i = 0; i < parts.length; i++) {
              if (parts[i] !== current[i]) { changed = true; break; }
          }
          current = parts;
          if (!changed) break;
      }
      return current.map(s => s.trim());
  }

  const data=all[requested];
  const main=document.querySelector("main");
  main.classList.remove("report-loading");
  if(!data){
    document.title=`${requested} 暂无报告数据｜ReadAWrite`;
    main.innerHTML=`<section class="hero compact-hero"><h1 class="report-title"><span class="cp-name">${esc(requested)}</span><small>暂无报告数据</small></h1><p class="lead">当前链接对应的 CP 不在本次报告数据范围内。</p><div class="actions"><a class="button" href="../index.html#focus">返回主看板</a></div></section>`;
    return;
  }

  // ────────────────────────────────────────────────────────────
  // ⚡ 批量收集所有字段，只触发 1~3 次 DOM 操作，完成全部解码
  // ────────────────────────────────────────────────────────────
  const toDecode = [];
  if (data.works) {
    data.works.forEach(w => toDecode.push(w.title, w.label, w.author));
  }
  if (data.authorCards) {
    data.authorCards.forEach(a => {
      toDecode.push(a.name);
      if (a.representativeWorks) a.representativeWorks.forEach(w => toDecode.push(w.title));
    });
  }
  if (data.events) {
    data.events.forEach(e => toDecode.push(e.title, e.note, e.date));
  }

  const decodedPool = batchDecodeHtml(toDecode);
  let dIdx = 0;

  if (data.works) {
    data.works.forEach(w => { w.title = decodedPool[dIdx++]; w.label = decodedPool[dIdx++]; w.author = decodedPool[dIdx++]; });
  }
  if (data.authorCards) {
    data.authorCards.forEach(a => {
      a.name = decodedPool[dIdx++];
      if (a.representativeWorks) a.representativeWorks.forEach(w => { w.title = decodedPool[dIdx++]; });
    });
  }
  if (data.events) {
    data.events.forEach(e => { e.title = decodedPool[dIdx++]; e.note = decodedPool[dIdx++]; e.date = decodedPool[dIdx++]; });
  }

  // ────────────────────────────────────────────────────────────
  // 页面渲染逻辑保持不变
  // ────────────────────────────────────────────────────────────
  const fmt=n=>Number(n||0).toLocaleString("zh-CN");
  const yearEntries=Object.entries(data.years); const maxYear=Math.max(1,...yearEntries.map(x=>x[1]));
  const currentYear=Number(data.currentYearLabel)||Number(String(data.end||'').slice(0,4))||new Date().getFullYear();
  const cutoffParts=String(data.end||'').split('-').map(Number);
  const cutoffMonth=cutoffParts[0]===currentYear&&cutoffParts[1]?cutoffParts[1]:12;
  const cutoffDay=cutoffParts[2]||31;
  const cutoffDisplay=String(data.dataCutoff||data.end||'未知');
  const lastMonthPartial=cutoffDay<new Date(currentYear,cutoffMonth,0).getDate();
  const monthValues=Array.from({length:cutoffMonth},(_,i)=>data.months[`${currentYear}-${String(i+1).padStart(2,"0")}`]||0);
  // 按实际绘图区绘制，保留零基线；只用当前展示年份确定上限。
  function monthChartGeometry(values,width,height,compact) {
    const peak=Math.max(0,...values);
    const interval=peak>=100?50:peak>=10?5:1;
    const maximum=Math.max(1,Math.ceil(peak*1.1/interval)*interval);
    const left=compact?14:width/16;
    const right=width-left;
    const top=height*26/160;
    const bottom=height*.75;
    return {left,right,top,bottom,maximum,points:values.map((v,i)=>({
      x:values.length>1?left+i*(right-left)/(values.length-1):width/2,
      y:bottom-v/maximum*(bottom-top),v
    }))};
  }
  const months=`<div class="month-chart-wrap"><svg class="month-line-chart" viewBox="0 0 800 198" role="img" aria-label="${esc(data.cp)} ${currentYear} 年 1 月至 ${cutoffMonth} 月新增作品走势，纵轴从零起"></svg></div>`;
  const years=yearEntries.map(([y,v])=>`<article class="year ${v===maxYear?'peak':''}"><i style="--h:${Math.max(2,Math.round(v/maxYear*100))}%"></i><strong>${y}</strong><b>${fmt(v)}</b><span>${Number(y)===currentYear?`截至${cutoffMonth}月${cutoffDay}日`:'年度新增'}</span></article>`).join("");
  const works=data.works.map(w=>`<a class="work compact-work discovery-work" href="${esc(w.url)}" target="_blank" rel="noopener"><div class="work-head"><em title="${esc(w.label)}">${esc(w.label)}</em><h3 title="${esc(w.title)}">${esc(w.title)}</h3><i aria-hidden="true">↗</i></div><p class="work-meta" title="${esc(w.author)}">${esc(w.author)} · ${fmt(w.chapters)} 章 · ${w.ended?'已完结':'连载中'}</p><div class="work-stats"><span><b>${fmt(w.likes)}</b>赞</span><span><b>${fmt(w.views)}</b>阅读</span></div></a>`).join("")||`<p class="empty-copy">当前数据范围内暂无有效作品。</p>`;
  const authors=data.authorCards.map(a=>{const titles=(a.representativeWorks||[]).map(w=>`<a href="${esc(w.url)}" target="_blank" rel="noopener" title="${esc(w.title)}">“${esc(w.title)}”</a>`).join('<i>·</i>');return `<article class="fact compact-author author-profile"><div class="author-head"><b class="author-name" title="${esc(a.name)}">${esc(a.name)}</b>${titles?`<span class="author-works">${titles}</span>`:''}</div><div class="author-stats"><span><b>${fmt(a.works)}</b>作品</span><span><b>${fmt(a.avgLikes)}</b>赞/篇</span><span><b>${fmt(a.avgViews)}</b>阅读/篇</span></div><div class="author-sparks">${['产出','点赞','阅读'].map((label,i)=>`<span><em>${label}</em><i><b style="width:${a.scores[i]}%"></b></i></span>`).join('')}</div></article>`}).join("")||`<p class="empty-copy">有效作者样本较少，暂不展示作者卡。</p>`;
  const events=data.events.length?data.events.map(e=>`<article class="case"><small>${esc(e.date)} · ${e.type==='broadcast'?'泰国剧播节点':'前置发布节点'}</small><h3>${esc(e.title)}</h3><p>${esc(e.note)}。</p></article>`).join(''):`<article class="pending"><small>剧播参照</small><h3>${esc(data.eventStatus||'暂无已整理的对应节点')}</h3><p>暂无可靠日期记录，不代表没有合作项目。</p></article>`;
  document.title=`${data.cp} 创作趋势分析｜ReadAWrite`;
  document.querySelector('meta[name="description"]').content=`${data.cp} ReadAWrite 同人创作趋势分析`;
  main.innerHTML=`
  <section class="hero compact-hero"><h1 class="report-title"><span class="cp-name" title="${esc(data.cp)}">${esc(data.cp)}</span><small>创作趋势</small></h1><p class="lead">数据截至 ${esc(cutoffDisplay)}（泰国时间） · 记录始于 ${esc(data.start)}</p><div class="kpis"><div class="kpi"><b>${fmt(data.total)}</b><span>累计有效作品</span></div><div class="kpi"><b>${fmt(data.authors)}</b><span>累计创作者</span></div><div class="kpi"><b>${fmt(data.currentYear)}</b><span>${currentYear} 年新增</span></div><div class="kpi"><b>${fmt(data.activeMonths)}</b><span>有新作月份</span></div></div></section>
  <section class="section compact-section"><div class="heading compact-heading"><div><span class="kicker">01 · ${currentYear} 月度新增</span></div><p>${lastMonthPartial?`${cutoffMonth} 月未完整（虚线）`:''}</p></div>${months}<p class="note">按首发月统计 · 截至 ${cutoffMonth}/${cutoffDay} 共 ${fmt(monthValues.reduce((sum,v)=>sum+v,0))} 篇</p></section>
  <section class="section compact-section"><div class="heading compact-heading"><div><span class="kicker">02 · 剧播参照</span></div></div><details class="broadcast-details"><summary><span>${data.events.length?`${data.events.length} 个已整理节点`:esc(data.eventStatus||'暂无已核实节点')}</span><small>查看时间线</small></summary><div class="broadcast">${events}</div><details class="source-note"><summary>来源与时间口径</summary><p>由公开信息汇总；中文剧名采用 B 站主流译名。时间重合仅作观察，不代表因果。</p></details></details></section>
  <section class="section timeline-section compact-section"><div class="heading compact-heading"><div><span class="kicker">03 · 年度分布</span></div><p>${currentYear} 年截至 ${cutoffMonth} 月 ${cutoffDay} 日</p></div><div class="year-grid dynamic-years">${years}</div></section>
  <section class="section compact-section"><div class="heading compact-heading"><div><span class="kicker">04 · 作品发现</span></div></div><div class="works">${works}</div></section>
  <section class="section compact-section"><div class="heading compact-heading"><div><span class="kicker">05 · 创作者观察</span></div></div><div class="facts author-facts">${authors}</div></section>
  <section class="end"><div class="actions"><a class="button secondary" href="index.html">全 CP 报告</a><a class="button" href="../index.html#focus">主看板</a></div><p class="method">ReadAWrite 有效作品 · ${data.start} — ${data.end} · 同链接去重</p><p class="created-by">Created by <strong>Atypical</strong> · With <strong>Codex</strong></p></section>`;
  const monthSvg=main.querySelector('.month-line-chart');
  let lastMonthSize='';
  function drawMonthChart() {
    const {width,height}=monthSvg.getBoundingClientRect();
    if(!width||!height)return;
    const compact=window.matchMedia('(max-width:760px)').matches;
    const size=`${width}:${height}:${compact}`;
    if(size===lastMonthSize)return;
    lastMonthSize=size;
    const {left,right,top,bottom,points}=monthChartGeometry(monthValues,width,height,compact);
    const linePoints=items=>items.map(p=>`${p.x},${p.y}`).join(' ');
    const solidPoints=linePoints(lastMonthPartial?points.slice(0,-1):points);
    const partialPoints=lastMonthPartial?linePoints(points.slice(-2)):'';
    monthSvg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    monthSvg.innerHTML=`<g class="month-grid">${[top,(top+bottom)/2,bottom].map(y=>`<line x1="${left}" y1="${y}" x2="${right}" y2="${y}"/>`).join('')}</g><polyline class="month-line" points="${solidPoints}"/>${lastMonthPartial?`<polyline class="month-line partial-line" points="${partialPoints}"/>`:''}${points.map((p,i)=>{
      const partial=lastMonthPartial&&i===points.length-1;
      return `<g class="month-point ${partial?'partial-point':''}"><title>${i+1} 月：${fmt(p.v)} 篇${partial?'（未完整）':''}</title><circle cx="${p.x}" cy="${p.y}" r="${compact?1.8:3}"/><text class="month-value" x="${p.x}" y="${p.y-(compact?9:12)}">${fmt(p.v)}</text><text class="month-label" x="${p.x}" y="${height-18}">${i+1}月${partial?'*':''}</text></g>`;
    }).join('')}`;
  }
  drawMonthChart();
  new ResizeObserver(drawMonthChart).observe(monthSvg);
})();

/* =========================================================
   CP SWITCHER
   ========================================================= */

(function initCpSwitcher() {
    const trigger = document.getElementById("cpSwitcherTrigger");
    const panel = document.getElementById("cpSwitcherPanel");
    const search = document.getElementById("cpSwitcherSearch");
    const currentLabel = document.getElementById("cpSwitcherCurrent");
    const recentSection = document.getElementById("cpSwitcherRecentSection");
    const recentContainer = document.getElementById("cpSwitcherRecent");
    const allContainer = document.getElementById("cpSwitcherAll");
    const empty = document.getElementById("cpSwitcherEmpty");

    if (
        !trigger ||
        !panel ||
        !search ||
        !currentLabel ||
        !recentContainer ||
        !allContainer
    ) {
        return;
    }

    const RECENT_KEY = "cp-report-recent-v1";
    const MAX_RECENT = 5;

    const reportData =
        window.CP_REPORT_DATA &&
        typeof window.CP_REPORT_DATA === "object"
            ? window.CP_REPORT_DATA
            : {};

    const cpNames = Object.keys(reportData).sort(
        (a, b) =>
            a.localeCompare(
                b,
                "en",
                { sensitivity: "base" }
            )
    );

    /*
     * 当前 CP
     * 支持：
     * cp.html?cp=MyChan
     * cp.html?cp=mychan
     */
    const params = new URLSearchParams(window.location.search);
    const rawCp = (params.get("cp") || "").trim();

    function resolveCp(value) {
        if (!value) return null;

        const normalized = String(value)
            .trim()
            .toLowerCase();

        return (
            cpNames.find(
                cp => cp.toLowerCase() === normalized
            ) || null
        );
    }

    const currentCp =
        resolveCp(rawCp) ||
        resolveCp("LenaMiu") ||
        cpNames[0] ||
        "";

    /*
     * 同步：
     * 1. 浏览器标题
     * 2. meta description
     * 3. 右上角当前 CP
     */
    function updatePageMeta(cp) {
        if (!cp) return;

        document.title =
            `${cp} 创作趋势分析｜ReadAWrite`;

        const description =
            document.querySelector(
                'meta[name="description"]'
            );

        if (description) {
            description.content =
                `${cp} ReadAWrite 同人创作趋势分析`;
        }

        currentLabel.textContent = cp;
    }

    updatePageMeta(currentCp);

    /*
     * 最近访问
     */
    function getRecentCps() {
        try {
            const saved = JSON.parse(
                localStorage.getItem(RECENT_KEY)
            );

            if (!Array.isArray(saved)) {
                return [];
            }

            return saved
                .filter(cp => cpNames.includes(cp))
                .slice(0, MAX_RECENT);
        } catch (_) {
            return [];
        }
    }

    function saveRecentCp(cp) {
        if (!cp || !cpNames.includes(cp)) return;

        const recent = getRecentCps()
            .filter(item => item !== cp);

        recent.unshift(cp);

        try {
            localStorage.setItem(
                RECENT_KEY,
                JSON.stringify(
                    recent.slice(0, MAX_RECENT)
                )
            );
        } catch (_) {}
    }

    saveRecentCp(currentCp);

    /*
     * 搜索匹配
     */
    function getMatches(query = "") {
        const normalized = query
            .trim()
            .toLowerCase();

        if (!normalized) {
            return cpNames.slice();
        }

        return cpNames.filter(
            cp =>
                cp.toLowerCase()
                    .includes(normalized)
        );
    }

    /*
     * 打开 / 关闭
     */
    function setSwitcherOpen(open) {
        panel.hidden = !open;

        trigger.setAttribute(
            "aria-expanded",
            String(open)
        );

        if (open) {
            search.value = "";
            renderSwitcher();

            requestAnimationFrame(() => {
                search.focus();
            });
        }
    }

    /*
     * 跳转 CP
     */
    function goToCp(cp) {
        if (!cp) return;

        saveRecentCp(cp);

        if (cp === currentCp) {
            setSwitcherOpen(false);
            return;
        }

        const url =
            new URL(window.location.href);

        url.searchParams.set("cp", cp);

        window.location.href =
            url.pathname +
            "?" +
            url.searchParams.toString();
    }

    /*
     * 创建一个 CP 按钮
     */
    function createCpButton(cp) {
        const button =
            document.createElement("button");

        button.type = "button";

        button.className =
            "cp-switcher-option";

        if (cp === currentCp) {
            button.classList.add("current");
        }

        const label =
            document.createElement("span");

        label.textContent = cp;

        button.appendChild(label);

        button.addEventListener(
            "click",
            () => goToCp(cp)
        );

        return button;
    }

    /*
     * 渲染下拉内容
     */
    function renderSwitcher() {
        const query =
            search.value
                .trim()
                .toLowerCase();

        const matches =
            getMatches(query);

        allContainer.replaceChildren();
        recentContainer.replaceChildren();

        /*
         * 搜索状态：
         * 隐藏最近访问，只显示搜索结果
         */
        if (query) {
            if (recentSection) {
                recentSection.hidden = true;
            }

            matches.forEach(cp => {
                allContainer.appendChild(
                    createCpButton(cp)
                );
            });

            if (empty) {
                empty.hidden =
                    matches.length !== 0;
            }

            return;
        }

        /*
         * 非搜索状态：
         * 显示最近访问
         */
        const recent =
            getRecentCps();

        if (recentSection) {
            recentSection.hidden =
                recent.length === 0;
        }

        recent.forEach(cp => {
            recentContainer.appendChild(
                createCpButton(cp)
            );
        });

        /*
         * 全部 CP
         */
        cpNames.forEach(cp => {
            allContainer.appendChild(
                createCpButton(cp)
            );
        });

        if (empty) {
            empty.hidden = true;
        }
    }

    /*
     * 点击顶部按钮
     */
    trigger.addEventListener(
        "click",
        event => {
            event.stopPropagation();

            setSwitcherOpen(
                panel.hidden
            );
        }
    );

    /*
     * 输入搜索
     */
    search.addEventListener(
        "input",
        renderSwitcher
    );

    /*
     * Enter：
     * 直接进入第一个搜索结果
     */
    search.addEventListener(
        "keydown",
        event => {
            if (event.key === "Enter") {
                const firstMatch =
                    getMatches(search.value)[0];

                if (firstMatch) {
                    event.preventDefault();
                    goToCp(firstMatch);
                }
            }
        }
    );

    /*
     * 点击外部关闭
     */
    document.addEventListener(
        "click",
        event => {
            if (
                !event.target.closest(
                    "#cpSwitcher"
                )
            ) {
                setSwitcherOpen(false);
            }
        }
    );

    /*
     * Esc 关闭
     */
    document.addEventListener(
        "keydown",
        event => {
            if (
                event.key === "Escape" &&
                !panel.hidden
            ) {
                setSwitcherOpen(false);
                trigger.focus();
            }
        }
    );

    /*
     * 防止点击面板时触发外部关闭
     */
    panel.addEventListener(
        "click",
        event => {
            event.stopPropagation();
        }
    );

    /*
     * 首次渲染
     */
    renderSwitcher();
})();
