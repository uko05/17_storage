// script.js
// 画像保管庫。ログイン必須(24_AccountCenterでの登録・ログインが前提)。
// アップロード時にクライアント側でリサイズ/圧縮してから保存し、原寸は保持しない。
//
// Firestore(screenshotStorageImages)・Storage(screenshotStorage/)のルールは
// 24_AccountCenterリポジトリのfirestore.rules/storage.rulesにある(実装・デプロイ済み)。

import { auth, db, storage } from './firebaseConfig.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  collection, doc, getDoc, setDoc, updateDoc, query, where, orderBy, onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

const loginGate   = document.getElementById('login-gate');
const storageApp  = document.getElementById('storage-app');

const uploadInput  = document.getElementById('upload-input');
const uploadBtn    = document.getElementById('upload-btn');
const uploadStatus = document.getElementById('upload-status');

const originalUploadRow = document.getElementById('original-upload-row');
const originalUploadCheckbox = document.getElementById('original-upload-checkbox');

const tagFilterInput   = document.getElementById('tag-filter-input');
const favoriteFilterBtn = document.getElementById('favorite-filter-btn');

const galleryGrid      = document.getElementById('gallery-grid');
const galleryEmptyHint = document.getElementById('gallery-empty-hint');

const IMAGES_COLLECTION = 'screenshotStorageImages';
const STORAGE_ROOT = 'screenshotStorage';
const VIEW_MAX_SIDE  = 1920;
const THUMB_MAX_SIDE = 400;
const WEBP_QUALITY = 0.85;

let currentUid = null;
let unsubscribeGallery = null;
let unsubscribeSitePerks = null;
let allImages = [];       // 自分がownerの画像を全件(Firestoreの現在の値)
let favoriteOnly = false;
let tagFilterText = '';

