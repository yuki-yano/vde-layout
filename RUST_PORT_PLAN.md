# vde-layout TypeScript → Rust 完全移植計画

## 1. 目的

vde-layout 1.1.3 の実装を TypeScript / Node.js から Rust へ完全移植する。
既存の YAML 設定、CLI、tmux / WezTerm バックエンド、dry-run、fzf セレクタ、フックの機能を Rust 実装で再現し、最終成果物から TypeScript / JavaScript と Node.js 実行時依存を撤去する。

実行コマンドとして `vde-layout` と短縮名 `vl` の二つを提供し、どちらも同じ Rust ライブラリの CLI エントリーポイントを呼び出す。

## 2. 移植の原則

- 後方互換用の TypeScript 実装、Node.js ランチャー、実行時 fallback は残さない。
- 設定ファイルと CLI のユーザー向け挙動は、意図的な変更を明記した項目を除いて現行 1.1.3 と一致させる。
- tmux / WezTerm の外部コマンド実行は抽象化し、ユニットテストでは記録可能な fake runner、結合テストでは実プロセスを使う。
- dry-run と実行で同じコンパイル済みプランを使い、バックエンドごとのコマンド生成差分だけを分離する。
- エラーは型付き error code、message、details を持たせ、CLI 層で終了コードと利用者向け guidance に変換する。
- 判断が必要な場合は、単純さ、型安全性、テスト可能性、外部コマンド境界の明確さを優先する。

### 2.1 意図的に変更する項目

- Rust 完全置換を破壊的変更として扱い、crate / CLI のバージョンを `2.0.0` に上げる。
- help / usage のレイアウトは `clap` 標準へ変更する。option 名、意味、default、終了コードは維持し、`try_parse` の parse error を捕捉して通常エラー `1`、利用者キャンセル `130` に明示変換する。
- エラー文言の句読点や YAML parser 固有表現は一致対象外とする一方、error code、対象 path、guidance、終了コードは維持する。
- fzf preview は Node.js の `node -e` を廃止し、実行中バイナリの非公開 `__preview` subcommand で base64 payload を表示する。
- npm 配布と Node.js ランチャーを廃止する。Rust 2.0.0 以降は GitHub Release の native artifact と `cargo install --git` を配布経路とし、npm registry 上の既存 package はこの作業では変更しない。
- plan hash は外部契約ではないため、言語間で hash 値そのものは一致させない。正規化した plan 構造の一致を parity 条件とし、Rust 内では canonical JSON の SHA-256 を決定的 hash とする。
- terminal の `delay` は `2^31-1` ms を上限とし、dry-run を含めて超過時は `INVALID_PLAN` とする。Node.js の timeout overflow による 1 ms 実行は、誤設定したコマンドの即時実行を招くため再現しない。
- `chalk` 依存の撤去に伴い、通常の CLI 出力に付けていた色装飾は廃止する。文字列の内容と stdout / stderr の出力先は維持し、fzf selector 内の識別用 ANSI 装飾のみ Rust 実装で維持する。

## 3. 現行ベースライン

移植開始時点の `main` は `5249bb7`（v1.1.3）。作業は branch `feature/rust-port`、worktree `/Users/yuki-yano/repos/github.com/yuki-yano/vde-layout/.git/wt/feature/rust-port` だけで行い、完了後の main への統合は本計画の範囲外とする。

- TypeScript 実装: `src/**/*.ts` 合計 18,259 行
- ベースライン検証: `pnpm run ci`
- テスト: 39 ファイル、444 件、全件成功
- CLI: preset 適用、`list`、`--select`、`--dry-run`、`--verbose`、`--backend`、window mode、config path、help、version、current-window 確認
- バックエンド: tmux、WezTerm
- 設定探索: project、`VDE_CONFIG_PATH`、XDG の順序と scope merge
- レイアウト: 再帰 split、weight / fixed-cell ratio、focus、cwd、env、delay、title、ephemeral、closeOnError
- 実行補助: template token、sidebar 保護、afterApply hook、fzf selector、`VDE_DEBUG` / `VDE_VERBOSE`

## 4. 目標アーキテクチャ

