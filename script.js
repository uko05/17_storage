// script.js
// 画像保管庫。ログイン必須(24_AccountCenterでの登録・ログインが前提)。
// アップロード時にクライアント側でリサイズ/圧縮してから保存し、原寸は保持しない。
//
// Firestore(screenshotStorageImages)・Storage(screenshotStorage/)のルールは
// 24_AccountCenterリポジトリのfirestore.rules/storage.rulesにある(実装・デプロイ済み)。

import { auth, db, storage, storageBucket } from './firebaseConfig.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { ref, uploadBytes, deleteObject } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

const loginGate   = document.getElementById('login-gate');
const storageApp  = document.getElementById('storage-app');
const siteTitle   = document.getElementById('site-title');
const homeSubDesc = document.getElementById('home-sub-desc');

const uploadInput  = document.getElementById('upload-input');
const uploadBtn    = document.getElementById('upload-btn');

const originalUploadRow = document.getElementById('original-upload-row');
const originalUploadCheckbox = document.getElementById('original-upload-checkbox');

const tagFilterList     = document.getElementById('tag-filter-list');
const selectModeToggle = document.getElementById('select-mode-toggle');
const bulkDeleteBtn    = document.getElementById('bulk-delete-btn');

const galleryGrid      = document.getElementById('gallery-grid');
const galleryEmptyHint = document.getElementById('gallery-empty-hint');

// タグ絞り込みが最初から空振りにならないよう用意した既定候補。
// 右クリックメニューにもこの候補をそのまま縦に並べて出し、クリックした
// その場でON/OFFする(別ポップアップは挟まない、script.jsのcontextmenu参照)。
const PRESET_TAGS = ['原神', 'スタレ', 'イラスト', 'スクショ', 'ガチャ', 'コスプレ', 'その他', 'あとで見る'];

const adminSection      = document.getElementById('admin-section');
const adminFlaggedList  = document.getElementById('admin-flagged-list');
const adminFlaggedEmpty = document.getElementById('admin-flagged-empty');

// FriendBoard(board.js)のADMIN_UIDと同一人物。管理者ロールの一般化は
// 将来的な課題として両サイトで共通のメモが残っている。
const ADMIN_UID = 'UPInlRxp2eM8OI3p18UU1d3OzNc2';

const IMAGES_COLLECTION = 'screenshotStorageImages';
const STORAGE_ROOT = 'screenshotStorage';
const VIEW_MAX_SIDE  = 1920;
const THUMB_MAX_SIDE = 400;
const WEBP_QUALITY = 0.85;

// 1日あたりのアップロード上限。想定同時利用者数(仮に1日30人程度)×この上限で
// 増える保存容量が費用的に問題ない範囲になるよう仮置きした値
// (2026-09時点、実際の利用者数を見ながら調整すること)。
// 元の画像のまま保存(UPoint交換の特典)は容量が大きいので別枠でさらに絞る。
const DAILY_UPLOAD_LIMIT = 30;
const DAILY_ORIGINAL_UPLOAD_LIMIT = 5;

let currentUid = null;
let unsubscribeGallery = null;
let unsubscribeSitePerks = null;
let allImages = [];       // 自分がownerの画像を全件(Firestoreの現在の値)
let activeTagFilter = null; // 登録されているタグの中から選ぶ方式(自由入力ではない)
let unsubscribeAdminFlagged = null;

// ===== 複数選択モード(タグ一括付け用) =====
let selectModeEnabled = false;
let selectedImageIds = new Set();

selectModeToggle.addEventListener('change', () => {
  selectModeEnabled = selectModeToggle.checked;
  if (!selectModeEnabled) {
    selectedImageIds.clear();
    renderGallery();
  }
});

// 選択チェックは常時表示なので、このボタンは「複数選択」がONかどうかに
// 関わらず、その時点で選択中の画像があれば削除できる。
bulkDeleteBtn.addEventListener('click', async () => {
  if (selectedImageIds.size === 0) {
    showToast('削除する画像を選んでください。');
    return;
  }
  const ids = [...selectedImageIds];
  if (await showConfirm(`選択中の${ids.length}件を削除します。元に戻せません。よろしいですか？`)) deleteImages(ids);
});