// ===== ログイン状態でメイン画面の出し分け =====
onAuthStateChanged(auth, async (user) => {
  if (unsubscribeGallery) { unsubscribeGallery(); unsubscribeGallery = null; }
  if (unsubscribeSitePerks) { unsubscribeSitePerks(); unsubscribeSitePerks = null; }

  if (user) {
    currentUid = user.uid;
    loginGate.classList.add('hidden');
    storageApp.classList.remove('hidden');
    startGalleryListener(currentUid);

    // 「元の画像のまま保存」はUPointでの交換で解放される機能。sitePerksは
    // Firebase Authのuidではなく共有匿名ID(omikujiUserId)側にぶら下がっているので、
    // accountLinksで一度引いてからomikujiUsersを見に行く(userAvatars等と同じ経路)。
    const omikujiUserId = await resolveOmikujiUserId(currentUid);
    if (omikujiUserId) unsubscribeSitePerks = startSitePerksListener(omikujiUserId);
  } else {
    currentUid = null;
    allImages = [];
    originalUploadUnlocked = false;
    originalUploadRow.classList.add('hidden');
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
function startSitePerksListener(omikujiUserId) {
  return onSnapshot(doc(db, 'omikujiUsers', omikujiUserId), (snap) => {
    originalUploadUnlocked = !!snap.data()?.sitePerks?.storage17?.originalUpload;
    originalUploadRow.classList.toggle('hidden', !originalUploadUnlocked);
    if (!originalUploadUnlocked) originalUploadCheckbox.checked = false;
  }, (e) => console.error('[storage] site perks listen failed', e));
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
    renderGallery();
  }, (e) => {
    console.error('[storage] gallery listen failed', e);
    uploadStatus.textContent = '画像一覧の取得に失敗しました(権限設定が未対応の可能性があります)。';
  });
}

function renderGallery() {
  const filtered = allImages.filter((img) => {
    if (img.moderationStatus === 'removed') return false;
    if (favoriteOnly && !img.favorite) return false;
    if (tagFilterText) {
      const tags = Array.isArray(img.tags) ? img.tags : [];
      if (!tags.some((t) => t.toLowerCase().includes(tagFilterText))) return false;
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

    const favBtn = document.createElement('span');
    favBtn.className = 'storage-card-fav';
    favBtn.textContent = img.favorite ? '★' : '☆';
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(img.id, !img.favorite);
    });
    card.appendChild(favBtn);

    card.addEventListener('click', () => {
      if (img.viewUrl) window.open(img.viewUrl, '_blank', 'noopener');
    });

    galleryGrid.appendChild(card);
  }
}

async function toggleFavorite(imageId, next) {
  try {
    await updateDoc(doc(db, IMAGES_COLLECTION, imageId), { favorite: next });
  } catch (e) {
    console.error('[storage] toggle favorite failed', e);
  }
}

tagFilterInput.addEventListener('input', () => {
  tagFilterText = tagFilterInput.value.trim().toLowerCase();
  renderGallery();
});

favoriteFilterBtn.addEventListener('click', () => {
  favoriteOnly = !favoriteOnly;
  favoriteFilterBtn.classList.toggle('active', favoriteOnly);
  renderGallery();
});

// ===== アップロード =====
uploadBtn.addEventListener('click', () => uploadInput.click());

uploadInput.addEventListener('change', async (e) => {
  const files = [...e.target.files];
  uploadInput.value = '';
  if (!files.length || !currentUid) return;

  const useOriginal = originalUploadUnlocked && originalUploadCheckbox.checked;

  uploadBtn.disabled = true;
  for (let i = 0; i < files.length; i++) {
    uploadStatus.textContent = `アップロード中... (${i + 1}/${files.length})`;
    try {
      await uploadOneFile(files[i], currentUid, useOriginal);
    } catch (err) {
      console.error('[storage] upload failed', err);
      uploadStatus.textContent = `「${files[i].name}」のアップロードに失敗しました。`;
      break;
    }
  }
  if (uploadStatus.textContent.startsWith('アップロード中')) {
    uploadStatus.textContent = 'アップロードが完了しました。';
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

async function uploadOneFile(file, uid, useOriginal) {
  const nativeImg = await loadImageFromFile(file);
  const thumbBlob = await resizeToWebp(nativeImg, THUMB_MAX_SIDE, WEBP_QUALITY);

  const imageId = doc(collection(db, IMAGES_COLLECTION)).id;
  const thumbRef = ref(storage, `${STORAGE_ROOT}/${uid}/${imageId}/thumb.webp`);
  await uploadBytes(thumbRef, thumbBlob, { contentType: 'image/webp' });

  // 「元の画像のまま保存」がON(UPointで解放済み)なら、リサイズ/圧縮せず
  // 選んだファイルをそのままアップロードする。対応していない形式の場合は
  // 従来通りWebPへ変換する(ORIGINAL_EXT_BY_TYPEに無ければフォールバック)。
  const ext = ORIGINAL_EXT_BY_TYPE[file.type];
  const isOriginal = !!(useOriginal && ext);

  let viewRef;
  if (isOriginal) {
    viewRef = ref(storage, `${STORAGE_ROOT}/${uid}/${imageId}/original.${ext}`);
    await uploadBytes(viewRef, file, { contentType: file.type });
  } else {
    const viewBlob = await resizeToWebp(nativeImg, VIEW_MAX_SIDE, WEBP_QUALITY);
    viewRef = ref(storage, `${STORAGE_ROOT}/${uid}/${imageId}/view.webp`);
    await uploadBytes(viewRef, viewBlob, { contentType: 'image/webp' });
  }

  const [viewUrl, thumbUrl] = await Promise.all([
    getDownloadURL(viewRef),
    getDownloadURL(thumbRef),
  ]);

  // moderationStatus: 'pending'のまま作成する。SafeSearch判定用のCloud Functionが
  // Storageへの書き込みをトリガーに動き、'approved'/'flagged'へ更新するか、
  // 明確に危険な場合はファイルごと削除する想定(未実装、CLAUDE.md参照)。
  await setDoc(doc(db, IMAGES_COLLECTION, imageId), {
    ownerUid: uid,
    createdAt: serverTimestamp(),
    tags: [],
    favorite: false,
    moderationStatus: 'pending',
    viewUrl,
    thumbUrl,
    shareEnabled: false,
    isOriginal,
  });
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
