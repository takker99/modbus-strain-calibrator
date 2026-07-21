# Design — ModbusStrainCalibrator

## 0. 目的

`modbus-strain-calibrator` は **ModbusSimpleLogger** の fork として、**HX711 ひずみゲージセンサー専用の検定 Web アプリ** を提供する。

### ユースケース

#### (A) 1ポート検定（外部標準基準）

校正済みの基準器（ゲージブロック、校正済みロードセル、既知質量のおもり等）で**印加値を直接入力**する方式。
- 例: ロードセル校正装置にセンサーを設置し、「0 kg → 1 kg → 2 kg → ...」と負荷を加えていく
- 各負荷点で HX711 の生値（raw）を読み、(raw, applied) ペアを蓄積
- 最小二乗法で **raw → 物理量** の変換係数を求める
- 結果: `physical = a·raw² + b·raw + c`（または `a·raw + b`）

#### (B) 2ポート検定（参照センサー基準）

**校正済みセンサー**（参照）と**未校正センサー**（検定対象）を 2 つの HX711 ポートに同時接続する方式。
- 複数の負荷点で 2 つの HX711 生値を同時記録
- `(target_raw, ref_phy)` のペアを蓄積
- 参照センサーの係数は**ユーザーが別途入力**しておき、その換算値を「正解 y」とみなす
- 最小二乗法で **target_raw → ref_phy（= physical）** の変換係数を求める
- 結果: `physical = a·target_raw² + b·target_raw + c`（または `a·target_raw + b`）

### 非機能要件

- **オフライン動作**（検定現場はネットワークがないことが多い）
- **完全ローカル処理**（生値・係数・検定点が一切外部送信されない）
- **USB 切断の自動検知**（ケーブルが抜けても安全側に倒れる）
- **画面スリープ抑止**（長時間の検定で画面が消えるのを防ぐ）
- **CSV / JSON でのエクスポート**（Excel / R / Python で事後解析できる）

---

## 1. 技術スタック

| レイヤー | 技術 |
|----------|------|
| フレームワーク | React 19 + TypeScript 6 |
| ビルド | Vite 8 + pnpm |
| スタイリング | Tailwind CSS 4 |
| チャート | Plotly.js (`plotly.js/lib/core` + `scattergl`) |
| Modbus 通信 | Web Serial API + `web-serial-polyfill` |
| 永続化 | localStorage（設定・検定結果）+ CSV/JSON ダウンロード |
| PWA | Service Worker（COOP/COEP + 全アセットプリキャッシュ） |

### 削除する依存

- `pyodide` (ScriptRunner 廃止)
- `modbus-serial` / `buffer` (元々未使用、外部依存なし)

※ `react-rnd` は **維持**（FloatingWindow + ModbusConfigPanel は現状のまま流用）

---

## 2. UI 構造

