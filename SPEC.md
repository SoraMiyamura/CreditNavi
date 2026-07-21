# クレカ乗車運賃ナビ 仕様書（引き継ぎドキュメント）

このドキュメントは、アプリ「クレカ乗車運賃ナビ」を新しいチャットで引き継ぐための仕様書です。
新規チャットの冒頭で、本ファイルと最新の成果物（index.html / fare.json / sw.js / notices.json / odpt_fare_importer.html / notices_editor.html）を添付すれば、そのまま開発を継続できます。

本書は現時点の実装を機能別にまとめた最新版です（旧来の日付順の変更履歴は本書末尾の「変更履歴（要約）」に集約しました）。実際の挙動は常に最新の index.html / fare.json を正としてください。

---

## 1. アプリ概要

クレジットカードのタッチ決済乗車（クレカ乗車）を使うと、交通系ICや現金と比べていくらお得かを、ポイント還元も含めて比較する首都圏の鉄道運賃ナビ。出発駅・到着駅を選ぶと、現金（きっぷ）／交通系IC／クレカ乗車の3手段の運賃と、クレカ乗車のポイント獲得量・実質負担額を提示する。

- 単一HTMLアプリ（index.html）。ビルド不要、`fetch("fare.json")` で運賃データを読み込む。
- 運賃計算は fare.json 単体で完結（外部API不要）。
- サービスワーカー対応（sw.js）でオフライン起動・キャッシュ利用が可能。
- iOS風UI。検索／乗車履歴／カードの3タブ + 経路候補・運賃内訳・検索履歴・アプリ情報等のプッシュ画面。

---

## 2. ファイル構成と役割

- **index.html** … アプリ本体（UI + 運賃・ポイント計算 + 経路探索）。単一ファイル。
- **fare.json** … 運賃データ本体（`format:"fare"` v2）。アプリと同じフォルダに置く。12事業者・日本語駅名済み・全862駅。
- **sw.js** … サービスワーカー。index.html と同じフォルダに配置し `navigator.serviceWorker.register('sw.js')` で登録。アプリ本体・fare.json をキャッシュし、オフラインでも起動・運賃計算が可能（fare.json はキャッシュを即返しつつバックグラウンド更新する stale-while-revalidate 方式）。**ただし notices.json だけはこのキャッシュ層の対象外**にしており、常にオンライン時の最新内容を取得する（§19参照）。
- **notices.json** … アプリ内「お知らせ」欄が読み込むお知らせデータ＋アプリの最新バージョン情報。index.html・fare.jsonと同じフォルダに置く。詳細は§19。
- **odpt_fare_importer.html** … ODPTの `odpt:RailwayFare` JSON を fare.json に変換・統合するツール（別アプリ）。
- **notices_editor.html** … notices.json をJSONを直接書かずに作成・編集するための単独ツール（別アプリ）。詳細は§20。
- **SPEC.md** … 本ドキュメント。

---

## 3. データ形式（fare.json v2 スキーマ）

トップレベルキー: `format, version, generated, note, operators, stationGroups, discounts, discountsNote, overrides, rule`

### 3.1 operators（12事業者）
keikyu, keio, seibu, sotetsu, tobu, toei, tokyometro, tokyu, 横浜高速鉄道みなとみらい線, mir(=つくばエクスプレス), yokohamamunicipal(=横浜市営地下鉄), yurikamome

各 operator（od-matrix型）の構造:
- `operator, operatorName, fareType:"od-matrix", symmetric:true/false`
- `stations`: `[{idx, slug, name, odptIds:[...]}]` … slug=一意キー(ローマ字)、name=表示名(日本語)。name===slug は未和訳。
- `pairFormat`: `["fromIdx","toIdx","cash","ic"]`
- `fares`: `[[fromIdx,toIdx,cash,ic], ...]`  cash=きっぷ(10円単位)、ic=IC(1円単位)。symmetric:true なら片方向のみ格納。
- 運賃参照は idx で行う。slug は同一駅グループ・割引照合に使う。

### 3.2 stationGroups（同一駅グループ・61件）
乗換可能かつ運賃通算される「同一駅扱い」。社局跨ぎ経路の接続点。
`{ id, members:[{op,slug},...], fareContinuous:true }`

### 3.3 discounts（乗継割引・30件）
きっぷ・IC向け。クレカ乗車に適用されるのはメトロ⇔都営の70円のみ。
`{ id, operators:[opA,opB], junction:[slug], amount, appliesTo:["cash","ic"], a:[opA側区間slug], b:[opB側区間slug] }`
- `operators[0]`=a側 / `operators[1]`=b側。方向自動判定。出発駅∈a かつ 到着駅∈b のとき適用。
- appliesTo: 基本 `["cash","ic"]`。メトロ⇔都営70円のみ `["cash","ic","cc"]`。IC限定は `["ic"]`。
- 出典: 首都圏乗継割引設定全区間一覧 2026-03-14（komachi600 / PDF tetu1.pdf）。
- 追加済: 泉岳寺(京急⇔都営)、横浜(東急/京急/相鉄/みなとみらい線 相互6ペア)。

