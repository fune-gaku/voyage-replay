---
name: codex-cross-review
description: Codex（OpenAI）と Claude Code の二人でこのレポの変更をレビューし、双方合意まで反復する。引数に PR 番号を取るか、無指定で現ブランチと main の差分を見る。「codex レビュー」「クロスレビュー」等で起動。
---

# Codex cross review

Codex に diff を読ませ、Claude が full context で評価し、双方が黙るまで反復する。

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
4. PR 対象なら `gh pr view <N> --json state,isDraft,headRefName` で OPEN かつ非 draft

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

## ループ（最大 5 反復）

### A. Codex に読ませる

review 本文は**ファイルに書かせ**、stdout には verdict 行だけ出させる。
`gh pr diff` は Codex の sandbox の network 制限で失敗するので、`git diff` を使わせること。

```bash
set -o pipefail   # codex の失敗が tee の status に隠れないように
LOG=.codex-review/<N>/iter-<k>.log
REVIEW=.codex-review/<N>/iter-<k>-review.md

codex exec --sandbox workspace-write \
  "このリポジトリの変更をレビューしてください。
   diff は \`git diff origin/main...HEAD\` で読み取ってください
   （\`gh pr diff\` は sandbox の network 制限で失敗します）。

   レビュー本文は $REVIEW に書いてください。
   stdout には本文を出さず、最後に verdict 行 1 件だけ:
     指摘なし → 'CODEX VERDICT: LGTM'
     指摘あり → 'CODEX VERDICT: CHANGES REQUESTED'
   同じ行を review ファイルの末尾にも入れてください。

   このツールは海難事故の航跡を 3D で再現します。壊れ方は
   『もっともらしく見えて幾何が嘘』です。重点観点:
   <上の 1〜9 をそのまま貼る>

   CLAUDE.md と docs/domain-notes.md のチェックリストに照らしてください。
   修正は絶対にしないこと。本文のファイル書き出しと verdict のみ。" \
  2>&1 | tee "$LOG"
```

review ファイルが書かれなかった場合の fallback。**生 LOG には Codex の tool trace が入り
`$HOME` の絶対パスが混じるので、公開 PR に乗せる前に必ず伏せる。** `sed` は `$HOME` を
regex として解釈してメタ文字を含むパスで置換漏れするので、Perl の `\Q...\E` を使う:

```bash
if [ ! -s "$REVIEW" ]; then
  perl -pe 's/\Q$ENV{HOME}\E/~/g' "$LOG" > "$REVIEW"
fi
VERDICT=$(grep -m1 -E '^CODEX VERDICT:' "$REVIEW" || grep -m1 -E '^CODEX VERDICT:' "$LOG")
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

**5 反復で強制終了**し、収束しなければ人間の判断に上げる。

## 反復ごとの報告

チャットにその場で出す。GitHub を開かなくても追える状態を保つ。

```markdown
### イテレーション <k> / 5

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
