# プロジェクト構成: vde-layout

## ルートディレクトリ
```
vde-layout/
├── .claude/        # Claude Code向け設定・コマンド
├── .kiro/          # Kiro方式の仕様・ステアリング文書
├── .serena/        # Serenaナレッジベース
├── .vscode/        # VS Codeワークスペース設定
├── ai/             # エージェント実行ログ
├── bin/            # CLIエントリスクリプト
├── dist/           # TypeScriptビルド成果物
├── examples/       # YAMLサンプル
├── src/            # ソースコードとテスト
├── CLAUDE.md       # Claude Code運用ガイド
├── README.md       # 利用者向けドキュメント
├── LICENSE         # MITライセンス
├── package.json    # npmパッケージ定義
├── tsconfig*.json  # TypeScript設定
├── vitest.config.mjs # テスト設定
├── eslint.config.mjs # ESLintフラット構成
├── cspell.json     # スペルチェック辞書
├── bun.lock        # Bunロックファイル
├── mise.toml       # miseツールバージョン管理
└── .npmignore      # npm公開時に除外するファイル
```

## `.kiro/` ディレクトリ
```
.kiro/
├── steering/
│   ├── product.md   # 本書 (常時読み込み)
│   ├── tech.md      # 技術方針 (常時読み込み)
│   └── structure.md # プロジェクト構成 (常時読み込み)
└── specs/
    └── ...          # フィーチャーごとの要求/設計/タスク（未作成の場合あり）
```

## `src/` サブディレクトリ
```
src/
├── index.ts                 # ライブラリエクスポート
├── cli.ts                   # CLIエントリ
├── __tests__/               # CLI/E2Eテスト・モック
│   ├── cli.test.ts
│   ├── e2e.test.ts
│   ├── index.test.ts
│   ├── helpers/test-utils.ts
│   └── mocks/
│       ├── layout-engine-mock.ts
│       ├── preset-manager-mock.ts
│       └── tmux-mock.ts
├── config/
│   ├── loader.ts
│   ├── validator.ts
│   └── __tests__/
│       ├── loader.test.ts
│       └── validator.test.ts
├── executor/
│   ├── index.ts
│   ├── real-executor.ts
│   ├── dry-run-executor.ts
│   └── mock-executor.ts
├── interfaces/
│   ├── index.ts
│   └── command-executor.ts
├── layout/
│   ├── engine.ts
│   ├── preset.ts
│   └── __tests__/
│       ├── engine.test.ts
│       └── preset.test.ts
├── models/
│   ├── schema.ts
│   ├── types.ts
│   └── __tests__/schema.test.ts
├── tmux/
│   ├── commands.ts
│   ├── executor.ts
│   └── __tests__/
│       ├── commands.test.ts
│       └── executor.test.ts
└── utils/
    ├── errors.ts
    ├── logger.ts
    ├── ratio.ts
    └── __tests__/
        ├── errors.test.ts
        └── ratio.test.ts
```

## ビルド成果物
- `dist/index.js`: CLIが読み込むエントリ。型定義 `dist/index.d.ts` とソースマップを同梱
- `bin/vde-layout`: Nodeシバン付きで `dist/index.js` を呼び出す

## 命名・配置規約
- **テスト**: 対応するディレクトリごとに `__tests__` を併設し `*.test.ts`
- **モック**: `src/__tests__/mocks/` 配下に機能単位で配置
- **型定義**: `schema.ts`, `types.ts` のように役割ごとに分割
- **設定ファイル**: ルート直下に配置し、各種ツールがデフォルト探索できるようにする

## 拡張余地
- `src/plugins/` など外部拡張ポイント用ディレクトリの追加
- `docs/` 配下の詳細ドキュメント整備
- `.kiro/specs/` にフィーチャー仕様を蓄積し、ステアリングと往復参照
- `examples/` の増強でプリセット共有パターンを増やす