### 3.4 overrides / rule
`overrides:{ic:[],cc:[]}`（個別上書き枠・現状空）。`rule`=社局跨ぎ計算方針の説明文。

---

## 4. 主要機能一覧

- 現金／交通系IC／クレカ乗車の3手段比較。
- クレカ乗車のポイント獲得量・実質負担額（カード5枚 + 東武特例）。
- 交通系IC還元率のユーザー設定（0.1%単位、カード画面）。
- 「最安」(緑)／「ポイント還元考慮後の実質最安」(青)／「上限適用」(オレンジ) バッジ。
- 駅名の日本語表示 + ローマ字併記。
- 2社跨ぎ + 3社以上の経路探索（ダイクストラ法）。
- 乗継割引（きっぷ・IC。クレカはメトロ⇔都営70円のみ）。
- クレカ乗車の可否判定（特例あり）。
- 横浜市営地下鉄のクレカ運賃=IC運賃（1円単位）。
- 1日上限サービスの運賃・ポイントへの実計算反映（横浜市営740円 / ゆりかもめ820円）。
- お気に入り区間（登録・削除、localStorage永続化）。
- 検索履歴・乗車履歴（ともにlocalStorage永続化、乗車履歴は日付グループ化・絞り込み検索可）。
- 三井住友カード(NL)・Oliveの月合計ポイント計算（200円単位）。
- アプリ情報画面（対応事業者・利用規約・ライセンス・お問い合わせ）。
- お知らせ機能（サムネイル画像・タイトル・本文（文中画像埋め込み可）を持つお知らせの一覧・詳細表示、アプリの更新案内の自動表示）。詳細は§19・§20。
- localStorageによる選択カード・還元率・各種履歴の永続化 + サービスワーカーによるオフライン対応。

---

## 5. 画面構成・UI構造

### 5.1 タブバー（下部3タブ）
1. **検索**（`tab-0`）… 出発・到着駅選択、お気に入り区間、経路候補。
2. **乗車履歴**（`tab-1`）… 実際に乗車した記録の一覧・追加・削除・絞り込み。
3. **カード**（`tab-2`）… ポイント計算に使うカード選択、今月のご利用状況、交通系IC還元率設定。

### 5.2 検索画面
- 大見出し「クレカ乗車運賃ナビ」の右に丸いインフォメーションボタン（`.info-btn`、`openAppInfo()`）→ アプリ情報画面へ。
- 経路入力カード右上に丸い履歴ボタン（`.history-btn`）→ 検索履歴画面（`scr-search-history`）へ。
- `#data-source`（対応事業者・駅数）の直下に「お知らせ」ボックス（`#notice-box`、`openNotices()`）。お知らせが1件も無い時は非表示。複数件ある場合は4秒おきにフェードしながら要約文を巡回表示（§19参照）。
- 「お気に入り区間」セクション（§8参照）。
- 最下部に社局跨ぎ計算方針の注記 `#app-note`。

### 5.3 プッシュ画面一覧
- `scr-results`（経路候補）／`scr-detail`（運賃の内訳）… 検索結果から遷移。
- `scr-search-history`（検索履歴一覧、タップで検索ボックスに反映）。
- `scr-app-info`（アプリ情報：対応事業者・利用規約・ライセンス・お問い合わせ。§11参照）。
- `scr-notices`（お知らせ一覧）／`scr-notice-detail`（お知らせ詳細）… お知らせボックスから遷移。§19参照。

### 5.4 レイアウト共通事項
- iPhone等のセーフエリア対応: viewportに `viewport-fit=cover`、`.tabbar`/`.scroll`/`.pushed-scroll` の下部余白に `env(safe-area-inset-bottom)` を加算。
- ピンチズーム無効化: viewportに `maximum-scale=1.0, minimum-scale=1.0, user-scalable=no`、`body`に `touch-action:pan-x pan-y;`。

---

## 6. 運賃・ポイント計算ロジック（重要）

### 6.1 3手段の運賃
- 現金(きっぷ) = cash(10円単位)。区間合算 − きっぷ乗継割引。
- 交通系IC = ic(1円単位)。区間合算 − IC乗継割引。
- クレカ乗車(cc) = 原則 cash と同額。特例あり。区間合算 − クレカ割引(メトロ⇔都営70円のみ)。
経路オブジェクト: `{cash, ic, cc, tobuFare, opKeys, legs, via, notes, opFrom, opTo, ...}`

### 6.2 クレカ乗車運賃の区間特例
- 横浜市営地下鉄: クレカ乗車も IC運賃(1円単位) を適用。`ccFareOf(op,v)=op==="yokohamamunicipal"?v[1]:v[0]`。single/cross/multi の各区間で使用。
- それ以外は cc=きっぷ運賃（ゆりかもめも現状きっぷ運賃扱い。横浜市営のようなIC特例は未適用）。

