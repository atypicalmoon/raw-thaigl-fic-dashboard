(()=>{
  const target=document.getElementById("generatedReports");
  const catalog=Array.isArray(window.FULL_REPORT_CATALOG)?window.FULL_REPORT_CATALOG:[];
  const fmt=value=>new Intl.NumberFormat("zh-CN").format(value||0);
  const esc=value=>String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
  if(!catalog.length){target.innerHTML='<p class="empty-note">尚未发布自动报告。运行工具仓库中的“更新看板和报告.bat”，选择“生成全 CP 报告”即可创建。</p>';return}
  target.innerHTML=catalog.map((report,index)=>`<a class="report-card${index===0?' latest-card':''}" href="report.html?period=${encodeURIComponent(report.slug)}"><span class="report-kind">${index===0?'最新自动报告':'自动报告'}</span><h3>${esc(report.label)}创作数据</h3><p>${esc(report.start)} — ${esc(report.cutoff)}</p><dl><div><dt>新增作品</dt><dd>${fmt(report.works)}</dd></div><div><dt>活跃作者</dt><dd>${fmt(report.authors)}</dd></div><div><dt>活跃 CP</dt><dd>${fmt(report.active_cps)}</dd></div></dl><span class="report-open">查看报告 <b>↗</b></span></a>`).join("");
})();
