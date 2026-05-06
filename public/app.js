(() => {
  const DATA_URL = 'data/digest.json';
  const ARCHIVE_INDEX_URL = 'data/archive/index.json';
  const ARCHIVE_DAY_URL = (date) => `data/archive/${date}.json`;
  const TABS = ['home', 'archive', 'bookmarks', 'options'];
  const VALID_CATEGORIES = ['新モデル', '研究', 'ビジネス', '規制', 'ツール'];

  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root = document) => root.querySelectorAll(sel);
  const elBody = document.body;
  const elLoading = $('loading');
  const elError = $('error');
  const elReload = $('reload-btn');
  const elTabbar = $('tabbar');

  const escapeHtml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const sanitizeUrl = (u) => /^https?:\/\//i.test(String(u || '').trim()) ? u : '#';
  const normalizeCategory = (c) => VALID_CATEGORIES.includes(c) ? c : 'その他';

  // **bold** / ==underline== / !!warning!! / \n をHTML化（XSS対策のため必ずescape後に処理）
  function richText(s) {
    if (!s) return '';
    let h = escapeHtml(s);
    // !!warning!! を最優先（赤太字）
    h = h.replace(/!!([^!]+)!!/g, '<span class="warn">$1</span>');
    // ==underline== （下線強調）
    h = h.replace(/==([^=]+)==/g, '<span class="hl">$1</span>');
    // **bold** （太字）
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong class="kw">$1</strong>');
    h = h.replace(/\r?\n/g, '<br/>');
    return h;
  }

  // detail_points: "**見出し**：本文" を key/value で整形
  function renderDetailPoint(p) {
    if (!p) return '';
    const m = String(p).match(/^\*\*([^*]+)\*\*\s*[:：]\s*(.+)$/);
    if (m) {
      return `<li class="dp-row"><span class="dp-key">${richText(m[1])}</span><span class="dp-val">${richText(m[2])}</span></li>`;
    }
    return `<li class="dp-row dp-row-plain">${richText(p)}</li>`;
  }

  // ===== 状態 =====
  const Store = {
    digest: null,           // 今日のダイジェスト
    archiveIndex: null,     // アーカイブ一覧
    archiveCache: {},       // 日付ごとの digest キャッシュ
    bookmarks: loadBookmarks(),
    settings: loadSettings(),
  };

  // ===== localStorage =====
  function loadBookmarks() {
    try { return JSON.parse(localStorage.getItem('ai-news.bookmarks') || '[]'); }
    catch { return []; }
  }
  function saveBookmarks() {
    localStorage.setItem('ai-news.bookmarks', JSON.stringify(Store.bookmarks));
  }
  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('ai-news.settings') || '{}'); } catch {}
    return {
      category: s.category || 'all',
      theme: s.theme === 'light' ? 'light' : 'dark',
      font: ['sm','md','lg'].includes(s.font) ? s.font : 'md',
      firstOpen: s.firstOpen === 'off' ? 'off' : 'on',
    };
  }
  function saveSettings() {
    localStorage.setItem('ai-news.settings', JSON.stringify(Store.settings));
  }

  // ===== topic ID（URLベースで一意に）=====
  function topicId(t) {
    return (t.url || '') + '|' + (t.title_ja || '');
  }
  function isBookmarked(t) {
    const id = topicId(t);
    return Store.bookmarks.some((b) => topicId(b) === id);
  }
  function toggleBookmark(t) {
    const id = topicId(t);
    const idx = Store.bookmarks.findIndex((b) => topicId(b) === id);
    if (idx >= 0) Store.bookmarks.splice(idx, 1);
    else Store.bookmarks.unshift({ ...t, _saved_at: new Date().toISOString() });
    saveBookmarks();
  }

  // ===== トピックカード描画 =====
  function renderTopic(t, idx, opts = {}) {
    const cat = normalizeCategory(t.category || '');
    const titleJaRich = richText(t.title_ja || '');
    const source = escapeHtml(t.source || '');
    const url = sanitizeUrl(t.url);
    const simple = richText(t.simple_explanation || '');
    const detailSummary = richText(t.detail_summary || '');
    const detailPoints = Array.isArray(t.detail_points) ? t.detail_points : [];
    const detailText = richText(t.detail_text || '');
    // 後方互換：旧 detail_explanation のみ持つアーカイブ
    const detailLegacy = !detailSummary && !detailPoints.length && !detailText && t.detail_explanation
      ? richText(t.detail_explanation) : '';
    const points = Array.isArray(t.points) ? t.points : [];
    const before = richText(t.before || '');
    const after = richText(t.after || '');
    const impact = richText(t.impact || '');
    const bookmarked = isBookmarked(t);
    const dataIdAttr = `data-topic-id="${escapeHtml(topicId(t))}"`;

    const hasDetail = detailSummary || detailPoints.length || detailText || detailLegacy;
    const detailHtml = hasDetail ? `
      <details class="detail-accordion">
        <summary>もっと詳しく知りたい方へ
          <svg class="chevron-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="detail-body">
          ${detailSummary ? `<p class="detail-summary">${detailSummary}</p>` : ''}
          ${detailPoints.length ? `<ul class="detail-points">${detailPoints.map(renderDetailPoint).join('')}</ul>` : ''}
          ${detailText ? `<div class="detail-text-block"><div class="block-label">解説</div><p class="detail-text">${detailText}</p></div>` : ''}
          ${detailLegacy ? `<p class="detail-text">${detailLegacy}</p>` : ''}
        </div>
      </details>` : '';

    const pointsHtml = points.length ? `
      <div class="points-block">
        <div class="block-label">ポイント</div>
        <ol class="points-list">${points.map(p => `<li><span class="pt-text">${richText(p)}</span></li>`).join('')}</ol>
      </div>` : '';

    const baHtml = (before || after) ? `
      <div class="ba-block">
        <div class="block-label">BEFORE → AFTER</div>
        <div class="ba-stack">
          <div class="ba-col ba-col-before">
            <div class="ba-head">BEFORE　これまで</div>
            <div class="ba-text">${before}</div>
          </div>
          <div class="ba-arrow-row">
            <span class="ba-arrow-line"></span>
            <span class="ba-arrow-label">こう変わる</span>
            <span class="ba-arrow-line"></span>
          </div>
          <div class="ba-col ba-col-after">
            <div class="ba-head">AFTER　これから</div>
            <div class="ba-text">${after}</div>
          </div>
        </div>
      </div>` : '';

    const impactHtml = impact ? `
      <div class="impact-block">
        <div class="block-label">💡 あなたへの影響</div>
        <p class="impact-text">${impact}</p>
      </div>` : '';

    const dateBadge = opts.dateLabel ? `<span class="topic-source">${escapeHtml(opts.dateLabel)}</span>` : '';
    const openAttr = (opts.open || idx === 0) && Store.settings.firstOpen === 'on' ? 'open' : '';

    const starSvg = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

    return `
      <li>
        <details class="topic-card" ${openAttr} ${dataIdAttr}>
          <summary>
            <div class="topic-summary-top">
              <div class="topic-summary-top-left">
                <span class="category-tag cat-${cat}">${cat}</span>
                ${dateBadge}
              </div>
              <button class="bookmark-btn ${bookmarked ? 'active' : ''}" data-bookmark aria-label="お気に入り" type="button">${starSvg}</button>
            </div>
            <div class="topic-title-ja">${titleJaRich}</div>
            <div class="topic-summary-bottom">
              <span class="topic-source">${source}</span>
              <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
          </summary>
          <div class="topic-body">
            <div class="simple-block">
              <div class="simple-label">かんたん説明</div>
              <p class="simple-text">${simple}</p>
            </div>
            ${detailHtml}
            ${pointsHtml}
            ${baHtml}
            ${impactHtml}
            <a class="read-more" href="${url}" target="_blank" rel="noopener noreferrer">
              元の記事を読む
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </a>
          </div>
        </details>
      </li>`;
  }

  // ===== HOME 描画 =====
  function renderHome() {
    const data = Store.digest;
    if (!data) return;
    $('overview-date').textContent = data.date || '';
    $('overview-text').innerHTML = richText(data.overview || '');

    const allTopics = Array.isArray(data.topics) ? data.topics : [];
    const cat = Store.settings.category;
    const filtered = cat === 'all' ? allTopics : allTopics.filter((t) => normalizeCategory(t.category) === cat);

    if (cat !== 'all') {
      $('active-filter').hidden = false;
      $('active-filter-label').textContent = `「${cat}」で絞り込み中`;
    } else {
      $('active-filter').hidden = true;
    }

    $('topics-list').innerHTML = filtered.map((t, i) => renderTopic(t, i)).join('');
    $('topics-empty').hidden = filtered.length > 0;
    $('tip-section').hidden = cat !== 'all';

    if (cat === 'all') {
      const tip = data.tip || {};
      $('tip-title').textContent = tip.title || '';
      $('tip-content').innerHTML = richText(tip.content || '');
    }
  }

  // ===== ARCHIVE 描画 =====
  async function loadArchiveIndex() {
    if (Store.archiveIndex) return Store.archiveIndex;
    try {
      const res = await fetch(`${ARCHIVE_INDEX_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      Store.archiveIndex = await res.json();
    } catch (e) {
      Store.archiveIndex = { entries: [] };
    }
    return Store.archiveIndex;
  }

  async function renderArchiveList() {
    const idx = await loadArchiveIndex();
    const entries = idx.entries || [];
    const list = $('archive-list');
    if (entries.length === 0) {
      list.innerHTML = '';
      $('archive-empty').hidden = false;
      return;
    }
    $('archive-empty').hidden = true;
    list.innerHTML = entries.map((e) => `
      <li>
        <button class="archive-item" data-archive-date="${escapeHtml(e.date)}">
          <div class="archive-item-date">${escapeHtml(e.date_label || e.date)}</div>
          <div class="archive-item-meta">${e.topics_count || 0} 件のトピック</div>
          <div class="archive-item-overview">${escapeHtml(e.overview || '')}${(e.overview && e.overview.length >= 110) ? '...' : ''}</div>
        </button>
      </li>`).join('');
  }

  async function loadArchiveDay(date) {
    if (Store.archiveCache[date]) return Store.archiveCache[date];
    const res = await fetch(`${ARCHIVE_DAY_URL(date)}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    Store.archiveCache[date] = data;
    return data;
  }

  async function showArchiveDetail(date) {
    const data = await loadArchiveDay(date);
    const topics = Array.isArray(data.topics) ? data.topics : [];
    const tip = data.tip || {};
    const html = `
      <section class="overview">
        <div class="section-label">${escapeHtml(data.date || date)}</div>
        <p class="overview-text">${richText(data.overview || '')}</p>
      </section>
      <div class="section-label">TOPICS</div>
      <ul class="topics-list">${topics.map((t, i) => renderTopic(t, i)).join('')}</ul>
      ${tip.title ? `
        <div class="section-label">TODAY'S TIP</div>
        <div class="tip-card">
          <div class="tip-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>
          </div>
          <div class="tip-body">
            <h3 class="tip-title">${escapeHtml(tip.title)}</h3>
            <p class="tip-content">${richText(tip.content || '')}</p>
          </div>
        </div>` : ''}`;
    $('archive-detail-content').innerHTML = html;
    $('archive-list').hidden = true;
    $('archive-empty').hidden = true;
    document.querySelector('#view-archive .archive-intro').hidden = true;
    $('archive-detail').hidden = false;
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function hideArchiveDetail() {
    $('archive-detail').hidden = true;
    $('archive-list').hidden = false;
    document.querySelector('#view-archive .archive-intro').hidden = false;
    renderArchiveList();
  }

  // ===== BOOKMARKS 描画 =====
  function renderBookmarks() {
    const list = Store.bookmarks;
    const ul = $('bookmarks-list');
    if (!list.length) {
      ul.innerHTML = '';
      $('bookmarks-empty').hidden = false;
      return;
    }
    $('bookmarks-empty').hidden = true;
    ul.innerHTML = list.map((t, i) => renderTopic(t, i)).join('');
  }

  // ===== OPTIONS 描画 =====
  function renderOptions() {
    // chips のアクティブ状態を反映
    $$('#opt-categories .chip').forEach(b => b.classList.toggle('active', b.dataset.category === Store.settings.category));
    $$('#opt-theme .chip').forEach(b => b.classList.toggle('active', b.dataset.theme === Store.settings.theme));
    $$('#opt-font .chip').forEach(b => b.classList.toggle('active', b.dataset.font === Store.settings.font));
    $$('#opt-firstopen .chip').forEach(b => b.classList.toggle('active', b.dataset.firstopen === Store.settings.firstOpen));

    // 情報
    if (Store.digest) {
      $('info-updated').textContent = Store.digest.generated_at_jst || '—';
      $('info-sources').textContent = Store.digest.source_count != null ? `${Store.digest.source_count} 件` : '—';
    }
  }

  // ===== タブ制御 =====
  function activateTab(name) {
    if (!TABS.includes(name)) name = 'home';
    TABS.forEach((t) => {
      $(`view-${t}`).hidden = (t !== name);
    });
    $$('.tab', elTabbar).forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    if (name === 'home') renderHome();
    if (name === 'archive') { hideArchiveDetail(); }
    if (name === 'bookmarks') renderBookmarks();
    if (name === 'options') renderOptions();
    history.replaceState(null, '', `#${name}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // ===== 設定変更ハンドラ =====
  function applyTheme() {
    elBody.dataset.theme = Store.settings.theme;
    const meta = $('theme-color-meta');
    if (meta) meta.content = Store.settings.theme === 'light' ? '#f5f7fb' : '#0a0e1a';
  }
  function applyFont() {
    elBody.dataset.font = Store.settings.font;
  }

  // ===== ロード =====
  async function loadDigest() {
    elLoading.hidden = false;
    elError.hidden = true;
    try {
      const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      Store.digest = await res.json();
      // 初期表示
      const initial = (location.hash || '#home').replace('#', '') || 'home';
      activateTab(initial);
    } catch (e) {
      console.error(e);
      elError.hidden = false;
    } finally {
      elLoading.hidden = true;
    }
  }

  // ===== イベント =====
  // タブ
  elTabbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    activateTab(btn.dataset.tab);
  });

  // リロード
  elReload.addEventListener('click', async () => {
    elReload.classList.add('spinning');
    Store.archiveIndex = null;
    Store.archiveCache = {};
    await loadDigest();
    setTimeout(() => elReload.classList.remove('spinning'), 400);
  });

  // ブックマーク（イベント委譲）+ アーカイブ項目クリック + フィルタ解除 + back
  document.addEventListener('click', (e) => {
    const bm = e.target.closest('[data-bookmark]');
    if (bm) {
      e.preventDefault();
      e.stopPropagation();
      const card = bm.closest('.topic-card');
      const id = card?.dataset.topicId;
      if (!id) return;
      // 探す: digest か bookmarks か archive
      const sources = [
        Store.digest?.topics || [],
        Store.bookmarks,
        ...Object.values(Store.archiveCache).flatMap(d => d.topics || []),
      ].flat();
      const t = sources.find((x) => topicId(x) === id);
      if (!t) return;
      toggleBookmark(t);
      bm.classList.toggle('active');
      const star = bm.querySelector('svg');
      if (star) {
        const isActive = bm.classList.contains('active');
        star.style.fill = isActive ? 'var(--bookmark-active)' : 'none';
      }
      // ブックマークタブが開いている時は再描画
      if (!$('view-bookmarks').hidden) renderBookmarks();
      return;
    }

    const arch = e.target.closest('[data-archive-date]');
    if (arch) {
      showArchiveDetail(arch.dataset.archiveDate);
      return;
    }

    if (e.target.closest('#archive-back')) {
      hideArchiveDetail();
      return;
    }

    if (e.target.closest('#filter-clear')) {
      Store.settings.category = 'all';
      saveSettings();
      renderHome();
      return;
    }
  });

  // オプション chips
  $('opt-categories').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    Store.settings.category = b.dataset.category;
    saveSettings();
    renderOptions();
  });
  $('opt-theme').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    Store.settings.theme = b.dataset.theme;
    saveSettings();
    applyTheme();
    renderOptions();
  });
  $('opt-font').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    Store.settings.font = b.dataset.font;
    saveSettings();
    applyFont();
    renderOptions();
  });
  $('opt-firstopen').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    Store.settings.firstOpen = b.dataset.firstopen;
    saveSettings();
    renderOptions();
  });

  // ハッシュ変更でタブ切替
  window.addEventListener('hashchange', () => {
    const name = (location.hash || '#home').replace('#', '');
    activateTab(name);
  });

  // ===== 初期化 =====
  applyTheme();
  applyFont();
  loadDigest();
  // archive プリロード（タブ切替時の即応性のため）
  loadArchiveIndex();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW register failed:', err));
    });
  }
})();