### 6.3 カード定義（5枚。`CARDS`配列）base=基本還元率, touch=タッチ上乗せ率
- `smccnl` 三井住友カード(NL): base0.5 touch6.5 (合計7%)
- `olive` Olive(クレジットモード): base0.5 touch7.5 (合計8%)
- `jcbs` JCB CARD S: base0.5 touch9.5 (合計10%)
- `jcbw` JCB CARD W: base1.0 touch9.5 (合計10.5%)
- `other` その他のクレカ: base=customRate(自己設定) touch0 (基本のみ)

### 6.4 クレカ乗車のポイント計算（東武特例が肝）
東武鉄道はタッチ決済の上乗せ還元の対象外（基本還元のみ）。
```
ポイント = 全区間cc × base%  +  (全区間cc − 東武運賃tobuFare) × touch%
```
- tobuFare=経路中の東武区間きっぷ運賃合計（single/cross/multiで集計）。
- 実装: `ccPoints(r,card)`。`eligible=max(0, r.cc - r.tobuFare)`。
- 例: 竹ノ塚→上野(東武180+メトロ180=cc360, tobuFare180) 三井住友NL → 360×0.5% + 180×6.5% = 1.8+11.7 = 13.5pt。

### 6.5 三井住友カード(NL)・Olive の月合計ポイント計算
実際には「都度」ではなく「毎月1日～月末の合計利用額」に対し200円単位で計算される点を反映（`MONTHLY_AGGREGATE_CARDS = Set(["smccnl","olive"])`）。
- 基本還元(0.5%): 月間クレカ乗車合計利用額を200円単位に切り捨てた額に適用。
- タッチ決済上乗せ(SMBC-NL 6.5%／Olive 7.5%): 月間合計から東武運賃合計を差し引いた額を200円単位に切り捨てた額に適用。
- 例: 月合計700円・うち東武200円 → 基本= floor(700/200)×200=600円×0.5%=3pt、上乗せ= floor(500/200)×200=400円×6.5%(or7.5%)=26pt(or30pt)、合計29pt(or33pt)。
- 実装: `roundDownTo200()`、`monthlyAggregatePoints()`、`monthlyCardUsage()`。乗車履歴（rideHistory）の各エントリに `cardId`（使用したCARDSのid）・`tobuFare`（東武運賃相当額）・`points`（都度計算カードの場合のみ、その乗車の獲得ポイント）を保存。三井住友NL・Oliveはポイントを都度記録せず月次集計。
- 運賃の内訳画面で、選択中のカードがこの2枚の場合、「ポイント獲得量は毎月1日～月末までの合計利用額に対し200円単位で計算するため、実際の付与ポイント数とは異なる場合があります」という注記を表示。
- 制約: この機能の追加前に記録した乗車履歴（cardId/tobuFare/pointsを持たない旧データ）は月次集計の対象外（0円・0pt扱い）。

### 6.6 JCB CARD S・W の獲得ポイント表示
マイカード画面「今月のご利用状況」に限り、JCB CARD S・Wの獲得ポイントは小数点以下切り捨てで整数表示（`POINT_TRUNCATE_CARDS = Set(["jcbs","jcbw"])`、`fmtPtForCard()`）。それ以外のカード、および運賃の内訳・経路候補一覧などマイカード画面以外の獲得ポイント表示は、従来通り小数点第1位までの四捨五入表示。

### 6.7 実質負担・バッジ
- クレカ実質=cc−ポイント。IC実質=ic−ic×icRate%。現金は実質=額面。
- 「最安」=額面(raw)最小、「実質最安」=実質(net)最小。「上限適用」=1日上限サービスにより軽減された経路（§7参照）。各運賃行の横にバッジ表示（経路候補一覧・運賃の内訳の両方、`capBadgeHtml(effR)`で共通化）。
- icRate(交通系IC還元率) 既定0.5%、カード画面で変更可。

---

## 7. 1日上限サービス（運賃・ポイントへの実計算反映）

`DAILY_CAP = { yokohamamunicipal:{name:"横浜市営地下鉄",cap:740}, yurikamome:{name:"ゆりかもめ",cap:820} }`。**両社局の上限は完全に別集計**（片方の利用がもう片方の残枠に影響しない）。

