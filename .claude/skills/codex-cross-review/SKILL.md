---
name: codex-cross-review
description: Codex（OpenAI）と Claude Code の二人でこのレポの変更をレビューし、双方合意まで反復する。引数に PR 番号を取るか、無指定で現ブランチと main の差分を見る。「codex レビュー」「クロスレビュー」等で起動。
---

# Codex cross review

Codex に diff を読ませ、Claude が full context で評価し、双方が黙るまで反復する。

## 費用について（先に読むこと）

**この skill の費用は、書いてある1行が何を読ませるかで桁が変わる。** 実測（2026-09）:

| 何を読ませるか | 1 反復あたり |
|---|---:|
| プロンプト本体 | 約 600 トークン |
| `CLAUDE.md` + `docs/domain-notes.md` を丸ごと | **5〜6 万トークン** |
| stacked PR で `origin/main...HEAD` を渡す | 自分の差分の **6.5 倍**（実測: 840 行 → 5448 行） |

`codex exec` は反復ごとに新しいプロセスなので、**渡したものは毎回読み直される**。だから
以下は守ること。守らないと 25〜30 万トークンが読むだけで消える。

- **リポジトリの文書を丸ごと読ませない。** 下の観点 1〜9 が `CLAUDE.md` と
  `docs/domain-notes.md` のチェックリストの蒸留版で、二重に渡す意味がない
- **反復の状態は PR に置く。** 前回の指摘をプロンプトに貼り直さず、Codex に PR の
  スレッドを読ませて「解決済みは再指摘しない」を判断させる
- **diff は PR の base から取る。** `main` からではない
- **テスト・lint・build を回させない。** それは CI の仕事で、Codex がやり直しても
  同じ答えに時間を払うだけ

MulmoTerminal の `.github/workflows/codex_review.yaml` が同じ verdict プロトコルを CI 側で
実装していて、上の4つはそこから来ている。

**このレポで探すべきものは、一般的な web の脆弱性ではない。** server も DB も多言語辞書も無く、
出力は静的な HTML 1 枚。壊れ方は「もっともらしく見えて幾何が嘘」であって XSS ではない。
観点を汎用のものに戻さないこと。

## 入力

- `<PR 番号>` または PR の URL → その PR を対象にし、結果を PR コメントとして残す
- 引数なし → 現ブランチと `main` の差分を対象にし、報告はチャットのみ（PR 前の下読み）

## 前提条件（1 回だけ確認、欠けていれば案内して停止）

1. `command -v codex`。無ければ `npm i -g @openai/codex` → `codex login`
2. `command -v gh` と `gh auth status`（PR 対象のときのみ）
3. `git status --short` が空。未コミットの変更があれば停止
4. PR 対象なら `gh pr view <N> --json state,isDraft,headRefName,baseRefName` で OPEN かつ非 draft。
   **`baseRefName` を控える**——diff はそこから取る（stacked PR で `main` から取ると、下に
   積まれた PR の変更を全部読ませることになる）

作業ファイルは `.codex-review/<N>/`（PR 無しなら `.codex-review/local/`）に置く。`.gitignore` 済み。

## レビュー観点（狭めないこと）

Codex への依頼と Claude 自身の読みの両方で、以下を必ず含める。上から順に、実際に高くつく順。

1. **COG と HDG の取り違え。** 灯火の照射範囲を決めるのは HDG。COG で代用していないか。
   `headingDegreesTrue` が欠けている点を黙って埋めていないか
2. **灯火の相対方位の向き。** `visibleLights(vessel, observerRelativeBearingDegrees)` の第2引数は
   *灯火を掲げている船の船首を基準にした観測者の方位*。逆にすると結果はちょうど 180° ずれ、
   しかも「それらしく見える」
3. **COLREG の条文番号が付いているか。** 灯火の弧は第21条、光達距離は第22条、何を掲げるかは
   第23条以降。数字の無い主張は検証できない
4. **位置は GPS アンテナか船体基準点か。** `positionAt` と `referencePointOffsets` の扱い。
   180m 船で「アンテナ間 40m」は接触であってニアミスではない
5. **`derivation` の誠実さ。** 合成した点を `measured` と報告していないか。推定区間が
   実測と同じ描かれ方をしていないか
6. **許容差が区間長でスケールしているか。** 固定許容差は短い区間で必ず誤検出する
   （`positionQuantisationMetres / 区間秒数`）