// ===== ログイン状態でメイン画面の出し分け =====
onAuthStateChanged(auth, async (user) => {
  if (unsubscribeGallery) { unsubscribeGallery(); unsubscribeGallery = null; }
  if (unsubscribeSitePerks) { unsubscribeSitePerks(); unsubscribeSitePerks = null; }
  if (unsubscribeAdminFlagged) { unsubscribeAdminFlagged(); unsubscribeAdminFlagged = null; }

  if (user) {
    currentUid = user.uid;
    loginGate.classList.add('hidden');
    storageApp.classList.remove('hidden');
    // ログイン済みの人には、サイトの説明は不要なのでシンプルにする
    // (未ログインの人には#login-gateの案内と合わせて引き続き表示する)。
    siteTitle.classList.add('hidden');
    homeSubDesc.classList.add('hidden');
    startGalleryListener(currentUid);

    // 「元の画像のまま保存」はUPointでの交換で解放される機能。sitePerksは
    // Firebase Authのuidではなく共有匿名ID(omikujiUserId)側にぶら下がっているので、
    // accountLinksで一度引いてからomikujiUsersを見に行く(userAvatars等と同じ経路)。
    const omikujiUserId = await resolveOmikujiUserId(currentUid);
    if (omikujiUserId) unsubscribeSitePerks = startSitePerksListener(omikujiUserId);

    if (currentUid === ADMIN_UID) {
      adminSection.classList.remove('hidden');
      unsubscribeAdminFlagged = startAdminFlaggedListener();
    } else {
      adminSection.classList.add('hidden');
    }
  } else {
    currentUid = null;
    allImages = [];
    originalUploadUnlocked = false;
    extraDailyUploads = 0;
    originalUploadRow.classList.add('hidden');
    adminSection.classList.add('hidden');
    siteTitle.classList.remove('hidden');
    homeSubDesc.classList.remove('hidden');
    loginGate.classList.remove('hidden');
    storageApp.classList.add('hidden');
  }
});

async function resolveOmikujiUserId(uid) {
  try {
    const snap = await getDoc(doc(db, 'accountLinks', uid));
    return snap.data()?.omikujiUserId || null;
  } catch (e) {
    console.error('[storage] accountLinks lookup failed', e);
    return null;
  }
}

let originalUploadUnlocked = false;
let extraDailyUploads = 0;
function startSitePerksListener(omikujiUserId) {
  return onSnapshot(doc(db, 'omikujiUsers', omikujiUserId), (snap) => {
    const perks = snap.data()?.sitePerks?.storage17 || {};
    originalUploadUnlocked = !!perks.originalUpload;
    extraDailyUploads = perks.extraDailyUploads || 0;
    originalUploadRow.classList.toggle('hidden', !originalUploadUnlocked);
    if (!originalUploadUnlocked) originalUploadCheckbox.checked = false;
  }, (e) => console.error('[storage] site perks listen failed', e));
}

function myDailyUploadLimit() {
  return DAILY_UPLOAD_LIMIT + extraDailyUploads;
}

// ===== ギャラリー購読 =====
function startGalleryListener(uid) {
  const q = query(
    collection(db, IMAGES_COLLECTION),
    where('ownerUid', '==', uid),
    orderBy('createdAt', 'desc'),
  );
  unsubscribeGallery = onSnapshot(q, (snap) => {
    allImages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderTagFilterList();
    renderGallery();
  }, (e) => {
    console.error('[storage] gallery listen failed', e);
    showToast('画像一覧の取得に失敗しました(権限設定が未対応の可能性があります)。');
  });
}

// ===== タグ絞り込み(登録されている=実際に使われているタグの一覧から選ぶ方式。
// 自由入力ではない) =====
function renderTagFilterList() {
  const counts = new Map();
  allImages.forEach((img) => {
    if (img.moderationStatus === 'removed') return;
    (Array.isArray(img.tags) ? img.tags : []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1));
  });
  // 使われている回数が多い順、同数ならあいうえお順
  const tags = [...counts.keys()].sort((a, b) => (counts.get(b) - counts.get(a)) || a.localeCompare(b, 'ja'));

  if (activeTagFilter && !tags.includes(activeTagFilter)) activeTagFilter = null;

  tagFilterList.innerHTML = '';
  tagFilterList.classList.toggle('hidden', tags.length === 0);
  tags.forEach((tag) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'storage-tag-filter-chip' + (activeTagFilter === tag ? ' active' : '');
    btn.textContent = `${tag} (${counts.get(tag)})`;
    btn.addEventListener('click', () => {
      activeTagFilter = activeTagFilter === tag ? null : tag;
      renderTagFilterList();
      renderGallery();
    });
    tagFilterList.appendChild(btn);
  });
}