- 各経路オブジェクト（single/cross/routeFromLegs/buildRoutesTX）に `opKeys`（経路中の全社局キー）を付与。
- 乗車履歴に「クレカ決済」で記録された当日分の該当社局ごとの利用額を集計（`todaysCreditCapUsage()`）。IC・現金での記録は集計対象外（媒体が異なるため）。
- 検索・運賃内訳画面では、該当社局を含む経路のクレカ運賃を「本日の利用済み額＋この区間の運賃」が上限を超える分だけ軽減して表示（`effectiveRouteForToday()`）。軽減時は運賃の内訳画面に黄色の「1日上限サービス適用済」ボックスで内訳（利用済み額・軽減後の額・上限額）を表示し、経路候補一覧・運賃の内訳の両方に「上限適用」バッジを表示。軽減が発生しない場合は「上限以内のため通常運賃のまま」という説明のみ表示。
- 乗車履歴に「乗車履歴を追加」で記録する際も、軽減後の実額をクレカ決済の場合のみ記録（`capUsage`・`paymentKind`フィールド）。IC・現金での記録には軽減を適用しない。
- 例: 本日ゆりかもめをクレカで590円分記録済みの状態で、有明→テレコムセンター（260円区間）を検索すると、クレカ乗車運賃は260円ではなく230円（820−590）と表示され、黄色ボックスで説明される。
- 既知の制約: この機能の追加前に記録された乗車履歴（capUsage/paymentKindを持たない旧データ）は、上限判定の集計対象に含まれない（0円扱い）。
- 実装: `capUsageForRoute(r)`（DAILY_CAP対象社局ごとのクレカ運賃寄与額を集計）。

---

## 8. お気に入り区間

検索画面の「区間の例」（固定チップ）を廃止し、ユーザーが登録・削除できる「お気に入り区間」機能に置き換え済み。

- セクションヘッダーは `sh-title-row` パターンで「お気に入り区間」＋右側に編集ボタン（`.fav-edit-btn`、`toggleFavoritesEdit()`）。
- 非編集時: `STS`の駅名でラベル化したチップ表示（`renderFavorites()`）。空の場合は案内文を表示。
- 編集時: `.group`/`.cell`パターンのリスト表示。各行に削除ボタン（`.ride-del-btn`再利用、`removeFavorite(idx)`）。最下部に「＋ 現在選択中の区間を追加」セル（`addCurrentAsFavorite()`）。選択中の出発・到着駅が異なる場合のみ有効化（青字）。
- データは `{fromSlug,toSlug}` の配列（`favoriteRoutes`）。`localStorage`（`LS_KEYS.favorites`）に永続化（`saveFavorites()`）。初回起動時は `seedFavoritesIfNeeded()` でモードごとの初期値を投入（bundle: 九段下→白金高輪、三軒茶屋→表参道、大手町→三田、神保町→目黒。TX: 駅配列から機械的に3件選出）。
- `setStation()`/`swapStations()` は編集モード中、選択変更のたびに `renderFavorites()` を呼び直し「追加」プレビューをライブ更新。

---

## 9. 検索履歴・乗車履歴

### 9.1 検索履歴
- 検索画面の経路入力カード右上の丸ボタン（`.history-btn`）から開く（`scr-search-history`）。
- 保存トリガー: 運賃の内訳画面を開いたタイミング（`openDetail`）。
- 項目をタップすると出発・到着駅が検索ボックスに反映され検索画面へ戻る（`applySearchHistory`）。
- `localStorage`（`LS_KEYS.history`）に永続化。最大30件、古いものから削除。「検索履歴をすべて削除」ボタンあり（`clearSearchHistoryConfirm`）。

### 9.2 乗車履歴
下部タブ「乗車履歴」。実際に乗車した記録（経路・支払い手段・支払金額・乗車日）を表示。

- **追加**: 運賃の内訳画面の「運賃比較」見出し横の丸＋ボタン（`.add-ride-btn`、「＋ 乗車履歴を追加」）からボトムシート（`ride-sheet`）を開いて記録。
  - 支払い手段は2段階選択: 初期表示は「ポイント計算に使うカード（検索時に選択中のカード）」「交通系IC」「その他」の3項目のみ。「その他」を選ぶと他の個別クレジットカードと「現金（きっぷ）」を展開表示（`rideStage`="main"|"other"、`setRideStage()`）。クレカ乗車不可の経路ではカード類を出さずIC・現金のみ表示。
  - 支払金額の手入力欄はなし。選択した支払い手段（カード＝クレカ乗車運賃、交通系IC＝IC運賃、現金＝きっぷ運賃）から自動的に金額を確定して記録（`resolveRidePayment(key,r)`）。1日上限サービス対象区間はクレカ決済時のみ軽減後の実額を記録。
  - 乗車日: 「今日」または「今日以外」（今日以外を選ぶと `<input type="date">` で任意の日付を選択可）。
- **表示**: 日付ごとにグループ化（見出しは「今日」「昨日」「○月○日」、年が異なる場合のみ「○年○月○日」）。各見出しの右側にその日の合計利用額（支払い手段を問わない合計）を表示。
- **絞り込み**: 「月で絞り込む」（記録がある年月から選択）と「支払い手段で絞り込む」（実際に使われた支払い手段名から選択）。
- **削除**: 各行に個別削除ボタンあり（確認ダイアログ経由）。「乗車履歴をすべて削除」ボタンもあり（`clearRideHistory`）。
- `localStorage`（`LS_KEYS.rideHistory`）に永続化。最大500件、古いものから削除。エントリ形式: `{from,to,via,payment,amount,date,paymentKind,cardId,tobuFare,points,capUsage,recordedAt}`。