```text
src/
├── lib.rs                 # 共有 API と CLI 実行入口
├── bin/
│   ├── vde-layout.rs      # 正式コマンド
│   └── vl.rs              # 短縮コマンド
├── cli/                   # clap 定義、表示、selector、hook、終了コード
├── config/                # YAML raw model、独自検証、探索、scope merge
├── core/                  # compile → plan → emit の純粋ロジック
├── executor/              # runner、pane map、template、共通実行処理
└── backends/
    ├── tmux/              # tmux 検出、dry-run、適用、sidebar 保護
    └── wezterm/           # CLI 検出、pane 一覧、dry-run、適用
tests/
├── cli.rs                 # assert_cmd による実バイナリ契約
├── config.rs              # 設定探索と merge のファイル I/O 結合試験
├── tmux.rs                # fake tmux によるコマンド列の結合試験
├── wezterm.rs             # fake wezterm によるコマンド列の結合試験
├── tmux_live.rs           # #[ignore] の隔離 socket live smoke
└── fixtures/              # YAML と期待出力／期待コマンド列
```

### 4.1 採用予定クレート

- `clap`: CLI パース、help、version
- `serde` / `serde-saphyr`: YAML モデルとデシリアライズ。duplicate key は拒否し、`strict_booleans` を有効化する
- `serde_json`: parity 用の構造比較と canonical plan 表現
- `thiserror`: 型付きエラー
- `sha2`: 決定的 plan hash
- `regex`: template token とバージョン解析
- `unicode-width`: CLI 一覧表示幅
- `base64`: fzf preview payload
- `shlex`: fzf preview command に渡す実行ファイルパスの shell quote
- `wait-timeout`: afterApply の 30 秒 timeout
- 開発用に `assert_cmd`、`predicates`、`tempfile`、`pretty_assertions`

依存バージョンは実装開始時に Cargo で解決して `Cargo.lock` を固定する。

### 4.2 YAML 検証とエラー設計

`serde-saphyr` は YAML から optional field を持つ raw model への構文デシリアライズまでを担当する。
unknown field は `deny_unknown_fields`、duplicate key は parser option で拒否する。
terminal / split の判別、必須 field、ratio、正数、相互制約、error code と path は独自 validator で検証し、parser の untagged enum error に利用者向け品質を依存させない。
YAML 1.2 互換 fixture として `on` / `off` / `yes` / `no` の文字列、真偽値、anchor / alias、merge key、duplicate key を現行 JS parser と比較する。

### 4.3 fzf preview 設計

selector は `std::env::current_exe()` で現在の `vde-layout` または `vl` を取得し、パスを shell quote してから fzf の preview command に `<current-exe> __preview {3}` を渡す。
非公開 subcommand は引数の base64 を Rust 内で decode して stdout に書き、OS ごとに異なる `base64` command や Node.js を呼び出さない。

## 5. 機能移植マトリクス

| 領域 | 現行責務 | Rust 側の完了証拠 |
| --- | --- | --- |
| Schema | strict nested pane、ratio、defaults、hooks、path 付き error | valid / invalid fixture の model / validator tests |
| Config | YAML parse、探索順、scope merge、conflict warning | tempdir 結合試験と warning assertion |
| Preset | get/list/default、missing error | preset manager unit tests |
| Compile | value 正規化、metadata、再帰 node、error path | compile fixture tests |
| Planner | pane ID、focus、ratio 検証 | pure unit tests |
| Emitter | split 順序、percent / fixed-cell、canonical hash | 正規化 JSON の構造比較と golden command plan tests |
| Template | this/focus/pane/window token | token unit tests、unknown token error |
| tmux | environment、window mode、split、command、sidebar | fake tmux integration + live smoke |
| WezTerm | version、list parse、tab/window、split、command | fake wezterm integration |
| CLI | apply/list/select/options/help/version/error、`VDE_DEBUG` / `VDE_VERBOSE` | assert_cmd end-to-end tests |
| Confirm | current-window の TTY 判定、`[y/N]`、非対話拒否、dry-run | fake input / terminal integration tests |
| fzf | inline/popup、extra args、Rust `__preview`、cancel | fake fzf integration tests |
| Hook | success/failure/timeout/token、dry-run | process integration tests |
| Distribution | build/test/lint/release artifact | CI workflow + local install smoke |
| Aliases | `vde-layout` / `vl` | 両バイナリで help/version/dry-run 一致 |

## 6. 実装フェーズとコミット計画

各フェーズは、実装 → format / lint / test → レビュー担当 Agent（開始時点は tmux `%255`）に独立レビュー依頼 → must-fix 修正 → 再レビュー → コミット、の順で完了させる。pane ID が変わった場合は担当役割とリポジトリを照合して新しい pane を特定する。
レビュー依頼後は対象差分を凍結し、修正を加えた場合は検証エビデンスを更新して再レビューを依頼する。

### Phase 0: 計画確定

- ignore 対象の `docs/` を使わず、追跡可能なルートの `RUST_PORT_PLAN.md` として本計画書を作成する。
- レビュー担当 Agent（開始時点は `%255`）に仕様網羅性、段階分割、検証可能性、配布方針のレビューを依頼する。
- must-fix / should-fix を反映し、総合判定「マージ可」を得る。

