# 画像保管庫 — 開発メモ

原神・スタレのスクショを、カメラロールの日常写真と混ざらずに後から見返せる
アップロード先サイト。登録済みアカウント(24_AccountCenter)でログインした人だけ
が使える(このサイト群では珍しく、ログイン必須)。静的サイト＋Firestore/Storage
という構成は他サイトと同じ。

## 運用ルール(25_FriendBoardと同じ)
- 修正するたびに`index.html`の`#site-version`を1つ上げる。
- 同時に`<link rel="stylesheet" href="styles.css?v=X.X">`のクエリパラメータも
  同じ番号に揃える(CSSだけキャッシュが古いまま反映されない症状を防ぐため)。

## ヘッダーの出し分け(実装済み 2026-09-09)
未ログインの人には`#site-title`/`#home-sub-desc`(タイトル・説明文)を表示、
ログイン済みの人にはこの2つを隠してシンプルにする(`script.js`の
`onAuthStateChanged`)。CSSの`:has()`セレクタで、タイトルが隠れている時は
`.portal-header`の上下余白も詰める(`.portal-header:has(#site-title.hidden)`)。
「画像を選ぶ」ボタンは元々`#storage-app`の先頭にあるため、ヘッダーが縮むと
自然に一番上に来る(並び替えは不要だった)。

## 決まっている設計方針
- **公開範囲**: 画像はデフォルト非公開。共有は「URLを知っている人にだけ」渡せる
  形式(サイト内での公開フィードにはしない)。
- **整理方法**: フォルダ/アルバムを強制しない。アップロード日時順の一覧が基本で、
  そこに任意のフリータグとお気に入り(★)を軽く乗せる方式(Google Photos/Immich
  が支持されている理由の分析から)。
- **画質**: 原寸は保存せず、クライアント側でリサイズ/WebP圧縮してから保存する。
  表示用は長辺1920px、一覧のサムネイルは長辺400px、quality 0.85。
  (`script.js`の`resizeToWebp()`。94_gazouのcanvasリサイズと同じ考え方)

## 画像の削除・右クリックメニュー(実装済み 2026-09-08)
ギャラリーの画像を右クリックすると、ブラウザ標準のメニュー(「名前を付けて
画像を保存」等)は`preventDefault()`で出さず、独自メニュー(拡大表示/
ダウンロード/共有用URLをコピー/削除する)を表示する(`script.js`の
`openContextMenu()`)。モバイルの長押しメニューはブラウザ側の挙動が
異なり、JSだけでは完全には抑止できない可能性がある(未検証)。

削除は「Storageの実ファイル(thumb+view/original)を`deleteObject()`で消す→
Firestoreドキュメントを`deleteDoc()`で消す」の順で行う。そのため
`mainPath`/`thumbPath`(Storageのパス文字列)もFirestoreドキュメントに
保存するようにした(`viewUrl`/`thumbUrl`はダウンロードURルであってパスでは
ないため、削除時に`ref()`へ渡すパスが別途必要)。**この変更より前に
アップロードされた画像には`mainPath`/`thumbPath`が無いので、削除ボタンが
効かない可能性がある**(テスト投稿があれば再アップロードして確認)。

Storage側は`allow write`(create/update用、`request.resource`の存在を
前提にした条件)とは別に`allow delete: if request.auth.uid == uid;`を
明示的に追加する必要があった(deleteリクエストには`request.resource`が
無いため、`allow write`の条件だけでは常に拒否されてしまう)。

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
  Cloud Vision APIのSafeSearch Detectionを実行し、`adult`/`violence`/`racy`
  のいずれかが`VERY_LIKELY`なら`moderationStatus:'removed'`。
  **`racy`はこれ以外の判定には一切関与しない**(2026-09-09、下記参照)。
  `adult`/`violence`が`POSSIBLE`以上なら`'flagged'`(+`flaggedAt`)、
  それ以外は`'approved'`にFirestoreを更新する。SafeSearch自体がエラーで
  失敗した場合も安全側に倒して`'flagged'`(`flaggedReason:'safesearch_error'`)
  にする(無条件approvedにはしない)。判定結果(`safeSearchScores:{adult,
  violence,racy}`)はログとFirestoreドキュメントの両方に記録する(元々
  記録しておらず、保留理由を後から追えなかった反省から追加)。管理画面の
  flagged一覧にもこのスコアを表示する。

  **`racy`のしきい値変更の経緯**: 当初`POSSIBLE`から保留にしていたが、
  ソシャゲ系キャラは肩出し・デコルテの衣装がデザインとして標準的なため、
  完全に健全なイラストが大量に誤検知された。`LIKELY`まで緩和しても
  なお健全な画像が引っかかる実例が確認されたため、最終的に`racy`は
  保留判定から完全に除外し、`VERY_LIKELY`の即削除にのみ関与する形にした
  (2026-09-09)。今後同様の相談が来た場合、`adult`/`violence`はこのサイトの
  用途(原神/スタレのスクショ・イラスト)では誤検知が少なく、`racy`だけが
  ノイズ源になりやすいという前提を踏まえること。
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