---

## 10. クレカ乗車の可否・特例ルール（コードだけでは意図が読めない部分）

判定は経路の実際の発着社局に基づく（`ccBlockForRoute(od,r)`）。

- 出発のみ不可: `CC_DEPART_BLOCK`。東京メトロ中野駅は出発(乗車)にクレカ乗車不可、到着(降車)は可。中野が到着駅のときは運賃内訳の「運賃比較」と「クレカ乗車運賃の内訳」の間に薄黄色の注意ボックスを表示。
- 発着とも不可(社局単位): `CC_NO_SERVICE = { seibu:Set(28駅), tobu:Set(128駅) }`。その社局で発着する経路のときのみブロック（例: 中井は西武発着なら不可、都営大江戸線発着なら可）。
  - 東武は「対応駅」から範囲展開して算出（対応78駅／非対応128駅）。対応=スカイツリーライン全線+押上/浅草、日光線一部、鬼怒川線3駅、伊勢崎線主要5駅、東上線 池袋〜小川町。
- ブロック時のメッセージ文言（`ccBlockForRoute()`が返す）:
  - 乗車駅のみ非対応: 「○○駅（事業者名）からクレカ乗車で乗ることはできません。」
  - 降車駅のみ非対応: 「○○駅（事業者名）ではクレカ乗車で降りることはできません。」
  - 発着とも非対応: 「○○駅（事業者名）、○○駅（事業者名）ではクレカ乗車はご利用できません。」（発着両方が非対応の場合は両方の駅名を併記）。
- ブロック時はクレカ乗車欄を赤字「ご利用できません」にし運賃・ポイント非表示、理由を注記。

---

## 11. アプリ情報画面

検索画面タイトル「クレカ乗車運賃ナビ」の右の丸いインフォメーションボタン（`.info-btn`、`openAppInfo()`）から開くプッシュ画面（`scr-app-info`）。内容は `renderAppInfo()` が動的に生成する。

1. **対応事業者**: `DATA.operators` から事業者一覧を `opStyle()` の色付きドットとともに列挙。
2. **利用規約**: 運賃・駅データ・ポイント計算結果の正確性・完全性を保証しない旨の免責文言。
3. **ライセンス**: ODPT データ活用基本ライセンス（https://developer.odpt.org/terms/data_basic_license.html）／チャレンジ限定ライセンス（https://developer.odpt.org/challenge_license）へのリンクと、運賃・駅データがODPT提供APIのデータをもとに作成されている旨・ライセンス区分（一般公開・商用可＋出典表示必須／期間・目的限定）の説明footnote。
4. **お問い合わせ**: X（旧Twitter）アカウント（https://x.com/miya_27su）へのリンク。

検索画面下部の `#data-source` は `対応事業者：○○＋○○＋…　全862駅 / 2026-07-18` 形式（`initFareV2()`内）。`#app-note` は「社局跨ぎは同一駅グループを接続点とした合算の最安値による推定です（連絡割引はメトロ⇔都営−70円のみ。クレカ乗車では他の乗継割引は適用されません）。IC運賃の社局跨ぎは各社IC運賃の合算による近似値です。」。

---

## 12. 経路探索ロジック

- `buildRoutes(i,j)` → od-matrixモードは `buildRoutesBundle`。
  - 単独 `single()`、2社跨ぎ `cross()`（stationGroups接続点を総当り）。
  - 3社以上 `multiHopCandidates()` … `dijkstraByLegs()`（2026-07-21改修）。状態=op|slug|mode|legs（T=乗車可/R=直前乗車で次は乗換のみ、legs=これまでの乗車回数）。乗車エッジ=OD運賃（legsを+1）、乗換エッジ=同一グループ間コスト0（legsは変化しない）。**旧実装は「全体最安の経路1本」だけを単純Dijkstraで探し、それが2社以内で完結する場合は3社以上の代替経路が全体最安でない限り候補にすら上がらなかった**（例: 多摩川→高島平で東急→都営が全体最安のため、より安全な東急→メトロ→都営の乗継が見つからなかった）。legsごとに最安値を独立に求める方式に変更し、3脚・4脚それぞれの最安経路を漏らさず候補化する。上限は `MULTIHOP_MAX_LEGS = 4`（相鉄→東急→メトロ→都営のような4社連結までカバー）。
  - `mergeConsecutiveSameOp()`（2026-07-21追加）: 0円の乗換を挟んで同じ社局に戻ってしまう「往復ループ」（例: 渋谷→(東急)→中目黒→(東急)→渋谷→(東急)→横浜のように同一社局が連続する見かけ上3脚の経路）を、連続する同一社局区間を1区間へ再合算してから採用することで除外。合算の結果2社以下に収束した候補（＝single()/cross()で既にカバー済み）は破棄する。
  - 候補は cash→ic 昇順、重複除去、上位4件。