7. **レイヤ境界。** `src/core/` に船の概念（航海灯・針路・喫水）や three.js が漏れていないか。
   逆向き（`actors/vessel/` → `core/`）は正しい
8. **抽出コードなら**: 全角文字（`ＡＩＳ` `ｋｎ`）、`\s` が改行を跨ぐ（行内は `[ \t]`）、
   列見出しを信用せず値域で判定しているか
9. 一般的な正しさ・エッジケース・テスト網羅（実事案に対する回帰があるか、合成データだけでないか）

## ループ（最大 2 反復）

**5 ではなく 2。** 反復の状態を PR に置くようにしたので、1 周目で出た指摘は 2 周目の Codex
が PR のスレッドから読む。それでも収束しないなら、往復を増やして解ける問題ではない。

### A. Codex に読ませる

review 本文は**ファイルに書かせ**、stdout には verdict 行だけ出させる。
`gh pr diff` は Codex の sandbox の network 制限で失敗するので、`git diff` を使わせること。
**base は PR のもの**を使う——`main` からではない。

```bash
set -o pipefail   # codex の失敗が tee の status に隠れないように
LOG=.codex-review/<N>/iter-<k>.log
REVIEW=.codex-review/<N>/iter-<k>-review.md

BASE=$(gh pr view <N> --json baseRefName -q .baseRefName 2>/dev/null || echo main)
git fetch -q origin "$BASE"

# **自分のプロセスに締切を持たせる。** codex exec は遅くなるのではなく黙って止まることが
# あり、そうなると上限まで待ち続ける。健全な review は 30 秒〜2 分。
timeout --signal=TERM --kill-after=30s 300 \
codex exec --sandbox workspace-write \
  "このリポジトリの変更をレビューしてください。
   diff は \`git diff origin/$BASE...HEAD\` で読み取ってください
   （\`gh pr diff\` は sandbox の network 制限で失敗します）。

   レビュー本文は $REVIEW に書いてください。
   stdout には本文を出さず、最後に verdict 行 1 件だけ:
     指摘なし → 'CODEX VERDICT: LGTM'
     指摘あり → 'CODEX VERDICT: CHANGES REQUESTED'
   同じ行を review ファイルの末尾にも入れてください。

   **書く前に、この PR に既にあるものを読んでください。**
     gh api repos/<owner>/<repo>/issues/<N>/comments --paginate
   前の 'CODEX VERDICT: CHANGES REQUESTED' の各項目について、いまの diff を見て
   解決済みなら**再指摘しないでください**。他のレビューが既に同じことを書いている
   ものも繰り返さないでください。既存のスレッドに対して自分が足せる分だけ書きます。

   **テスト・lint・build は実行しないでください。** それは CI の仕事で、同じものが
   すべての PR で走ります。ここで走らせても答えは変わらず、時間だけかかります。
   読んで判断してください。実行しないと決められない主張があるなら、そう書いてください。

   このツールは海難事故の航跡を 3D で再現します。壊れ方は
   『もっともらしく見えて幾何が嘘』です。重点観点:
   <上の 1〜9 をそのまま貼る>

   修正は絶対にしないこと。本文のファイル書き出しと verdict のみ。" \
  2>&1 | tee "$LOG"
```

**`CLAUDE.md` や `docs/domain-notes.md` を読ませないこと。** 上の観点 1〜9 がその蒸留版で、
丸ごと渡すと 1 反復あたり 5〜6 万トークンになる。冒頭の「費用について」を参照。

review ファイルが書かれなかった場合は、**そこで止めて人に見せる。** 生 LOG には Codex の
tool trace（試行錯誤の全部）が入るので、これを review 本文として公開 PR に投稿すると、
結論ではなく作業の過程を貼ることになる。`$HOME` を伏せても中身は残る。

```bash
if [ ! -s "$REVIEW" ]; then
  echo "Codex が review 本文を書きませんでした。$LOG を人が読んでください。" >&2
  exit 1
fi
VERDICT=$(grep -m1 -E '^CODEX VERDICT:' "$REVIEW")
```

PR 対象なら `gh pr comment <N> --body-file "$REVIEW"` で代理投稿する。

### B. Claude が評価する（受動的に適用しない）

各指摘について、`MUST-FIX` / `VALID-NIT` / `FALSE-POSITIVE` / `DEFER` に分ける。判断材料:

- **本当に間違っているか。** 同じパターンが実コードにあるか `grep` で確かめてから受け入れる
- **他に何箇所あるか。** 1 箇所だけ直して残り 3 箇所が壊れたまま、が最悪
- **Codex が見落としたもの。** 指摘は出発点であって天井ではない
- **一次情報の照合（必須）。** 指摘が「COLREG ではこう」「報告書ではこう」を前提にしている場合、
  受け入れる前に**条文か報告書の付表そのものに当たる**。Codex も Claude も学習時点の知識でしかない。
  照合したら条文番号・報告書番号・ページを引用として残す。ライブラリ挙動の主張なら公式 docs を
  `WebFetch` で取る

`MUST-FIX` と `VALID-NIT` はこの反復で適用。`FALSE-POSITIVE` と `DEFER` は論拠を残す
（次の反復の Codex が同じ指摘を繰り返さないように、PR コメントか本文に書く）。

### C. 適用してからローカルチェック

```bash
npm run check:config && npm run lint && npm run typecheck && npm test && npm run build
```

**赤を push しない。** `git add` は触ったファイルだけ（`git add -A` 禁止）。`--no-verify` 禁止
（pre-commit の gitleaks を飛ばす意味がない。CI で同じものが動く）。

### D. 継続判定

- `LGTM` かつ Claude 側にも残課題なし → 終了
- `LGTM` だが Claude が見落としを見つけた → 直して次の反復（Codex に再検証させる）
- `CHANGES REQUESTED` → 次の反復
- verdict 行なし → `CHANGES REQUESTED` 扱い、protocol 違反として記録して再依頼

**2 反復で強制終了**し、収束しなければ人間の判断に上げる。往復を増やして解ける問題では
ないうえ、1 反復ごとに diff 全体をもう一度読ませることになる。

## 反復ごとの報告

チャットにその場で出す。GitHub を開かなくても追える状態を保つ。

```markdown
### イテレーション <k> / 2

**Codex verdict**: LGTM / CHANGES REQUESTED (<N> 件)

| # | 指摘 (出所) | 分類 | 対応 | 根拠 |
|---|---|---|---|---|
| 1 | <要約> (Codex) | MUST-FIX | <SHA> で修正 | <grep 結果 / 条文 / 報告書のページ> |
| 2 | <要約> (Codex) | FALSE-POSITIVE | 却下 | <論拠> |
| 3 | <要約> (Claude) | MUST-FIX | <SHA> で修正 | Codex は指摘していない |

Codex review 本文: [iter-<k>-review.md](.codex-review/<N>/iter-<k>-review.md)
```

Codex の本文はリンクのみ（長くなってチャットが読めなくなる）。Claude 自身が見つけた指摘は
**Codex の手柄にせず `(Claude)` と明記する**。

## マージ

Codex LGTM + Claude 側クリア + CI green が揃ってから、**ユーザーに明示確認を取る**。
Claude は push も merge も勝手にしない。

## 落とし穴

| 罠 | 対処 |
|---|---|
| `gh pr diff` が sandbox で失敗する | `git diff origin/main...HEAD` を使わせる |
| 生 LOG に `$HOME` の絶対パスが混じる | `perl -pe 's/\Q$ENV{HOME}\E/~/g'`。`sed` は不可 |
| stdout に review 本文が混ざって verdict が拾えない | ファイル受け渡し + verdict 行 1 件だけ、を明示 |
| Codex の COLREG 解釈を鵜呑みにする | 条文に当たる。灯火の弧は第21条、光達距離は第22条 |
| 「もっともらしい」修正を受け入れる | 幾何の主張は `test/` に固定してから受け入れる |
| Codex の指摘が汎用 web 脆弱性に寄る | 観点リストを毎回そのまま渡す。狭めない |
| `CLAUDE.md` / `domain-notes` を読ませて 1 反復 5〜6 万トークン | 観点 1〜9 がその蒸留版。文書は渡さない |
| stacked PR で `origin/main...HEAD` が下位 PR を全部含む | `gh pr view` の `baseRefName` から取る |
| Codex が `npm test` を回して時間を払う | 実行しないよう明示する。CI が同じものを走らせる |
| `codex exec` が遅くなるのではなく黙って止まる | `timeout 300` を掛け、止まったら人に上げる |
| 生 LOG を review 本文として PR に投稿する | 本文が無ければ止める。trace は結論ではない |
