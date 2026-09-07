/**
 * うーこの部屋 共通サイドバー
 *
 * 使い方: 各ページの </body> 直前に下記1行を追加するだけ
 *   <script src="https://uko05.github.io/TopPage00/shared/sidebar.js"></script>
 *
 * ★ 新しいページを追加するときは MENU 配列だけ編集すれば全ページに反映されます ★
 */
(function () {
  'use strict';

  // 二重初期化防止
  if (document.getElementById('uko-sidebar')) return;

  /* ===================================================================
     ★ メニュー定義（ここだけ更新すればOK）
  =================================================================== */

  const TOP_LINK = {
    label: 'うーこの部屋',
    url: 'https://uko05.github.io/TopPage00/'
  };

  const MENU = [
    {
      label: '便利ツール',
      children: [
        { label: '【原神】これいる聖遺物', url: 'https://uko05.github.io/artifactCheck13/' },
        { label: 'アカウント管理', url: 'https://uko05.github.io/24_AccountCenter/' },
      ]
    },
    {
      label: '推しキャラランキング',
      children: [
        { label: '原神',           url: 'https://uko05.github.io/TiersList01/' },
        { label: 'スタレ【運命】', url: 'https://uko05.github.io/TiersList02/' },
        { label: 'スタレ【属性】', url: 'https://uko05.github.io/TiersList03/' },
      ]
    },
    {
      label: 'フリーフォーマット',
      children: [
        { label: '原神',  url: 'https://uko05.github.io/genshinFormat04/' },
        { label: 'スタレ', url: 'https://uko05.github.io/starrailFormat05/' },
      ]
    },
    {
      label: 'チェックシート',
      children: [
        { label: '原神',  url: 'https://uko05.github.io/genshinCheck06/' },
        { label: 'スタレ', url: 'https://uko05.github.io/starrailCheck07/' },
      ]
    },
    {
      label: 'ゲームとか',
      children: [
        { label: '原神クイズ王',     url: 'https://uko05.github.io/11_GenshinQuiz/' },
        { label: '原神ズームアップ', url: 'https://uko05.github.io/12_GenshinZoomUp/' },
        { label: '原神おみくじ', url: 'https://uko05.github.io/14_GenshinOmikuji/' },
        { label: 'NTEチェッカー', url: 'https://uko05.github.io/16_NTEChecker/' },
      ]
    },
  ];

  /* ===================================================================
     CSS
  =================================================================== */
  const css = `
    .uko-hamburger {
      position: fixed;
      top: 8px;
      left: 12px;
      z-index: 1000;
      width: 40px;
      height: 40px;
      background: var(--surface, #ffffff);
      border: 1px solid var(--border, #dddddd);
      border-radius: 6px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.15);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 5px;
      padding: 0;
    }
    .uko-hamburger span {
      display: block;
      width: 20px;
      height: 2px;
      background: #333;
      border-radius: 2px;
      transition: transform 0.25s, opacity 0.25s;
    }
    .uko-hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
    .uko-hamburger.open span:nth-child(2) { opacity: 0; }
    .uko-hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

    .uko-sidebar-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.55);
      z-index: 998;
    }
    .uko-sidebar-overlay.active { display: block; }

    #uko-sidebar {
      position: fixed;
      top: 0;
      left: -280px;
      width: 260px;
      height: 100vh;
      background: #1a1a2a;
      border-right: 1px solid var(--border, #dddddd);
      z-index: 999;
      overflow-y: auto;
      transition: left 0.25s ease;
      padding-top: 64px;
      box-sizing: border-box;
      text-align: left;
    }
    #uko-sidebar.open { left: 0; }

    #uko-sidebar .uko-menu-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    #uko-sidebar .uko-menu-top a {
      display: block;
      padding: 14px 16px;
      color: #fff;
      font-size: 14px;
      font-weight: bold;
      text-decoration: none;
      border-bottom: 1px solid var(--border, #dddddd);
      letter-spacing: 0.03em;
    }
    #uko-sidebar .uko-menu-top a:hover { background: rgba(255,255,255,0.05); }

    #uko-sidebar .uko-menu-group {
      border-bottom: 1px solid var(--border, #dddddd);
    }
    #uko-sidebar .uko-menu-parent {
      width: 100%;
      background: none;
      border: none;
      border-bottom: 1px solid var(--border, #dddddd);
      color: var(--accent, #ffcc00);
      font-size: 14px;
      font-weight: bold;
      font-family: var(--font, sans-serif);
      text-align: left;
      padding: 14px 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      letter-spacing: 0.03em;
    }
    #uko-sidebar .uko-menu-parent:hover { background: rgba(255,255,255,0.05); }

    #uko-sidebar .uko-menu-arrow::before {
      content: '▶';
      font-size: 10px;
      color: var(--accent, #ffcc00);
      display: inline-block;
    }
    #uko-sidebar .uko-menu-group.open .uko-menu-arrow::before { content: '▼'; }

    #uko-sidebar .uko-menu-children {
      list-style: none;
      display: none;
      background: rgba(0,0,0,0.2);
      margin: 0;
      padding: 0;
    }
    #uko-sidebar .uko-menu-group.open .uko-menu-children { display: block; }

    #uko-sidebar .uko-menu-children a {
      display: block;
      padding: 11px 16px 11px 36px;
      color: #fff;
      text-decoration: none;
      font-size: 13px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    #uko-sidebar .uko-menu-children a:hover {
      background: rgba(255,255,255,0.07);
      color: var(--accent, #ffcc00);
    }
  `;

  /* ===================================================================
     HTML生成（MENU配列から動的生成）
  =================================================================== */
  function buildSidebar() {
    const nav = document.createElement('nav');
    nav.id = 'uko-sidebar';

    const ul = document.createElement('ul');
    ul.className = 'uko-menu-list';

    // トップリンク
    const topLi = document.createElement('li');
    topLi.className = 'uko-menu-top';
    const topA = document.createElement('a');
    topA.href = TOP_LINK.url;
    topA.target = '_blank';
    topA.rel = 'noopener';
    topA.textContent = TOP_LINK.label;
    topLi.appendChild(topA);
    ul.appendChild(topLi);

    // グループ（MENU配列をループ）
    MENU.forEach(group => {
      const li = document.createElement('li');
      li.className = 'uko-menu-group';

      const btn = document.createElement('button');
      btn.className = 'uko-menu-parent';
      const arrow = document.createElement('span');
      arrow.className = 'uko-menu-arrow';
      btn.appendChild(arrow);
      btn.appendChild(document.createTextNode(group.label));
      li.appendChild(btn);

      const childUl = document.createElement('ul');
      childUl.className = 'uko-menu-children';

      group.children.forEach(child => {
        const childLi = document.createElement('li');
        const a = document.createElement('a');
        a.href = child.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = child.label;
        childLi.appendChild(a);
        childUl.appendChild(childLi);
      });

      li.appendChild(childUl);
      ul.appendChild(li);
    });

    nav.appendChild(ul);
    return nav;
  }

  /* ===================================================================
     DOMへの追加（body末尾にappend）
  =================================================================== */

  // CSS
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ハンバーガーボタン
  const hamburger = document.createElement('button');
  hamburger.id = 'uko-hamburger';
  hamburger.className = 'uko-hamburger';
  hamburger.setAttribute('aria-label', 'メニューを開く');
  hamburger.innerHTML = '<span></span><span></span><span></span>';
  document.body.appendChild(hamburger);

  // オーバーレイ
  const overlay = document.createElement('div');
  overlay.id = 'uko-sidebar-overlay';
  overlay.className = 'uko-sidebar-overlay';
  document.body.appendChild(overlay);

  // サイドバー本体
  const sidebar = buildSidebar();
  document.body.appendChild(sidebar);

  /* ===================================================================
     イベント
  =================================================================== */
  function toggleSidebar() {
    const isOpen = sidebar.classList.toggle('open');
    overlay.classList.toggle('active', isOpen);
    hamburger.classList.toggle('open', isOpen);
  }

  hamburger.addEventListener('click', toggleSidebar);
  overlay.addEventListener('click', toggleSidebar);

  sidebar.querySelectorAll('.uko-menu-parent').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.uko-menu-group').classList.toggle('open'));
  });

})();
