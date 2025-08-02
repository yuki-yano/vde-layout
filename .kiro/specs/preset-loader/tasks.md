# 実装計画

## Phase 1: プロジェクトセットアップとコア構造

- [ ] 1. プロジェクト構造の初期化とTypeScript設定
  - package.jsonの作成とコア依存関係のインストール（commander, yaml, execa, chalk, fs-extra）
  - TypeScript設定（tsconfig.json）の作成
  - ESLintとPrettierの設定
  - ディレクトリ構造の作成（src/cli, src/config, src/layout, src/tmux, src/utils）
  - エントリーポイントの作成（bin/vde-layout, src/index.ts）
  - _要件: 1.1, 1.3_

- [ ] 2. テスト環境のセットアップ
  - Vitestの設定とテストディレクトリ構造の作成
  - テストヘルパーユーティリティの作成
  - モック用のtmuxコマンドシミュレーター作成
  - _要件: 5.5_

## Phase 2: データモデルとバリデーション

- [ ] 3. コアデータモデルの実装（テスト駆動開発）
  - 3.1 Zodスキーマ定義のテスト作成（src/models/__tests__/schema.test.ts）
  - 3.2 データモデルインターフェースの定義（src/models/types.ts）
  - 3.3 Zodスキーマの実装（src/models/schema.ts）：Pane、Layout、Preset、Config
  - 3.4 バリデーションロジックの実装とカスタムバリデーター
  - _要件: 6.1, 6.2, 6.4, 6.5_

- [ ] 4. エラークラス階層の実装
  - 4.1 エラークラスのテスト作成（src/utils/__tests__/errors.test.ts）
  - 4.2 カスタムエラークラスの実装（src/utils/errors.ts）：VDELayoutError, ConfigError, ValidationError, TmuxError, EnvironmentError
  - 4.3 エラーメッセージフォーマッターの実装
  - _要件: 5.1, 5.3_

## Phase 3: 設定ファイル管理

- [ ] 5. XDG準拠の設定ローダー実装（テスト駆動開発）
  - 5.1 設定ローダーのテスト作成（src/config/__tests__/loader.test.ts）
  - 5.2 XDGパス解決ロジックの実装（src/config/loader.ts）
  - 5.3 YAMLファイル読み込みとyaml v2でのパース処理
  - 5.4 設定ファイル検索順序の実装（VDE_CONFIG_PATH → XDG_CONFIG_HOME → ~/.config）
  - _要件: 2.1, 2.2, 2.3, 2.4_

- [ ] 6. YAMLバリデーターの実装
  - 6.1 バリデーターのテスト作成（src/config/__tests__/validator.test.ts）
  - 6.2 Zodスキーマを使用したYAML検証ロジック（src/config/validator.ts）
  - 6.3 詳細なバリデーションエラーメッセージの生成
  - _要件: 3.4, 3.5, 6.3, 6.7_

## Phase 4: プリセット管理

- [ ] 7. プリセットマネージャーの実装（テスト駆動開発）
  - 7.1 プリセットマネージャーのテスト作成（src/layout/__tests__/preset.test.ts）
  - 7.2 PresetManagerクラスの実装（src/layout/preset.ts）
  - 7.3 プリセット取得、検証、一覧表示機能の実装
  - 7.4 defaultプリセットのフォールバック処理
  - _要件: 3.1, 3.2, 3.3, 3.6_

## Phase 5: tmux統合

- [ ] 8. tmuxエグゼキューターの実装（テスト駆動開発）
  - 8.1 tmuxエグゼキューターのテスト作成（src/tmux/__tests__/executor.test.ts）
  - 8.2 TmuxExecutorクラスの実装（src/tmux/executor.ts）
  - 8.3 execaを使用した安全なコマンド実行
  - 8.4 tmuxセッション内チェックとコマンドログ機能
  - _要件: 4.1, 4.5, 5.5_

- [ ] 9. tmuxコマンドジェネレーターの実装
  - 9.1 コマンドジェネレーターのテスト作成（src/tmux/__tests__/commands.test.ts）
  - 9.2 ペイン分割、リサイズ、コマンド実行のコマンド生成（src/tmux/commands.ts）
  - 9.3 環境変数設定とペインタイトル設定のコマンド生成
  - _要件: 4.2, 4.3, 4.4, 6.8, 6.9, 6.11_

## Phase 6: レイアウトエンジン

- [ ] 10. レイアウトエンジンのコア実装（テスト駆動開発）
  - 10.1 レイアウトエンジンのテスト作成（src/layout/__tests__/engine.test.ts）
  - 10.2 LayoutEngineクラスの実装（src/layout/engine.ts）
  - 10.3 既存ペインのクリア処理とペイン作成の再帰的アルゴリズム
  - 10.4 分割比率計算とペインサイズ調整ロジック
  - _要件: 4.1, 4.2, 4.3, 6.3, 6.7_

- [ ] 11. ペインオプション適用機能の実装
  - 11.1 ペインオプションのテスト作成（フォーカス、遅延、作業ディレクトリ）
  - 11.2 cwdの変更、環境変数設定、コマンド実行前の遅延処理
  - 11.3 フォーカス移動とペインタイトル設定の実装
  - _要件: 6.6, 6.8, 6.9, 6.10, 6.11_

## Phase 7: CLIインターフェース

- [ ] 12. CLIパーサーとコマンド構造の実装（テスト駆動開発）
  - 12.1 CLIのテスト作成（src/__tests__/cli.test.ts）
  - 12.2 CLIクラスの実装（src/cli.ts）：commander.jsを使用したオプション解析
  - 12.3 プリセット実行、リスト表示、ヘルプ、バージョン表示の実装
  - 12.4 defaultプリセットの自動選択ロジック
  - _要件: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.6_

- [ ] 13. 実行オプションとフィードバック機能の実装
  - 13.1 verboseとdry-runオプションのテスト作成
  - 13.2 詳細ログ出力とドライラン機能の実装
  - 13.3 成功メッセージとエラーフィードバックの実装
  - 13.4 デバッグモード（VDE_DEBUG）のサポート
  - _要件: 5.1, 5.2, 5.3, 5.4, 5.5_

## Phase 8: 統合とE2Eテスト

- [ ] 14. メインエントリーポイントの統合
  - 14.1 bin/vde-layoutスクリプトの作成（#!/usr/bin/env node）
  - 14.2 src/index.tsでのモジュール統合とエクスポート
  - 14.3 エラーハンドリングとプロセス終了コードの設定
  - 14.4 グローバルインストール対応の確認
  - _要件: 1.1, 5.3_

- [ ] 15. 統合テストとE2Eテストの実装
  - 15.1 設定ファイル読み込みからレイアウト作成までの統合テスト
  - 15.2 様々なレイアウトパターンのE2Eテスト（単純な2ペイン、複雑なネスト構造）
  - 15.3 エラーケースのE2Eテスト（設定不在、無効な設定、tmux未起動）
  - 15.4 CLIオプションの組み合わせテスト
  - _要件: 全要件のエンドツーエンド検証_

- [ ] 16. パッケージ公開準備
  - 16.1 package.jsonの最終調整（bin設定、scripts、dependencies）
  - 16.2 README.mdの作成（インストール方法、使用例、設定例）
  - 16.3 examples/ディレクトリにサンプル設定ファイルを配置
  - 16.4 npm publishの準備（.npmignore、バージョニング）
  - _要件: プロダクト配布準備_