```
┌────────────────────────────────────────────────────────────┐
│ Header                                                     │
│  [ModbusStrainCalibrator]  [●Connected @ 38400bps 8N1]    │
│                              [Connect/Disconnect] [Menu]   │
├────────────────────────────────────────────────────────────┤
│ Mode Selector                                              │
│  ( ) 1-port  (●) 2-port                                    │
├────────────────────────────────────────────────────────────┤
│ Channel Selectors (mode に応じて変化)                       │
│  [1-port]  Target CH: [CH 00 ▼]                            │
│  [2-port]  Reference CH: [CH 00 ▼]  Target CH: [CH 01 ▼]  │
├────────────────────────────────────────────────────────────┤
│ Live Readings (リアルタイム)                                │
│  ┌──── CH 00 ────┐  ┌──── CH 01 ────┐                     │
│  │ Raw    12345  │  │ Raw    23456  │                     │
│  │ mV/V   0.123  │  │ mV/V   0.234  │                     │
│  │ Phy(*)  1.234 │  │ Phy(*)  2.345 │                     │
│  │ [level meter] │  │ [level meter] │                     │
│  └───────────────┘  └───────────────┘                     │
├────────────────────────────────────────────────────────────┤
│ Calibration Workbench (検定テーブル)                        │
│  [+ Add Point]  [Calculate]  [Save]  [Export]  [Clear]    │
│  ┌─ # ─┬── x (raw) ──┬── y (input) ──┬── time ─────────┐  │
│  │  1  │    12345    │   0.000 (kg)  │ 12:34:56.789   │ [x]│
│  │  2  │    23456    │   1.000 (kg)  │ 12:35:01.234   │ [x]│
│  │ ... │             │               │                 │   │
│  └─────┴─────────────┴───────────────┴─────────────────┴───┘│
│                                                            │
│  Regression: [Degree ▼: 1 (linear) / 2 (quadratic)]       │
│  Result:                                                  │
│    a = 0.0001234                                          │
│    b = 0.9876                                             │
│    c = 0.0000     (degree=2 only)                         │
│    R²  = 0.9998                                           │
│    RMSE = 0.0023                                          │
├────────────────────────────────────────────────────────────┤
│ Regression Plot (Plotly scattergl)                         │
│  ・散布点 (x=raw, y=applied)                                │
│  ・回帰直線 / 曲線 (overlay)                                │
│  ・残差プロット (任意トグル)                                 │
├────────────────────────────────────────────────────────────┤
│ Modbus Config Panel (FloatingWindow)                       │
│  Slave ID, Baud, Parity, etc.                              │
└────────────────────────────────────────────────────────────┘
```

- 1画面完結の縦スクロール。タブやページ遷移なし。
- 設定変更（チャネル切替・モード切替・degree 切替）は即時反映。

---

## 3. データモデル

### 検定点

```ts
type CalibrationPoint = {
  index: number;        // 1-based 連番
  x: number;            // HX711 raw（または target_raw）
  y: number;            // applied (1-port) / ref_phy from ref coeffs (2-port、自動計算、上書き不可)
  timestamp: number;    // Date.now()
};
```

### 検定結果

```ts
type CalibrationDegree = 1 | 2;

type CalibrationResult = {
  ch: number;                       // 対象 HX711 ポート番号（0-7）
  mode: '1port' | '2port';
  degree: CalibrationDegree;       // 1 or 2
  a: number;
  b: number;
  c: number;                        // degree=2 のみ使用、degree=1 では 0
  r2: number;
  rmse: number;
  points: CalibrationPoint[];
  refCh?: number;                   // mode='2port' のとき参照 CH
  refCoeffs?: { degree: 1 | 2; a: number; b: number; c: number };  // 2-port で使用
  updatedAt: number;                // Date.now()
  label?: string;                   // 任意の名称（例: "Sensor-A 校正 2026-01-15"）
};
```

検定結果は localStorage に save/load せず、CSV/JSON エクスポートで保存する。

### 参照センサー係数（2-port 用）

2-port モードでは参照センサーの係数 (a, b, c) を画面上部のテキストボックスに直接入力する。
ダイアログや別画面は使わず、インラインの入力欄として常時表示する。
前回入力した値は localStorage（`modbus_calibrator_reference_sensors_v1`）に自動保存し、次回起動時に復元する。

```ts
type ReferenceSensorCoeffs = {
  degree: 1 | 2;
  a: number;
  b: number;
  c: number;
};
```

### 設定

```ts
type AppSettings = {
  mode: '1port' | '2port';
  targetCh: number;                 // 0-7
  refCh: number;                    // 0-7 (2-port のみ)
  degree: 1 | 2;
  serial: SerialSettings;
  slaveId: number;
  modbusPrecision: 'normal' | 'extended';
  theme: 'light' | 'dark';
};
```

---

## 4. コンポーネント構成

