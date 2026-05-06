(() => {
  const DATA_URL = 'data/digest.json';

  const $ = (id) => document.getElementById(id);
  const elLoading = $('loading');
  const elError = $('error');
  const elContent = $('content');
  const elReload = $('reload-btn');

  const escapeHtml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const sanitizeUrl = (u) => {
    const s = String(u ?? '').trim();
    return /^https?:\/\//i.test(s) ? s : '#';
  };

  const VALID_CATEGORIES = ['新モデル', '研究', 'ビジネス', '規制', 'ツール'];
  const normalizeCategory = (c) => VALID_CATEGORIES.includes(c) ? c : 'その他';

  const renderTopic = (t, idx) => {
    const cat = normalizeCategory(t.category || '');
    const titleJa = escapeHtml(t.title_ja || '');
    const titleEn = t.title_en ? `<div class="topic-title-en">${escapeHtml(t.title_en)}</div>` : '';
    const source = escapeHtml(t.source || '');
    const url = sanitizeUrl(t.url);
    const simple = escapeHtml(t.simple_explanation || '').replace(/\n/g, '<br/>');
    const detail = escapeHtml(t.detail_explanation || '').replace(/\n/g, '<br/>');
    const points = Array.isArray(t.points) ? t.points : [];
    const before = escapeHtml(t.before || '');
    const after = escapeHtml(t.after || '');
    const impact = escapeHtml(t.impact || '');

    const detailHtml = detail
      ? `
        <details class="detail-accordion">
          <summary>
            もっと詳しく知りたい方へ
            <svg class="chevron-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </summary>
          <p class="detail-text">${detail}</p>
        </details>
      `
      : '';

    const pointsHtml = points.length
      ? `
        <div class="points-block">
          <div class="block-label">ポイント</div>
          <ol class="points-list">
            ${points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}
          </ol>
        </div>
      `
      : '';

    const baHtml = (before || after)
      ? `
        <div class="ba-block">
          <div class="block-label">BEFORE → AFTER</div>
          <div class="ba-grid">
            <div class="ba-col ba-col-before">
              <div class="ba-head">BEFORE</div>
              <div class="ba-text">${before}</div>
            </div>
            <div class="ba-arrow">→</div>
            <div class="ba-col ba-col-after">
              <div class="ba-head">AFTER</div>
              <div class="ba-text">${after}</div>
            </div>
          </div>
        </div>
      `
      : '';

    const impactHtml = impact
      ? `
        <div class="impact-block">
          <div class="block-label">わたしたちへの影響</div>
          <p class="impact-text">${impact}</p>
        </div>
      `
      : '';

    return `
      <li>
        <details class="topic-card" ${idx === 0 ? 'open' : ''}>
          <summary>
            <div class="topic-summary-top">
              <span class="category-tag cat-${cat}">${cat}</span>
            </div>
            <div class="topic-title-ja">${titleJa}</div>
            ${titleEn}
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
      </li>
    `;
  };

  const render = (data) => {
    // OVERVIEW
    $('overview-date').textContent = data.date || '';
    $('overview-text').textContent = data.overview || '';

    // TOPICS
    const topics = Array.isArray(data.topics) ? data.topics : [];
    $('topics-list').innerHTML = topics.map(renderTopic).join('');

    // TIP
    const tip = data.tip || {};
    $('tip-title').textContent = tip.title || '';
    $('tip-content').textContent = tip.content || '';

    // FOOTER
    $('footer-meta').textContent = data.generated_at_jst
      ? `最終更新: ${data.generated_at_jst}`
      : '';

    elContent.hidden = false;
    elError.hidden = true;
  };

  const load = async () => {
    elLoading.hidden = false;
    elError.hidden = true;
    elContent.hidden = true;
    try {
      const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      render(data);
    } catch (e) {
      console.error(e);
      elError.hidden = false;
    } finally {
      elLoading.hidden = true;
    }
  };

  elReload.addEventListener('click', async () => {
    elReload.classList.add('spinning');
    await load();
    setTimeout(() => elReload.classList.remove('spinning'), 400);
  });

  load();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW register failed:', err));
    });
  }
})();