## タグ機能(実装済み 2026-09-09)
それまでタグを付けるUI自体が存在せず、絞り込み欄が常に空振りする状態だった
ため新規実装。既定タグ`PRESET_TAGS`(`script.js`先頭で定義):
`原神・スタレ・イラスト・スクショ・ガチャ・コスプレ・その他・あとで見る`。

- タグ付けは**アップロード後**、画像の右クリックから行う(アップロード時には
  タグを聞かない)。
- 絞り込み行の左に「複数選択」チェックボックスを追加(`#select-mode-toggle`、
  2026-09-09に「選択」から改名)。ONにすると各画像に選択用チェックボックスが
  出る(`.storage-card-select`、CSSは`#gallery-grid.select-mode`配下でのみ
  表示)。ONの間はカードのどこをクリックしてもチェックがトグルする
  (`selectModeEnabled`の時はカードのclickでライトボックスを開かずチェックを
  トグルするよう分岐している)。
- **タグ絞り込みは自由入力ではなく、実際に使われている(登録済みの)タグの
  一覧から選ぶ方式**(2026-09-09、テキスト入力から変更)。`renderTagFilterList()`
  が`allImages`から使用中タグを集計し、使用回数の多い順にチップ表示する
  (`activeTagFilter`で単一選択、同じものをもう一度押すと解除)。allImagesが
  更新されるたびに(`startGalleryListener`のonSnapshot内で)再集計している。
- **タグ付けは右クリックメニュー→「タグを選択」→2段目メニュー方式**
  (2026-09-09に2転三転した経緯: ①専用モーダル(`#tag-picker`)方式 →
  ②タグ一覧を1段目に直接埋め込む方式 → ③現行の「タグを選択」を挟んで
  2段目メニューを開く方式。②は「ワンクッション無く一覧が出るのが分かり
  にくい」とのことで③に戻した)。専用モーダルは無く、`buildTagMenuItems
  (imageIds)`が候補タグ(+「＋ 新しいタグを追加」)をメニュー項目の配列で
  返し、`openContextMenu()`をもう一度同じ座標で呼んで2段目として開く。
  - 1枚右クリック時: `拡大表示/タグを選択/ダウンロード/共有用URLをコピー/
    削除する`の並び(「タグを選択」は2番目)。クリックすると2段目に
    タグ一覧が開き、各タグの行に既存タグなら`✓ `を付けて表示、クリックで
    その場でON/OFFする(`toggleTagOnImage()`。確認・適用ボタンは無く
    1クリックで即確定)。
  - 複数選択時(`selectedImageIds.size > 0`): 1段目は
    `タグを選択(N件に追加)`と`画像削除`の2項目。「タグを選択」から開く
    2段目でクリックしたタグを選択中の全画像に"追加"する(`addTagToImages()`、
    **追加のみ**で既存タグの削除はしない — 画像ごとに元のタグが違うため)。
    選択状態はタグ適用後もクリアしない(続けて別のタグも追加できるように)。
    「画像削除」は`deleteImages(ids)`で選択中の全画像を一括削除する
    (`deleteImage()`と共通処理`deleteImageFilesAndDoc()`を切り出して共有)。
  - どちらも「＋ 新しいタグを追加」で`prompt()`を使った簡易入力から
    独自タグを作成できる。
  - 右クリックメニュー(`.storage-context-menu`)はタグ分の項目が増えて
    縦に長くなるため、`max-height:70vh; overflow-y:auto`を追加した。

## ⚠️ 残っているタスク

00_TopPageのハンバーガーメニュー(`shared/sidebar.js`のMENU配列、「便利ツール」
グループ)への追加は2026-09-08に完了済み。

### 予算アラート(参考: 費用面のセーフティネット)
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