```
src/
├── App.tsx                            # ルート: 接続・モード管理・レイアウト
├── main.tsx                           # エントリ + SW 登録 + ErrorBoundary
├── index.css
├── types.ts                           # CalibrationPoint, CalibrationResult, ...
├── constants.ts                       # AI_CHANNELS=16, HX711_CHANNELS=8, ...
├── modbus/
│   └── webserialClient.ts             # 既存をそのまま流用
├── hooks/
│   ├── useTheme.ts                    # 既存を流用
│   ├── useCalibration.ts              # 検定点・degree・計算の状態管理
│   └── useHx711Live.ts                # 1〜2ch ポーリング + 生値保持
├── components/
│   ├── Hx711LiveCard.tsx              # 1ch 分の生値・mV/V・レベルメーター + mini-chart
│   ├── CalibrationWorkbench.tsx       # 検定テーブル + Add/Calculate/Export/Clear + Degree 選択
│   ├── CalibrationRow.tsx             # 1行編集（x, y, time, delete）
│   ├── RegressionResultPanel.tsx      # 係数・R²・RMSE 表示
│   ├── RegressionChart.tsx            # Plotly scatter 散布図 + 回帰線
│   ├── ModeSelector.tsx               # 1-port / 2-port 切替
│   ├── ChannelSelector.tsx            # HX711 ch 0-7 ドロップダウン
│   ├── ModbusConfigPanel.tsx          # 既存をそのまま流用（FloatingWindow）
│   └── AppHeader.tsx                  # タイトル・Connect・Menu ボタン
└── utils/
    ├── crc16.ts                       # 既存を流用
    ├── cookies.ts                     # 既存を流用（キー prefix 変更）
    ├── regression.ts                  # 最小二乗（線形・2次） + R² + RMSE
    ├── csvExport.ts                   # CSV ダウンロード (Blob + a[download])
    ├── jsonExport.ts                  # JSON ダウンロード
    └── calibration.ts                 # hx711RawToMvPerV, レベルメーター色
```

### 削除するファイル

- `src/pyodideWorker.ts`
- `src/hooks/useScriptRunner.ts`
- `src/hooks/useChartAxes.ts`
- `src/components/ScriptRunnerPanel.tsx`
- `src/components/VoltageConfigPanel.tsx`
- `src/components/HamburgerMenu.tsx`
- `src/components/SlidePanel.tsx`
- `src/components/AppInfoPanel.tsx` (新 `AppHeader` に統合)
- `src/components/ChartPanel.tsx` (廃止: 新アプリには 1 つの散布図のみ)
- `src/components/ManualPanel.tsx` (取扱説明書、不要)
- `src/components/CalibrationPanel.tsx` (`CalibrationWorkbench` に置換)
- `src/utils/tsvExport.ts` (`csvExport.ts` / `jsonExport.ts` に置換)
- `src/utils/dataStorage.ts` (IndexedDB 廃止)

※ `FloatingWindow.tsx` は **維持**（ModbusConfigPanel のコンテナとして使用）

---

## 5. 状態管理

### `useHx711Live`

```ts
function useHx711Live(opts: {
  client: WebSerialModbusClient | null;
  channels: number[];          // 1個（1-port）または2個（2-port）
  pollingMs: number;           // 200ms 固定推奨
  precision: 'normal' | 'extended';
}): {
  raws: Record<number, number>;    // ch → 最新生値
  voltages: Record<number, number>; // ch → mV/V
  timestamp: number;
  isPolling: boolean;
};
```

- `setInterval(pollingMs)` で `readInputRegisters(0, channels.length)` を呼ぶ
- IndexedDB / TSV には**書かない**（検定アプリではライブ表示のみ）
- 200ms ポーリングで**1秒あたり 5回**の読取り → ユーザーが「Add Point」を押した瞬間の値で記録

### `useCalibration`