function renderGallery() {
  const filtered = allImages.filter((img) => {
    if (img.moderationStatus === 'removed') return false;
    if (activeTagFilter) {
      const tags = Array.isArray(img.tags) ? img.tags : [];
      if (!tags.includes(activeTagFilter)) return false;
    }
    return true;
  });

  galleryGrid.innerHTML = '';
  galleryEmptyHint.classList.toggle('hidden', filtered.length > 0);

  for (const img of filtered) {
    const card = document.createElement('div');
    card.className = 'storage-card';

    const thumb = document.createElement('img');
    thumb.src = img.thumbUrl || img.viewUrl || '';
    thumb.loading = 'lazy';
    thumb.alt = '';
    card.appendChild(thumb);

    if (img.moderationStatus && img.moderationStatus !== 'approved') {
      const pending = document.createElement('span');
      pending.className = 'storage-card-pending';
      pending.textContent = '審査中';
      card.appendChild(pending);
    }

    // 選択チェックは常に表示(2026-09-10、複数選択モードON時だけの表示から変更)。
    // チェック自体は分かりにくいので、選択中は赤枠(.selected)を主な目印にする。
    const selectCb = document.createElement('input');
    selectCb.type = 'checkbox';
    selectCb.className = 'storage-card-select';
    selectCb.checked = selectedImageIds.has(img.id);
    card.classList.toggle('selected', selectCb.checked);
    selectCb.addEventListener('click', (e) => e.stopPropagation());
    selectCb.addEventListener('change', () => {
      if (selectCb.checked) selectedImageIds.add(img.id);
      else selectedImageIds.delete(img.id);
      card.classList.toggle('selected', selectCb.checked);
    });
    card.appendChild(selectCb);

    card.addEventListener('click', () => {
      // 複数選択モードの時は、画像のどこをクリックしてもチェックが
      // トグルするようにする(チェックボックスそのものを狙わなくていい)。
      if (selectModeEnabled) {
        selectCb.checked = !selectCb.checked;
        selectCb.dispatchEvent(new Event('change'));
        return;
      }
      if (img.viewUrl) openLightbox(img.viewUrl);
    });

    // ブラウザ標準の右クリックメニュー(「名前を付けて画像を保存」等)は出さず、
    // このサイト独自のメニュー(削除/ダウンロード/共有用URL/タグ)を表示する。
    // 「タグを選択」をワンクッション挟み、クリックするとタグ一覧(候補+新規追加)
    // だけの2段目のメニューが同じ位置に開く(2026-09-09)。
    // 選択モードで1枚以上チェックが付いていれば、右クリックした画像に関わらず
    // 選択中の全画像へまとめてタグを追加/削除するメニューになる。
    thumb.draggable = false;
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (selectedImageIds.size > 0) {
        const ids = [...selectedImageIds];
        openContextMenu(e.pageX, e.pageY, [
          { label: `タグを選択(${ids.length}件に追加)`, onClick: () => openContextMenu(e.pageX, e.pageY, buildTagMenuItems(ids)) },
          {
            label: '画像削除',
            danger: true,
            onClick: async () => {
              if (await showConfirm(`選択中の${ids.length}件を削除します。元に戻せません。よろしいですか？`)) deleteImages(ids);
            },
          },
        ]);
        return;
      }
      openContextMenu(e.pageX, e.pageY, [
        { label: '拡大表示', onClick: () => { if (img.viewUrl) openLightbox(img.viewUrl); } },
        { label: 'タグを選択', onClick: () => openContextMenu(e.pageX, e.pageY, buildTagMenuItems([img.id])) },
        { label: 'ダウンロード', onClick: () => downloadImage(img) },
        { label: '共有用URLをコピー', onClick: () => copyShareUrl(img) },
        {
          label: '削除する',
          danger: true,
          onClick: async () => {
            if (await showConfirm('この画像を削除します。元に戻せません。よろしいですか？')) deleteImage(img);
          },
        },
      ]);
    });

    galleryGrid.appendChild(card);
  }
}