- 例: 所沢→横浜 = 西武→[池袋]→東京メトロ→[渋谷]→東急。多摩川→高島平 = 東急→[中目黒]→東京メトロ→[飯田橋]→都営地下鉄（メトロ⇔都営−70円の連絡割引込みで600円。§3.3参照）。
- 距離帯型 `buildRoutesTX` も残存（現行 mir は od-matrix で保持）。

---

## 13. 事業者表示スタイル（OP_STYLE）

`opStyle(op)={sym,name,color}`。fare.jsonの operator 値に一致するキーで登録:

- tokyometro: M / 東京メトロ / #149DD3
- toei: 都 / 都営地下鉄 / #199B4C
- tokyu: TK / 東急電鉄 / #DA0442
- tobu: TB / 東武鉄道 / #0F6CC3
- seibu: SE / 西武鉄道 / #00A5B9
- keio: KO / 京王電鉄 / #DD0077
- keikyu: KK / 京急電鉄 / #00A7E3
- sotetsu: SO / 相模鉄道 / #0A234F
- 横浜高速鉄道みなとみらい線: MM / みなとみらい線 / #09357F
- mir: TX / つくばエクスプレス / #000080
- yokohamamunicipal: 横浜市営 / 横浜市営地下鉄 / #006BF0
- yurikamome: U / ゆりかもめ / #27404C

未登録社局は operatorName とグレーで自動表示。

---

## 14. データ永続化（localStorage / LS_KEYS）

```
LS_KEYS = {
  history:     "crekaFareNavi.history.v1",      // 検索履歴
  rideHistory: "crekaFareNavi.rideHistory.v1",   // 乗車履歴
  cardId:      "crekaFareNavi.cardId.v1",        // 選択中のカード
  customRate:  "crekaFareNavi.customRate.v1",    // 「その他のクレカ」の自己設定還元率
  icRate:      "crekaFareNavi.icRate.v1",        // 交通系ICのポイント還元率
  favorites:   "crekaFareNavi.favorites.v1"      // お気に入り区間
}
```

起動時に `loadPersisted()` で一括復元。各保存関数: `saveHistory()` / `saveRideHistory()` / `saveCard()` / `saveIcRate()` / `saveFavorites()`。

---

## 15. データ上の注意

- 小川町: 東武東上線 小川町(埼玉, slug=Ogawamachi) と 都営新宿線 小川町(東京, slug=OgawamachiToei) は別駅。分離済み。都営小川町は 淡路町(Awajicho)・新御茶ノ水(ShinOchanomizu) と同一駅グループ。
- 綾瀬↔北千住(東京メトロ) は現金160円・IC155円に手動修正済み。

---

## 16. インポーター（odpt_fare_importer.html）

- ODPTの `odpt:RailwayFare` JSON をドロップ → 事業者ごとに od-matrix へ変換・検証（10円単位/切り上げ/対称性/名寄せ矛盾）。`odpt:Station` JSON で日本語駅名付与。
- 土台モード: 既存の完成 fare.json を一緒に入れると「土台」として読み込み、既存の operators・stationGroups・discounts・overrides・手動修正を保持したまま新会社を追記統合。stationGroups は土台の既存グループを Union-Find で seed し、同名スラッグ自動検出＋手動グループを統合。
- 駅名辞書内蔵: メトロ/都営/京王/西武/東武/東急/京急/相鉄/みなとみらい線/横浜市営地下鉄/つくばエクスプレス/ゆりかもめ。
- 自己修復: 土台やパススルーにローマ字のまま残った駅名・英語の事業者名を、再取り込み時に辞書で日本語補完（`normalizeOperatorNames`）。

---

## 17. 既知の課題・データライセンス

- ODPTライセンス: 一般ライセンス(公開・商用可、出典表示必須)と、チャレンジ限定ライセンス(期間・目的限定)が混在。運賃データは事業者ごとに条件が異なる(例: 京急の運賃はチャレンジ2026限定)。一般公開時は限定ライセンスの運賃データを差し替え要。運賃の数値自体は事実で著作権は生じにくいが、公式運賃表のレイアウト丸写しは避け、入手元の規約に従う。
- IC運賃の社局跨ぎは各社IC運賃の合算による近似。
- ゆりかもめのクレカ運賃は現状きっぷ運賃扱い(横浜市営のようなIC特例は未適用)。
- overrides（fare.jsonの個別上書き枠）・rule（社局跨ぎ計算方針の説明文）はコードから未参照だが、データが空である限り実害はない（将来 overrides にデータが入った場合は反映ロジックの追加が必要）。

---

## 18. 今後の変更で触る主なポイント（早見表・index.html）