```ts
type CalculateResult =
  | { ok: true; value: CalibrationResult }
  | { ok: false; error: string };

function useCalibration(): {
  result: CalibrationResult | null;
  points: CalibrationPoint[];
  degree: 1 | 2;
  validationError: string | null;     // 常に最新のバリデーション状態（ボタン押下不要）
  setDegree: (d: 1 | 2) => void;
  addPoint: (x: number, y: number) => void;
  removePoint: (index: number) => void;
  clearPoints: () => void;
  calculate: () => CalculateResult;   // points から最小二乗、throw はしない
};
```

- points / degree の変更は自動で localStorage（`modbus_calibrator_workbench_v1`）に保存（ページ再読込時の復元用）
- `validationError` は points と degree から常に導出（`points.length < degree + 1` ならエラーメッセージ）
- `calculate()` は `validationError` が null の場合のみ呼び出し可能
- CSV/JSON エクスポートは util 関数（`csvExport.ts` / `jsonExport.ts`）として独立

### 親コンポーネント

`App.tsx` で:
1. 接続状態（`connected`, `client`）
2. モード（`mode`）
3. 対象/参照 CH
4. live 生値（`raws`）
5. 検定結果（`result`）
6. 表示

これらを縦並びで配置。Modal/Dialog は使用しない（2-port の参照係数はインラインのテキストボックス）。ModbusConfigPanel のみ FloatingWindow（既存 react-rnd 流用）。

---

## 6. 検定ワークフロー詳細

### 6.1 1-port モード

```
1. ユーザーがデバイスに既知の負荷を印加（例: 0 kg）
2. 画面の Live カードで HX711 raw が安定するのを確認
3. 入力欄「y (input)」に 0.000 を入力
4. [+ Add Point] クリック
    → { x: currentRaw, y: 0.000, timestamp: now } が追加される
5. 負荷を変更 (例: 1 kg)、同様に追加
6. 3点以上（degree=1）または 4点以上（degree=2）追加
7. [Calculate] クリック
    → 最小二乗で a, b, c, R², RMSE を計算
    → 散布図に回帰線を overlay
8. [Export CSV / Export JSON] で外部に保存
```

### 6.2 2-port モード

```
1. 参照センサー（既校正）と検定対象センサーを 2 ch に接続
2. 2-port モードに切り替えると、画面上部の参照センサー係数入力欄（a, b, c のテキストボックス）が表示される
   → 前回の値があれば自動復元、なければ手入力
3. 通常の負荷印加ワークフロー（両 ch の raw 値が Live 表示）
4. [+ Add Point] クリック時:
   - target CH の生値 → x
   - ref CH の生値を ref 係数で物理値に換算 → y（自動計算、上書き不可）
5. 3点以上追加 → [Calculate]
6. 結果表示 → [Export]
```

### 6.3 リアルタイム可視化

- Live カードに各 ch の **過去 N 秒の生値グラフ**（小型 Plotly chart）をオプション表示
- 検定テーブルの下に **散布図 + 回帰線**を大きい Plotly chart で表示
- ダークモード対応（既存パレット）

---

## 7. 最小二乗実装

`src/utils/regression.ts`:

```ts
export type RegressionInput = { x: number; y: number }[];
export type RegressionDegree = 1 | 2;
export type RegressionResult = {
  degree: RegressionDegree;
  // degree=1: y = a·x + b
  // degree=2: y = a·x² + b·x + c
  a: number;
  b: number;
  c: number;        // degree=1 では 0
  r2: number;
  rmse: number;
  n: number;
};

export function fitRegression(points: RegressionInput, degree: RegressionDegree): RegressionResult {
  if (degree === 1) return fitLinear(points);
  return fitQuadratic(points);
}

function fitLinear(points: RegressionInput): RegressionResult { /* 既存 wiki/calibration.md 参照 */ }
function fitQuadratic(points: RegressionInput): RegressionResult { /* 同 */ }
```

