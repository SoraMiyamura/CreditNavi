# クレカ乗車運賃ナビ 仕様書（引き継ぎドキュメント）

このドキュメントは、アプリ「クレカ乗車運賃ナビ」を新しいチャットで引き継ぐための仕様書です。
新規チャットの冒頭で、本ファイルと最新の成果物（index.html / fare.json(=fare-ja.json) / odpt_fare_importer.html）を添付すれば、そのまま開発を継続できます。

---

## 1. アプリ概要

クレジットカードのタッチ決済乗車（クレカ乗車）を使うと、交通系ICや現金と比べていくらお得かを、ポイント還元も含めて比較する首都圏の鉄道運賃ナビ。出発駅・到着駅を選ぶと、現金（きっぷ）／交通系IC／クレカ乗車の3手段の運賃と、クレカ乗車のポイント獲得量・実質負担額を提示する。

- 単一HTMLアプリ（index.html）。ビルド不要、fetch("fare.json") で運賃データを読み込む。
- 運賃計算は fare.json 単体で完結（外部API不要）。
- iOS風UI。検索／履歴／カードの3タブ + 経路候補・運賃内訳のプッシュ画面。

---

## 2. ファイル構成と役割

- index.html … アプリ本体（UI + 運賃・ポイント計算 + 経路探索）。単一ファイル。
- fare.json … 運賃データ本体（format:"fare" v2）。アプリと同じフォルダに置く。現行最新は fare-ja.json（12事業者・日本語駅名済み）を fare.json にリネームして使用。
- odpt_fare_importer.html … ODPTの odpt:RailwayFare JSON を fare.json に変換・統合するツール（別アプリ）。
- SPEC.md … 本ドキュメント。

注: ワークスペース同期の不具合で fare.json という名前が旧版に巻き戻る事象があったため、確定版は fare-ja.json として保持。配布時は fare.json にリネーム。

---

## 3. データ形式（fare.json v2 スキーマ）

トップレベルキー: format, version, generated, note, operators, stationGroups, discounts, discountsNote, overrides, rule

### 3.1 operators（12事業者）
keikyu, keio, seibu, sotetsu, tobu, toei, tokyometro, tokyu, 横浜高速鉄道みなとみらい線, mir(=つくばエクスプレス), yokohamamunicipal(=横浜市営地下鉄), yurikamome

各 operator（od-matrix型）の構造:
- operator, operatorName, fareType:"od-matrix", symmetric:true/false
- stations: [{idx, slug, name, odptIds:[...]}] … slug=一意キー(ローマ字)、name=表示名(日本語)。name===slug は未和訳。
- pairFormat: ["fromIdx","toIdx","cash","ic"]
- fares: [[fromIdx,toIdx,cash,ic], ...]  cash=きっぷ(10円単位)、ic=IC(1円単位)。symmetric:true なら片方向のみ格納。
- 運賃参照は idx で行う。slug は同一駅グループ・割引照合に使う。

### 3.2 stationGroups（同一駅グループ・61件）
乗換可能かつ運賃通算される「同一駅扱い」。社局跨ぎ経路の接続点。
{ id, members:[{op,slug},...], fareContinuous:true }

### 3.3 discounts（乗継割引・30件）
きっぷ・IC向け。クレカ乗車に適用されるのはメトロ⇔都営の70円のみ。
{ id, operators:[opA,opB], junction:[slug], amount, appliesTo:["cash","ic"], a:[opA側区間slug], b:[opB側区間slug] }
- operators[0]=a側 / operators[1]=b側。方向自動判定。出発駅∈a かつ 到着駅∈b のとき適用。
- appliesTo: 基本 ["cash","ic"]。メトロ⇔都営70円のみ ["cash","ic","cc"]。IC限定は ["ic"]。
- 出典: 首都圏乗継割引設定全区間一覧 2026-03-14（komachi600 / PDF tetu1.pdf）。
- 追加済: 泉岳寺(京急⇔都営)、横浜(東急/京急/相鉄/みなとみらい線 相互6ペア)。

### 3.4 overrides / rule
overrides:{ic:[],cc:[]}（個別上書き枠・現状空）。rule=社局跨ぎ計算方針の説明文。

---

## 4. 主要機能一覧

- 現金／交通系IC／クレカ乗車の3手段比較。
- クレカ乗車のポイント獲得量・実質負担額（カード5枚 + 東武特例）。
- 交通系IC還元率のユーザー設定（0.1%単位、カード画面）。
- 「最安」(緑)／「ポイント還元考慮後の実質最安」(青) バッジ。
- 駅名の日本語表示 + ローマ字併記。
- 2社跨ぎ + 3社以上の経路探索（ダイクストラ法）。
- 乗継割引（きっぷ・IC。クレカはメトロ⇔都営70円のみ）。
- クレカ乗車の可否判定（特例あり）。
- 横浜市営地下鉄のクレカ運賃=IC運賃（1円単位）。
- 1日上限サービスの注記（横浜市営740円 / ゆりかもめ820円）。
- 検索履歴（メモリ内、リロードで消える）。