- カード追加・還元率変更 → `CARDS` 配列
- タッチ上乗せ対象外の社局追加 → `ccPoints` / `tobuFare` 集計（東武と同要領）
- クレカ=IC運賃の社局追加 → `ccFareOf`
- クレカ乗車不可の駅追加 → `CC_DEPART_BLOCK` / `CC_NO_SERVICE`
- 1日上限の社局追加 → `DAILY_CAP`
- 月合計ポイント計算の対象カード追加 → `MONTHLY_AGGREGATE_CARDS`
- ポイント切り捨て表示の対象カード追加 → `POINT_TRUNCATE_CARDS`
- 事業者の記号・色・名称 → `OP_STYLE`
- お気に入り区間の初期値変更 → `seedFavoritesIfNeeded()` の呼び出し箇所（`initFareV2`/`initTX`）
- アプリ情報画面の内容変更 → `renderAppInfo()`
- 乗継割引の追加・修正 → fare.json の `discounts`
- 運賃の個別修正 → fare.json の該当 operator の `fares`
- 新会社の運賃取り込み → odpt_fare_importer.html（土台モード）
- お知らせの追加・編集・更新案内の告知 → notices_editor.htmlで作成し notices.json を差し替え（§19・§20）
- 3社以上の経路探索の脚数上限変更 → `MULTIHOP_MAX_LEGS`（index.html）
- タブ切替時に閉じるプッシュ画面の追加 → `switchTab()` 内のリセット対象ID配列（index.html）

---

## 19. お知らせ機能（notices.json）

### 19.1 概要
検索画面の `#data-source`（対応事業者・駅数）の直下に「お知らせ」ボックスを表示する。オンライン時のみ `notices.json` を取得し、内容をアプリ内の一覧・詳細画面で表示する。取得に失敗した場合（オフライン、notices.json未配置など）はボックスごと非表示になるだけで、エラーは出さない。

### 19.2 notices.json のデータ形式
```json
{
  "latestVersion": "2026-07-20",
  "updateSummary": "タップして更新",
  "notices": [
    {
      "id": "2026-07-20-seibu-fare",
      "date": "2026-07-20",
      "title": "西武鉄道の運賃改定に対応しました",
      "summary": "西武鉄道の運賃を最新に更新",
      "thumbnail": "",
      "body": "<p>本文（HTML）。<img src=\"...\">のように文中に画像も埋め込み可。</p>"
    }
  ]
}
```
- `latestVersion`（省略可）: index.html内の `APP_VERSION` 定数と異なる値だと、お知らせ一覧の先頭に「最新版があります」が自動挿入される（`isUpdate:true` のお知らせとして扱われ、タイトルが青字になり、詳細画面に「更新する」ボタンが表示される）。
- `updateSummary`（省略可）: 上記の更新案内をお知らせボックスに表示する際の要約文言。省略時は「タップして更新」。
- `notices[]` の各要素:
  - `id`: 一意なID（notices_editor.htmlが自動生成）。
  - `date`（省略可）: 一覧・詳細画面に表示。
  - `title`: 必須。空の場合そのお知らせは書き出し時に除外される（notices_editor.html側の挙動）。
  - `summary`（省略可）: お知らせボックスに表示する短い文言。省略時は `title` を表示。
  - `thumbnail`（省略可）: 一覧の左側（`.notice-thumb`、幅120px・アスペクト比16:9・`object-fit:contain`で見切れず表示）と詳細画面冒頭（`.notice-detail-thumb`、同じく16:9・contain）に表示。画像URLでもアップロード由来のbase64データURIでもよい。
  - `body`: HTML文字列。`<img>` タグで文中の任意の位置に画像を埋め込める。信頼できる内容（開発者自身が管理）である前提で、サニタイズせずそのままinnerHTMLに描画する。

### 19.3 UI・表示ロジック
- お知らせボックス（`#notice-box`、`openNotices()`）: `NOTICES.length===0` なら非表示。複数件ある場合は `noticeRotateTimer` により4秒おきに次のお知らせのsummaryへフェード切り替え。
- 一覧画面（`scr-notices`、`renderNoticesList()`）: サムネイル（120px幅・16:9）＋タイトル（`.notice-list-title`、最大2行でクランプ表示、3行目以降は省略）＋日付。タップで詳細画面へ（`openNoticeDetail(idx)`）。
- 詳細画面（`scr-notice-detail`）: サムネイル（あれば）→タイトル→日付→本文（`body`をそのままinnerHTMLとして描画）。更新案内（`isUpdate:true`）の場合のみ「更新する」ボタンを表示し、タップで `applyAppUpdate()`（キャッシュ内のindex.htmlエントリを削除して `location.reload()`）を実行する。