// ===== 右クリックメニュー内のタグ一覧 =====
// 「タグを選択」というワンクッションを挟まず、候補タグをそのまま右クリック
// メニューに縦に並べ、クリックした瞬間にON/OFF(1枚編集)または追加(複数枚
// 一括)する。複数枚一括時は画像ごとに既存タグが違うので、選んだタグを
// 各画像の既存タグに"追加"するだけにする(既存タグの削除はしない)。
function buildTagMenuItems(imageIds) {
  const isSingle = imageIds.length === 1;
  const targetImg = isSingle ? allImages.find((i) => i.id === imageIds[0]) : null;
  const currentTags = (isSingle && Array.isArray(targetImg?.tags)) ? targetImg.tags : [];

  const items = PRESET_TAGS.map((tag) => {
    const has = currentTags.includes(tag);
    return {
      label: (isSingle ? (has ? '✓ ' : '　') : '') + tag,
      onClick: () => (isSingle ? toggleTagOnImage(imageIds[0], tag, !has) : addTagToImages(imageIds, tag)),
    };
  });

  items.push({
    label: '＋ 新しいタグを追加',
    onClick: () => {
      const v = (prompt('追加するタグ名を入力してください') || '').trim();
      if (!v) return;
      if (isSingle) toggleTagOnImage(imageIds[0], v, true);
      else addTagToImages(imageIds, v);
    },
  });

  return items;
}

async function toggleTagOnImage(imageId, tag, add) {
  try {
    const img = allImages.find((i) => i.id === imageId);
    const current = Array.isArray(img?.tags) ? img.tags : [];
    const next = add ? Array.from(new Set([...current, tag])) : current.filter((t) => t !== tag);
    await updateDoc(doc(db, IMAGES_COLLECTION, imageId), { tags: next });
    showToast(add ? `「${tag}」を追加しました。` : `「${tag}」を外しました。`);
  } catch (e) {
    console.error('[storage] tag toggle failed', e);
    showToast('タグの更新に失敗しました。');
  }
}

async function addTagToImages(imageIds, tag) {
  try {
    await Promise.all(imageIds.map((id) => {
      const img = allImages.find((i) => i.id === id);
      const merged = Array.from(new Set([...(Array.isArray(img?.tags) ? img.tags : []), tag]));
      return updateDoc(doc(db, IMAGES_COLLECTION, id), { tags: merged });
    }));
    showToast(`「${tag}」を${imageIds.length}件に追加しました。`);
  } catch (e) {
    console.error('[storage] bulk tag add failed', e);
    showToast('タグの追加に失敗しました。');
  }
}

// ===== 独自の右クリックメニュー =====
let activeContextMenu = null;
function closeContextMenu() {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}
document.addEventListener('click', closeContextMenu);
document.addEventListener('scroll', closeContextMenu, true);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContextMenu(); });

function openContextMenu(pageX, pageY, items) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'storage-context-menu';
  items.forEach(({ label, onClick, danger }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    if (danger) btn.classList.add('danger');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeContextMenu();
      onClick();
    });
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  activeContextMenu = menu;

  // 画面外にはみ出さないよう位置を調整する
  menu.style.left = `${pageX}px`;
  menu.style.top = `${pageY}px`;
  const rect = menu.getBoundingClientRect();
  const overflowX = rect.right - (window.scrollX + window.innerWidth);
  const overflowY = rect.bottom - (window.scrollY + window.innerHeight);
  if (overflowX > 0) menu.style.left = `${pageX - overflowX}px`;
  if (overflowY > 0) menu.style.top = `${pageY - overflowY}px`;
}

