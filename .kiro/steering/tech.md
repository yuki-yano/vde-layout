# 技術スタック: vde-layout

## アーキテクチャ概要
- **CLI中心構成**: `bin/vde-layout` から `dist/index.js` を実行するNode.js CLIとして配布
- **設定駆動型**: YAML構成ファイル（XDG Base Directory準拠）を解析し、Zodでバリデーション
- **tmuxコマンド生成**: レイアウトエンジンがペイン分割・比率計算を行い、executor経由でtmuxを操作
- **Executor切替**: 本番実行/ドライラン/モックをStrategyパターンで差し替え
- **ログ&エラー層**: ログレベル別出力と独自エラークラスで診断性を確保

## 主要モジュール
- `src/cli.ts`: Commanderを用いたCLIパラメータ解析とエントリポイント
- `src/config/loader.ts`: XDGパス解決・YAMLロード・プリセット探索
- `src/config/validator.ts`: Zodでの構造検証と詳細なエラーハンドリング
- `src/layout/engine.ts`: レイアウト木構造の再帰的展開と比率正規化
- `src/tmux/commands.ts`: tmuxサブコマンド生成（分割・ペイン選択・サイズ調整）
- `src/executor/*.ts`: 実行戦略（リアル/ドライラン/モック）のインターフェース実装
- `src/utils/logger.ts`: 構造化ログと冗長度制御
- `src/models/schema.ts`: YAML→内部モデル変換の共通型

## 言語・ランタイム
- **TypeScript 5.3+**: 厳格モードで型安全性と補完性を確保
- **Node.js 22以上**: `engines.node` で明示。ES2022ターゲット、CommonJS出力
- **Bun (任意)**: `prepublishOnly` スクリプトで `bun run` を利用。リリース前にインストールが必要
- **tmux 2.0+**: ランタイム要件。存在しない場合のエラーハンドリング強化が課題

## ビルド&テストフロー
- `bun run clean` → `bun run build`: TypeScriptを`dist/`へトランスパイル（`tsc`）
- `npm run build` / `npm run compile`: いずれも `tsc`
- `npm run test`: Vitestでユニット・統合テスト実行
- `npm run test:coverage`: V8カバレッジ収集
- `npm run dev`: `tsc --watch` を使った開発ビルド
- `npm run lint`: ESLint (flat config) で `src/` を検査
- `npm run format`: Prettierで `src/**/*.ts` を整形
- `npm run typecheck`: 出力なし型チェック

## 依存関係
### 本番依存
- `commander` (CLIコマンド定義)
- `chalk` (CLI出力装飾)
- `execa` (tmuxプロセス実行)
- `fs-extra` (ファイル操作ユーティリティ)
- `yaml` (YAMLパース)
- `zod` (スキーマ検証)

### 開発依存
- `typescript` / `tsconfig.json` (ビルド/型定義)
- `vitest` / `@vitest/coverage-v8` (テスト)
- `eslint` / `typescript-eslint` / `@eslint/js` / `eslint-config-prettier` (Lint)
- `prettier` (フォーマット)
- `globals`, `@types/node`, `@types/fs-extra` (型補完)

## 設定ファイル
- `tsconfig.json`: `dist/` 出力、`strict` オン、`declaration`/`sourceMap` 生成
- `tsconfig.test.json`: テスト対象向け設定（Vitestやモックで利用）
- `eslint.config.mjs`: Flat Config形式でESLintルール定義
- `vitest.config.mjs`: `tsconfig.test.json` を読み込み、テストエイリアスを定義
- `cspell.json`: スペルチェック対象語彙
- `mise.toml`: miseでのツールバージョン管理（Node/Bunなど）

## コマンドチートシート
```bash
# 依存関係インストール
npm install
# または pnpm install / bun install

# ビルド
npm run build

# 監視コンパイル
npm run dev

# テスト
npm run test
npm run test:watch

# Lint & フォーマット
npm run lint
npm run format

# 型チェック
npm run typecheck

# Dry-run実行例
node dist/index.js dev --dry-run
```

## 環境変数
- `XDG_CONFIG_HOME`: プリセット探索の基準ディレクトリ
- `VDE_CONFIG_PATH`: 設定ファイルの検索パスを上書き
- `VDE_DEBUG`: `true` で詳細ログ
- `VDE_VERBOSE`: `true` で情報レベルログ
- `TMUX`: tmux実行中に自動設定される環境変数

## テスト戦略
- `src/__tests__/*.test.ts`: CLIとユーティリティのE2E/統合テスト
- 各サブディレクトリの `__tests__/`: モジュール単位ユニットテスト
- モック (`src/__tests__/mocks/`, `src/executor/mock-executor.ts`): tmux依存部の分離
- Vitestでのスナップショット・カバレッジ計測を組み込み

## 配布
- npmパッケージとして `dist/`, `bin/`, `README.md`, `LICENSE` を公開対象に設定
- `LICENSE` はMIT。2025年10月5日時点でOSSとして再利用可能な状態。