- 数値安定性: HX711 raw が `int16` レンジ (`-32768` 〜 `32767`)、データ点数 N ≲ 100。Cramer's rule で十分。
- 外部ライブラリ（mathjs / regression-js）は使用しない。
- 異常系は throw ではなく discriminated union（`{ ok: true; value } | { ok: false; error: string }`）で表現
  - `points.length < degree + 1` → `{ ok: false, error: 'At least N points are required' }`
  - 同次座標 `(x_i = constant)` → `{ ok: false, error: 'All x values are identical' }`
- 呼び出し側（useCalibration / CalibrationWorkbench）は戻り値の ok で分岐、try/catch 不要

---

## 8. 永続化

### localStorage キー

| キー | 型 | 備考 |
|------|-----|------|
| `modbus_calibrator_settings_v1` | `AppSettings` | UI 状態・接続設定・テーマ |
| `modbus_calibrator_workbench_v1` | `{ mode, points, degree }` | 作業中の検定（中断復元用）、変更のたびに自動保存 |
| `modbus_calibrator_reference_sensors_v1` | `{ a, b, c, degree }` | 2-port 参照センサー係数（直前の値のみ、次回起動時に復元） |

※ 検定結果（`CalibrationResult`）は localStorage に保存しない。CSV/JSON エクスポートのみ。

- キーのプレフィックスは既存 fork と区別するため **`modbus_calibrator_`** に統一。
- `utils/cookies.ts` の `readJsonStorage` / `writeJsonStorage` をそのまま使う。

### エクスポート

#### CSV

```csv
# ModbusStrainCalibrator vX.Y.Z
# ch=0
# mode=1port
# degree=1
# a=0.0001234
# b=0.9876
# c=0
# r2=0.9998
# rmse=0.0023
# updated_at=2026-01-15T12:34:56.789Z
index,timestamp_ms,iso8601,x_raw,y_applied
1,1737015296789,2026-01-15T12:34:56.789Z,12345,0.000
2,1737015301234,2026-01-15T12:35:01.234Z,23456,1.000
...
```

- ヘッダー行は `#` でコメント化（pandas / R で `comment='#'` で読込可能）
- Excel 互換: `\t` 区切りではなく `,` 区切り

#### JSON

```json
{
  "app": "ModbusStrainCalibrator",
  "version": "X.Y.Z",
  "exportedAt": "2026-01-15T12:34:56.789Z",
  "ch": 0,
  "mode": "1port",
  "degree": 1,
  "coefficients": { "a": 0.0001234, "b": 0.9876, "c": 0 },
  "metrics": { "r2": 0.9998, "rmse": 0.0023 },
  "points": [
    { "index": 1, "timestamp": 1737015296789, "x": 12345, "y": 0.000 },
    { "index": 2, "timestamp": 1737015301234, "x": 23456, "y": 1.000 }
  ]
}
```

#### 実装

`src/utils/csvExport.ts` / `src/utils/jsonExport.ts`:

```ts
export function downloadCsv(filename: string, content: string): void;
export function downloadJson<T>(filename: string, data: T): void;
```

- `Blob` + `URL.createObjectURL` + `<a download>` パターン（既存 `downloadJson` を流用）
- File System Access API は**使わない**（オーバースペック）
- デフォルトファイル名: `calibration_ch0_1port_2026-01-15T12-34-56.csv`

---

## 9. PWA / Service Worker

既存 `public/sw.js` を維持。`BASE_PATH` を `/modbus_strain_calibrator/` に変更。

```js
const BASE_PATH = '/modbus_strain_calibrator/';
const CACHE_NAME = `modbus-calibrator-${CACHE_VERSION}`;
```

- プリキャッシュ対象から `pyodide/` 配下が消える（**約 14MB 削減**）
- COOP/COEP ヘッダは維持（将来 SharedArrayBuffer を使う拡張に備える）

---

## 10. ディレクトリ構造（最終形）

