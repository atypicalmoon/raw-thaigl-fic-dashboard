(()=>{
  const target=document.getElementById("generatedReports");
  const catalog=Array.isArray(window.FULL_REPORT_CATALOG)?window.FULL_REPORT_CATALOG:[];
  const fmt=value=>new Intl.NumberFormat("zh-CN").format(value||0);
  const esc=value=>String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
  if(!catalog.length){target.innerHTML='<p class="empty-note">暂无半年或年度报告，可浏览下方专题报告。</p>';return}
  target.innerHTML=catalog.map((report,index)=>`<a class="report-card${index===0?' latest-card':''}" href="report.html?period=${encodeURIComponent(report.slug)}"><span class="report-kind">${index===0?'最新报告':'往期报告'}</span><h3>${esc(report.label)}创作数据</h3><p>${esc(report.start)} — ${esc(report.cutoff)}</p><dl><div><dt>新增作品</dt><dd>${fmt(report.works)}</dd></div><div><dt>活跃作者</dt><dd>${fmt(report.authors)}</dd></div><div><dt>活跃 CP</dt><dd>${fmt(report.active_cps)}</dd></div></dl><span class="report-open">查看报告 <b>↗</b></span></a>`).join("");
})();
