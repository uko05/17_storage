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
- Storage: `screenshotStorage/{uid}/{imageId}/view.webp`(または`original.{ext}`)
  と `.../thumb.webp`
- Firestore: `screenshotStorageImages/{imageId}` = `{ ownerUid, createdAt,
  tags:[], favorite:bool, moderationStatus:'pending'|'approved'|'flagged'|'removed',
  viewUrl, thumbUrl, shareEnabled:bool, isOriginal:bool }`
- `imageId`は`doc(collection(db,'screenshotStorageImages')).id`でクライアント側
  生成してからStorageのパスにも使い回している。
- **書き込み順序が重要**: Firestoreドキュメントを**先に**作り、そのあとで
  Storageへアップロードする(逆ではない)。理由: Cloud Functions
  (`moderateStorageUpload`)がStorage書き込み完了と同時に発火し、
  Firestoreドキュメントへ`{merge:true}`で結果を書き込みに行く。もし
  ドキュメントがまだ無い状態でこれが先に走ると、直後にクライアントが行う
  `setDoc`(mergeなし)がその結果を丸ごと上書きしてしまう。`viewUrl`/`thumbUrl`
  も`getDownloadURL()`を待たず、Storageの読み取りルールが`if true`(公開)
  であることを前提に`https://firebasestorage.googleapis.com/v0/b/{bucket}/o/
  {encodedPath}?alt=media`形式で決定的に組み立てている(アップロード前でも
  確定できるので、この順序変更と相性がよい)。

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

## Cloud Functions(SafeSearchモデレーション、実装・デプロイ済み 2026-09-08)
このサイト群で初めて使うCloud Functions。実体は`24_AccountCenter/functions/`
にある(Firestore/Storageルールと同じく共有インフラリポジトリ側)。
`firebase.json`に`"functions": {"source": "functions"}`を追加済み。
リージョンは**asia-northeast1**(StorageバケットもFirestoreのデータベースも
asia-northeast1にあるため。Storageトリガーはバケットと別リージョンの
関数からは張れず一度`us-central1`でデプロイ失敗した)。Node.js 22
(2026-09時点、Node 20は非推奨のため)。

3つの関数:
- `moderateStorageUpload`(Storageの`onFinalize`トリガー、パスが
  `screenshotStorage/{uid}/{imageId}/(view.webp|original.*)`の時だけ処理。
  `thumb.webp`は同じ画像の縮小版で判定結果が変わらないためスキップ)。
  Cloud Vision APIのSafeSearch Detectionを実行し、`VERY_LIKELY`→
  `moderationStatus:'removed'`、`LIKELY`/`POSSIBLE`→`'flagged'`(+
  `flaggedAt`)、`UNLIKELY`/`VERY_UNLIKELY`→`'approved'`にFirestoreを
  更新する。SafeSearch自体がエラーで失敗した場合も安全側に倒して
  `'flagged'`(`flaggedReason:'safesearch_error'`)にする(無条件approvedには
  しない)。
- `sweepFlaggedImages`(`onSchedule('every 24 hours')`)。`flagged`のまま
  `flaggedAt`から7日経過した画像を`'removed'`にする(見忘れ放置の
  フェイルセーフ)。
- `cleanupRemovedImage`(`screenshotStorageImages/{imageId}`の
  `onDocumentUpdated`トリガー)。`moderationStatus`が`'removed'`に**変わった
  瞬間**に実際のStorageファイルを削除する処理をここに一本化している
  (SafeSearchの自動判定・7日一括削除・管理者の手動却下、どの経路で
  `'removed'`になっても同じ処理で片付く。呼び出し側は理由を問わず
  Firestoreを更新するだけでよい設計)。

管理者用の確認画面(`index.html`の`#admin-section`、`script.js`の
`ADMIN_UID`)を実装済み。FriendBoard(`board.js`)と同一のADMIN_UIDを
そのまま流用(将来的にロールベースへ移行する構想はFriendBoard側のメモ参照)。
`moderationStatus=='flagged'`の画像を一覧表示し「公開する/削除する」を選べる。
Firestoreルール側でも管理者(`isAdmin()`)には`moderationStatus`/`shareEnabled`
/`moderatedAt`のみの更新を許可済み。

前提として、保留中でもファイル自体はStorageに存在する以上、Google側の
自動スキャンに対して完全に無リスクにはならない、という点はユーザーとの
会話で認識合わせ済み(だからこそ即自動削除としきい値管理・7日自動削除が重要)。

## 元画像のまま保存する機能(実装・08_UPoint連携済み 2026-09-08)
デフォルトはこれまで通りリサイズ/WebP圧縮。08_UPointで100UPと交換すると
`omikujiUsers/{omikujiUserId}.sitePerks.storage17.originalUpload`がtrueになり、
アップロード画面にチェックボックスが出て「元の画像のまま保存」を選べるように
なる(一度交換すれば永続、`perkType:'flag'`)。08_UPoint側のカタログ追加も完了
(`08_UPoint/script.js`のSITE_GROUPS)。

## ⚠️ 未実装・ブロッカー(次にやること)

### 1. 00_TopPageのハンバーガーメニューにまだ載っていない
`00_TopPage/shared/sidebar.js`の`MENU`配列に17_storageのリンクを追加する
作業がまだ。これをしないと他サイトのハンバーガーメニューから辿り着けない。

### 2. 予算アラート(参考: 費用面のセーフティネット)
`genshin-bakatare01`のGCP請求先アカウントに、月10円/月500円の2段階で
メール通知が飛ぶ予算アラートを設定済み(2026-09-08、gcloud CLIで作成)。
17_storage固有の設定ではなくプロジェクト全体に対するものだが、想定外の
利用急増があった場合の早期検知として機能する想定。

## アップロード上限(2026-09-08決定、あくまで仮置き)
費用を青天井にしないためのクライアント側カウント(Firestoreルールでの強制では
ない、`countUploadedToday()`)。
- 通常(圧縮)アップロード: **1日30枚/人**(`myDailyUploadLimit()`が
  `sitePerks.storage17.extraDailyUploads`を加算する。08_UPointで50UP/回・
  最大10回まで交換でき、+1枚ずつ永続的に底上げできる。合計で最大+10枚まで)
- 元画像のまま保存: **1日5枚/人**(こちらはextraDailyUploadsの対象外の固定値。
  UPointで解放済みでも別枠でこの上限。上限に達した分は自動で圧縮保存に
  フォールバックする、エラーにはしない)

**根拠(仮の試算)**: 1日あたりの利用者数を仮に30人と想定。圧縮画像1枚あたり
view+thumbで概算350KB、元画像は平均5MB(上限30MB)と仮定すると、全員が
毎日上限までフルに使った最悪ケースでも月間のストレージ増加は概算30GB程度
(Firebase Storage課金は$0.026/GB/月程度なので、月1000円未満で収まる計算)。
実際の利用者数が想定と大きくズレる場合は、この30人という前提ごと見直して
上限を調整すること。

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