予定コミット:

1. `docs: Rust完全移植計画を追加`

### Phase 1: Cargo 基盤、モデル、設定

- version `2.0.0` の `Cargo.toml`、二つの binary target、共有 library を追加する。
- error、model、config validator / loader / merger、preset manager を移植する。
- TypeScript の schema/config/preset テストに対応する Rust テストを追加する。

予定コミット:

2. `feat: Rustの設定基盤を実装`

### Phase 2: core と parity harness

- compile → planner → emitter の純粋ロジックを移植する。
- TypeScript の core テストに対応する Rust テストを追加する。
- 現行実装と同じ fixture から plan を JSON 構造として正規化し、言語間の object / array / number / string / null の構造一致を比較する。
- TypeScript 側の正規化 plan JSON を golden fixture としてコミットし、TypeScript 削除後も Rust の回帰テスト資産として維持する。
- plan hash は Rust 側の canonical JSON（object key の辞書順、整数と有限小数の最短表現、UTF-8 文字列）から生成し、同じ Rust plan の再実行で一致することだけを検証する。

予定コミット:

3. `feat: Rustのコアプランナーを実装`

### Phase 3: 共通 executor と tmux バックエンド

- command runner、pane map、template token、terminal command preparation を移植する。
- tmux の環境検証、new/current window、sidebar 保護、split sizing、pane command、focus を移植する。
- dry-run と実行の同一 plan 利用、実 tmux pane の初期サイズ解決、sidebar pane から実際の split origin へのサイズ補正、解決不能時の `<dynamic>` 表示を検証する。
- fake tmux で失敗注入を行い、error code と途中状態を検証する。
- 隔離した tmux socket の test は `#[ignore]` に分離し、ローカルと tmux を導入した Ubuntu CI で `cargo test --test tmux_live -- --ignored --nocapture` を明示実行する。

予定コミット:

4. `feat: Rust版tmuxバックエンドを実装`

### Phase 4: WezTerm バックエンド

- WezTerm CLI version 検証、list parser、active window/tab 解決を移植する。
- new/current window、split、cwd/env/command、focus、ephemeral を移植する。
- fake wezterm の fixture で success / failure / cancellation を検証する。

予定コミット:

5. `feat: Rust版WezTermバックエンドを実装`

### Phase 5: CLI、selector、hook、二つのコマンド

- 全 CLI option、preset/list/default、verbose/debug、`VDE_DEBUG` / `VDE_VERBOSE`、current-window 確認、構造化 error 表示を移植する。
- `CoreError` の文字列 code を CLI の `ErrorCode` へ変換し、tmux 環境エラーを既存 guidance と終了コードへ接続する。
- fzf selector の auto/inline/tmux-popup、Rust `__preview`、追加引数を移植する。
- afterApply hook の token、cwd、warning-only failure、30 秒 timeout を移植する。
- `vde-layout` と `vl` が同一の library entrypoint を呼ぶようにする。
- assert_cmd で両バイナリの help/version/list/dry-run/error parity を検証する。

予定コミット:

6. `feat: Rust版CLIとvlエイリアスを実装`

### Phase 6: 完全置換、CI、配布、文書

- TypeScript / JavaScript、Node 設定、pnpm lockfile、npm bin wrapper を削除する。
- npm publish workflow は削除し、npm registry 上の既存 package を自動変更・deprecate しない。
- README の install/development/requirements を GitHub Release / `cargo install --git` / Rust バイナリ向けに更新する。
- Ubuntu CI に tmux を導入し、`cargo fmt --check`、`cargo clippy --all-targets --all-features -- -D warnings`、`cargo test --all-targets --all-features`、明示的 tmux live smoke、release build に置換する。
- tag で Linux/macOS の x86_64/aarch64 release artifact と checksum を生成する workflow を用意する。
- `cargo install --path . --root <temp>` で二つの実行ファイルが導入されることを検証する。
- 旧 444 テストの機能項目と Rust テストの対応表を完成させ、欠落がないことを監査する。

予定コミット:

7. `chore: Rust実装へ完全移行`

## 7. レビュー運用

レビューはレビュー担当 Agent（開始時点は tmux pane `%255`）に依頼する。依頼文には次を必ず含める。

- 対象リポジトリと worktree の絶対パス
- AGENTS.md の遵守、日本語レビュー
- 実装やファイル変更の禁止
- 計画書と diff の仕様準拠レビュー、その後の独立した品質レビュー
- `must-fix / should-fix / nit`、ファイルと行、問題、修正方針、総合判定