### 19.4 実装・キャッシュ上の注意
- `loadNotices()` は `initData()` 完了時（fare.json等の読み込み完了後）に一度だけ呼ばれる。通常の `fetch("notices.json",{cache:"no-store"})` で取得し、失敗時（オフライン等）は何もしない。
- sw.jsの `fetch` イベントハンドラは、notices.jsonへのリクエストだけ `respondWith()` せずスルーする（`url.pathname.endsWith("/notices.json")` で判定）。これにより notices.json だけは index.html・fare.json 等が使うstale-while-revalidateキャッシュ層を経由せず、常にオンライン時点の最新内容を取得する。

---

## 20. 今後のアップデート運用フロー（お知らせ・バージョン案内）

新しいお知らせを出したい、またはindex.htmlを更新したことをユーザーに知らせたい場合の手順。

1. `notices_editor.html` をブラウザで開く（ビルド不要、そのまま開くだけで動作する単独ツール。位置づけはodpt_fare_importer.htmlと同じ）。
2. 既存のnotices.jsonを編集したい場合は、上部のドロップゾーンに読み込ませる。新規に作る場合はこの手順は不要。
3. 「＋ 新しいお知らせを追加」でカードを追加し、タイトル・日付・ボックス表示用の短い文言（省略可）・サムネイル（URL入力またはアップロード）・本文を入力する。本文欄はツールバーの「画像URLを挿入」「画像をアップロードして挿入」でカーソル位置に文中画像を挿入できる。
4. **index.htmlのコードを変更した回（＝デプロイを伴う更新）だけ**、「全体設定」の `latestVersion` に新しい日付等を入力し、index.html内の `APP_VERSION` 定数（本書執筆時点の値は `2026-07-20`）も同じ値に書き換える。index.htmlを変えていないのにlatestVersionだけ変更すると、ユーザーに誤って「最新版があります」と案内してしまうので注意。notices.jsonの追加・修正だけならAPP_VERSION/latestVersionは変更不要。
5. 「notices.jsonをダウンロード」で書き出し、index.html・fare.json・sw.jsと同じフォルダに置き換えてGitHub Pagesへ公開する。
6. 公開後、Service Workerのキャッシュにより初回アクセスでは古いindex.htmlがそのまま表示され続けることがある（stale-while-revalidateの仕様上、notices.json以外は1回遅れで反映される）。ユーザー側でサイトデータの消去・ホーム画面アイコンの再追加が必要になる場合がある点は、お知らせ機能でも完全には解消できない（notices.jsonの内容自体はほぼ即時反映されるが、index.htmlのコード変更の反映はこのタイムラグが残る）。

---

## 変更履歴（要約）

日付順の詳細な変更履歴（2026-07-18〜19、全27ラウンド分）は本書の旧バージョンに記載していたが、内容はすべて上記の各セクションに統合済み。主なマイルストーンのみ要約する。

1. サービスワーカー対応・各種localStorage永続化・セーフエリア対応。
2. 検索履歴の丸ボタン化・乗車履歴タブの新設（追加・支払い手段選択・日付指定）。
3. 乗車履歴ポップアップの2段階選択化・ボタンの拡大。
4. 横浜市営地下鉄クレカ運賃バグ修正（IC運賃特例の実装漏れ）・乗車履歴の個別削除。
5. 1日上限サービスの実装（当初は注記のみ→乗車履歴を用いた実計算反映）。
6. 運賃の内訳への「上限適用」バッジ表示・ピンチズーム無効化。
7. 三井住友カード(NL)・Oliveの月合計ポイント計算（200円単位）の実装。
8. マイカード画面のUI刷新（ご利用状況カードを最上部に、金額・ポイント表示の強化）。
9. JCB CARD S・Wの獲得ポイント表示切り捨て。
10. クレカ乗車不可の理由文言の改善。
11. ODPTライセンスの明記 → 後にアプリ情報画面へ統合。
12. アプリ情報画面の新設（対応事業者・利用規約・ライセンス・お問い合わせ）、お気に入り区間機能の実装、各種文言・レイアウト調整。
13. （2026-07-21）西武鉄道の運賃改定（2026-03-14実施分）をfare.jsonに反映。経路探索ロジックを、全体最安の経路1本だけを探すダイクストラ法から、脚数（乗車回数）ごとに最安値を独立に求める方式（`dijkstraByLegs`）に変更し、2社以内の経路が全体最安でも3社以上のより安全・現実的な代替経路（例: 東急→東京メトロ→都営地下鉄）を見落とさないよう修正。あわせて、0円の乗換を挟んで同一社局に戻ってしまう「往復ループ」経路（見かけ上その社局が連続する無駄な経路）を除去する`mergeConsecutiveSameOp`を追加。タブバー切替時に検索履歴・お知らせ・アプリ情報などのプッシュ画面が閉じずに残ってしまう不具合を修正（`switchTab()`のリセット対象にすべてのプッシュ画面を追加）。お知らせ機能（notices.json・notices_editor.html・sw.jsのnotices.json除外）を新規実装（§19・§20）。

（この仕様書は会話時点の実装に基づく。実際の値は最新の index.html / fare.json を正とすること。）
