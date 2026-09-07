# スクショ保管庫 — 開発メモ

原神・スタレのスクショを、カメラロールの日常写真と混ざらずに後から見返せる
アップロード先サイト。登録済みアカウント(24_AccountCenter)でログインした人だけ
が使える(このサイト群では珍しく、ログイン必須)。静的サイト＋Firestore/Storage
という構成は他サイトと同じ。

## 決まっている設計方針
- **公開範囲**: 画像はデフォルト非公開。共有は「URLを知っている人にだけ」渡せる
  形式(サイト内での公開フィードにはしない)。
- **整理方法**: フォルダ/アルバムを強制しない。アップロード日時順の一覧が基本で、
  そこに任意のフリータグとお気に入り(★)を軽く乗せる方式(Google Photos/Immich
  が支持されている理由の分析から)。
- **画質**: 原寸は保存せず、クライアント側でリサイズ/WebP圧縮してから保存する。
  表示用は長辺1920px、一覧のサムネイルは長辺400px、quality 0.85。
  (`script.js`の`resizeToWebp()`。94_gazouのcanvasリサイズと同じ考え方)

## データモデル(実装済み・script.js)
- Storage: `screenshotStorage/{uid}/{imageId}/view.webp` と `.../thumb.webp`
- Firestore: `screenshotStorageImages/{imageId}` = `{ ownerUid, createdAt,
  tags:[], favorite:bool, moderationStatus:'pending'|'approved'|'flagged'|'removed',
  viewUrl, thumbUrl, shareEnabled:bool }`
- `imageId`は`doc(collection(db,'screenshotStorageImages')).id`でクライアント側
  生成してからStorageのパスにも使い回している(先にIDを確定させてから
  Storageアップロード→Firestore書き込みの順で行うため)。

## ⚠️ 未実装・ブロッカー(次にやること)

### 1. Firestore/Storageのセキュリティルールが無い
このプロジェクト(`genshin-bakatare01`)のルールはBakatare01リポジトリ側で
管理されており(FriendBoardの[[project_point_redemption_site]]メモ参照)、
末尾が `match /{document=**} { allow read, write: if false; }` という
全拒否のcatch-allになっている。`screenshotStorageImages`コレクションと
`screenshotStorage/`パスの許可ルールを**Bakatare01リポジトリに追加しないと、
このサイトの読み書きは全てpermission-deniedで失敗する**。

追加すべきルール案(Firestore側、ログイン必須なので`request.auth != null`必須、
自分のuidのドキュメントだけ読み書き可能にする):
```
match /screenshotStorageImages/{imageId} {
  allow read: if request.auth != null
    && (resource.data.ownerUid == request.auth.uid || resource.data.shareEnabled == true);
  allow create: if request.auth != null
    && request.resource.data.ownerUid == request.auth.uid
    && request.resource.data.moderationStatus == 'pending';
  allow update: if request.auth != null && resource.data.ownerUid == request.auth.uid
    && request.resource.data.ownerUid == resource.data.ownerUid;
  allow delete: if request.auth != null && resource.data.ownerUid == request.auth.uid;
}
```
Storage側は`storage.rules`(Bakatare01側、Firestoreルールとは別ファイルの想定)に
`match /screenshotStorage/{uid}/{allPaths=**} { allow read: if true;
allow write: if request.auth != null && request.auth.uid == uid; }`のようなルールが必要。

### 2. Cloud Functions(SafeSearchモデレーション)が未実装
このサイト群で初めてCloud Functionsを使うことになる機能。設計方針(2026-09確定):
- Storageの`onFinalize`トリガーでCloud Vision APIのSafeSearch Detectionを実行
- `VERY_LIKELY` → 該当ファイルを**即自動削除**し、Firestoreドキュメントの
  `moderationStatus`を`'removed'`にする(または削除する)
- `LIKELY`/`POSSIBLE` → `moderationStatus`を`'flagged'`にする。この間は
  `shareEnabled`を強制的にfalseのままにして共有リンクを発行させない
  (=保留中は絶対に人に見せない)。加えて**7日間確認されなければ自動削除**する
  フェイルセーフを入れる(タイマー付きCloud Function or 別途スケジュール実行)。
- `UNLIKELY`/`VERY_UNLIKELY` → `moderationStatus`を`'approved'`にする
- 管理者(自分)用の確認画面で`moderationStatus == 'flagged'`のものを一覧表示し、
  「公開する/削除する」を選べるようにする(FriendBoardの通報確認タブと同じ
  パターンを流用予定、未実装)
- 前提として、保留中でもファイル自体はStorageに存在する以上、Google側の
  自動スキャンに対して完全に無リスクにはならない、という点はユーザーとの
  会話で認識合わせ済み(だからこそ即自動削除としきい値管理・7日自動削除が重要)。

### 3. gitリポジトリ未作成
`E:\20_GitHub\17_storage`はまだ`git init`していない。GitHub Pagesで公開する
ならリポジトリ作成が必要(94_gazouと違い、これは公開サイトなので早めに必要)。

## その他
- ヘッダー/フッター/ハンバーガーメニュー/フォント(`mihoyo-zenzero`)/モバイル
  対応(768pxブレークポイント)は00_TopPage/25_FriendBoardのデザインをそのまま
  踏襲(`index.html`, `styles.css`)。ハンバーガーメニューは共通の
  `shared/sidebar.js`を読み込むだけ(ローカル確認用/本番用の2パターンが
  index.html内にコメントで両方入っている、他サイトと同じ切り替え方式)。
  17_storageを公開したら、00_TopPageの`shared/sidebar.js`内`MENU`配列にも
  リンクを追加すること(そうしないと他サイトのハンバーガーメニューから
  17_storageへ辿り着けない)。
- ログイン必須のサイトなので、`index.html`の`#login-gate`/`#storage-app`を
  `script.js`の`onAuthStateChanged`で出し分けている(未ログイン時は
  アップロード/ギャラリーのUIごと隠す)。