must-fix はコミット前に全件解消する。should-fix は原則解消し、見送る場合は根拠を記録して再レビューを受ける。nit は裁量で扱う。

## 8. リスクと対策

| リスク | 対策 |
| --- | --- |
| 18,259 行の一括置換で挙動が欠落する | 機能マトリクスと fixture parity を先に作り、領域別コミットに分割する |
| tmux / WezTerm の実環境差 | 外部コマンド runner を注入可能にし、fake integration と tmux live smoke を併用する |
| YAML strictness / merge semantics が変わる | invalid fixture と複数 scope の golden test を移植する |
| YAML 1.1/1.2、anchor、duplicate key の parser 差 | `serde-saphyr` の strict boolean / duplicate error option を固定し、現行 parser との fixture parity を取る |
| Serde union error が path を失う | raw model と独自 validator を分離し、code / path / guidance を直接組み立てる |
| JavaScript と Rust の JSON 直列化が異なる | parity は hash ではなく構造比較とし、Rust 内 hash 用 canonical JSON を別に定義する |
| fixed-cell split の端数処理が変わる | 現行の境界値を golden 化し、同じコマンド列を比較する |
| `fzf` や hook が test で hang する | fake executable と明示 timeout を使う |
| バイナリ別に CLI 挙動が分岐する | `run_cli` を library に一つだけ置き、二つの薄い Rust main から呼ぶ |
| リリース対象で build できない | CI matrix で四 target を build し、artifact ごとに smoke check する |

## 9. 完了条件（DoD）

### 機能完了条件

- [ ] YAML schema、設定探索、scope merge、preset 管理が Rust で動作する。
- [ ] compile、plan、emit、plan hash が Rust で動作する。
- [ ] weight / fixed-cell を含む再帰レイアウトが tmux と WezTerm の両方で動作する。
- [ ] cwd、env、delay、title、focus、ephemeral、closeOnError が両バックエンドで動作する。
- [ ] current/new window、TTY 確認、非対話拒否、dry-run 時の非確認、tmux sidebar 保護、template token が動作する。
- [ ] list、select、dry-run、verbose/debug、`VDE_DEBUG` / `VDE_VERBOSE`、backend、config、window mode、help、version `2.0.0` が動作する。
- [ ] fzf inline / tmux-popup / Rust `__preview`、afterApply hook が Node.js なしで動作する。
- [ ] `vde-layout` と `vl` が同じ機能・終了コードで実行できる。
- [ ] リポジトリの実装・ビルド・テストから TypeScript / JavaScript / Node.js 依存が除去されている。

### テスト完了条件

- [ ] 旧 39 ファイル・444 テストの機能項目すべてに Rust テストまたは明示的な結合試験が対応している。
- [ ] `cargo fmt --check` が成功する。
- [ ] `cargo clippy --all-targets --all-features -- -D warnings` が成功する。
- [ ] `cargo test --all-targets --all-features` が成功する。
- [ ] `cargo test --test tmux_live -- --ignored --nocapture` が隔離 tmux socket 上で成功する。
- [ ] `cargo build --release --bins` が成功する。
- [ ] fake tmux / fake wezterm / fake fzf の結合試験が成功する。
- [ ] `cargo install --path . --root <temp>` 後の `vde-layout` / `vl` で help、version、dry-run の一致を確認する。
- [ ] `rg --files -g '*.ts' -g '*.tsx' -g '*.js' -g '*.mjs' -g '*.cjs'` が空である。

### 運用反映条件

- [ ] GitHub Actions CI が Rust の format / clippy / test / release build を実行する。
- [ ] tag workflow が Linux/macOS、x86_64/aarch64 の artifact と SHA-256 checksum を生成する。
- [ ] npm publish workflow と Node.js 配布物が削除され、GitHub Release / `cargo install --git` が唯一の公開手順として文書化される。
- [ ] README に Rust 版の導入、二つのコマンド、開発、対応環境、設定例が反映される。
- [ ] 全フェーズのコミットがレビュー担当 Agent（開始時点は `%255`）のレビューを通過し、worktree が clean である。
- [ ] 最終 completion audit で本 DoD を一項目ずつ実測確認する。
- [ ] 全項目完了後に ntfy で変更内容と検証結果を通知する。

## 10. 停止条件

- 現行 1.1.3 のベースラインテストが再現不能になった場合。
- ユーザー作業由来と判断できない差分、secret、credential、意図不明な生成物を検出した場合。
- レビュー担当 Agent のレビューで「設計から要見直し」と判定され、修正方針を合理的に確定できない場合。
- 外部環境上、tmux / Rust toolchain / target toolchain が利用できず、代替の検証でも完了証拠を作れない場合。
