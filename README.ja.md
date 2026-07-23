# vde-layout

[English](README.md)

`vde-layout` は、YAMLで定義したpresetからtmux、WezTerm、Herdrのterminal workspaceを再現するCLIです。

必要なpane、command、working directory、split比率を一度定義すれば、`vde-layout`または短縮名の`vl`から同じworkspaceを開けます。

## インストール

### Cargo

```bash
cargo install vde-layout --locked
```

sourceからbuildする場合はRust 1.88以降が必要です。

### build済みbinary

[GitHub Releases](https://github.com/yuki-yano/vde-layout/releases)から利用環境に合うarchiveをdownloadしてください。

各archiveには`vde-layout`と`vl`が含まれ、SHA-256 checksumも公開されます。

release archiveは次の環境を対象にします。

- Linux x86_64
- Linux aarch64
- macOS x86_64
- macOS Apple Silicon

## 最初のpreset

`~/.config/vde/layout/config.yml`を作成します。

```yaml
presets:
  dev:
    name: Development
    description: Editor, application server, and logs
    layout:
      type: horizontal
      ratio: [2, 1]
      panes:
        - name: editor
          command: nvim
          focus: true
        - type: vertical
          ratio: [2, 1]
          panes:
            - name: server
              command: npm run dev
            - name: logs
              command: tail -f logs/app.log
```

使用するterminal backendを起動し、presetを適用します。

```bash
vde-layout dev
```

短いcommand名を使う場合は`vl`を実行します。

```bash
vl dev
```

terminalを変更せず、実行予定のcommandだけを確認するには`--dry-run`を指定します。

```bash
vde-layout dev --dry-run
```

## terminal backendの選択

default backendはtmuxです。

presetまたはcommand lineで別のbackendを選択できます。

```yaml
presets:
  dev:
    name: Development
    backend: herdr
```

```bash
vde-layout dev --backend wezterm
```

| backend | 実行時の要件 | new-windowの動作 |
| --- | --- | --- |
| tmux | tmux 2.0以降と実行中のsession | tmux windowを作成 |
| WezTerm | `20220624-141144-bd1b7c5d`以降の`wezterm` CLI | active windowにtabを作成し、windowがなければ新規作成 |
| Herdr | `herdr` 0.7.4以降と実行中のserver | current workspaceにtabを作成 |

Herdrでは、splitの両側を10%から90%の範囲に収める必要があります。

この範囲を超えるpresetは、Herdr側で暗黙に補正せず、`vde-layout`がerrorとして報告します。

## commandの概要

```text
vde-layout [OPTIONS] [PRESET]
vde-layout list
```

よく使うcommandとoptionは次のとおりです。

```bash
# 設定済みpresetを一覧表示
vde-layout list

# default presetを適用
# "default" keyがなければ最初のpresetを適用
vde-layout

# fzfによるpreset選択
vde-layout --select

# current windowまたはtabを再利用
vde-layout dev --current-window

# 常に新しいwindowまたはtabを作成
vde-layout dev --new-window

# 指定した設定ファイルを使用
vde-layout dev --config ./team-layouts.yml

# 解決したpresetと実行内容を表示
vde-layout dev --verbose

# 構造化されたdebug情報を表示
VDE_DEBUG=true vde-layout dev
```

すべてのoptionは`vde-layout --help`で確認できます。

`vl`は`vde-layout`と同じoption、出力、終了codeを使用します。

## current windowを安全に再利用する

`--current-window`は、presetを適用する前に対象のtmux window、WezTerm tab、Herdr tabにある他のpaneを閉じます。

対話実行では、paneを閉じる前に確認を求めます。

tmuxでは、user optionの`@vde_sidebar=1`を持つpaneを保護します。

保護したpaneは閉じず、残りの領域に新しいlayoutを作成します。

新しいpresetや共有されたpresetを適用する前に、`--dry-run`で内容を確認してください。

```bash
vde-layout dev --current-window --dry-run
```

## 設定

### preset

各presetは`presets`の下に定義し、表示名を必ず指定します。

```yaml
presets:
  api:
    name: API development
    description: Editor and API server
    backend: tmux
    windowMode: new-window
    layout:
      type: horizontal
      ratio: [3, 2]
      panes:
        - name: editor
          command: nvim
          cwd: /path/to/api
          focus: true
        - name: server
          command: cargo run
          cwd: /path/to/api
          env:
            RUST_LOG: debug
          title: API
          delay: 500
```

presetで使用できるfieldは次のとおりです。

| field | 必須 | 説明 |
| --- | --- | --- |
| `name` | はい | 表示名 |
| `description` | いいえ | `list`とselectorに表示する説明 |
| `backend` | いいえ | `tmux`、`wezterm`、`herdr`のいずれか。defaultはtmux |
| `windowMode` | いいえ | `new-window`または`current-window` |
| `layout` | いいえ | 入れ子にできるpane layout |
| `command` | いいえ | `layout`を省略した単一pane presetで実行するcommand |
| `hooks.afterApply` | いいえ | preset適用後にhostで実行するcommand |

`layout`と`command`を両方省略すると、default shellを持つpaneを一つ開きます。

### layoutとpane

split nodeでは、左右に並べる場合に`horizontal`、上下に並べる場合に`vertical`を指定します。

split nodeは任意の深さまで入れ子にできます。

```yaml
layout:
  type: horizontal
  ratio: ["90c", 2]
  panes:
    - name: editor
      command: nvim
    - type: vertical
      ratio: [1, 1]
      panes:
        - name: tests
          command: cargo test
        - name: shell
```

terminal paneで使用できるfieldは次のとおりです。

| field | 説明 |
| --- | --- |
| `name` | 必須のpane名 |
| `command` | paneへ送信するcommand |
| `cwd` | commandの実行前に移動するdirectory |
| `env` | commandの実行前にexportする環境変数 |
| `delay` | commandを送信するまで待機する時間。単位はmillisecond |
| `title` | paneのtitleまたはlabel |
| `focus` | 最後にfocusするpane。一つのpaneだけに指定可能 |
| `ephemeral` | commandが成功した後にpaneを閉じる |
| `closeOnError` | ephemeral paneのcommandが失敗した場合もpaneを閉じる |

### 比率と固定cell

数値のratioはweightとして扱います。

```yaml
ratio: [2, 1]
```

固定cell数は正の整数の末尾に`c`を付けます。

```yaml
ratio: ["90c", 2, 1]
```

固定cellを先に確保し、残った領域をweightに従って配分します。

ratioには次の制約があります。

- `panes`と同じ数の要素を指定する
- 数値のweightを一つ以上含める
- 正のweightと正の整数cell数だけを使用する

terminalが固定cell layoutを満たせない場合、指定したsizeを暗黙に変更せず、presetの適用をerrorにします。

### default設定

設定全体のwindowとselectorの動作を`defaults`で指定できます。

```yaml
defaults:
  windowMode: new-window
  selector:
    ui: auto
    surface: auto
    tmuxPopupOpts: "80%,70%"
    fzf:
      extraArgs:
        - --cycle
        - --info=inline
```

command line option、preset、default設定の順で優先します。

## 設定ファイルの検索と結合

`--config`を省略すると、`vde-layout`は次のscopeから設定を検索します。

1. current directoryから上位へ検索するproject設定。`.vde/layout/config.yml`、`.vde/layout.yml`の順
2. `VDE_CONFIG_PATH`が設定されている場合の`$VDE_CONFIG_PATH/layout.yml`
3. `$XDG_CONFIG_HOME/vde/layout/config.yml`。`XDG_CONFIG_HOME`がなければ`~/.config/vde/layout/config.yml`
4. 旧XDG pathの`$XDG_CONFIG_HOME/vde/layout.yml`。`XDG_CONFIG_HOME`がなければ`~/.config/vde/layout.yml`

共有設定を先に読み、project設定を最後に読みます。

後から読み込んだscopeは、同じkeyを持つpresetとdefault設定を上書きします。

## presetを対話選択する

`fzf`をinstallしてから、次のcommandを実行します。

```bash
vde-layout --select
```

selectorにはpreset名、説明、YAML previewが表示されます。

表示方法や`fzf`のoptionはcommand lineから指定できます。

```bash
vde-layout --select --select-surface inline
vde-layout --select --select-surface tmux-popup
vde-layout --select --select-tmux-popup-opts "80%,70%"
vde-layout --select --fzf-arg=--cycle --fzf-arg=--info=inline
```

tmux popupを使用する場合はtmux 3.3以降が必要です。

## template tokenでpaneを参照する

paneのcommandでは、layout作成時に割り当てられたIDをtemplate tokenから参照できます。

| token | 値 |
| --- | --- |
| `{{this_pane}}` | commandを受け取るpaneのID |
| `{{focus_pane}}` | 最後にfocusするpaneのID |
| `{{pane_id:name}}` | 指定した名前を持つpaneのID |

```yaml
panes:
  - name: editor
    command: nvim
    focus: true
  - name: reporter
    command: 'echo "editor={{pane_id:editor}} focus={{focus_pane}}"'
```

存在しないpane名を指定するとerrorになります。

`{{window_id}}`は`hooks.afterApply`だけで使用できます。

## preset適用後にcommandを実行する

`hooks.afterApply`は、backendの処理が完了した後にhost上で一度実行されます。

```yaml
presets:
  dev:
    name: Development
    command: nvim
    hooks:
      afterApply: 'notify-send "ready in {{window_id}}"'
```

hookは次の規則で動作します。

- `vde-layout`を起動したdirectoryで`sh -c`を使って実行する
- `{{this_pane}}`、`{{focus_pane}}`、`{{pane_id:name}}`、`{{window_id}}`を使用できる
- `--dry-run`では表示だけを行い、実行しない
- 30秒でtimeoutする
- 失敗した場合はwarningを出し、成功済みのpreset適用は失敗扱いにしない

## 環境変数

| 変数 | 用途 |
| --- | --- |
| `VDE_CONFIG_PATH` | 共有設定を置く追加directory |
| `XDG_CONFIG_HOME` | XDG設定のbase directory |
| `VDE_VERBOSE=true` | 情報logを有効化 |
| `VDE_DEBUG=true` | debug logと構造化error情報を有効化 |
| `TMUX` | tmux session内での実行確認 |
| `HERDR_PANE_ID` | Herdrのcurrent-window modeで使用するpane |
| `HERDR_WORKSPACE_ID` | Herdrで新しいtabを作成するworkspace |

Herdrが管理するpaneから起動したcommandには、Herdrが関連する環境変数を自動設定します。

## 問題を調べる

### 適用前に内容を確認する

`--dry-run`ではbackend binaryを必要とせず、paneの作成、終了、size変更を行いません。

```bash
vde-layout dev --backend herdr --dry-run
```

### backendが見つからない

backendのCLIが`PATH`に含まれることを確認します。

```bash
tmux -V
wezterm --version
herdr --version
```

WezTermとHerdrを使用する場合は、dry-run以外の実行前にapplicationまたはserverを起動します。

### 固定cell layoutを適用できない

terminalを広げるか、固定cell数を減らすか、固定cellを数値のweightへ変更してください。

`VDE_DEBUG=true`を指定すると、size解決に使用したpane sizeを確認できます。

## 開発

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets --all-features
cargo test --test tmux_live -- --ignored --nocapture
cargo publish --locked --dry-run
```

tmuxのlive testは隔離したsocketを使用するため、activeなtmux sessionを変更しません。

bug reportとfeature requestは[GitHub Issues](https://github.com/yuki-yano/vde-layout/issues)へ登録してください。

## License

MIT
