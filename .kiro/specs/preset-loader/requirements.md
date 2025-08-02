# Requirements Document

## 概要
vde-layoutは、YAMLで定義されたレイアウトプリセットを使用して、tmuxのペイン構成を自動的に再現するCLIツールです。ユーザーが指定したプリセット名に基づいて、設定ファイルから対応するレイアウト定義を読み込み、現在のtmuxウィンドウ内でペイン分割と配置を実行します。

### レイアウト定義の例
```yaml
presets:
  development:
    name: "Development Layout"
    description: "Full-stack development environment with editor and terminals"
    layout:
      type: horizontal
      ratio: [70, 30]
      panes:
        - type: vertical
          ratio: [70, 30]
          panes:
            - name: "neovim"
              command: "nvim"
              cwd: "~/projects/vde-layout"
              focus: true
              title: "Editor"
            - type: horizontal
              ratio: [1, 1, 1]
              panes:
                - name: "term1"
                  cwd: "~/projects/vde-layout"
                - name: "term2"
                  command: "npm run dev"
                  cwd: "~/projects/vde-layout"
                  env:
                    NODE_ENV: "development"
                  delay: 1000
                  title: "Dev Server"
                - name: "term3"
                  title: "General"
        - type: vertical
          ratio: [1, 1]
          panes:
            - name: "claude-code1"
              command: "claude"
              title: "AI Assistant 1"
            - name: "claude-code2"
              command: "claude"
              title: "AI Assistant 2"
```

## 要件

### 要件 1: プリセット指定とCLIインターフェース
**ユーザーストーリー:** 開発者として、コマンドラインからプリセット名を指定してレイアウトを再現したい。作業環境を素早く構築できるようにするため。

#### 受け入れ基準
1. WHEN ユーザーが `vde-layout --preset <preset-name>` を実行する THEN システムは指定されたプリセット名を解析して処理を開始する
2. WHEN プリセット名が省略される THEN システムは "default" プリセットを使用して処理を実行する
3. IF "default" プリセットが存在しない THEN システムは使用可能なプリセットのリストを表示してエラーを返す
4. WHEN `--help` オプションが指定される THEN システムは使用方法とオプションの説明を表示する
5. WHEN `--version` オプションが指定される THEN システムはパッケージのバージョン情報を表示する
6. IF tmux セッション外で実行される THEN システムは適切なエラーメッセージを表示して終了する

### 要件 2: 設定ファイルの読み込みとXDG準拠
**ユーザーストーリー:** 開発者として、XDG Base Directory仕様に準拠した場所から設定ファイルを読み込みたい。標準的な設定管理ができるようにするため。

#### 受け入れ基準
1. WHEN 設定ファイルの読み込みが必要になる THEN システムは以下の優先順位で設定ファイルを検索する：
   - `$VDE_CONFIG_PATH/layout.yml` （環境変数が設定されている場合）
   - `$XDG_CONFIG_HOME/vde/layout.yml`
   - `~/.config/vde/layout.yml` （XDG_CONFIG_HOMEが未設定の場合）
2. IF 設定ファイルが見つからない THEN システムは検索したパスを含むエラーメッセージを表示する
3. WHEN 設定ファイルが見つかる THEN システムはYAML形式のファイルをパースして内容を読み込む
4. IF YAMLのパースエラーが発生する THEN システムはエラーの詳細（行番号、エラー内容）を表示する

### 要件 3: プリセット管理と検証
**ユーザーストーリー:** 開発者として、設定ファイル内で複数のプリセットを定義して管理したい。異なる作業環境を簡単に切り替えられるようにするため。

#### 受け入れ基準
1. WHEN 設定ファイルを読み込む THEN システムは `presets` キー配下のすべてのプリセット定義を取得する
2. WHEN 指定されたプリセット名で設定を検索する THEN システムは `presets.<preset-name>` の定義を取得する
3. IF 指定されたプリセットが存在しない THEN システムは利用可能なプリセット名のリストを表示してエラーを返す
4. WHEN プリセット定義が取得される THEN システムは以下の妥当性を検証する：
   - `layout` キーが存在すること
   - `type` が "horizontal" または "vertical" であること
   - `ratio` 配列の要素数と `panes` 配列の要素数が一致すること
   - ネストした構造が正しく定義されていること
5. IF プリセット定義が不正な形式である THEN システムは具体的な検証エラーを表示する（例：「ratio配列の要素数2がpanes配列の要素数3と一致しません」）
6. WHEN `--list` オプションが指定される THEN システムは各プリセットのキー名と `name` フィールドの値を一覧表示する

