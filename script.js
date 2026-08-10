const TIER_COLORS = ["#fff0ea", "#ffd1b8", "#ffb07c", "#ff9a56", "#ef7627", "#df6b75", "#d162a4", "#b55690", "#a30262"];
const COLOR_SHIFT = 0.1;

// 🚀 性能优化 1（修正版）：手写正则实体表覆盖不全，&mdash; &bull; 等命名实体会显示成原始文本（乱码）。
// HTML5 命名实体有 2000+ 个，不适合手动维护，所以改回用浏览器原生解码（100% 正确），
// 但不再「每个字段单独触发一次 DOM 操作」，而是把一批字符串拼成一个大字符串，只做一次 innerHTML 赋值，
// 再按分隔符拆回去 —— 正确性和速度都要。
const _decodeScratch = document.createElement('textarea');
const _DECODE_SEP = '\uE000\uE001'; // 私有区字符，正常文本几乎不可能出现，安全用作分隔符

// 单条解码（供极端兜底场景使用）
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

// 批量解码：整份 CSV 解析阶段只调用一次，内部只做 1~3 次 DOM 操作（对应多重编码兜底），
// 而不是「行数 × 字段数」次操作，这是真正的性能关键。
function batchDecodeHtml(strings, maxDepth = 3) {
    let current = strings.map(s => (typeof s === 'string' ? s : ''));
    for (let pass = 0; pass < maxDepth; pass++) {
        const joined = current.join(_DECODE_SEP);
        _decodeScratch.innerHTML = joined;
        const decodedJoined = _decodeScratch.value;
        const parts = decodedJoined.split(_DECODE_SEP);
        if (parts.length !== current.length) {
            // 极端情况下分隔符被破坏，逐条兜底解码，保正确性
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

const TIER_ORDER = ["0–50", "51–100", "101–300", "301–500", "501–1k", "1k–2k", "2k–5k", "5k–8k", "8k+"];
const TIER_BINS = [-1, 50, 100, 300, 500, 1000, 2000, 5000, 8000, Infinity];
const tierColorScale = d3.scaleOrdinal().domain(TIER_ORDER).range(TIER_COLORS);

function customSoftSpectral(t) {
    const shiftedT = (t + COLOR_SHIFT + 1) % 1;
    let color = d3.hsl(d3.interpolateSpectral(shiftedT));
    color.s *= 0.85;
    const LIGHTNESS_CAP = 0.8;
    if (color.l > LIGHTNESS_CAP) {
        color.l = LIGHTNESS_CAP + (color.l - LIGHTNESS_CAP) * 0.5;
    }
    return color.toString();
}

const READABLE_CP_PALETTE = d3.range(10).map(index => {
    const color = d3.color(d3.interpolateSpectral(index / 9));
    color.opacity = 0.75;
    return color.formatRgb();
});

function stableNameHash(value) {
    let hash = 2166136261;
    for (const char of String(value)) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function buildCpColorMap(cps) {
    const colorMap = new Map();
    const totals = d3.rollup(allParsedRows, v => v.length, d => d.cp);
    const ranked = cps.slice().sort((a, b) => (totals.get(b) || 0) - (totals.get(a) || 0) || a.localeCompare(b));
    ranked.forEach((cp, index) => {
        const base = READABLE_CP_PALETTE[index % READABLE_CP_PALETTE.length];
        const cycle = Math.floor(index / READABLE_CP_PALETTE.length);
        if (!cycle) colorMap.set(cp, base);
        else {
            const target = cycle % 2 ? "#f8f4f5" : "#332f35";
            const amount = Math.min(.16 + Math.floor((cycle - 1) / 2) * .08, .38);
            colorMap.set(cp, d3.interpolateLab(base, target)(amount));
        }
    });
    return colorMap;
}

function makeCpColorAccessor(cps, colorMap) {
    const accessor = (cp) => colorMap.get(cp) || "#94a3b8";
    accessor.domain = () => cps.slice();
    return accessor;
}

const heatInterpolator = d3.interpolateYlOrRd;
let allParsedRows = [];
let dataAfterStatus = [];
let baseOkArticleCount = 0;
let cpColor = null;
let selectedFocusCp = "";
let focusCpChoices = [];
let tableSearchQuery = "";
let tableSortMode = "likes_desc";
let tableStatusMode = "all";
const getTablePageSize = () => window.innerWidth <= 720 ? 30 : 50;
let tableVisibleCount = getTablePageSize();
let currentFocusArticles = [];
const focusStatsCache = new Map();
let updateTimer = null;
const heatmapHiddenCps = new Set();
let heatmapCpChoices = [];
let heatmapVisibilityTimer = null;
let dedupInfo = { totalRows: 0, uniqueRows: 0 };
let companyToCps = new Map();
let cpToCompany = new Map();
const cpCatalog = Array.isArray(window.CP_CATALOG) ? window.CP_CATALOG : [];

// 🚀 性能优化 2：缓存各图表的持久化 <g> 容器引用，避免每次 update() 都 selectAll("*").remove() 整个 SVG 再重建。
// 配合下面 join() 的 key function（例如 d => d.cp），D3 只对发生变化的元素做增删/属性过渡，DOM 操作量大幅减少。
let cpBarG = null;
let likesG = null;
let growthTotalG = null;
let growthCpG = null;

let state = {
    cps: new Set(),
    companies: new Set(),
    years: new Set(),
    tiers: new Set(TIER_ORDER),
    includeReview: false,
    customLikeMin: null,
    customLikeMax: null,
};
const tooltip = d3.select("#tooltip");

function replaceSetContents(targetSet, values) {
    targetSet.clear();
    values.forEach(value => targetSet.add(value));
}

function invertSetFromValues(targetSet, values) {
    replaceSetContents(targetSet, values.filter(value => !targetSet.has(value)));
}

function continuousMonths(rows) {
    const values = rows.map(d => d.month_year).filter(Boolean).sort();
    if (!values.length) return [];
    const [startY, startM] = values[0].split("-").map(Number);
    const [endY, endM] = values[values.length - 1].split("-").map(Number);
    const months = [];
    let year = startY, month = startM;
    while (year < endY || (year === endY && month <= endM)) {
        months.push(`${year}-${String(month).padStart(2, "0")}`);
        month++;
        if (month === 13) { month = 1; year++; }
    }
    return months;
}

function showTooltip(html, event) {
    tooltip.style("opacity", 1).html(html);
    const node = tooltip.node();
    const left = Math.min(event.clientX + 14, window.innerWidth - node.offsetWidth - 10);
    const top = Math.min(Math.max(event.clientY - 10, 10), window.innerHeight - node.offsetHeight - 10);
    tooltip.style("left", Math.max(left, 10) + "px").style("top", top + "px");
}

function hideTooltip() { tooltip.style("opacity", 0); }

function usesTouchLayout() {
    return window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

function activateChartCp(event, cp, highlight, html) {
    if (!usesTouchLayout()) {
        setFocusCP(cp);
        return;
    }
    setFocusCP(cp, { scroll: false });
    if (highlight) highlight(cp);
    requestAnimationFrame(() => showTooltip(`${html}<br><span style="color:#f3b6cf;font-size:11px;">已预选 ${cp}，向下滑动可查看作品</span>`, event));
}

function activateLegend(event, source, cp, highlight, html) {
    activateChartCp(event, cp, highlight, html);
}

window.addEventListener("scroll", hideTooltip, { passive: true });
document.addEventListener("pointerdown", event => {
    if (event.pointerType === "touch") hideTooltip();
}, { passive: true });
document.addEventListener("pointercancel", hideTooltip, { passive: true });

function likeTier(n) {
    for (let i = 0; i < TIER_BINS.length - 1; i++) {
        if (n > TIER_BINS[i] && n <= TIER_BINS[i + 1]) return TIER_ORDER[i];
    }
    return TIER_ORDER[0];
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 10000) return (num / 1000).toFixed(1) + "k";
    return num.toLocaleString();
}

function formatAxisCompact(num) {
    return Math.abs(num) >= 1000 ? d3.format(".2~s")(num) : num.toLocaleString();
}

function resolveArticleUrl(d) {
    if (d.link && String(d.link).startsWith("http")) return d.link;
    if (d.url && String(d.url).startsWith("http")) return d.url;
    if (d.href && String(d.href).startsWith("http")) return d.href;
    if (d.article_id) return `https://www.readawrite.com/a/${d.article_id}`;
    if (d.id && !isNaN(d.id)) return `https://www.readawrite.com/a/${d.id}`;
    return "#";
}

function normalizeLinkKey(rawLink, fallbackUrl) {
    const src = (rawLink && String(rawLink).trim()) || (fallbackUrl && String(fallbackUrl).trim()) || "";
    return src.replace(/\/+$/, "").toLowerCase();
}

// 每行需要 HTML 解码的字段，统一在这里声明，方便以后增减
const DECODE_FIELDS = ["title", "author", "cp", "company", "keyword", "duplicate_cps"];

function parseCSVText(text) {
    const firstLine = text.split('\n')[0] || '';
    const delimiter = firstLine.includes('\t') ? '\t' : ',';
    const rawRows = d3.dsvFormat(delimiter).parse(text);

    // 第一步：把每行需要解码的原始字符串都取出来，攒成一个大数组
    const rawStrings = [];
    rawRows.forEach(d => {
        rawStrings.push(d.title ? d.title.trim() : (d.name ? String(d.name).trim() : ""));
        rawStrings.push((d.author || d.writer || d.user || d.username || "").trim());
        rawStrings.push(d.cp ? d.cp.trim() : "");
        rawStrings.push(d.company ? d.company.trim() : "");
        rawStrings.push(d.keyword ? String(d.keyword).trim() : "");
        rawStrings.push(d.duplicate_cps ? String(d.duplicate_cps).trim() : "");
    });

    // 第二步：一次性批量解码（内部只做 1~3 次 DOM 操作，而不是 行数×6 次）
    const decoded = batchDecodeHtml(rawStrings);
    const FIELD_COUNT = DECODE_FIELDS.length;

    // 第三步：组装成最终行对象
    return rawRows.map((d, i) => {
        const base = i * FIELD_COUNT;
        const decTitle = decoded[base];
        const decAuthor = decoded[base + 1];
        const decCp = decoded[base + 2];
        const decCompany = decoded[base + 3];
        const decKeyword = decoded[base + 4];
        const decDupCpsRaw = decoded[base + 5];

        const rawStatus = (d.Status || d.status || "").trim();
        const pDate = new Date(d.publish_date);
        const validDate = !isNaN(pDate.getTime());
        const likes = +String(d.likes || "0").replace(/,/g, "") || 0;
        const url = resolveArticleUrl(d);
        const cp = decCp || null;

        let finalDup = "";
        if (decDupCpsRaw && !["null", "-", "na", "无", "nan"].includes(decDupCpsRaw.toLowerCase())) {
            let arr = decDupCpsRaw.split(/[,，、|]/).map(s => s.trim()).filter(Boolean);
            if (cp) {
                const cpLower = cp.toLowerCase();
                arr = arr.filter(s => s.toLowerCase() !== cpLower);
            }
            finalDup = Array.from(new Set(arr)).join("、");
        }

        return {
            title: decTitle || "无标题",
            author: decAuthor || "匿名",
            cp: cp,
            company: decCompany || "未知",
            keyword: decKeyword,
            duplicate_cps: finalDup,
            status: rawStatus,
            is_end: String(d.is_end).trim() === "1",
            publish_date_obj: validDate ? pDate : null,
            publish_date_str: d.publish_date || "未知",
            year: validDate ? String(pDate.getFullYear()) : null,
            month_year: validDate ? `${pDate.getFullYear()}-${String(pDate.getMonth()+1).padStart(2,"0")}` : null,
            likes,
            tier: likeTier(likes),
            view_count: +String(d.view_count || "0").replace(/,/g, "") || 0,
            chapter_count: +d.chapter_count || 0,
            url,
            _linkKey: normalizeLinkKey(d.link, url)
        };
    }).filter(d => d.cp);
}

function dedupeByLink(rows) {
    const seen = new Map();
    let noLinkFallbackIndex = 0;
    rows.forEach(d => {
        const key = d._linkKey || `__nolink__${(d.title||"").toLowerCase()}__${(d.author||"").toLowerCase()}__${noLinkFallbackIndex++}`;
        if (!seen.has(key)) seen.set(key, d);
    });
    return Array.from(seen.values());
}

function applyStatusFilter() {
    baseOkArticleCount = dedupeByLink(allParsedRows.filter(d => (d.status ? d.status.toLowerCase() : "") === "ok")).length;
    const statusFiltered = allParsedRows.filter(d => {
        const currentStatus = d.status ? d.status.toLowerCase() : "";
        if (currentStatus === "ok") return true;
        if (d.status === "需要review") return state.includeReview;
        return false;
    });
    dataAfterStatus = dedupeByLink(statusFiltered);
    dedupInfo = { totalRows: statusFiltered.length, uniqueRows: dataAfterStatus.length };
}

function loadArticlesFile() {
    const dataVersion = window.DASHBOARD_META?.data_version || Date.now();
    d3.text(`./articles_cleaned.csv?v=${encodeURIComponent(dataVersion)}`, { cache: "no-cache" })
        .then(text => {
            allParsedRows = parseCSVText(text);
            initDashboard();
        })
        .catch(() => {
            console.warn("未能读取本地文件");
        });
}

function initDashboard() {
    if (!allParsedRows.length) return;
    companyToCps = new Map();
    cpToCompany = new Map();
    cpCatalog.forEach(item => {
        if (!companyToCps.has(item.company)) companyToCps.set(item.company, new Set());
        companyToCps.get(item.company).add(item.cp);
        cpToCompany.set(item.cp, item.company);
    });
    allParsedRows.forEach(d => {
        const cp = d.cp;
        const comp = d.company || "未知";
        if (cp) {
            if (!companyToCps.has(comp)) companyToCps.set(comp, new Set());
            companyToCps.get(comp).add(cp);
            cpToCompany.set(cp, comp);
        }
    });

    const cps = Array.from(new Set([...cpCatalog.map(item => item.cp), ...allParsedRows.map(d => d.cp)])).sort();
    const cpColorMap = buildCpColorMap(cps);
    cpColor = makeCpColorAccessor(cps, cpColorMap);

    state.cps = new Set(cps);
    state.companies = new Set(Array.from(companyToCps.keys()));
    state.years = new Set(Array.from(new Set(allParsedRows.map(d => d.year))).filter(Boolean));
    state.tiers = new Set(TIER_ORDER);

    applyStatusFilter();

    renderChips("companyCheckboxList", Array.from(state.companies).sort(), state.companies, "plain");
    renderCpCheckboxes();
    renderChips("yearCheckboxList", Array.from(state.years).sort(), state.years, "plain");
    renderChips("tierChips", TIER_ORDER, state.tiers, "chip");

    document.getElementById("filterPanel").style.display = "block";
    document.getElementById("dashboardGrid").style.display = "block";

    bindEvents();
    update();
}

function renderCpCheckboxes() {
    const container = d3.select("#cpCheckboxList").html("");
    const sortedCompanies = Array.from(state.companies).sort();

    if (sortedCompanies.length === 0) {
        container.append("div").style("color", "var(--text-sub)").style("font-size", "12.5px").style("padding", "8px").text("无符合条件的 CP");
        return;
    }

    sortedCompanies.forEach(company => {
        const cps = Array.from(companyToCps.get(company) || []).sort();
        if (cps.length === 0) return;

        const groupDiv = container.append("div")
            .style("width", "100%").style("margin-bottom", "4px").style("background", "#fff")
            .style("border", "1px solid var(--border)").style("border-radius", "6px").style("padding", "6px 10px")
            .attr("class", "cp-company-group");

        const header = groupDiv.append("div")
            .style("display", "flex").style("justify-content", "space-between").style("align-items", "center")
            .style("font-size", "12px").style("font-weight", "600").style("color", "var(--text-muted)")
            .style("border-bottom", "1px dashed var(--border-light)").style("margin-bottom", "6px").style("padding-bottom", "4px");

        header.append("span").text(`🏢 ${company}`);
        const actions = header.append("div").style("display", "flex").style("gap", "12px");
        actions.append("span").text("全选").style("cursor", "pointer").style("color", "var(--accent)").on("click", () => {
            cps.forEach(c => state.cps.add(c));
            renderCpCheckboxes(); update();
        });
        actions.append("span").text("清空").style("cursor", "pointer").style("color", "var(--text-sub)").on("click", () => {
            cps.forEach(c => state.cps.delete(c));
            renderCpCheckboxes(); update();
        });

        const cpWrap = groupDiv.append("div").style("display", "flex").style("flex-wrap", "wrap").style("gap", "4px 10px");
        cps.forEach(cp => {
            const label = cpWrap.append("label").attr("class", "checkbox-item").attr("data-cp-name", cp.toLowerCase()).style("font-size", "12px").style("gap", "3px");
            label.append("input").attr("type", "checkbox").attr("value", cp).property("checked", state.cps.has(cp)).on("change", function() {
                if (this.checked) state.cps.add(cp); else state.cps.delete(cp);
                update();
            });
            label.append("span").style("display", "inline-block").style("width", "6px").style("height", "6px").style("border-radius", "50%").style("background", cpColor(cp));
            label.append("span").text(cp);
        });
    });
}

function updateCpSelectionByCompany(newlyAddedCompany = null) {
    const validCps = new Set();
    state.companies.forEach(comp => {
        const cps = companyToCps.get(comp);
        if (cps) cps.forEach(cp => validCps.add(cp));
    });
    // 保留 Set 实例：已渲染控件的事件处理器可能仍持有它的引用。
    replaceSetContents(state.cps, Array.from(state.cps).filter(cp => validCps.has(cp)));
    if (newlyAddedCompany) {
        const cps = companyToCps.get(newlyAddedCompany);
        if (cps) cps.forEach(cp => state.cps.add(cp));
    }
    renderCpCheckboxes();
}

function setFocusCP(cp, options = {}) {
    const shouldScroll = options.scroll !== false;
    hideTooltip();
    selectedFocusCp = cp || "";
    document.getElementById("focusCpSearch").value = selectedFocusCp;
    const focusHeader = document.getElementById("focusHeader");
    focusHeader.classList.toggle("lenamiu-clickable", selectedFocusCp === "LenaMiu");
    if (selectedFocusCp === "LenaMiu") {
        focusHeader.setAttribute("role", "button");
        focusHeader.setAttribute("tabindex", "0");
        focusHeader.setAttribute("aria-label", "播放 LenaMiu 隐藏图案");
    } else {
        focusHeader.removeAttribute("role");
        focusHeader.removeAttribute("tabindex");
        focusHeader.removeAttribute("aria-label");
    }
    const easterEggLayer = document.getElementById("lenamiuEasterEgg");
    easterEggLayer.replaceChildren();
    easterEggLayer.classList.remove("active");
    easterEggLayer.setAttribute("aria-hidden", "true");
    drawFocusArea(getFilteredRows());
    if (cp && shouldScroll) {
        document.getElementById("focus").scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function openDiscoveryCp(cp) {
    if (!cp) return;
    setFocusCP(cp);
}

function renderFocusCpOptions() {
    const container = document.getElementById("focusCpOptions");
    const query = document.getElementById("focusCpSearch").value.trim().toLowerCase();
    const matches = focusCpChoices.filter(cp => cp.toLowerCase().includes(query));
    container.replaceChildren();
    if (!matches.length) {
        const empty = document.createElement("div");
        empty.className = "focus-cp-empty";
        empty.textContent = "没有匹配的 CP";
        container.appendChild(empty);
        return;
    }
    matches.forEach(cp => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "focus-cp-option";
        option.setAttribute("role", "option");
        option.textContent = cp;
        option.onclick = () => {
            setFocusCpOptionsOpen(false);
            openDiscoveryCp(cp);
        };
        container.appendChild(option);
    });
}

function setFocusCpOptionsOpen(open) {
    const options = document.getElementById("focusCpOptions");
    options.hidden = !open;
    document.getElementById("focusCpSearch").setAttribute("aria-expanded", String(open));
    if (open) renderFocusCpOptions();
}

function launchLenaMiuEasterEgg(cp) {
    const layer = document.getElementById("lenamiuEasterEgg");
    layer.replaceChildren();
    if (cp !== "LenaMiu" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const emojis = ["🦋", "🦋", "🧸", "🧸"].sort(() => Math.random() - .5);
    const positions = [];
    while (positions.length < emojis.length) {
        const candidate = { x: 22 + Math.random() * 56, y: 16 + Math.random() * 54 };
        if (positions.every(pos => Math.hypot(candidate.x - pos.x, candidate.y - pos.y) >= 15)) positions.push(candidate);
    }
    emojis.forEach((emoji, index) => {
        const mark = document.createElement("span");
        mark.className = "lenamiu-emoji-mark";
        mark.textContent = emoji;
        mark.style.left = `${positions[index].x}%`;
        mark.style.top = `${positions[index].y}%`;
        mark.style.setProperty("--delay", `${index * .08}s`);
        mark.style.setProperty("--rotation", `${-14 + Math.random() * 28}deg`);
        mark.addEventListener("animationend", () => mark.remove(), { once: true });
        layer.appendChild(mark);
    });
}

function renderChips(containerId, items, selectedSet, kind) {
    const el = d3.select("#" + containerId).html("");
    items.forEach(item => {
        if (kind === "chip") {
            el.append("div").attr("class", "chip" + (selectedSet.has(item) ? " active" : ""))
                .text(item)
                .on("click", function() {
                    if (selectedSet.has(item)) selectedSet.delete(item);
                    else selectedSet.add(item);
                    d3.select(this).classed("active", selectedSet.has(item));
                    update();
                });
            return;
        }
        const label = el.append("label").attr("class", "checkbox-item");
        label.append("input").attr("type", "checkbox").attr("value", item).property("checked", selectedSet.has(item))
            .on("change", function() {
                if (this.checked) {
                    selectedSet.add(item);
                    if (containerId === "companyCheckboxList") updateCpSelectionByCompany(item);
                } else {
                    selectedSet.delete(item);
                    if (containerId === "companyCheckboxList") updateCpSelectionByCompany();
                }
                update();
            });
        label.append("span").text(item);
    });
}

function bindEvents() {
    const themeToggle = document.getElementById("themeToggle");
    const syncThemeToggle = () => {
        const whiteMode = document.documentElement.dataset.theme === "white";
        themeToggle.textContent = whiteMode ? "○" : "◐";
        themeToggle.setAttribute("aria-pressed", String(whiteMode));
        themeToggle.setAttribute("aria-label", whiteMode ? "恢复默认" : "简洁模式");
        themeToggle.title = whiteMode ? "恢复默认" : "简洁模式";
    };
    syncThemeToggle();
    themeToggle.onclick = () => {
        const whiteMode = document.documentElement.dataset.theme !== "white";
        if (whiteMode) document.documentElement.dataset.theme = "white";
        else delete document.documentElement.dataset.theme;
        try { localStorage.setItem("dashboard-theme", whiteMode ? "white" : "default"); } catch (_) {}
        syncThemeToggle();
    };

    let filterExpanded = false;
    const setFilterExpanded = expanded => {
        filterExpanded = expanded;
        document.getElementById("filterContent").style.display = filterExpanded ? (window.innerWidth <= 720 ? "block" : "grid") : "none";
        document.getElementById("filterToggleIcon").innerText = filterExpanded ? "收起 ▲" : "展开 ▼";
        document.getElementById("toggleFilterBtn").setAttribute("aria-expanded", String(filterExpanded));
    };
    window.addEventListener("resize", () => {
        if (filterExpanded) document.getElementById("filterContent").style.display = window.innerWidth <= 720 ? "block" : "grid";
    });
    document.getElementById("toggleFilterBtn").onclick = () => setFilterExpanded(!filterExpanded);
    document.querySelectorAll(".mobile-filter-section-toggle").forEach(toggle => {
        toggle.onclick = () => {
            const row = toggle.closest(".control-row");
            const willExpand = row.classList.contains("mobile-collapsed");
            document.querySelectorAll(".control-row").forEach(otherRow => {
                otherRow.classList.add("mobile-collapsed");
                otherRow.querySelector(".mobile-filter-section-toggle")?.setAttribute("aria-expanded", "false");
            });
            if (willExpand) {
                row.classList.remove("mobile-collapsed");
                toggle.setAttribute("aria-expanded", "true");
            }
        };
    });
    document.addEventListener("click", event => {
        if (window.innerWidth <= 720 || event.target.closest(".control-row")) return;
        document.querySelectorAll(".control-row").forEach(row => {
            row.classList.add("mobile-collapsed");
            row.querySelector(".mobile-filter-section-toggle")?.setAttribute("aria-expanded", "false");
        });
    });
    document.getElementById("mobileCollapseFilterBtn").onclick = () => {
        setFilterExpanded(false);
        document.getElementById("filterPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    };
    document.getElementById("mobileResetBtn").onclick = () => document.getElementById("resetBtn").click();

    const dataInfo = document.getElementById("dataInfo");
    const dataInfoTrigger = document.getElementById("dataInfoTrigger");
    const dataInfoPopover = document.getElementById("dataInfoPopover");
    let dataInfoHideTimer;
    const setDataInfoOpen = open => {
        dataInfoPopover.hidden = !open;
        dataInfoTrigger.setAttribute("aria-expanded", String(open));
    };
    dataInfoTrigger.onclick = e => { e.stopPropagation(); setDataInfoOpen(dataInfoPopover.hidden); };
    dataInfo.onmouseenter = () => { clearTimeout(dataInfoHideTimer); if (window.matchMedia("(hover: hover)").matches) setDataInfoOpen(true); };
    dataInfo.onmouseleave = () => { if (window.matchMedia("(hover: hover)").matches) dataInfoHideTimer = setTimeout(() => setDataInfoOpen(false), 160); };
    document.getElementById("dataInfoClose").onclick = () => setDataInfoOpen(false);
    document.addEventListener("click", e => { if (!dataInfo.contains(e.target)) setDataInfoOpen(false); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") setDataInfoOpen(false); });

    const focusCpSearch = document.getElementById("focusCpSearch");
    const resolveFocusCp = () => {
        const query = focusCpSearch.value.trim().toLowerCase();
        if (!query) return;
        const match = focusCpChoices.find(cp => cp.toLowerCase() === query) || focusCpChoices.find(cp => cp.toLowerCase().includes(query));
        if (match) {
            setFocusCpOptionsOpen(false);
            openDiscoveryCp(match);
        }
    };
    focusCpSearch.onfocus = () => setFocusCpOptionsOpen(true);
    focusCpSearch.oninput = () => setFocusCpOptionsOpen(true);
    focusCpSearch.onkeydown = e => {
        if (e.key === "Enter") resolveFocusCp();
        if (e.key === "Escape") setFocusCpOptionsOpen(false);
        if (e.key === "ArrowDown") {
            e.preventDefault();
            document.querySelector("#focusCpOptions .focus-cp-option")?.focus();
        }
    };
    document.getElementById("focusCpArrow").onclick = () => setFocusCpOptionsOpen(document.getElementById("focusCpOptions").hidden);
    document.addEventListener("click", e => { if (!e.target.closest(".focus-combobox")) setFocusCpOptionsOpen(false); });
    document.getElementById("clearFocusCpBtn").onclick = () => {
        setFocusCP("");
        focusCpSearch.focus();
        setFocusCpOptionsOpen(true);
    };
    const focusHeader = document.getElementById("focusHeader");
    focusHeader.onclick = event => {
        if (event.target.closest("input, button, select, option")) return;
        if (selectedFocusCp === "LenaMiu") launchLenaMiuEasterEgg(selectedFocusCp);
    };
    focusHeader.onkeydown = event => {
        if ((event.key === "Enter" || event.key === " ") && selectedFocusCp === "LenaMiu" && !event.target.closest("input, button, select, option")) {
            event.preventDefault();
            launchLenaMiuEasterEgg(selectedFocusCp);
        }
    };
    document.getElementById("randomCpBtn").onclick = () => {
        const choices = Array.from(state.cps);
        if (choices.length) {
            setFocusCpOptionsOpen(false);
            openDiscoveryCp(choices[Math.floor(Math.random() * choices.length)]);
        }
    };

    document.getElementById("cpSearchInput").oninput = function(e) {
        const q = e.target.value.trim().toLowerCase();
        d3.selectAll("#cpCheckboxList .checkbox-item").each(function() {
            const name = this.getAttribute("data-cp-name") || "";
            this.style.display = name.includes(q) ? "inline-flex" : "none";
        });
        d3.selectAll("#cpCheckboxList .cp-company-group").each(function() {
            const hasVisibleCp = this.querySelectorAll(".checkbox-item[style*='inline-flex'], .checkbox-item:not([style*='none'])").length > 0;
            this.style.display = hasVisibleCp ? "block" : "none";
        });
    };

    document.getElementById("selectAllCPBtn").onclick = () => {
        d3.selectAll("#cpCheckboxList .checkbox-item").each(function() {
            if (this.style.display !== "none") {
                const input = this.querySelector("input");
                if (input) { input.checked = true; state.cps.add(input.value); }
            }
        });
        update();
    };
    document.getElementById("clearCPBtn").onclick = () => {
        d3.selectAll("#cpCheckboxList input[type=checkbox]").property("checked", false);
        state.cps.clear(); update();
    };
    document.getElementById("invertCPBtn").onclick = () => {
        const visible = [];
        d3.selectAll("#cpCheckboxList .checkbox-item").each(function() {
            if (this.style.display !== "none") {
                const input = this.querySelector("input");
                if (input) visible.push(input.value);
            }
        });
        visible.forEach(cp => state.cps.has(cp) ? state.cps.delete(cp) : state.cps.add(cp));
        renderCpCheckboxes(); update();
    };

    document.getElementById("selectAllCompanyBtn").onclick = () => {
        replaceSetContents(state.companies, companyToCps.keys());
        replaceSetContents(state.cps, cpColor.domain());
        d3.selectAll("#companyCheckboxList input[type=checkbox]").property("checked", true);
        updateCpSelectionByCompany(); update();
    };
    document.getElementById("clearCompanyBtn").onclick = () => {
        d3.selectAll("#companyCheckboxList input[type=checkbox]").property("checked", false);
        state.companies.clear(); state.cps.clear();
        updateCpSelectionByCompany(); update();
    };
    document.getElementById("invertCompanyBtn").onclick = () => {
        const allCompanies = Array.from(companyToCps.keys());
        const previouslySelected = new Set(state.companies);
        invertSetFromValues(state.companies, allCompanies);
        state.companies.forEach(company => {
            if (!previouslySelected.has(company)) {
                (companyToCps.get(company) || []).forEach(cp => state.cps.add(cp));
            }
        });
        d3.selectAll("#companyCheckboxList input[type=checkbox]")
            .property("checked", function() { return state.companies.has(this.value); });
        updateCpSelectionByCompany(); update();
    };

    document.getElementById("selectAllYearBtn").onclick = () => {
        replaceSetContents(state.years, Array.from(new Set(allParsedRows.map(d => d.year))).filter(Boolean));
        d3.selectAll("#yearCheckboxList input[type=checkbox]").property("checked", true);
        update();
    };
    document.getElementById("clearYearBtn").onclick = () => {
        d3.selectAll("#yearCheckboxList input[type=checkbox]").property("checked", false);
        state.years.clear(); update();
    };
    document.getElementById("invertYearBtn").onclick = () => {
        const allYears = Array.from(new Set(allParsedRows.map(d => d.year))).filter(Boolean);
        invertSetFromValues(state.years, allYears);
        d3.selectAll("#yearCheckboxList input[type=checkbox]")
            .property("checked", function() { return state.years.has(this.value); });
        update();
    };

    document.getElementById("selectAllTierBtn").onclick = () => {
        replaceSetContents(state.tiers, TIER_ORDER);
        renderChips("tierChips", TIER_ORDER, state.tiers, "chip");
        update();
    };
    document.getElementById("clearTierBtn").onclick = () => {
        state.tiers.clear();
        renderChips("tierChips", TIER_ORDER, state.tiers, "chip");
        update();
    };
    document.getElementById("invertTierBtn").onclick = () => {
        invertSetFromValues(state.tiers, TIER_ORDER);
        renderChips("tierChips", TIER_ORDER, state.tiers, "chip");
        update();
    };

    const handleCustomLikeChange = () => {
        const minVal = parseInt(document.getElementById("customLikeMin").value);
        const maxVal = parseInt(document.getElementById("customLikeMax").value);
        state.customLikeMin = isNaN(minVal) ? null : minVal;
        state.customLikeMax = isNaN(maxVal) ? null : maxVal;
        update();
    };
    document.getElementById("customLikeMin").oninput = handleCustomLikeChange;
    document.getElementById("customLikeMax").oninput = handleCustomLikeChange;

    document.getElementById("tableFilterInput").oninput = function(e) {
        tableSearchQuery = e.target.value.trim().toLowerCase();
        tableVisibleCount = getTablePageSize();
        renderFocusTable(currentFocusArticles);
    };
    document.getElementById("tableSortSelect").onchange = function() {
        tableSortMode = this.value;
        tableVisibleCount = getTablePageSize();
        renderFocusTable(currentFocusArticles);
    };
    document.getElementById("tableStatusSelect").onchange = function() {
        tableStatusMode = this.value;
        tableVisibleCount = getTablePageSize();
        renderFocusTable(currentFocusArticles);
    };
    document.getElementById("clearTableSearchBtn").onclick = () => {
        tableSearchQuery = "";
        document.getElementById("tableFilterInput").value = "";
        tableVisibleCount = getTablePageSize();
        renderFocusTable(currentFocusArticles);
        document.getElementById("tableFilterInput").focus();
    };
    document.getElementById("loadMoreArticlesBtn").onclick = () => {
        tableVisibleCount += getTablePageSize();
        renderFocusTable(currentFocusArticles);
    };
    document.getElementById("metricSelect").onchange = () => drawHeatmap(getFilteredRows());
    document.getElementById("heatmapRangeSelect").onchange = () => drawHeatmap(getFilteredRows());
    document.getElementById("heatmapSortSelect").onchange = () => drawHeatmap(getFilteredRows());
    document.getElementById("heatmapTopNSelect").onchange = () => drawHeatmap(getFilteredRows());
    const heatmapCpPanel = document.getElementById("heatmapCpPanel");
    const heatmapCpToggle = document.getElementById("heatmapCpToggle");
    heatmapCpToggle.onclick = () => {
        heatmapCpPanel.hidden = !heatmapCpPanel.hidden;
        heatmapCpToggle.setAttribute("aria-expanded", String(!heatmapCpPanel.hidden));
        if (!heatmapCpPanel.hidden) renderHeatmapCpChecks();
    };
    document.getElementById("heatmapCpChecks").onchange = event => {
        if (!event.target.matches('input[type="checkbox"]')) return;
        if (event.target.checked) heatmapHiddenCps.delete(event.target.value);
        else heatmapHiddenCps.add(event.target.value);
        document.getElementById("heatmapHiddenCount").innerText = `已隐藏 ${heatmapHiddenCps.size} 个`;
        clearTimeout(heatmapVisibilityTimer);
        heatmapVisibilityTimer = setTimeout(() => drawHeatmap(getFilteredRows()), 120);
    };
    document.getElementById("heatmapRestoreAll").onclick = () => {
        heatmapHiddenCps.clear();
        renderHeatmapCpChecks();
        drawHeatmap(getFilteredRows());
    };
    document.getElementById("growthTopNSelect").onchange = () => drawGrowthChart(getFilteredRows());
    document.getElementById("cpBarTopNSelect").onchange = () => drawCpBar(getFilteredRows());
    document.getElementById("likesTopNSelect").onchange = () => drawLikesChart(getFilteredRows());
    document.getElementById("includeReviewToggle").onchange = function() {
        state.includeReview = this.checked;
        applyStatusFilter(); update();
    };
    document.getElementById("resetBtn").onclick = () => {
        replaceSetContents(state.companies, companyToCps.keys());
        replaceSetContents(state.cps, cpColor.domain());
        replaceSetContents(state.years, Array.from(new Set(allParsedRows.map(d => d.year))).filter(Boolean));
        replaceSetContents(state.tiers, TIER_ORDER);
        state.includeReview = false;
        state.customLikeMin = null; state.customLikeMax = null;
        tableSearchQuery = "";
        tableSortMode = "likes_desc";
        tableStatusMode = "all";
        document.getElementById("includeReviewToggle").checked = false;
        document.getElementById("cpSearchInput").value = "";
        document.getElementById("tableFilterInput").value = "";
        document.getElementById("tableSortSelect").value = tableSortMode;
        document.getElementById("tableStatusSelect").value = tableStatusMode;
        document.getElementById("customLikeMin").value = "";
        document.getElementById("customLikeMax").value = "";
        applyStatusFilter();
        renderChips("companyCheckboxList", Array.from(state.companies).sort(), state.companies, "plain");
        renderCpCheckboxes();
        renderChips("yearCheckboxList", Array.from(state.years).sort(), state.years, "plain");
        renderChips("tierChips", TIER_ORDER, state.tiers, "chip");
        update();
    };
}

function getFilteredRows() {
    return dataAfterStatus.filter(d => {
        if (!state.cps.has(d.cp)) return false;
        if (!state.companies.has(d.company)) return false;
        // 选择具体年份时，无日期/无法解析年份的记录也必须排除。
        if (!state.years.has(d.year)) return false;
        if (!state.tiers.has(d.tier)) return false;
        if (state.customLikeMin !== null && d.likes < state.customLikeMin) return false;
        if (state.customLikeMax !== null && d.likes > state.customLikeMax) return false;
        return true;
    });
}

function updateKPIs(rows) {
    const totalArticles = rows.length;
    const totalLikes = d3.sum(rows, d => d.likes);
    const distinctCPs = new Set(rows.map(d => d.cp)).size;
    const endCount = rows.filter(d => d.is_end).length;
    const endRate = totalArticles ? ((endCount / totalArticles) * 100).toFixed(1) + "%" : "0%";
    const dictionaryTotal = cpColor.domain().length;
    const collectedTotal = new Set(dataAfterStatus.filter(d => d.year).map(d => d.cp)).size;
    const uncollectedTotal = Math.max(0, dictionaryTotal - collectedTotal);
    const validYears = Array.from(new Set(rows.map(d => d.year))).filter(Boolean).sort();
    const timeSpan = validYears.length > 1 ? `${validYears[0]} - ${validYears[validYears.length-1]}` : (validYears[0] || "—");
    const allYearCount = new Set(allParsedRows.map(d => d.year).filter(Boolean)).size;
    const hasActiveFilter = state.companies.size !== companyToCps.size ||
        state.cps.size !== dictionaryTotal || state.years.size !== allYearCount ||
        state.tiers.size !== TIER_ORDER.length || state.includeReview ||
        state.customLikeMin !== null || state.customLikeMax !== null;
    document.getElementById("kpiTotalArticles").innerText = totalArticles.toLocaleString();
    const dupRemoved = dedupInfo.totalRows - dedupInfo.uniqueRows;
    document.getElementById("kpiArticleLabel").innerText = hasActiveFilter ? "筛选结果" : "有效作品";
    document.getElementById("kpiQualityNote").innerText = hasActiveFilter ?
        `全站有效作品 ${baseOkArticleCount.toLocaleString()} 篇` :
        (dupRemoved > 0 ? `通过内容筛选 ${dataAfterStatus.length.toLocaleString()} 篇 · 合并 ${dupRemoved.toLocaleString()} 项重复` : `通过内容筛选 ${dataAfterStatus.length.toLocaleString()} 篇`);
    document.getElementById("kpiTotalLikes").innerText = formatNumber(totalLikes);
    document.getElementById("kpiLikesNote").innerText = hasActiveFilter ? "当前结果合计" : "全部有效作品合计";
    document.getElementById("kpiTotalCPs").innerText = distinctCPs;
    document.getElementById("kpiCpLabel").innerText = hasActiveFilter ? "覆盖 CP" : "当前覆盖 CP";
    document.getElementById("kpiTopCP").innerText = hasActiveFilter ? `全站收录范围 ${dictionaryTotal} 对 CP` : `预设收录 ${dictionaryTotal} 个 · ${uncollectedTotal} 个暂无主归属作品`;
    document.getElementById("kpiTimeSpan").innerText = timeSpan;
    document.getElementById("kpiEndRate").innerText = hasActiveFilter ? `完结率 ${endRate}` : `完结作品：${endRate}`;
    const companyText = state.companies.size === companyToCps.size ? "全部公司" : `${state.companies.size}家公司`;
    const cpText = `${state.cps.size}个CP`;
    const years = Array.from(state.years).sort();
    const yearText = years.length ? (years.length <= 3 ? years.join("、") : `${years[0]}–${years[years.length - 1]}`) : "未选年份";
    const likeText = state.customLikeMin !== null || state.customLikeMax !== null ?
        `点赞 ${state.customLikeMin ?? 0}–${state.customLikeMax ?? "∞"}` : `${state.tiers.size}个点赞档`;
    document.getElementById("filterSummaryText").innerText = `（${companyText} · ${cpText} · ${yearText} · ${likeText} · 命中 ${totalArticles} 条）`;
    document.getElementById("mobileCompanyCount").innerText = `${state.companies.size} 个已选`;
    document.getElementById("mobileCpCount").innerText = `${state.cps.size} 个已选`;
    document.getElementById("mobileYearCount").innerText = `${state.years.size} 个已选`;
    document.getElementById("mobileTierCount").innerText = state.customLikeMin !== null || state.customLikeMax !== null ? "使用精确区间" : `${state.tiers.size} 个已选`;
    document.getElementById("mobileFilterResultCount").innerText = totalArticles.toLocaleString();
}

function update() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(updateNow, 180);
}

function updateNow() {
    const rows = getFilteredRows();
    updateKPIs(rows);
    drawCpBar(rows);
    drawLikesChart(rows);
    drawGrowthChart(rows);
    drawHeatmap(rows);
    syncFocusSelectAndDraw(rows);
}

function syncFocusSelectAndDraw(rows) {
    const availableCps = Array.from(state.cps).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    focusCpChoices = availableCps;
    if (!availableCps.length) {
        document.getElementById("focusCpSearch").value = ""; selectedFocusCp = ""; drawFocusArea(rows); return;
    }
    if (selectedFocusCp && !state.cps.has(selectedFocusCp)) selectedFocusCp = "";
    document.getElementById("focusCpSearch").value = selectedFocusCp;
    if (!document.getElementById("focusCpOptions").hidden) renderFocusCpOptions();
    drawFocusArea(rows);
}

// 🌟 方案一核心：上下双图联动渲染
// 🚀 性能优化 3：全站大盘趋势图改为橙色渐变，并用透明的大半径圆做悬浮响应区（不再画可见圆点）。
// 同时用持久化 <g> + key-joined 元素代替每次 selectAll("*").remove() 全量重建，减少 DOM 抖动。
function drawGrowthChart(rows) {
    const valid = rows.filter(d => d.month_year);
    const months = continuousMonths(valid);

    const totalSvg = d3.select("#growthTotalChart");
    const cpSvg = d3.select("#growthChart");
    const legendBox = d3.select("#growthLegend").html("");

    if (!months.length || !valid.length) {
        totalSvg.selectAll("*").remove();
        cpSvg.selectAll("*").remove();
        growthTotalG = null; growthCpG = null;
        totalSvg.append("text").attr("fill", "var(--text-sub)").attr("y", 20).text("暂无匹配数据");
        cpSvg.append("text").attr("fill", "var(--text-sub)").attr("y", 20).text("暂无匹配数据");
        return;
    }

    const totalByMonth = d3.rollup(valid, v => v.length, d => d.month_year);
    const totalData = months.map(m => ({ month: m, count: totalByMonth.get(m) || 0 }));

    const topNRaw = document.getElementById("growthTopNSelect").value;
    const cpTotals = d3.rollup(valid, v => v.length, d => d.cp);
    const allFilteredCps = Array.from(state.cps).filter(cp => cpTotals.has(cp)).sort((a, b) => cpTotals.get(b) - cpTotals.get(a));

    let displayCps = allFilteredCps;
    if (topNRaw !== "all" && allFilteredCps.length > +topNRaw) {
        displayCps = allFilteredCps.slice(0, +topNRaw);
    }

    const byCp = d3.group(valid, d => d.cp);
    const cpSeries = displayCps.map(cp => {
        const cpRows = byCp.get(cp) || [];
        const countByMonth = d3.rollup(cpRows, v => v.length, d => d.month_year);
        return {
            cp,
            points: months.map(m => ({ month: m, count: countByMonth.get(m) || 0 }))
        };
    });

    const width = totalSvg.node().parentElement.clientWidth || 600;
    const compactTimeAxis = width <= 520;
    const margin = { top: 15, right: 25, bottom: 25, left: compactTimeAxis ? 38 : 40 };
    const x = d3.scalePoint().domain(months).range([margin.left, width - margin.right]);
    const timeTickTarget = compactTimeAxis ? 4 : (width <= 720 ? 6 : 8);
    const trendTickStep = Math.max(1, Math.ceil(months.length / timeTickTarget));
    let trendTicks = months.filter((_, i) => i % trendTickStep === 0 || i === months.length - 1);
    if (compactTimeAxis) {
        const years = Array.from(new Set(months.map(month => month.slice(0, 4))));
        const yearStep = Math.max(1, Math.ceil(years.length / 4));
        const shownYears = years.filter((_, i) => i % yearStep === 0 || i === years.length - 1);
        trendTicks = shownYears.map(year => months.find(month => month.startsWith(year))).filter(Boolean);
    }
    const formatMonthTick = month => compactTimeAxis ? month.slice(0, 4) : month;

    // 1. 上图：全站大盘面积趋势图（橙色渐变）
    const totalHeight = 130;
    totalSvg.attr("width", width).attr("height", totalHeight);
    const yTotalMax = d3.max(totalData, d => d.count) || 1;
    const yTotal = d3.scaleLinear().domain([0, yTotalMax]).nice().range([totalHeight - margin.bottom, margin.top]);

    if (!growthTotalG) {
        totalSvg.selectAll("*").remove();
        const defs = totalSvg.append("defs");
        const areaGradient = defs.append("linearGradient").attr("id", "totalTrendGradient").attr("x1", "0%").attr("y1", "0%").attr("x2", "0%").attr("y2", "100%");
        areaGradient.append("stop").attr("offset", "0%").attr("stop-color", "#b86f7d").attr("stop-opacity", 0.24);
        areaGradient.append("stop").attr("offset", "100%").attr("stop-color", "#b86f7d").attr("stop-opacity", 0.015);

        growthTotalG = totalSvg.append("g");
        growthTotalG.append("g").attr("class", "axis y-axis");
        growthTotalG.append("g").attr("class", "axis x-axis");
        growthTotalG.append("path").attr("class", "total-area").attr("fill", "url(#totalTrendGradient)");
        growthTotalG.append("path").attr("class", "total-line").attr("fill", "none").attr("stroke", "#b86f7d").attr("stroke-width", 2);
        growthTotalG.append("g").attr("class", "total-dots-layer");
    }

    growthTotalG.select(".y-axis").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(yTotal).ticks(3).tickFormat(compactTimeAxis ? formatAxisCompact : formatNumber));
    growthTotalG.select(".x-axis").attr("transform", `translate(0,${totalHeight - margin.bottom})`)
        .call(d3.axisBottom(x).tickValues(trendTicks).tickFormat(formatMonthTick));

    const area = d3.area().x(d => x(d.month)).y0(totalHeight - margin.bottom).y1(d => yTotal(d.count)).curve(d3.curveMonotoneX);
    const lineTotal = d3.line().x(d => x(d.month)).y(d => yTotal(d.count)).curve(d3.curveMonotoneX);

    growthTotalG.select(".total-area").datum(totalData).attr("d", area);
    growthTotalG.select(".total-line").datum(totalData).attr("d", lineTotal);

    // 透明悬浮响应区（不显示可见圆点，只用于捕获 mousemove）
    growthTotalG.select(".total-dots-layer").selectAll("circle").data(totalData, d => d.month).join(
        enter => enter.append("circle")
            .attr("cx", d => x(d.month)).attr("cy", d => yTotal(d.count)).attr("r", 8)
            .attr("fill", "transparent")
            .style("cursor", "pointer")
            .on("mousemove", (e, d) => showTooltip(`<b>全站大盘总量</b><br>${d.month}: 新增 <b>${d.count}</b> 篇${lastMonthIncomplete && d.month === lastMonth ? `<br><span style="color:#f3bd75">本月截至 ${+cutoffDate[2]}/${+cutoffDate[3]}</span>` : ""}`, e))
            .on("mouseleave", hideTooltip),
        update => update.attr("cx", d => x(d.month)).attr("cy", d => yTotal(d.count)),
        exit => exit.remove()
    );

    const cutoffText = window.DASHBOARD_META?.data_cutoff || "";
    const cutoffDate = cutoffText.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const lastMonth = months[months.length - 1];
    const lastMonthIncomplete = Boolean(cutoffDate && `${cutoffDate[1]}-${cutoffDate[2]}` === lastMonth && +cutoffDate[3] < new Date(+cutoffDate[1], +cutoffDate[2], 0).getDate());
    const peakData = lastMonthIncomplete ? totalData.slice(0, -1) : totalData;
    const peakValue = d3.max(peakData, d => d.count) || 0;
    const peakMonths = peakData.filter(d => d.count === peakValue).map(d => d.month);
    document.getElementById("totalTrendMeta").innerText = `单月新增峰值：${peakMonths.join("、")} · ${peakValue} 篇`;
    const completeTotalData = lastMonthIncomplete ? totalData.slice(0, -1) : totalData;
    const partialTotalData = lastMonthIncomplete ? totalData.slice(-2) : [];
    growthTotalG.select(".total-area").datum(completeTotalData).attr("d", area);
    growthTotalG.select(".total-line").datum(completeTotalData).attr("d", lineTotal);
    const bandStart = lastMonthIncomplete ? (months.length > 1 ? (x(months[months.length - 2]) + x(lastMonth)) / 2 : margin.left) : 0;
    growthTotalG.selectAll("rect.current-month-band").data(lastMonthIncomplete ? [lastMonth] : []).join("rect")
        .attr("class", "current-month-band").attr("x", bandStart).attr("y", margin.top)
        .attr("width", Math.max(0, width - margin.right - bandStart)).attr("height", totalHeight - margin.top - margin.bottom)
        .attr("rx", 3).attr("fill", "#f3bd75").attr("fill-opacity", .13).lower();
    growthTotalG.selectAll("path.total-partial-line").data(lastMonthIncomplete ? [partialTotalData] : []).join("path")
        .attr("class", "total-partial-line").attr("fill", "none").attr("stroke", "#b86f7d").attr("stroke-width", 2)
        .attr("stroke-dasharray", "5 4").attr("d", d => lineTotal(d));
    growthTotalG.selectAll("circle.total-partial-point").data(lastMonthIncomplete ? [totalData[totalData.length - 1]] : []).join("circle")
        .attr("class", "total-partial-point").attr("cx", d => x(d.month)).attr("cy", d => yTotal(d.count)).attr("r", 3.5)
        .attr("fill", "var(--bg-card)").attr("stroke", "#b86f7d").attr("stroke-width", 2);
    growthTotalG.selectAll("text.current-month-note").data(lastMonthIncomplete ? [cutoffDate[3]] : []).join("text")
        .attr("class", "current-month-note").attr("x", width - margin.right).attr("y", margin.top + 9).attr("text-anchor", "end")
        .attr("fill", "var(--text-sub)").attr("font-size", 9).text(day => `截至 ${+cutoffDate[2]}/${+day}`);

    // 2. 下图：各 CP 趋势折线图
    const cpHeight = 260;
    cpSvg.attr("width", width).attr("height", cpHeight);
    const yCpMax = d3.max(cpSeries, s => d3.max(s.points, p => p.count)) || 1;
    const yCp = d3.scaleLinear().domain([0, yCpMax]).nice().range([cpHeight - margin.bottom, margin.top]);

    if (!growthCpG) {
        cpSvg.selectAll("*").remove();
        growthCpG = cpSvg.append("g");
        growthCpG.append("g").attr("class", "axis y-axis");
        growthCpG.append("g").attr("class", "axis x-axis");
        growthCpG.append("g").attr("class", "series-layer");
    }

    growthCpG.selectAll("rect.current-month-band").data(lastMonthIncomplete ? [lastMonth] : []).join("rect")
        .attr("class", "current-month-band").attr("x", bandStart).attr("y", margin.top)
        .attr("width", Math.max(0, width - margin.right - bandStart)).attr("height", cpHeight - margin.top - margin.bottom)
        .attr("rx", 3).attr("fill", "#f3bd75").attr("fill-opacity", .13).lower();

    growthCpG.select(".y-axis").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(yCp).ticks(5).tickFormat(compactTimeAxis ? formatAxisCompact : formatNumber));
    growthCpG.select(".x-axis").attr("transform", `translate(0,${cpHeight - margin.bottom})`)
        .call(d3.axisBottom(x).tickValues(trendTicks).tickFormat(formatMonthTick))
        .selectAll("text").attr("transform", "rotate(0)").style("text-anchor", "middle");

    const lineCp = d3.line().x(d => x(d.month)).y(d => yCp(d.count)).curve(d3.curveMonotoneX);

    const seriesSel = growthCpG.select(".series-layer").selectAll("g.series-group").data(cpSeries, d => d.cp);
    seriesSel.exit().remove();
    const seriesEnter = seriesSel.enter().append("g").attr("class", "series-group");
    // 可见的细线：只做展示，鼠标不容易精确悬浮到
    seriesEnter.append("path").attr("class", "series-line").attr("fill", "none").attr("stroke-width", 2).attr("pointer-events", "none");
    seriesEnter.append("path").attr("class", "series-partial-line").attr("fill", "none").attr("stroke-width", 2).attr("stroke-dasharray", "5 4").attr("pointer-events", "none");
    seriesEnter.append("circle").attr("class", "series-partial-point").attr("r", 3).attr("fill", "var(--bg-card)").attr("stroke-width", 2).attr("pointer-events", "none");
    // 透明的粗「命中区」：专门用来接收 hover/click，比细线更容易悬浮到
    seriesEnter.append("path").attr("class", "series-hit").attr("fill", "none").attr("stroke", "transparent").attr("stroke-width", 12).style("cursor", "pointer");
    seriesEnter.append("g").attr("class", "series-dots");
    const seriesMerged = seriesEnter.merge(seriesSel);

    seriesMerged.each(function(s) {
        const sGroup = d3.select(this);
        const completePoints = lastMonthIncomplete ? s.points.slice(0, -1) : s.points;
        const partialPoints = lastMonthIncomplete ? s.points.slice(-2) : [];
        sGroup.select(".series-line")
            .attr("stroke", cpColor(s.cp))
            .attr("d", lineCp(completePoints));
        sGroup.select(".series-partial-line").attr("stroke", cpColor(s.cp)).attr("d", lastMonthIncomplete ? lineCp(partialPoints) : null);
        sGroup.select(".series-partial-point").attr("stroke", cpColor(s.cp))
            .attr("display", lastMonthIncomplete ? null : "none")
            .attr("cx", lastMonthIncomplete ? x(s.points[s.points.length - 1].month) : 0)
            .attr("cy", lastMonthIncomplete ? yCp(s.points[s.points.length - 1].count) : 0);

        sGroup.select(".series-hit")
            .attr("d", lineCp(s.points))
            .on("mouseenter", () => setGrowthHighlight(s.cp))
            .on("mouseleave", () => setGrowthHighlight(null))
            .on("click", event => activateChartCp(event, s.cp, setGrowthHighlight, `<b>${s.cp}</b><br>当前时间范围新增：<b>${d3.sum(s.points, point => point.count).toLocaleString()}</b> 篇`));

        sGroup.select(".series-dots").selectAll("circle").data(s.points, p => p.month).join(
            enter => enter.append("circle")
                .attr("cx", d => x(d.month)).attr("cy", d => yCp(d.count)).attr("r", 5)
                .attr("fill", cpColor(s.cp)).attr("opacity", 0)
                .style("cursor", "pointer")
                .on("mousemove", (e, d) => { setGrowthHighlight(s.cp); showTooltip(`<b>${s.cp}</b><br>${d.month}: 新增 <b>${d.count}</b> 篇${lastMonthIncomplete && d.month === lastMonth ? `<br><span style="color:#f3bd75">本月截至 ${+cutoffDate[2]}/${+cutoffDate[3]}</span>` : ""}<br><span style="color:#60a5fa; font-size:11px;">🎯 点击直接聚焦该 CP</span>`, e); })
                .on("mouseleave", () => { setGrowthHighlight(null); hideTooltip(); })
                .on("click", (event, d) => activateChartCp(event, s.cp, setGrowthHighlight, `<b>${s.cp}</b><br>${d.month}: 新增 <b>${d.count}</b> 篇`)),
            update => update.attr("cx", d => x(d.month)).attr("cy", d => yCp(d.count)),
            exit => exit.remove()
        );

        const shortName = s.cp.length > 10 ? s.cp.slice(0, 9) + '…' : s.cp;
        const totalCount = d3.sum(s.points, point => point.count);
        legendBox.append("div")
            .attr("class", "growth-legend-row")
            .attr("data-cp", s.cp)
            .on("click", event => activateLegend(event, "growth", s.cp, setGrowthHighlight, `<b>${s.cp}</b><br>当前时间范围新增：<b>${totalCount.toLocaleString()}</b> 篇`))
            .on("mouseenter", () => setGrowthHighlight(s.cp))
            .on("mouseleave", () => setGrowthHighlight(null))
            .html(`<span class="growth-legend-swatch" style="background:${cpColor(s.cp)};"></span><span>${shortName}</span>`);
    });
}

// 悬浮某条 CP 折线 / 图例时，让其它线和图例项淡出，方便在多条线堆叠时聚焦查看
// cp 传 null 表示恢复全部正常显示
function setGrowthHighlight(cp) {
    if (!growthCpG) return;
    growthCpG.selectAll("g.series-group")
        .transition().duration(120)
        .style("opacity", d => (!cp || d.cp === cp) ? 1 : 0.15);
    d3.select("#growthLegend").selectAll(".growth-legend-row")
        .transition().duration(120)
        .style("opacity", function() {
            const rowCp = this.getAttribute("data-cp");
            return (!cp || rowCp === cp) ? 1 : 0.35;
        });
}

// 🚀 性能优化 4：持久化 <g> 容器 + key-joined bars/labels，筛选切换时只对变化的 CP 做增删/移动动画，
// 而不是每次都清空重画所有条形。
function drawCpBar(rows) {
    const topNRaw = document.getElementById("cpBarTopNSelect").value;
    const fullData = Array.from(d3.group(rows, d => d.cp), ([cp, items]) => ({
        cp,
        count: items.length,
        p90: d3.quantile(items, .9, d => d.likes) || 0,
        highCount: items.filter(d => d.likes >= 1000).length
    })).sort((a, b) => b.count - a.count);
    let data = fullData;
    if (topNRaw !== "all" && fullData.length > +topNRaw) data = fullData.slice(0, +topNRaw);

    const svg = d3.select("#cpBarChart");
    const width = Math.max(svg.node().parentElement.clientWidth - 8, 320);
    const compactChart = width <= 520;
    const height = compactChart ? 310 : 330;
    svg.attr("width", width).attr("height", height);
    svg.selectAll("*").remove();
    cpBarG = null;

    if (!data.length) {
        svg.append("text").attr("fill", "var(--text-sub)").attr("y", 20).text("暂无数据");
        d3.select("#cpProfileLegend").html("");
        return;
    }

    const margin = { top: 18, right: 22, bottom: compactChart ? 34 : 38, left: compactChart ? 38 : 46 };
    const x = d3.scaleSqrt().domain([0, d3.max(data, d => d.count) || 1]).nice().range([margin.left, width - margin.right]);
    const yMax = d3.max(data, d => d.p90) || 1;
    const y = d3.scaleLinear().domain([0, yMax * 1.08]).nice().range([height - margin.bottom, margin.top]);
    const radius = d3.scaleSqrt().domain([0, d3.max(data, d => d.highCount) || 1]).range([6, 22]);
    const g = svg.append("g");
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${height-margin.bottom})`).call(d3.axisBottom(x).ticks(5).tickFormat(formatNumber));
    g.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(compactChart ? formatAxisCompact : formatNumber));

    const points = g.selectAll("g.cp-point").data(data, d => d.cp).join("g")
        .attr("class", "cp-point").attr("transform", d => `translate(${x(d.count)},${y(d.p90)})`)
        .attr("data-cp", d => d.cp)
        .attr("tabindex", 0).attr("role", "button").style("cursor", "pointer")
        .on("mousemove", (e, d) => showTooltip(`<b>${d.cp}</b><br>作品：${d.count.toLocaleString()}<br>点赞 P90：${Math.round(d.p90).toLocaleString()}<br>1000+：${d.highCount} 篇`, e))
        .on("mouseenter", (e, d) => setProfileHighlight(d.cp))
        .on("mouseleave", () => { hideTooltip(); setProfileHighlight(null); }).on("click", (e, d) => activateChartCp(e, d.cp, setProfileHighlight, `<b>${d.cp}</b><br>作品：${d.count.toLocaleString()}<br>点赞 P90：${Math.round(d.p90).toLocaleString()}<br>1000+：${d.highCount} 篇`))
        .on("keydown", (e, d) => { if (e.key === "Enter" || e.key === " ") setFocusCP(d.cp); });
    points.append("circle").attr("r", d => radius(d.highCount)).attr("fill", d => cpColor(d.cp)).attr("stroke", "#fff").attr("stroke-width", 1.5);
    const legend = d3.select("#cpProfileLegend").html("").attr("class", "chart-legend");
    data.forEach(d => {
        const item = legend.append("button").attr("type", "button").attr("class", "chart-legend-button").attr("data-cp", d.cp)
            .on("click", event => activateLegend(event, "profile", d.cp, setProfileHighlight, `<b>${d.cp}</b><br>作品：${d.count.toLocaleString()}<br>点赞 P90：${Math.round(d.p90).toLocaleString()}<br>1000+：${d.highCount} 篇`)).on("mouseenter focus", () => setProfileHighlight(d.cp)).on("mouseleave blur", () => setProfileHighlight(null));
        item.append("span").style("background", cpColor(d.cp));
        item.append("b").text(d.cp);
    });
}

function setProfileHighlight(cp) {
    d3.select("#cpBarChart").selectAll(".cp-point")
        .style("opacity", function() { return !cp || this.getAttribute("data-cp") === cp ? 1 : .14; });
    d3.select("#cpProfileLegend").selectAll(".chart-legend-button[data-cp]")
        .style("opacity", function() { return !cp || this.getAttribute("data-cp") === cp ? 1 : .3; });
}

function drawLikesChart(rows) {
    const svg = d3.select("#likesChart");
    if (!rows.length) {
        svg.selectAll("*").remove();
        likesG = null;
        svg.attr("width", 300).attr("height", 60).append("text").attr("fill", "var(--text-sub)").attr("y", 20).text("暂无数据");
        d3.select("#likesLegend").html(""); return;
    }
    const topNRaw = document.getElementById("likesTopNSelect").value;
    const cpTotals = d3.rollup(rows, v => v.length, d => d.cp);
    let rankedCps = Array.from(cpTotals.keys()).sort((a, b) => cpTotals.get(b) - cpTotals.get(a));
    let othersCps = [];
    if (topNRaw !== "all" && rankedCps.length > +topNRaw) {
        othersCps = rankedCps.slice(+topNRaw);
        rankedCps = rankedCps.slice(0, +topNRaw);
    }
    const othersKey = "__OTHERS__";
    const stackKeys = othersCps.length ? [...rankedCps, othersKey] : rankedCps.slice();
    const tierCpCounts = d3.rollup(rows, v => v.length, d => d.tier, d => d.cp);
    const normalizedData = TIER_ORDER.map(tier => {
        const counts = tierCpCounts.get(tier) || new Map();
        const total = d3.sum(Array.from(counts.values())) || 0;
        const row = { tier, total };
        stackKeys.forEach(key => {
            const count = key === othersKey ? d3.sum(othersCps, cp => counts.get(cp) || 0) : (counts.get(key) || 0);
            row[key] = total ? count / total * 100 : 0;
            row[`_${key}`] = count;
        });
        return row;
    });
    const series = d3.stack().keys(stackKeys)(normalizedData);
    const width = svg.node().parentElement.clientWidth || 400;
    const margin = { top: 8, right: 12, bottom: 30, left: width <= 520 ? 58 : 70 };
    const height = 320;
    svg.attr("width", width).attr("height", height);
    const x = d3.scaleLinear().domain([0, 100]).range([margin.left, width - margin.right]);
    const y = d3.scaleBand().domain(TIER_ORDER).range([margin.top, height - margin.bottom]).padding(.2);
    const colorOf = key => key === othersKey ? "#d9cfd2" : cpColor(key);

    svg.selectAll("*").remove();
    likesG = svg.append("g");
    const g = likesG;
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${height-margin.bottom})`).call(d3.axisBottom(x).ticks(4).tickFormat(d => d + "%"));
    g.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y));

    g.selectAll(".series").data(series).join("g")
        .attr("class", "likes-series")
        .attr("data-cp", d => d.key)
        .attr("fill", d => colorOf(d.key))
        .selectAll("rect").data(d => d).join("rect")
        .attr("x", d => x(d[0])).attr("width", d => Math.max(x(d[1]) - x(d[0]), 0))
        .attr("y", d => y(d.data.tier)).attr("height", y.bandwidth())
        .attr("stroke", "#fff").attr("stroke-width", .65)
        .style("cursor", "pointer")
        .attr("tabindex", 0).attr("role", "button")
        .on("mousemove", function(e, d) {
            const key = d3.select(this.parentNode).datum().key;
            const abs = d.data[`_${key}`];
            if (!abs) return;
            const label = key === othersKey ? `其她 ${othersCps.length} 个 CP` : key;
            showTooltip(`<b>${d.data.tier}</b><br>${label}：<b>${d.data[key].toFixed(1)}%</b>（${abs} 篇）`, e);
        })
        .on("mouseenter", function() { setLikesHighlight(d3.select(this.parentNode).datum().key); })
        .on("mouseleave", () => { hideTooltip(); setLikesHighlight(null); })
        .on("click", function(event, d) { const key = d3.select(this.parentNode).datum().key; if (key !== othersKey) activateChartCp(event, key, setLikesHighlight, `<b>${d.data.tier}</b><br>${key}：<b>${d.data[key].toFixed(1)}%</b>（${d.data[`_${key}`]} 篇）`); })
        .on("keydown", function(e) { const key = d3.select(this.parentNode).datum().key; if ((e.key === "Enter" || e.key === " ") && key !== othersKey) setFocusCP(key); });

    const legendBox = d3.select("#likesLegend").html("").attr("class", "chart-legend");
    rankedCps.forEach(cp => {
        const item = legendBox.append("button").attr("type", "button").attr("class", "chart-legend-button").attr("data-cp", cp)
            .on("click", event => activateLegend(event, "likes", cp, setLikesHighlight, `<b>${cp}</b><br>当前筛选范围作品：<b>${(cpTotals.get(cp) || 0).toLocaleString()}</b> 篇`)).on("mouseenter focus", () => setLikesHighlight(cp)).on("mouseleave blur", () => setLikesHighlight(null));
        item.append("span").style("background", cpColor(cp));
        item.append("b").text(cp);
    });
    if (othersCps.length) {
        const item = legendBox.append("div").attr("class", "chart-legend-button likes-others");
        item.append("span").style("background", "#d9cfd2"); item.append("b").text(`其她 ${othersCps.length} CP`);
    }
}

function setLikesHighlight(cp) {
    d3.select("#likesChart").selectAll(".likes-series")
        .style("opacity", function() { return !cp || this.getAttribute("data-cp") === cp ? 1 : .14; });
    d3.select("#likesLegend").selectAll(".chart-legend-button[data-cp]")
        .style("opacity", function() { return !cp || this.getAttribute("data-cp") === cp ? 1 : .3; });
}

function renderHeatmapCpChecks() {
    const container = d3.select("#heatmapCpChecks").html("");
    heatmapCpChoices.forEach(cp => {
        const label = container.append("label").attr("class", "checkbox-item");
        label.append("input").attr("type", "checkbox").attr("value", cp).property("checked", !heatmapHiddenCps.has(cp));
        label.append("span").text(cp);
    });
    const hiddenCount = heatmapCpChoices.filter(cp => heatmapHiddenCps.has(cp)).length;
    document.getElementById("heatmapHiddenCount").innerText = `已隐藏 ${hiddenCount} 个`;
}

function drawHeatmap(rows) {
    const metric = document.getElementById("metricSelect").value;
    const rangeRaw = document.getElementById("heatmapRangeSelect").value;
    const sortMode = document.getElementById("heatmapSortSelect").value;
    const topNRaw = document.getElementById("heatmapTopNSelect").value;
    const allValid = rows.filter(d => d.month_year);
    const selectableCps = Array.from(state.cps).filter(c => cpColor.domain().includes(c));
    const allCps = selectableCps.filter(cp => !heatmapHiddenCps.has(cp));
    const allMonths = continuousMonths(allValid);
    const months = rangeRaw === "all" ? allMonths : allMonths.slice(-Math.max(1, +rangeRaw));
    const visibleMonths = new Set(months);
    const valid = allValid.filter(d => visibleMonths.has(d.month_year));
    const container = d3.select("#heatmapContainer").html("");

    if (!months.length || !selectableCps.length) {
        container.append("div").style("color", "var(--text-sub)").style("padding", "30px 0").style("text-align", "center").text("暂无匹配数据");
        d3.select("#heatmapLegend").html(""); return;
    }

    const agg = new Map();
    valid.forEach(d => {
        const key = d.cp + "|" + d.month_year;
        if (!agg.has(key)) agg.set(key, { count: 0, likes: 0, view_count: 0, chapter_count: 0 });
        const o = agg.get(key);
        o.count++; o.likes += d.likes; o.view_count += d.view_count; o.chapter_count += d.chapter_count;
    });

    const cpTotal = new Map();
    selectableCps.forEach(cp => cpTotal.set(cp, 0));
    agg.forEach((o, key) => {
        const cp = key.slice(0, key.lastIndexOf("|"));
        if (cpTotal.has(cp)) cpTotal.set(cp, cpTotal.get(cp) + o[metric]);
    });

    let sortedCps = allCps.slice();
    if (sortMode === "alpha") sortedCps.sort((a, b) => a.localeCompare(b));
    else sortedCps.sort((a, b) => (cpTotal.get(b) || 0) - (cpTotal.get(a) || 0));

    if (topNRaw !== "all" && sortedCps.length > +topNRaw) sortedCps = sortedCps.slice(0, +topNRaw);
    const hiddenInScope = selectableCps.filter(cp => heatmapHiddenCps.has(cp));
    if (sortMode === "alpha") hiddenInScope.sort((a, b) => a.localeCompare(b));
    else hiddenInScope.sort((a, b) => (cpTotal.get(b) || 0) - (cpTotal.get(a) || 0));
    heatmapCpChoices = [...sortedCps, ...hiddenInScope];
    if (!document.getElementById("heatmapCpPanel").hidden) renderHeatmapCpChecks();
    if (!sortedCps.length) {
        container.append("div").style("color", "var(--text-sub)").style("padding", "30px 0").style("text-align", "center").text("当前 CP 均已隐藏，可在“调整 CP”中恢复");
        d3.select("#heatmapLegend").html(""); return;
    }

    const cellW = 28, cellH = 28, headerH = 20, footerH = 68;
    const leftPad = 10, rightPad = 64;
    const gridW = months.length * cellW, gridH = sortedCps.length * cellH;

    const cellVals = [];
    sortedCps.forEach(cp => {
        months.forEach(m => { const c = agg.get(cp + "|" + m); if (c) cellVals.push(c[metric]); });
    });

    const maxVal = d3.max(cellVals) || 1;
    const color = d3.scaleSequentialSqrt(heatInterpolator).domain([0, maxVal]).clamp(true);

    const wrapper = container.append("div").attr("class", "heatmap-wrapper");
    const fixedBox = wrapper.append("div").attr("class", "heatmap-fixed-labels");
    const leftSvg = fixedBox.append("svg").attr("width", 150).attr("height", gridH + headerH + footerH);
    const leftG = leftSvg.append("g").attr("transform", `translate(0, ${headerH})`);

    sortedCps.forEach((cp, i) => {
        const yPos = i * cellH;
        const cpTotal = d3.sum(months, month => agg.get(cp + "|" + month)?.count || 0);
        const rowBtn = leftG.append("g").style("cursor", "pointer").attr("tabindex", 0).attr("role", "button")
            .on("click", event => activateChartCp(event, cp, null, `<b>${cp}</b><br>当前时间范围发文：<b>${cpTotal.toLocaleString()}</b> 篇`))
            .on("keydown", e => { if (e.key === "Enter" || e.key === " ") setFocusCP(cp); });
        rowBtn.append("circle").attr("cx", 12).attr("cy", yPos + cellH / 2).attr("r", 4).attr("fill", cpColor(cp));
        rowBtn.append("text").attr("x", 22).attr("y", yPos + cellH / 2 + 4).attr("fill", "var(--text-main)").attr("font-size", "12px")
            .text(cp.length > 16 ? cp.slice(0, 15) + '…' : cp).append("title").text(cp);
    });

    const scrollArea = wrapper.append("div").attr("class", "heatmap-scroll-area");
    const rightSvg = scrollArea.append("svg").attr("width", gridW + leftPad + rightPad).attr("height", gridH + headerH + footerH);
    const rightG = rightSvg.append("g").attr("transform", `translate(${leftPad}, ${headerH})`);

    sortedCps.forEach((cp, i) => {
        const yPos = i * cellH;
        months.forEach((m, j) => {
            const xPos = j * cellW;
            const o = agg.get(cp + "|" + m);
            const val = o ? o[metric] : 0;
            const cell = rightG.append("rect")
                .attr("x", xPos + 1).attr("y", yPos + 2).attr("width", cellW - 2).attr("height", cellH - 4)
                .attr("rx", 3).attr("fill", val === 0 ? "#f8fafc" : color(val))
                .style("cursor", val ? "pointer" : "default")
                .attr("aria-label", `${cp}，${m}，${metric}：${val}`);

            if (val) {
                cell.on("mousemove", (e) => showTooltip(`<b>${cp}</b> · ${m}<br>发文: ${o.count}篇 · 点赞: ${formatNumber(o.likes)}`, e))
                    .on("mouseleave", hideTooltip)
                    .on("click", event => activateChartCp(event, cp, null, `<b>${cp}</b> · ${m}<br>发文: ${o.count}篇 · 点赞: ${formatNumber(o.likes)}`));
            }
        });
    });

    const monthG = rightG.append("g").attr("transform", `translate(0, ${gridH})`);
    months.forEach((m, j) => {
        const xPos = j * cellW + cellW / 2;
        monthG.append("text").attr("x", xPos).attr("y", 14).attr("text-anchor", "start").attr("fill", "var(--text-muted)").attr("font-size", "9.5px").attr("transform", `rotate(40, ${xPos}, 14)`).text(m);
    });

    const metricLabels = { count: "发文篇数", likes: "点赞总量", view_count: "阅读总量", chapter_count: "章节总量" };
    const legend = d3.select("#heatmapLegend").html("")
        .style("display", "flex").style("align-items", "center").style("gap", "10px").style("font-size", "11.5px").style("color", "var(--text-muted)");
    legend.append("span").text(metricLabels[metric]);
    legend.append("span").text("0");
    legend.append("span").style("display", "inline-block").style("width", "180px").style("height", "10px")
        .style("border-radius", "999px").style("background", `linear-gradient(90deg, ${color(0)}, ${color(maxVal * 0.5)}, ${color(maxVal)})`);
    legend.append("span").text(formatNumber(maxVal));

    // 默认展示最近月份，而不是每次从最早月份开始。
    requestAnimationFrame(() => {
        const node = scrollArea.node();
        if (node) node.scrollLeft = node.scrollWidth - node.clientWidth;
    });
}

function drawFocusArea(rows) {
    if (!selectedFocusCp) {
        document.getElementById("currentFocusCpLabel").innerText = "选择一对 CP";
        document.getElementById("articleCountBadge").innerText = "共 0 篇";
        document.getElementById("focusArticleTotal").innerText = "—";
        document.getElementById("focusCompletionRate").innerText = "—";
        document.getElementById("focusHighLikeRate").innerText = "—";
        document.getElementById("focusPeakMonth").innerText = "—";
        renderFocusTable([]); return;
    }

    const cpArticles = rows.filter(d => d.cp === selectedFocusCp);
    currentFocusArticles = cpArticles;
    tableVisibleCount = getTablePageSize();
    renderFocusTable(cpArticles);

    document.getElementById("currentFocusCpLabel").innerText = selectedFocusCp;
    const cacheKey = `${selectedFocusCp}|${Array.from(state.companies).sort().join(",")}|${Array.from(state.cps).sort().join(",")}|${Array.from(state.years).sort().join(",")}|${Array.from(state.tiers).sort().join(",")}|${state.customLikeMin ?? ""}|${state.customLikeMax ?? ""}|${state.includeReview}`;
    let stats = focusStatsCache.get(cacheKey);
    if (!stats) {
        const completionRate = cpArticles.length ? cpArticles.filter(d => d.is_end).length / cpArticles.length * 100 : 0;
        const highCount = cpArticles.filter(d => d.likes >= 1000).length;
        const highRate = cpArticles.length ? (highCount / cpArticles.length * 100).toFixed(1) : "0.0";
        const monthCounts = d3.rollup(cpArticles.filter(d => d.month_year), v => v.length, d => d.month_year);
        const peakMonth = Array.from(monthCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
        stats = { completionRate, highRate, peakMonth: peakMonth ? peakMonth[0] : "无有效日期" };
        if (focusStatsCache.size >= 200) focusStatsCache.clear();
        focusStatsCache.set(cacheKey, stats);
    }
    document.getElementById("focusArticleTotal").innerText = cpArticles.length.toLocaleString();
    document.getElementById("focusCompletionRate").innerText = `${stats.completionRate.toFixed(1)}%`;
    document.getElementById("focusHighLikeRate").innerText = `${stats.highRate}%`;
    document.getElementById("focusPeakMonth").innerText = stats.peakMonth;
}

function renderFocusTable(cpArticles) {
    const tbody = d3.select("#articleTableBody");
    tbody.selectAll("*").remove();
    if (!selectedFocusCp) {
        currentFocusArticles = [];
        document.getElementById("loadMoreArticlesBtn").hidden = true;
        document.getElementById("articleCountBadge").innerText = `共 0 篇`; return;
    }
    let filtered = [...cpArticles];
    if (tableStatusMode === "ended") filtered = filtered.filter(d => d.is_end);
    if (tableStatusMode === "ongoing") filtered = filtered.filter(d => !d.is_end);
    if (tableSearchQuery) {
        filtered = filtered.filter(d => (d.title && d.title.toLowerCase().includes(tableSearchQuery)) || (d.author && d.author.toLowerCase().includes(tableSearchQuery)));
    }
    const visible = filtered.slice(0, tableVisibleCount);
    document.getElementById("articleCountBadge").innerText = `展示 ${Math.min(tableVisibleCount, filtered.length)} / ${filtered.length} 篇`;
    const loadMoreButton = document.getElementById("loadMoreArticlesBtn");
    loadMoreButton.hidden = visible.length >= filtered.length;
    loadMoreButton.innerText = `加载更多（剩余 ${(filtered.length - visible.length).toLocaleString()} 篇）`;
    if (!filtered.length) {
        document.getElementById("loadMoreArticlesBtn").hidden = true;
        tbody.append("tr").append("td").attr("colspan", 6).style("text-align", "center").style("color", "var(--text-sub)").style("padding", "20px 0").text("无匹配作品"); return;
    }
    const sorters = {
        likes_desc: (a, b) => b.likes - a.likes,
        date_desc: (a, b) => (b.publish_date_obj?.getTime() || 0) - (a.publish_date_obj?.getTime() || 0),
        views_desc: (a, b) => b.view_count - a.view_count,
        title_asc: (a, b) => a.title.localeCompare(b.title)
    };
    filtered.sort(sorters[tableSortMode] || sorters.likes_desc).slice(0, tableVisibleCount).forEach(d => {
        const tr = tbody.append("tr");
        const linkTd = tr.append("td").attr("class", "title-cell");
        if (d.url && d.url !== "#") linkTd.append("a").attr("href", d.url).attr("target", "_blank").attr("rel", "noopener noreferrer").attr("title", d.title).text(d.title);
        else linkTd.append("span").attr("class", "plain-title").attr("title", d.title).text(d.title);
        tr.append("td").append("span").attr("class", "author-text").text(d.author);
        tr.append("td").style("color", "var(--text-muted)").text(d.publish_date_str);
        tr.append("td").style("text-align", "right").style("font-weight", "700").text(d.likes.toLocaleString());
        tr.append("td").style("text-align", "right").style("color", "var(--text-muted)").text(d.view_count.toLocaleString());
        tr.append("td").style("text-align", "center").append("span").attr("class", `tag-status ${d.is_end ? 'tag-end' : 'tag-ongoing'}`).text(d.is_end ? "完结" : "连载");
    });
}

let lastDailyCp = "";

function drawDailyCp() {
    const eligible = dedupeByLink(allParsedRows.filter(d =>
        (d.status || "").toLowerCase() === "ok" && d.publish_date_obj && d.url && d.url !== "#"
    ));
    if (!eligible.length) return;
    const grouped = d3.group(eligible, d => d.cp);
    const cps = Array.from(grouped.keys());
    let cp = cps[Math.floor(Math.random() * cps.length)];
    if (cps.length > 1 && cp === lastDailyCp) cp = cps[(cps.indexOf(cp) + 1) % cps.length];
    lastDailyCp = cp;
    const works = grouped.get(cp);
    const work = works[Math.floor(Math.random() * works.length)];
    document.getElementById("dailyDrawCp").innerText = cp;
    const title = document.getElementById("dailyWorkTitle");
    title.innerText = work.title;
    title.href = work.url;
    document.getElementById("dailyWorkAuthor").innerText = `作者：${work.author}`;
    document.getElementById("dailyWorkLikes").innerText = `♥ ${work.likes.toLocaleString()}`;
    document.getElementById("dailyWorkDate").innerText = work.publish_date_str;
    const layer = document.getElementById("dailyDrawLayer");
    layer.hidden = false;
    const card = layer.querySelector(".daily-draw-card");
    card.style.animation = "none";
    void card.offsetWidth;
    card.style.animation = "";
    document.getElementById("dailyDrawClose").focus();
}

function closeDailyDraw() {
    document.getElementById("dailyDrawLayer").hidden = true;
    document.getElementById("dailyDrawTrigger").focus();
}

document.getElementById("dailyDrawTrigger").addEventListener("click", event => {
    event.preventDefault();
    drawDailyCp();
});
document.getElementById("dailyDrawAgain").addEventListener("click", drawDailyCp);
document.getElementById("dailyDrawClose").addEventListener("click", closeDailyDraw);
document.getElementById("dailyDrawLayer").addEventListener("click", event => {
    if (event.target.id === "dailyDrawLayer") closeDailyDraw();
});
document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !document.getElementById("dailyDrawLayer").hidden) closeDailyDraw();
});

// 🚀 性能优化 5：resize 增加变化阈值判断，避免浏览器缩放/字体渲染引起的微小抖动触发整页重绘
let resizeTimer;
let lastWindowWidth = window.innerWidth;
window.addEventListener("resize", () => {
    if (!allParsedRows.length) return;
    if (Math.abs(window.innerWidth - lastWindowWidth) < 20) return;
    lastWindowWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { update(); }, 200);
});

// 容器宽度也可能在窗口宽度不变时发生变化（侧栏、缩放、布局切换）。
if (window.ResizeObserver) {
    let lastDashboardWidth = 0;
    const dashboardResizeObserver = new ResizeObserver(entries => {
        if (!allParsedRows.length) return;
        const width = Math.round(entries[0].contentRect.width);
        if (!width || Math.abs(width - lastDashboardWidth) < 2) return;
        lastDashboardWidth = width;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => update(), 120);
    });
    dashboardResizeObserver.observe(document.getElementById("dashboardGrid"));
}

document.getElementById("dataCutoff").innerText = window.DASHBOARD_META?.data_cutoff || "未知";
loadArticlesFile();