---

## 5. 運賃・ポイント計算ロジック（重要）

### 5.1 3手段の運賃
- 現金(きっぷ) = cash(10円単位)。区間合算 − きっぷ乗継割引。
- 交通系IC = ic(1円単位)。区間合算 − IC乗継割引。
- クレカ乗車(cc) = 原則 cash と同額。特例あり。区間合算 − クレカ割引(メトロ⇔都営70円のみ)。
経路オブジェクト: {cash, ic, cc, tobuFare, opKeys, legs, via, notes, opFrom, opTo, ...}

### 5.2 クレカ乗車運賃の区間特例
- 横浜市営地下鉄: クレカ乗車も IC運賃(1円単位) を適用。ccFareOf(op,v)=op==="yokohamamunicipal"?v[1]:v[0]。single/cross/multi の各区間で使用。
- それ以外は cc=きっぷ運賃。

### 5.3 カード定義（5枚）base=基本還元率, touch=タッチ上乗せ率
- smccnl 三井住友カード(NL): base0.5 touch6.5 (合計7%)
- olive Olive(クレジットモード): base0.5 touch7.5 (合計8%)
- jcbs JCB CARD S: base0.5 touch9.5 (合計10%)
- jcbw JCB CARD W: base1.0 touch9.5 (合計10.5%)
- other その他のクレカ: base=customRate(自己設定) touch0 (基本のみ)

### 5.4 クレカ乗車のポイント計算（東武特例が肝）
東武鉄道はタッチ決済の上乗せ還元の対象外（基本還元のみ）。
ポイント = 全区間cc × base%  +  (全区間cc − 東武運賃tobuFare) × touch%
- tobuFare=経路中の東武区間きっぷ運賃合計（single/cross/multiで集計）。
- 実装: ccPoints(r,card)。eligible=max(0, r.cc - r.tobuFare)。
- 例: 竹ノ塚→上野(東武180+メトロ180=cc360, tobuFare180) 三井住友NL → 360×0.5% + 180×6.5% = 1.8+11.7 = 13.5pt。

### 5.5 実質負担・バッジ
- クレカ実質=cc−ポイント。IC実質=ic−ic×icRate%。現金は実質=額面。
- 「最安」=額面(raw)最小、「実質最安」=実質(net)最小。各運賃行の横にバッジ。
- icRate(交通系IC還元率) 既定0.5%、カード画面で変更可。

### 5.6 1日上限サービス（注記のみ・計算未反映）
DAILY_CAP = { yokohamamunicipal:{name:"横浜市営地下鉄",cap:740}, yurikamome:{name:"ゆりかもめ",cap:820} }
経路の opKeys に該当社局が含まれると、運賃内訳のクレカ乗車欄に「1日上限サービスあり：○○ ○円」を表示。運賃・ポイント計算には未反映。

---

## 6. クレカ乗車の可否・特例ルール（コードだけでは意図が読めない部分）

判定は経路の実際の発着社局に基づく（ccBlockForRoute(od,r)）。
- 出発のみ不可: CC_DEPART_BLOCK。東京メトロ中野駅は出発(乗車)にクレカ乗車不可、到着(降車)は可。中野が到着駅のときは運賃内訳の「運賃比較」と「クレカ乗車運賃の内訳」の間に薄黄色の注意ボックスを表示。
- 発着とも不可(社局単位): CC_NO_SERVICE = { seibu:Set(28駅), tobu:Set(128駅) }。その社局で発着する経路のときのみブロック（例: 中井は西武発着なら不可、都営大江戸線発着なら可）。
  - 東武は「対応駅」から範囲展開して算出（対応78駅／非対応128駅）。対応=スカイツリーライン全線+押上/浅草、日光線一部、鬼怒川線3駅、伊勢崎線主要5駅、東上線 池袋〜小川町。
- ブロック時はクレカ乗車欄を赤字「ご利用できません」にし運賃・ポイント非表示、理由を注記。

---

## 7. 経路探索ロジック

- buildRoutes(i,j) → od-matrixモードは buildRoutesBundle。
  - 単独 single()、2社跨ぎ cross()（stationGroups接続点を総当り）。
  - 3社以上 multiHopCandidates() … ダイクストラ法。状態=op|slug|mode（T=乗車可/R=直前乗車で次は乗換のみ）。乗車エッジ=OD運賃、乗換エッジ=同一グループ間コスト0。cash最短・ic最短の2経路を候補化（3社以上のみ返す）。
  - 候補は cash→ic 昇順、重複除去、上位4件。
