# 画像保管庫 — 開発メモ

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

## Firestore/Storageのセキュリティルール(実装・デプロイ済み 2026-09-08)
ルールの実体は**このリポジトリには無く**、`E:\20_GitHub\24_AccountCenter\firestore.rules`
と`...\storage.rules`にある(プロジェクト全体で共有しているファイル。ユーザーは
Firebaseプロジェクト名`genshin-bakatare01`から「Bakatare01」と呼ぶことがあるが、
実際のリポジトリ名は24_AccountCenter。詳細は[[reference_firestore_rules_location]]メモ参照)。
`screenshotStorageImages`/`screenshotStorage/`のルールは追加済み・
`firebase deploy --only firestore:rules` / `--only storage`で反映済み
(このFirebase CLIバージョンでは`firestore:rules,storage:rules`のように
まとめて1回で指定するとエラーになるため、2回に分けて実行する必要がある)。

内容: ログイン必須(`request.auth.uid`をそのままownerUid/Storageパスに使う、
accountLinks経由の共有匿名IDにはしていない)。`moderationStatus`はクライアント
から変更不可(Cloud Functions/Admin SDK専用)。`shareEnabled`は
`moderationStatus == 'approved'`の時だけtrueにできる。

## ⚠️ 未実装・ブロッカー(次にやること)

### 1. Cloud Functions(SafeSearchモデレーション)が未実装
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

### 2. 元画像のまま保存する機能(UP交換で解放、実装中)
デフォルトはこれまで通りリサイズ/WebP圧縮。ユーザーが08_UPointでUPを消費して
解放すると、チェックボックスで「元の画像のまま保存」を選べるようにする
(`sitePerks.storage17.originalUpload`的なflag、[[project_point_redemption_site]]と
同じパターン)。08_UPoint側に実際の交換メニューを追加する作業は別途必要
(このリポジトリ単体では解放フラグを読むだけ)。

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