```
modbus-strain-calibrator/
├── package.json                  # pnpm, pyodide 削除（react-rnd は維持）
├── pnpm-lock.yaml                # コミットする
├── pnpm-workspace.yaml           # 任意（モノレポ化する場合）
├── tsconfig.json
├── vite.config.ts                # pyodideAssets 削除, base path 変更
├── tailwind.config.js
├── postcss.config.js
├── index.html                    # title 変更
├── public/
│   ├── sw.js                     # BASE_PATH 変更
│   ├── manifest.json             # name/description 変更
│   └── icon.svg
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   ├── types.ts
│   ├── constants.ts              # HX711_CHANNELS=8, ...
│   ├── modbus/
│   │   └── webserialClient.ts    # 既存流用
│   ├── hooks/
│   │   ├── useTheme.ts           # 既存流用
│   │   ├── useHx711Live.ts       # 新規
│   │   └── useCalibration.ts     # 新規
│   ├── components/
│   │   ├── AppHeader.tsx         # 新規（タイトル・接続・設定ボタン）
│   │   ├── ModeSelector.tsx      # 新規
│   │   ├── ChannelSelector.tsx   # 新規
│   │   ├── Hx711LiveCard.tsx     # 新規（生値 + レベルメーター + mini-chart）
│   │   ├── CalibrationWorkbench.tsx  # 新規（Degree 選択含む）
│   │   ├── CalibrationRow.tsx    # 新規
│   │   ├── RegressionResultPanel.tsx # 新規
│   │   ├── RegressionChart.tsx   # 新規（Plotly scatter）
│   │   └── ModbusConfigPanel.tsx # 既存をそのまま流用（FloatingWindow）
│   └── utils/
│       ├── crc16.ts              # 既存流用
│       ├── cookies.ts            # 既存流用（プレフィックス変更）
│       ├── calibration.ts        # 既存（HX711部分）を流用、ADS1115 削除
│       ├── regression.ts         # 新規
│       ├── csvExport.ts          # 新規
│       └── jsonExport.ts         # 新規
└── wiki/                         # 設計ドキュメント
    ├── index.md
    ├── log.md
    ├── architecture.md
    ├── modbus-client.md
    ├── polling.md
    ├── data-persistence.md
    ├── calibration.md
    ├── pwa-sw.md
    ├── build.md
    ├── conventions.md
    └── design-strain-calibrator.md  # このファイル
```

---

## 11. 開発フロー

```bash
# 初回
pnpm install

# 開発
pnpm dev
# → http://localhost:5173/

# 型チェック
pnpm typecheck

# ビルド
pnpm build
# → dist/

# プレビュー（GitHub Pages の subdir 確認用）
pnpm preview
# → http://localhost:4173/modbus_strain_calibrator/

# デプロイ: GitHub Pages へ push で自動デプロイ (.github/workflows/deploy.yml)
```

`deploy.yml` は `pnpm` アクションに置換:

```yaml
- name: Setup pnpm
  uses: pnpm/action-setup@v4
  with:
    version: 9
- name: Setup Node
  uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: pnpm
- name: Install
  run: pnpm install --frozen-lockfile
- name: Build
  run: pnpm build
```

---

## 12. マイグレーション手順

1. `package.json` を pnpm 用に書換、削除する依存を抜く
2. `src/pyodideWorker.ts`, `src/hooks/useScriptRunner.ts`, 関連コンポーネントを削除
3. `vite.config.ts` から `pyodideAssets` プラグイン削除、base path 変更
4. `public/sw.js` の `BASE_PATH` 変更
5. `public/manifest.json` の name/description 変更
6. `index.html` の title 変更
7. `src/utils/regression.ts` 新規
8. `src/utils/csvExport.ts` / `jsonExport.ts` 新規
9. `src/hooks/useHx711Live.ts` / `useCalibration.ts` 新規
10. 各種コンポーネントを新規実装
11. `src/App.tsx` を新レイアウトに置換

---

