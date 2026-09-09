# 「どういう画か」と「眼はどこか」を分ける（issue #63）

## 何を

`render/player.ts` の

```ts
export type ViewKind = "overhead" | "bridge";
const diagramMode = this.view.kind === "overhead";
```

を 2 つに割る。**どのカメラを選んだか**が**どういう画を描くか**を決めている状態をやめる。

## なぜ

この真偽値 1 つに **8 つ**ぶら下がっている。

| 何を決めているか | どこ |
|---|---|
| 地球を曲げるか（船体の沈み込み） | `place()` → `sinkage()` |
| 平面図グリッドを出すか | `stage.diagram.visible` |
| 照明・地図の乗算色・空・光の道 | `sceneParts.setDiagramView()` |
| 標識を灯質どおり点滅させるか | `shine(mark, diagramMode)` |
| 航海灯を誰に向けて描くか | `audienceFor()` |
| 灯が水面に筋を敷くか | `lampsLit(diagramMode)` |
| どちらの出典を出すか | `creditFor(diagramMode)` |
| 眼が要るか | `const eye = diagramMode ? null : this.eye()` |

**2 つの視点に対しては全部正しい。3 つ目に対しては答えを持っていない。**

高度 200 m から斜めに見下ろす眼は海図でも船橋でもない。`diagramMode` は false になるので
地球は曲がり海は光り地図は消えるが、**どの船にも乗っていない**。そして `audienceFor()` は
`eye.member === member` で自船かどうかを見ており、`Eye` は `Cast` を持っている——
**船に乗っていない眼は型として作れない。**

だから自由視点は「カメラを足す」話ではなく「真偽値を割る」話になる。

## どう割るか

```ts
/** 画の種類。曲率・照明・地図・点滅・筋・グリッド・出典を決める。 */
type Picture = "chart" | "world";

/** 眼の居場所。海図には眼が無い（図面は場所ではない）。 */
type ViewSelection =
  | { kind: "chart" }
  | { kind: "bridge"; actorId?: string }
  | { kind: "free"; at: LocalPosition; headingDegreesTrue: number; heightMetres: number };
```

- `chart` → `Picture = "chart"`、眼なし
- `bridge` / `free` → `Picture = "world"`、眼あり

`Eye` から `member` を必須でなくする:

```ts
interface Eye {
  position: LocalPosition;
  heading: number;
  /** 乗っている船。自由視点では null——誰の船でもない眼は、全船にとって observer。 */
  aboard: Cast | null;
  eyeHeightMetres: number;
}
```

`LampAudience` は**既に 3 値**（diagram / self / observer）で、observer は
「この船の船首を基準にした観測者の方位」なので、**乗っていない眼はそのまま observer**。
型は既に用意できている。用意できていないのは `Eye` のほう。

## 素直な実装だと何が間違うか

### 1. `diagramMode` を `kind !== "chart"` に置換して終わりにする

それだと**名前だけ変わって溶接は残る**。8 つの判断は「画の種類」に依存していて、
「どのカメラか」には依存していない。関数の引数を `Picture` にすること。
`shine(mark, diagramMode)` は `shine(mark, picture)` になり、真偽値の反転を読む必要が消える。

**そして最初の実装でこれを踏んだ（レビュー 1 反復目）。** `pictureOf()` を呼んだ直後に
`const chart = picture === "chart"` と真偽値へ潰し、消費者の契約は `diagramMode: boolean` の
まま。眼の有無とカメラ選択も `this.view.kind === "chart"` を再判定していた。
**罠として自分で書いた形に、そのまま落ちた。**
`Picture` は `render/view.ts` に置いて `scene.ts` からも読めるようにする
（`setDiagramView` も 8 つのうちの 1 つなので、player を import させるわけにいかない）。

### 2. 自由視点を「船橋カメラの位置を動かせるようにしたもの」として作る

`placeBridgeCamera` は**船首方位に沿って向ける**（`camera.rotation.set(0, rotationY, 0)`）。
船橋窓の向きが針路であって進行方向でないのは #6 以来の主張なので、そこは触らない。
自由視点は**別のカメラ**で、俯角を持てる。同じ関数を拡張すると船橋の主張が緩む。

### 3. 眼の高さを船から取り続ける

`eye.member.eyeHeightMetres` は船橋の高さ。自由視点は自分の高さを持つ。
`Eye` に `eyeHeightMetres` を載せて、カメラも `sinkage` も水面の中心もそこから取る。

### 4. 自船の灯火を隠す判定が壊れる

`audienceFor` の `eye.member === member` は、自由視点で `eye.aboard === null` になるので
**全船が observer** になる。それが正しい——誰の船でもない眼から見れば、どの船の灯も
「相手の灯」。ただし `null === member` が偶然 false になるのに頼らず、明示的に書く。

### 5. 出典の判定

`creditFor` は「いま画面に出ている地面の層」を答えている。`chart` なら淡色地図、
`world` なら標高タイル。**自由視点は world なので標高タイル**——これは正しく、
自由視点で淡色地図を出すと「海図を斜めから見た」という別の主張になる。

### 6. 平面図の枠決めが自由視点にも効いてしまう

`activeCamera()` の `frameOverhead()` は `chart` のときだけ。
`sceneParts.setView({centre, extentMetres, aspect})` は地図タイルの取得範囲も決めるので、
**自由視点で呼ぶと海図用の範囲でタイルを取りに行く**。world では呼ばない。

### 7. 「単独で完結」を「消費者の無い枠組み」と読む

割っただけで自由視点を作らないと、**割り方が正しいかを誰も検証しない**。
このレポは `prototypes/` を実装になったら消す規律を持っている。枠組みだけ置くのは逆。
**最小の自由視点を 1 つ載せて、割り方を実証する。**
UI（ドラッグ・軌道・飛行）は別 issue。

## 触るもの

- `src/render/cameras.ts` — `ViewKind` を消し、自由視点カメラを足す
- `src/render/player.ts` — `ViewSelection`、`Picture`、`Eye`、`audienceFor`、8 つの消費者
- `src/ui/transport.ts`（あれば視点切替の配線）
- `test/player.spec.ts`、`test/cameras.spec.ts`
- `docs/domain-notes.md`、`CLAUDE.md`

## 未解決

1. **自由視点の眼で、船体の沈み込みをどう扱うか。** `sinkage` は眼からの距離で決まるので
   そのまま効く。ただし**真上から見下ろす自由視点**は海図とほぼ同じ画なのに曲率が入る。
   それは正しい（世界を見ているので）が、読者が海図と混同しうる。パネルが言うか？
2. **`build:single` の 1 枚 HTML で視点を保存するか。** 自由視点の位置は「聞いていること」で
   あって「記載されていること」ではない。#56 の状態層の先取りになるので、v1 では
   **保存しない**（開くと既定の視点）でよいか
3. **録画（`captureStream`）で自由視点を使うか。** 使えるが、動かしながら録ると
   「カメラワーク」になる。事故再現の映像として何を許すかは別の判断
