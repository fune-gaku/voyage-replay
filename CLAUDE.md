# CLAUDE.md — voyage-replay

AI コーディングエージェント向けの作業ノート。「何のツールか」「使い方」は **README.md**
にあるので、ここに書いていないことはそちらを読むこと。

## スタックとパッケージマネージャ

- TypeScript / Vite / Vitest / ESLint / Prettier。3D は three.js を予定しているが**まだ入れていない**
- パッケージマネージャは **npm**。`npm install <pkg>` を使い、package.json を手で書き換えない。
  yarn ではない（OSS なので Node 同梱の npm で追加インストール不要にする、
  yarn classic はメンテナンスモード、という理由）

## 変更したら走らせるもの

```
npm run check:config  # lint と tsc が「見る設定になっているか」を検査（後述）
npm run lint          # ESLint（型情報つき）
npm run typecheck     # tsc --noEmit（src / test / *.config.ts を全部見る）
npm test              # Vitest（test/**/*.spec.ts）
npm run build         # typecheck + vite build
npm run format        # Prettier。.prettierignore で *.md は対象外
npm run dev           # 開発ページ
```

CI は同じものを順に流すだけ。ローカルで通れば CI も通る。

## 設定は「読む」のではなく「実効値を出して数える」

**入っていない設定は何も報告しない。** これがこのレポで一度踏んだ罠で、最初の版は
`tseslint.configs.recommended` + `strict: true` という、いかにも厳しそうで実際には
**型情報ルールが1本も動いていない**設定だった（`parserOptions.projectService` が無いので
そもそも型を見られない）。lint は通り、CI は緑で、欠けていること自体はどこにも出なかった。

そのため `npm run check:config` が、**設定ファイルではなく実効値**を読んで、
必要なルールとコンパイラフラグが実際に有効かを検査する。CI では lint より先に走る。

設定を触ったら、この3つで確かめること。

```
npx eslint --print-config src/core/track.ts   # そのファイルに実際に効いているルール
npx tsc -p tsconfig.json --showConfig         # extends 解決後のコンパイラ設定
npx tsc -p tsconfig.json --noEmit --<flag>    # そのフラグを入れたときの違反件数
```

- **`strict: true` は「厳しい設定」ではない。** `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature` などは
  含まれない。このレポは個別に入れてある
- **型情報ルールは `*TypeChecked` プリセットにしか無い。** `recommended` にも `strict` にも
  `no-floating-promises` も `no-unsafe-*` も `consistent-type-assertions` も入っていない
- **例外は `eslint.config.js` に理由付きで書く。** ファイルに散らした `eslint-disable` コメントは、
  気づかないうちにルールを失う経路そのもの

詳細と実測値は [`docs/verifying-config.md`](docs/verifying-config.md)。

## レイアウト

```
spec/     .voyage.json の JSON Schema。フォーマットの正本
src/core/ 型・測地・検証・トラック標本化・物理スクリーニング
src/actors/vessel/  船に固有のもの（航海灯、将来は船体生成と運動モデル）
src/extract/        報告書などからシナリオを起こす（未実装）
examples/ 実データのシナリオ。CI が schema 検証する
test/     Vitest
docs/     フォーマット仕様、ドメイン知識、抽出元ごとのメモ
plans/    1変更1設計メモ
```

`core/` と `actors/vessel/` を分けているのは、将来ジャンルを広げる余地を安く残すためで、
今すぐ汎用化する意図ではない。**`core/` に船の概念（航海灯・針路・喫水）を持ち込まないこと。**
逆に `actors/vessel/` は `core/` に依存してよい。

## このドメインで間違えやすいこと

ここが一番高くつく。順に、実際に踏んだ順。

### 対地針路（COG）と船首方位（HDG）は別物

COG は「どこへ進んでいるか」、HDG は「船首がどちらを向いているか」。差が偏角（drift angle）で、
潮流のある海域では目に見える大きさになる。そして**航海灯の照射範囲を決めるのは HDG のほう**。

`headingDegreesTrue` は頻繁に欠ける。簡易型（Class B）AIS は船首方位を送信しないので、
2隻の再現で片方に無いのが普通。**欠けているとき COG で黙って埋めないこと。** ライブラリは
`undefined` のまま返す。代用するなら呼び出し側が明示的にやり、画面にもそう出す
（`src/main.ts` の `aspects()` がその書き方）。