- 例: 所沢→横浜 = 西武→[池袋]→東京メトロ→[渋谷]→東急。
- 距離帯型 buildRoutesTX も残存（現行 mir は od-matrix で保持）。

---

## 8. 事業者表示スタイル（OP_STYLE）

opStyle(op)={sym,name,color}。fare.jsonの operator 値に一致するキーで登録:
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

## 9. データ上の注意

- 小川町: 東武東上線 小川町(埼玉, slug=Ogawamachi) と 都営新宿線 小川町(東京, slug=OgawamachiToei) は別駅。分離済み。都営小川町は 淡路町(Awajicho)・新御茶ノ水(ShinOchanomizu) と同一駅グループ。
- 綾瀬↔北千住(東京メトロ) は現金160円・IC155円に手動修正済み。

---

## 10. インポーター（odpt_fare_importer.html）

- ODPTの odpt:RailwayFare JSON をドロップ → 事業者ごとに od-matrix へ変換・検証（10円単位/切り上げ/対称性/名寄せ矛盾）。odpt:Station JSON で日本語駅名付与。
- 土台モード: 既存の完成 fare.json を一緒に入れると「土台」として読み込み、既存の operators・stationGroups・discounts・overrides・手動修正を保持したまま新会社を追記統合。stationGroups は土台の既存グループを Union-Find で seed し、同名スラッグ自動検出＋手動グループを統合。
- 駅名辞書内蔵: メトロ/都営/京王/西武/東武/東急 に加え、京急/相鉄/みなとみらい線/横浜市営地下鉄/つくばエクスプレス/ゆりかもめ を追加済み。
- 自己修復: 土台やパススルーにローマ字のまま残った駅名・英語の事業者名を、再取り込み時に辞書で日本語補完（normalizeOperatorNames）。

---

## 11. 既知の課題・データライセンス

- ODPTライセンス: 一般ライセンス(公開・商用可、出典表示必須)と、チャレンジ限定ライセンス(期間・目的限定)が混在。運賃データは事業者ごとに条件が異なる(例: 京急の運賃はチャレンジ2026限定)。一般公開時は限定ライセンスの運賃データを差し替え要。運賃の数値自体は事実で著作権は生じにくいが、公式運賃表のレイアウト丸写しは避け、入手元の規約に従う。
- 1日上限サービスは注記のみ(計算未反映)。
- IC運賃の社局跨ぎは各社IC運賃の合算による近似。
- ゆりかもめのクレカ運賃は現状きっぷ運賃扱い(横浜市営のようなIC特例は未適用)。

---

## 12. 今後の変更で触る主なポイント（早見表・index.html）

- カード追加・還元率変更 → CARDS 配列
- タッチ上乗せ対象外の社局追加 → ccPoints / tobuFare 集計（東武と同要領）
- クレカ=IC運賃の社局追加 → ccFareOf
- クレカ乗車不可の駅追加 → CC_DEPART_BLOCK / CC_NO_SERVICE
- 1日上限の社局追加 → DAILY_CAP
- 事業者の記号・色・名称 → OP_STYLE
- 乗継割引の追加・修正 → fare.json の discounts
- 運賃の個別修正 → fare.json の該当 operator の fares
- 新会社の運賃取り込み → odpt_fare_importer.html（土台モード）

---

（この仕様書は会話時点の実装に基づく。実際の値は最新の index.html / fare.json を正とすること。）

---

## 13. 2026-07-18 追加分（サービスワーカー・永続化・レイアウト調整）

- サービスワーカー対応（sw.js 新規追加）。index.html と同じフォルダに配置し、`navigator.serviceWorker.register('sw.js')` で登録。アプリ本体・fare.json をキャッシュし、オフラインでも起動・運賃計算が可能（fare.json はキャッシュを即返しつつバックグラウンド更新のstale-while-revalidate方式）。
- 検索履歴・選択カード・カスタム還元率・交通系IC還元率を localStorage に保存し、リロード・再起動後も復元されるように変更（LS_KEYS, loadPersisted(), saveHistory(), saveCard(), saveIcRate()）。履歴タブに「履歴をすべて削除」ボタンを追加（clearHistory()）。
- iPhone等のホームバー（セーフエリア）と下部タブバーが重ならないよう、viewport に `viewport-fit=cover` を追加し、.tabbar / .scroll / .pushed-scroll の下部余白に `env(safe-area-inset-bottom)` を加算。

（この仕様書は会話時点の実装に基づく。実際の値は最新の index.html / fare.json を正とすること。）