### 要件 4: tmuxレイアウトの再現
**ユーザーストーリー:** 開発者として、YAMLで定義されたレイアウトを現在のtmuxウィンドウで正確に再現したい。複雑なペイン構成を手動で作成する手間を省くため。

#### 受け入れ基準
1. WHEN レイアウトの再現を開始する THEN システムは現在のtmuxウィンドウ内の既存ペインをすべてクリアする
2. WHEN ペイン分割を実行する THEN システムはYAML定義に従って垂直・水平分割を順次実行する
3. IF ペインサイズが指定されている THEN システムは指定されたサイズ（パーセンテージまたは行/列数）でペインをリサイズする
4. WHEN 各ペインが作成される THEN システムは定義されたコマンドがあれば実行する
5. IF tmuxコマンドの実行に失敗する THEN システムは部分的に作成されたレイアウトをクリーンアップしてエラーを報告する

### 要件 5: エラーハンドリングとユーザーフィードバック
**ユーザーストーリー:** 開発者として、操作の進行状況や問題発生時に適切なフィードバックを受け取りたい。問題を素早く特定して解決できるようにするため。

#### 受け入れ基準
1. WHEN `--verbose` オプションが指定される THEN システムは実行中のすべての操作を詳細にログ出力する
2. WHEN `--dry-run` オプションが指定される THEN システムは実際のtmuxコマンドを実行せずに、実行予定のコマンドを表示する
3. IF エラーが発生する THEN システムは以下の情報を含むエラーメッセージを表示する：
   - エラーの種類（設定エラー、tmuxエラー、システムエラー）
   - 発生した場所（ファイル名、プリセット名、コマンド）
   - 推奨される解決方法
4. WHEN レイアウトの再現が成功する THEN システムは成功メッセージと作成されたペイン数を表示する
5. WHILE デバッグモードが有効 (`VDE_DEBUG=1`) THE SYSTEM SHALL すべての内部処理とtmuxコマンドの詳細をログ出力する

### 要件 6: レイアウト定義の構造
**ユーザーストーリー:** 開発者として、直感的で柔軟なYAML形式でレイアウトを定義したい。複雑なレイアウトも簡潔に表現できるようにするため。

#### 受け入れ基準
1. WHERE プリセット定義内 THE SYSTEM SHALL 以下のトップレベル要素をサポートする：
   - `name`: プリセットの表示名（例："Development Layout"）
   - `layout`: レイアウト構造の定義
   - `description`: プリセットの説明（オプション）
2. WHERE レイアウト定義内 THE SYSTEM SHALL 以下の要素をサポートする：
   - `type`: 分割方向（horizontal/vertical）
   - `ratio`: 分割比率の配列（例：[70, 30]で70%と30%の分割）
   - `panes`: 子ペインの配列（ネストした分割）
   - `name`: ペインの識別名（オプション）
   - `command`: ペイン内で実行するコマンド（オプション）
   - `focus`: このペインにフォーカスを設定するかのブール値（オプション）
   - `cwd`: 作業ディレクトリのパス（オプション）
   - `env`: 環境変数の定義オブジェクト（オプション）
   - `delay`: コマンド実行前の遅延時間（ミリ秒単位、オプション）
   - `title`: tmuxペインタイトル（オプション）
3. WHEN `ratio` が指定される THEN システムは配列の値を比率として解釈し、合計に対する各ペインの割合を計算する
4. IF ペインが `type` と `panes` を持つ THEN システムはそれを分割コンテナとして扱い、再帰的に処理する
5. IF ペインが `name` または `command` を持つ THEN システムはそれを末端ペインとして扱う
6. WHEN `focus: true` が指定されたペインがある THEN システムはレイアウト作成後にそのペインにフォーカスを移動する
7. WHERE ネストした分割内 THE SYSTEM SHALL 親の分割方向と異なる方向の分割をサポートする（例：horizontal内のvertical）
8. IF `cwd` が指定されている THEN システムはペイン作成後、コマンド実行前に作業ディレクトリを変更する
9. IF `env` が指定されている THEN システムは指定された環境変数を設定してからコマンドを実行する
10. IF `delay` が指定されている THEN システムは指定されたミリ秒待機してからコマンドを実行する
11. IF `title` が指定されている THEN システムはtmuxのペインタイトルを設定する