### 航海灯は「誰から見た相対方位か」を取り違えると 180° ずれる

`visibleLights(vessel, observerRelativeBearingDegrees)` の引数は
**灯火を掲げている船の船首を基準にした、観測者の方位**。逆にすると結果はちょうど 180° ずれ、
しかも「それらしく見える」ので、誰かが灯火から相手の見え方を読むまで気づかない。

照射範囲は COLREG 第21条。マスト灯 225°、舷灯 各112.5°、船尾灯 135°。225 + 135 = 360 で
水平線をちょうど覆うので、**どの方位にも必ず何かが見え、二重には数えない**。
`test/lights.spec.ts` がこれを 0.1° 刻みで固定している。

### 位置は GPS アンテナ。船体の基準点ではない

AIS が送るのはアンテナ位置で、JTSB の付表も脚注でそう書いている。180m 船ならアンテナは
船首から 100m 以上後ろにあるので、「アンテナ間 40m」は接触であってニアミスではない。
`track.positionAt` がどちらかを持ち、`vessel.referencePointOffsets` に AIS メッセージ5番の
4つの距離（船首・船尾・左舷・右舷まで）が入る。**この4つから全長と幅が逆算できる**ので、
報告書の諸元欄より正確なことがある（諸元欄の長さは登録長 Lr で、全長ではない）。

### 直線補間は暫定であって、正しくない

`sampleAt()` は今のところ標本間を直線で結んでいる。船はそう動かない——舵を切っても
すぐには回らず、回り始めたら惰性で回り続け、船首は進行方向から偏角ぶんずれる。
1分間隔の標本を直線で結ぶと、船が横滑りしているように見えて、船を扱ったことがある人には
一目で嘘だと分かる。**ここを一次遅れ（野本）モデルに置き換えるのが次の仕事。**
それまで、合成した点はすべて `derivation: "interpolated"` として返している。

### PDF から取るとき

- **全角文字**。`ＡＩＳ` `ＶＨＦ` `ｋｎ` は全角。半角 `AIS` で grep すると 0 件になる
- **列見出しを信用しない**。`pdftotext` のレイアウト復元は見出し行をずらす。ある報告書は
  見出しが「船首方位」に見えたが、実際の値域は 1.8〜11.3 で衝突後にゼロへ落ちた——速力だった。
  **列の意味は値域で判定する**
- **正規表現の `\s` は改行を跨ぐ**。行末の数値列を `(?:\s+\d+)+` で取ると次の行の時刻を食い、
  行を1つおきに取りこぼす。半分になっても表として成立して見えるので気づきにくい。
  行内の空白は `[ \t]` で書くこと

### 許容差は区間長に応じて広げる

報告書の緯度経度は秒まで（行によっては 1 秒刻み）。経度 1 秒は中緯度で約 26m なので、
20 秒間隔の 2 点では丸めだけで 1kn 以上ずれる。固定の許容差だと短い区間で必ず誤検出する。
`checkPlausibility` は `positionQuantisationMetres / 区間秒数` を許容差に足している。

## 出所（derivation）は飾りではない

各点が `measured`（記録）/ `digitised`（航跡図から読み取り）/ `inferred`（口述から復元）/
`interpolated`（このツールが合成）のどれかを持つ。**これがこのツールが「再現」を名乗れる
根拠そのもの**なので、レンダラも推定区間は実測と描き分けること（破線・半透明など）。
JTSB 自身が航行経路図で実線と破線を描き分けているので、これは発明ではなく踏襲。

## examples/ は仕様のテストでもある

`examples/*.voyage.json` は CI が `spec/voyage.schema.json` で検証する。スキーマを変えたら
例も直る必要がある。**例が通らなくなったら、それは書き留められていないフォーマット変更**で、
ユニットテストには見えない唯一の壊れ方。

`examples/suo-nada-2025-11-27.voyage.json`（周防灘の衝突、実データ 59 点）は参照事案で、
`test/examples.spec.ts` が最接近距離・方位の不動・灯火の見え方まで固定している。
このファイルの数字を触るときは、報告書の付表と突き合わせること。

## plans/

1変更1メモ。何を・なぜ・どのファイルを触るかを数段落。実装前に書き、終わったら
`plans/done/` へ移す。