// ===== 拡大表示(ポップアップ) =====
function openLightbox(url) {
  let lb = document.getElementById('storage-lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'storage-lightbox';
    lb.className = 'storage-lightbox';
    lb.innerHTML = `
      <button type="button" class="storage-lightbox-close" aria-label="閉じる">×</button>
      <img class="storage-lightbox-img" alt="">
    `;
    lb.addEventListener('click', (e) => {
      if (e.target === lb || e.target.classList.contains('storage-lightbox-close')) closeLightbox();
    });
    document.body.appendChild(lb);
  }
  lb.querySelector('.storage-lightbox-img').src = url;
  lb.classList.add('open');
}
function closeLightbox() {
  const lb = document.getElementById('storage-lightbox');
  if (lb) lb.classList.remove('open');
}
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

// ===== 独自の確認ポップアップ(削除確認など。ブラウザ標準confirm()は使わない) =====
function showConfirm(message) {
  return new Promise((resolve) => {
    let modal = document.getElementById('storage-confirm');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'storage-confirm';
      modal.className = 'storage-confirm';
      modal.innerHTML = `
        <div class="storage-confirm-inner">
          <p class="storage-confirm-message"></p>
          <div class="storage-confirm-actions">
            <button type="button" class="secondary-btn storage-confirm-cancel">キャンセル</button>
            <button type="button" class="primary-btn storage-confirm-ok">OK</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    modal.querySelector('.storage-confirm-message').textContent = message;

    const okBtn = modal.querySelector('.storage-confirm-ok');
    const cancelBtn = modal.querySelector('.storage-confirm-cancel');

    const finish = (result) => {
      modal.classList.remove('open');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
      window.removeEventListener('keydown', onKeydown);
      resolve(result);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onBackdrop = (e) => { if (e.target === modal) finish(false); };
    const onKeydown = (e) => { if (e.key === 'Escape') finish(false); };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);
    window.addEventListener('keydown', onKeydown);

    modal.classList.add('open');
  });
}

// ===== 簡易トースト通知 =====
let toastTimer = null;
function showToast(message) {
  let toastEl = document.getElementById('storage-toast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'storage-toast';
    toastEl.className = 'storage-toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

// ===== ダウンロード/共有URL/削除 =====
async function downloadImage(img) {
  try {
    const res = await fetch(img.viewUrl);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const blob = await res.blob();
    const extMatch = img.viewUrl.match(/\.([a-zA-Z0-9]+)\?alt=media/);
    const ext = extMatch ? extMatch[1] : 'jpg';
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = `${img.id}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  } catch (e) {
    console.error('[storage] download failed', e);
    showToast('ダウンロードに失敗しました。');
  }
}

async function copyShareUrl(img) {
  try {
    await navigator.clipboard.writeText(img.viewUrl);
    showToast('共有用URLをコピーしました。');
  } catch (e) {
    console.error('[storage] copy url failed', e);
    // クリップボードAPIが使えない環境向けのフォールバック
    prompt('このURLをコピーしてください:', img.viewUrl);
  }
}

async function deleteImageFilesAndDoc(img) {
  const jobs = [];
  if (img.thumbPath) jobs.push(deleteObject(ref(storage, img.thumbPath)).catch(() => {}));
  if (img.mainPath) jobs.push(deleteObject(ref(storage, img.mainPath)).catch(() => {}));
  await Promise.all(jobs);
  await deleteDoc(doc(db, IMAGES_COLLECTION, img.id));
}

async function deleteImage(img) {
  try {
    await deleteImageFilesAndDoc(img);
    showToast('画像を削除しました。');
  } catch (e) {
    console.error('[storage] delete failed', e);
    showToast('削除に失敗しました。');
  }
}

async function deleteImages(imageIds) {
  try {
    await Promise.all(imageIds.map((id) => {
      const img = allImages.find((i) => i.id === id);
      return img ? deleteImageFilesAndDoc(img) : Promise.resolve();
    }));
    selectedImageIds.clear();
    selectModeToggle.checked = false;
    selectModeEnabled = false;
    galleryGrid.classList.remove('select-mode');
    renderGallery();
    showToast(`${imageIds.length}件の画像を削除しました。`);
  } catch (e) {
    console.error('[storage] bulk delete failed', e);
    showToast('削除に失敗しました。');
  }
}

// ===== 管理者用: モデレーション確認(flagged画像の承認/却下) =====
function startAdminFlaggedListener() {
  const q = query(
    collection(db, IMAGES_COLLECTION),
    where('moderationStatus', '==', 'flagged'),
    orderBy('flaggedAt', 'desc'),
  );
  return onSnapshot(q, (snap) => {
    renderAdminFlagged(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (e) => console.error('[storage] admin flagged listen failed', e));
}

function renderAdminFlagged(items) {
  adminFlaggedList.innerHTML = '';
  adminFlaggedEmpty.classList.toggle('hidden', items.length > 0);

  for (const img of items) {
    const card = document.createElement('div');
    card.className = 'storage-admin-card';

    const thumb = document.createElement('img');
    thumb.src = img.thumbUrl || img.viewUrl || '';
    thumb.alt = '';
    card.appendChild(thumb);

    const meta = document.createElement('div');
    meta.className = 'storage-admin-card-meta';
    const reasonLine = img.flaggedReason === 'safesearch_error'
      ? '(SafeSearch判定でエラーが発生したため保留)'
      : '';
    const scores = img.safeSearchScores;
    const scoresLine = scores
      ? `<div>判定: adult=${escapeHtml(scores.adult)} / violence=${escapeHtml(scores.violence)} / racy=${escapeHtml(scores.racy)}</div>`
      : '';
    meta.innerHTML = `
      <div>投稿者UID: ${escapeHtml(img.ownerUid || '-')}</div>
      <div>保留日時: ${fmtTimestamp(img.flaggedAt)}</div>
      ${scoresLine}
      ${reasonLine ? `<div>${reasonLine}</div>` : ''}
    `;

    const actions = document.createElement('div');
    actions.className = 'storage-admin-card-actions';

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'secondary-btn';
    openBtn.textContent = '拡大表示';
    openBtn.addEventListener('click', () => {
      if (img.viewUrl) openLightbox(img.viewUrl);
    });

    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.className = 'primary-btn';
    approveBtn.textContent = '公開する';
    approveBtn.addEventListener('click', () => moderateFlaggedImage(img.id, 'approved'));

    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.className = 'secondary-btn';
    rejectBtn.textContent = '削除する';
    rejectBtn.addEventListener('click', async () => {
      if (await showConfirm('この画像を削除します。よろしいですか？')) moderateFlaggedImage(img.id, 'removed');
    });

    actions.appendChild(openBtn);
    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    meta.appendChild(actions);
    card.appendChild(meta);
    adminFlaggedList.appendChild(card);
  }
}

async function moderateFlaggedImage(imageId, nextStatus) {
  try {
    await updateDoc(doc(db, IMAGES_COLLECTION, imageId), {
      moderationStatus: nextStatus,
      shareEnabled: false,
      moderatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.error('[storage] admin moderate failed', e);
  }
}

function fmtTimestamp(ts) {
  if (!ts?.toDate) return '-';
  return ts.toDate().toLocaleString('ja-JP');
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ===== アップロード =====
uploadBtn.addEventListener('click', () => uploadInput.click());

function startOfTodayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// allImages(ギャラリー購読で既に持っている自分の全件)から、ローカル日付の
// 今日作成された件数を数える。書き込み直後でcreatedAtがserverTimestamp未解決
// (ローカルではnull)な場合は「今作った=今日」として扱う。
function countUploadedToday(onlyOriginal) {
  const todayStart = startOfTodayMs();
  return allImages.filter((img) => {
    if (onlyOriginal && !img.isOriginal) return false;
    const ms = img.createdAt?.toMillis ? img.createdAt.toMillis() : Date.now();
    return ms >= todayStart;
  }).length;
}

uploadInput.addEventListener('change', async (e) => {
  const files = [...e.target.files];
  uploadInput.value = '';
  if (!files.length || !currentUid) return;

  const wantsOriginal = originalUploadUnlocked && originalUploadCheckbox.checked;
  let uploadedToday = countUploadedToday(false);
  let originalUploadedToday = countUploadedToday(true);
  let fellBackToCompressed = false;
  let hitDailyLimit = false;

  const dailyLimit = myDailyUploadLimit();
  uploadBtn.disabled = true;
  for (let i = 0; i < files.length; i++) {
    if (uploadedToday >= dailyLimit) {
      hitDailyLimit = true;
      showToast(`1日のアップロード上限(${dailyLimit}枚)に達したため、残りは保存できませんでした。`);
      break;
    }
    // 元画像保存の1日上限に達している場合は、アップロード自体は続行しつつ
    // その分だけ通常の圧縮保存にフォールバックする(せっかく選んだ画像を
    // 無駄にしないため、エラーにはしない)。
    const useOriginalForThis = wantsOriginal && originalUploadedToday < DAILY_ORIGINAL_UPLOAD_LIMIT;
    if (wantsOriginal && !useOriginalForThis) fellBackToCompressed = true;

    if (files.length > 1) showToast(`アップロード中... (${i + 1}/${files.length})`);
    try {
      await uploadOneFile(files[i], currentUid, useOriginalForThis);
      uploadedToday++;
      if (useOriginalForThis) originalUploadedToday++;
    } catch (err) {
      console.error('[storage] upload failed', err);
      showToast(`「${files[i].name}」のアップロードに失敗しました。`);
      uploadBtn.disabled = false;
      return;
    }
  }
  if (!hitDailyLimit) {
    showToast(fellBackToCompressed
      ? `アップロードが完了しました(元画像保存は1日${DAILY_ORIGINAL_UPLOAD_LIMIT}枚までのため、一部は圧縮版で保存しました)。`
      : 'アップロードが完了しました。');
  }
  uploadBtn.disabled = false;
});

const ORIGINAL_EXT_BY_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
};

// Storageの読み取りルールがどのパスも公開(if true)なので、getDownloadURL()の
// ような署名付きURLは不要で、標準のダウンロードURL形式をパスから直接組み立てられる。
function publicDownloadUrl(path) {
  return `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(path)}?alt=media`;
}

async function uploadOneFile(file, uid, useOriginal) {
  const nativeImg = await loadImageFromFile(file);

  // 「元の画像のまま保存」がON(UPointで解放済み)なら、リサイズ/圧縮せず
  // 選んだファイルをそのままアップロードする。対応していない形式の場合は
  // 従来通りWebPへ変換する(ORIGINAL_EXT_BY_TYPEに無ければフォールバック)。
  const ext = ORIGINAL_EXT_BY_TYPE[file.type];
  const isOriginal = !!(useOriginal && ext);
  const mainFilename = isOriginal ? `original.${ext}` : 'view.webp';
  const mainContentType = isOriginal ? file.type : 'image/webp';

  const imageId = doc(collection(db, IMAGES_COLLECTION)).id;
  const thumbPath = `${STORAGE_ROOT}/${uid}/${imageId}/thumb.webp`;
  const mainPath  = `${STORAGE_ROOT}/${uid}/${imageId}/${mainFilename}`;

  // SafeSearchモデレーション用Cloud Function(Storageの書き込み完了トリガー)は
  // 判定結果をこのFirestoreドキュメントにmergeで書き込みに来る。そのトリガーは
  // Storageアップロード完了と同時に走るため、ドキュメントを先に作っておかないと
  // 「ドキュメントがまだ無い→Functionが部分的なドキュメントを作る→直後にこの
  // クライアントのsetDocが丸ごと上書きしてモデレーション結果が消える」という
  // 競合が起きる。そのためStorageへのアップロードより先にここでFirestoreへ
  // 書き込む(URLもgetDownloadURL()を待たず決定的に組み立てられるので、
  // アップロード前でも先に確定できる)。
  await setDoc(doc(db, IMAGES_COLLECTION, imageId), {
    ownerUid: uid,
    createdAt: serverTimestamp(),
    tags: [],
    moderationStatus: 'pending',
    viewUrl: publicDownloadUrl(mainPath),
    thumbUrl: publicDownloadUrl(thumbPath),
    mainPath,
    thumbPath,
    shareEnabled: false,
    isOriginal,
  });

  const thumbBlob = await resizeToWebp(nativeImg, THUMB_MAX_SIDE, WEBP_QUALITY);
  await uploadBytes(ref(storage, thumbPath), thumbBlob, { contentType: 'image/webp' });

  const mainBlob = isOriginal ? file : await resizeToWebp(nativeImg, VIEW_MAX_SIDE, WEBP_QUALITY);
  await uploadBytes(ref(storage, mainPath), mainBlob, { contentType: mainContentType });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function resizeToWebp(img, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/webp', quality);
  });
}