## 13. テスト方針

- **ユニットテスト**（Vitest）: `regression.ts` の線形/2次フィットに対して既知データで検証
  - 傾き 2.0, 切片 1.0 の完全直線データ → `{ ok: true, value.r2 = 1.0 }`
  - ノイズを含むデータ → R² が想定範囲内
  - 同次 x データ → `{ ok: false, error: 'All x values are identical' }`
  - データ点数不足 → `{ ok: false, error: 'At least N points are required' }`
- **手動 E2E**: 実機 HX711 + 既知負荷で 1-port / 2-port 両モード
- **モダンブラウザ互換**: Chrome / Edge 最新版で動作確認

`pnpm add -D vitest` で導入、`pnpm test` で実行。

---

## 14. リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| 最小二乗の数値不安定性 | 係数が発散 | データ点数 N 制限、特異点（x_i すべて同じ）は discriminated union でエラー通知 |
| HX711 raw のドリフト | 検定中の生値ずれ | ユーザーが安定を確認してから Add Point |
| 2-port で参照係数の入力ミス | 検定対象係数全体が狂う | 参照係数入力時にライブ値 + 換算値プレビュー |
| USB 切断で検定中断 | 作業中の points 消失 | localStorage に作業中データを毎変更で保存 |
| ブラウザ非対応 (Safari / Firefox) | Web Serial 不可 | README で Chrome/Edge のみサポートと明記 |
| localStorage クォータ超過 | 検定結果保存失敗 | JSON サイズ警告 (5MB 超で警告) |
| COOP/COEP 設定ミス | SharedArrayBuffer 使えなくなる | vite.config.ts と sw.js の両方で設定、pre-commit チェック |

---

## 15. ロードマップ（将来）

1. **v1.0**: 1-port / 2-port 検定、線形/2次回帰、CSV/JSON エクスポート
2. **v1.1**: 多項式回帰 (3次・4次)、残差プロット、Bland-Altman
3. **v1.2**: 不確かさ評価（タイプA・B）、検定レポート PDF 出力
4. **v2.0**: 複数センサー同時検定（最大 8 ポート）、検定履歴のタイムライン表示

---

## 付録 A: HX711 仕様整理

- ADC: 24bit シグマデルタ
- ゲイン: 128 (デフォルト CH A) / 64 (CH B)
- データレート: 10 Hz / 80 Hz
- 出力: int16 レンジ（Modbus レジスタ 0〜15 が AI 16ch）
- mV/V 換算: `raw / 32768 / 128 / 2 * 1000` (mV/V)
- μɛ 換算: `mV/V * 2000` (ゲージ率 2.0 仮定)
- 推奨励起: 5V (負荷セルの定格に合わせる)
- ひずみ限界: ±3000 με 程度（ゲージ率 2.0 なら）

## 付録 B: ロードセル検定の教科書的手順（参考）

1. **零点調整**: 無負荷で raw を記録 → オフセット c の確認
2. **スパン校正**: 定格容量の 0% → 25% → 50% → 75% → 100% → 0% と往復
3. **ヒステリシス**: 上昇列と下降列の差を確認
4. **繰返し性**: 同じ負荷で 3回以上測定
5. **非直線性**: ベストフィット直線からの偏差

検定アプリでは (1)(2)(3) をサポート。(4)(5) は CSV エクスポート後に外部ツールで実施。

---

## 関連ページ

- [architecture.md](architecture.md) — fork 元の全体構成
- [modbus-client.md](modbus-client.md) — 通信層（流用）
- [polling.md](polling.md) — ポーリング簡略化方針
- [data-persistence.md](data-persistence.md) — 永続化方針
- [calibration.md](calibration.md) — 最小二乗の数式
- [pwa-sw.md](pwa-sw.md) — Service Worker 設定
- [build.md](build.md) — Vite + pnpm 設定
- [conventions.md](conventions.md) — 命名規則
