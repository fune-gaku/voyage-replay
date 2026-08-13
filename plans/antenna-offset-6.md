# AIS アンテナ位置の補正

## 何を

`src/render/player.ts` の `place()` が報告位置をそのまま船体グループの原点に入れている。
`src/render/hull.ts` は原点を「船体中心・喫水線上」と定義しているので、**AIS アンテナの位置に
船体の中心が置かれている**。`referencePointOffsets` を使って船体を正しい位置に置く。

## なぜ

`examples/suo-nada-2025-11-27.voyage.json` での実測値:

| | LOA | アンテナ（船首から） | 船体中心（船首から） | 前方へのずれ | 右舷へのずれ |
| --- | ---: | ---: | ---: | ---: | ---: |
| Seitoku Maru | 49 m | 39 m | 24.5 m | 14.5 m | 0.5 m |
| Spinner 2 | 121 m | 104 m | 60.5 m | 43.5 m | 2.5 m |

両船とも船首方向へずれて描かれている。最接近が数十 m の衝突事案でこれは効く。

そして `docs/format.md` と `core/track.ts` の `closestPointOfApproach` は「報告位置はアンテナで
あって船体ではない」と文章で警告している。**言っていることと描いているものが食い違っている**、
というのがこの変更の理由。

## どう

`player.ts` の `castMember` が外側 `Group` に `hull.group` と `lights.group` を入れており、
`place()` が触るのは外側の position と rotation.y だけ。だから**内側に静的オフセットを 1 回**
入れれば済む。

- 毎フレームの計算はゼロ（ビルド時に 1 回）
- 回転は外側にかかるので船首方位に自動で追従する
- 灯火も同じ内側グループに入れれば一緒に動く（物理的に正しい）

オフセット（ローカル軸は +X 右舷 / −Z 前方）:

```
前方 = loa / 2 − fromBowMetres
右舷 = (fromPortMetres + fromStarboardMetres) / 2 − fromPortMetres
```

**素直な実装だと何が間違うか。**

1. **横方向に `beamMetres` を使う。** Seitoku Maru は `beamMetres: 9.4` に対して offsets の和が 9
   （AIS は m 単位に丸める）。混ぜると 0.2 m の作り物が出る。**offsets の中で閉じること**
2. **`positionAt` を見ない。** `"reference-point"` はすでに移してある側なので、補正すると
   二重にずれる
3. **船首方位が無いときを特別扱いしようとする。** これは要らない。`place()` が既に「HDG が
   無ければ COG を代用し、パネルでそう言う」方針を持っている（`player.ts:174-178`）ので、
   補正はその方針をそのまま継承する。ここで別の判断を足すと、同じ方針が 2 か所に分かれる

## どのファイル

- `src/render/player.ts` — `castMember` に内側グループとオフセット
- `src/render/hull.ts` — 原点の定義コメントを「移される前提」から現状に合わせる
- `src/ui/panels.ts` — 現在の「アンテナは船首から N m」の説明を「補正済み／補正できず」に
- `test/player.spec.ts` — 上の 3 つの罠それぞれに 1 本
- `test/examples.spec.ts` — 見え方が変わるので固定値の更新。**報告書の付表と突き合わせてから直す**

## 未解決

- **CPA も直すか。** `closestPointOfApproach` は報告位置間の距離を返し、コメントでそう断っている。
  船体間の距離を出すなら別関数になる（船体形状が要るので `core/` には置けない）。この plan では
  触らず、別 issue にするのが素直
- **`referencePointOffsets` が無い船。** 補正しようがない。無補正で描いてパネルにそう出す、で
  よいか
- **offsets の和と `loaMetres` が食い違う事案。** 例では両船とも一致しているが、一致しない報告書は
  出てくる。どちらを信じるか。`CLAUDE.md` にある「諸元欄の長さは登録長 Lr で全長ではない」の
  裏返しで、offsets のほうが正しいことがある
