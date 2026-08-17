# prototypes/

答えが紙の上では出ない問いを、動かして確かめるための場所。**製品コードではない。**

`src/` と違うのは目的だけで、扱いは同じ——`tsconfig.json` の `include` に入っていて、
`npm run typecheck` と `npm run lint`（関数の大きさの3つの上限を含む）が効く。
効いていないのは**カバレッジだけ**で、`vitest.config.ts` の `coverage.include` が
`src/**/*.ts` なので、ここにテストの無いコードを置いても閾値は動かない。

そのぶん、**ここで分かったことは `src/` に持っていくときに書き直される前提**で置くこと。
**プロトタイプが実装になったら、このディレクトリから消す。** 実測値と設計判断は
plan と PR に残るので、動かないコードを残す理由はない。

## 卒業したもの

- **terrain**（2026-08、[#25](https://github.com/fune-gaku/voyage-replay/pull/25) →
  [#26](https://github.com/fune-gaku/voyage-replay/issues/26)）——
  船橋視点に標高タイルで陸を出し、地球の曲率を入れる。実装は `src/render/terrain.ts`、
  `src/render/curvature.ts`、`src/core/horizon.ts`。設計判断は `plans/done/terrain-26.md`、
  計測値（転送量・フレーム時間・曲率の検証）は #25 の本文にある。

  1つだけ持ち帰らなかったものがある: `lighting.ts` が `core/conditions.ts` から
  **太陽の実位置で照らしていた**。明らかに良いが、それは
  [#15](https://github.com/fune-gaku/voyage-replay/issues/15) の領域。#25 のコミットに残っている。
