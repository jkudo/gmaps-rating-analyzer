# Google Map 口コミ評価アナライザー

**日本語** ・ [English](#google-maps-review-rating-analyzer-english)

Google マップの店舗ページを開くと、星評価の分布から「平均点だけでは見えない実態」（賛否の割れ方・二極化・信頼性）を分析し、最後に **「行く価値があるか」の総合評価** まで表示する Chrome 拡張機能です。計算はすべてブラウザ内で完結します。任意で **Gemini または OpenAI** による自然言語の総合評価も追加でき、さらに任意で、表示中のレビュー本文の一部を加味した評価にもできます。

> ⚠️ これは非公式の個人用ツールであり、Google とは一切関係ありません。

---

## スクリーンショット

<!-- 例: docs/screenshot.png を追加してください -->
`（ここに docs/screenshot.png などを追加）`

---

## 特長

- **星ごとの件数を自動取得** — ページの `aria-label`（例: `5 つ星、クチコミ 315 件`）から読み取るため、Google 側の class 名や DOM 構造の変更に強い設計です。日本語・英語表示の両方に対応。
- **基本統計** — 中央値・平均・最頻値・標準偏差・高評価率（4〜5★）・低評価率（1〜2★）・中立率（3★）。
- **二極化と信頼性の指標** — 極端評価率、分極化指数、評価不一致確率、強い不一致確率、平均評価差、正規化エントロピー、双峰性係数。
- **分布グラフ** — 実測の棒グラフに「同じ平均・標準偏差の正規分布近似」を重ねて表示（外部ライブラリ不要の自前 SVG）。
- **総合評価** — 分布パターンから「行く価値が高い／おおむね良好／人を選ぶ／慎重に」などを理由付きで提示。
- **任意：AI 連携（Gemini / OpenAI）** — 自分の API キーを設定すると、総合評価を自然言語で自動生成。プロバイダは設定で選べます。
- **任意：レビュー本文の解析** — オンにすると、表示中レビュー本文の一部（投稿者名なし）も加味し、共通する称賛・不満の傾向を反映。AI連携時は「数値からの評価／レビュー本文からの評価／統合評価」の章立てで、数値とレビューの一致・食い違いまで示します。
- **拡張アイコンの左クリックで設定（オプション）を開けます。**
- **任意：超分析（全レビュー読込）** — レビュー一覧を自動スクロールして表示可能な分を全件読み込み、レビュー本文のみで分析。章立て＋抽出キーワードを表示します（統計指標は非表示・ワンクリックで通常表示に復帰）。多くのトークン・費用を消費する点に注意。
- **表示言語の切り替え（日本語 / English / 自動）** — パネル・設定画面・AIの総合評価の言語を切り替えられます。「自動」はGoogleマップの表示言語（なければブラウザの言語）に従います。
- ダークモード対応／パネルのドラッグ移動・折りたたみ／ページ遷移時の自動更新。
- すべての計算は端末内。グラフ描画も依存ライブラリなし。

---

## インストール

1. このリポジトリを **ダウンロード（または `git clone`）** します。
2. Chrome で `chrome://extensions` を開きます。
3. 右上の **「デベロッパーモード」** をオンにします。
4. **「パッケージ化されていない拡張機能を読み込む」** をクリックし、このフォルダ（`manifest.json` がある階層）を選びます。
5. Google マップで店舗ページを開くと、右上に分析パネルが表示されます。

> Chrome / Edge など Chromium 系ブラウザの Manifest V3 に対応しています。ビルド手順はありません。

---

## AI による総合評価（任意・Gemini / OpenAI）

ローカルの分析だけでも総合評価は表示されますが、より自然な文章で評価したい場合は AI を設定できます。プロバイダは **Google Gemini** または **OpenAI** から選べます。

1. API キーを発行します。Gemini は [Google AI Studio](https://aistudio.google.com/apikey)（無料枠あり）、OpenAI は [OpenAI Platform](https://platform.openai.com/api-keys)（従量課金）。
2. 拡張アイコンを **左クリック** して設定を開きます（または拡張の詳細画面 →「拡張機能のオプション」、パネルの「設定を開く」リンク）。
3. 「AIプロバイダ」で使う方を選び、API キーを貼り付け、モデルを選び、「保存」→「接続テスト」で疎通確認します。
4. 以後、店舗ページを開くと総合評価欄が自動で AI 生成に切り替わります（右肩のラベルがプロバイダ名＋使用モデル名。レビュー本文を加味したときは「口コミ本文を加味」と表示）。

### レビュー本文の解析（任意）

設定の「レビュー本文も解析する」をオンにすると、AI生成時に表示中レビュー本文の一部（最大10〜20件・**投稿者名なし**・各300字程度・★が偏らないよう各評価から均等に抽出）も渡し、総合評価を **「数値からの評価／レビュー本文からの評価／おすすめのシーン／統合評価」** の章立てで出力します。統合評価では、数値とレビューが一致するか食い違うか（星評価だけでは見えない点）まで示します。クチコミ（レビュー）が表示された状態でお使いください。送信内容は[プライバシー節](#プライバシーとセキュリティ)を参照してください。

なお総合評価には、分布やレビューから読み取れる **「おすすめのシーン」**（どんな利用シーン・客層に向くか、逆に向かないか）も表示されます。

### 超分析（全レビュー読込・レビュー内容のみ）

総合評価の下にある **「🔬 超分析」** を押すと、レビュー一覧を自動スクロールして表示可能な分を可能な限り全件読み込み、その本文（最大100件・**投稿者名なし**・各評価から均等に抽出）だけを使って分析します。超分析は **レビュー内容のみ** で判断し、星の統計指標は使いません（このとき統計セクションは非表示になり、「← 通常分析に戻す」で元の表示に戻せます）。結果には章立て（評価されている点／不満点・注意点／**不審・無関係な低評価（荒らしチェック）**／向いている人・向かない人／総評）と、**分析に使った主なキーワード** が表示されます。一度実行した店ではボタンが「再分析」に変わり、押すと読み込み直して再生成します。

> ⚠️ 超分析は多数のレビュー本文をまとめてAIに送るため、通常の総合評価より **送信トークン・費用・生成時間が大幅に増えます**（特に OpenAI など従量課金）。レビュー件数の多い店舗ほど顕著です。コストが気になる場合は通常の総合評価をご利用ください。

> 超分析・通常分析の結果はそれぞれセッション中キャッシュされ、行き来しても再生成（再送信）しません。クチコミタブを開いた状態でお使いください。読み込めるのは表示中のレビューのみです。

### モデル

- Gemini の既定は安定版の **`gemini-3.5-flash`**。混雑（503）やレート超過（429）の際は自動で再試行し、必要なら **`gemini-2.5-flash`** に切り替えます。
- OpenAI の既定は **`gpt-5.4-mini`**（安価・高速）。上位の `gpt-5.5`、最安の `gpt-5.4-nano` なども選べます（OpenAI は従量課金）。
- モデル一覧・料金・無料枠は各社の公式（[Gemini models](https://ai.google.dev/gemini-api/docs/models) ・ [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) ・ [OpenAI models](https://platform.openai.com/docs/models)）を参照。

### 自動生成

- 「店舗を開いたとき自動でAIの総合評価を生成する」を設定でオン/オフできます（既定オン）。
- 自動生成は店舗に少しとどまってから発火し、同じ店舗の結果はセッション中キャッシュして再呼び出ししません。

---

## 総合評価について（重要）

AI／ローカルいずれの総合評価も、既定では **判断材料は星評価の集計値と統計指標だけ** です。料理・接客・価格など店舗の具体的な中身は判断材料にしていません。したがって出力は「**みんなの評価のつき方から見て行く価値があるか**」という性質のもので、味の好みや目的との相性まで保証するものではありません。設定で「レビュー本文も解析する」をオンにすると、表示中レビュー本文の一部も判断材料に加わり、共通する称賛・不満の傾向が反映されます（その場合の送信内容はプライバシー節を参照）。

**荒らし・不当な低評価について：** レビュー本文を解析する場合（「レビュー本文も解析する」オンの総合評価、または超分析）、AIは店舗の体験と無関係な低評価や評価爆撃と思われるものがあれば指摘し、それらを除いた見立ても述べます。ただしこれは **本文からのAIの推測であって確定判定ではありません**。また荒らしの多くは本文のない星だけの低評価で投稿され、本文解析の対象外です（数値には反映されます）。さらに **近年のGoogleマップはAI・機械学習で違反レビューを自動削除している** ため、あからさまな荒らしは表示前に除去済みのことが多く、この機能が拾えるのは「フィルターをすり抜けて残ったグレーな低評価」に限られます。

---

## 指標の意味

| 指標 | 説明 |
|---|---|
| 中央値 | 件数を低い順に並べた真ん中の星。少数の極端評価に強い代表値。 |
| 平均 | 加重平均。少数の極端評価に引っ張られやすい。 |
| 高/低/中立評価率 | 4〜5★ / 1〜2★ / 3★ の割合。 |
| 極端評価率 | (1★ + 5★) / 全体。両極の比率。 |
| 分極化指数 | 平均(\|評価−3\|) ÷ 2。0=中央集中、1=両極集中。 |
| 評価不一致確率 | 無作為な2人の評価が異なる確率（1 − Σpᵢ²）。 |
| 強い不一致確率 | 2人の評価差が3★以上になる確率。 |
| 平均評価差 | 無作為な2人の星の平均的なズレ。 |
| 正規化エントロピー | 分布の散らばり（0〜1）。1ほど星全体に分散。 |
| 双峰性係数 | Sarle の係数。0.56超で双峰の可能性（**補助指標**。強い偏りでも超えるため形も併せて判断）。 |

---

## プライバシーとセキュリティ

- 統計の計算はすべて **この端末内** で行われ、外部に送信されません。
- AI（Gemini／OpenAI）を有効にした場合のみ、**星評価の集計値と統計指標** を、選んだプロバイダのAPIに送信します。通常は **店舗名・位置情報・個別レビュー本文は送りません。**
- 設定の **「レビュー本文も解析する」をオンにしたときに限り**、ページに表示中のレビュー本文の一部（最大10〜20件・**投稿者名なし**・各300字程度）もAIに送信し、共通する称賛・不満の傾向を総合評価に反映します。オフ（既定）の間は送りません。
- **「超分析」を実行したときも同様に**、表示中レビュー本文（最大100件・**投稿者名なし**）をAIに送信します（超分析はレビュー本文のみを使用）。多数のレビューを送るため送信量・費用が大きくなります。
- API キーは `chrome.storage`（この端末内）にのみ保存されます。
- 通信先は選んだプロバイダのエンドポイント（Gemini: `generativelanguage.googleapis.com` ／ OpenAI: `api.openai.com`）に限定しています（`host_permissions`）。
- **配布せず、個人利用してください。** キーを設定したフォルダを第三者に渡すとキーが漏れます。
- 無料枠／既定の設定では、**送信したプロンプト（レビュー本文を含む場合あり）がモデル改善に利用されることがあります**（Gemini 有料・Vertex AI、OpenAI の API 既定などは扱いが異なります。各社のデータ利用ポリシーをご確認ください）。

---

## 制限事項

- 5段階という離散データのため、中央値は値が粗く（4 や 5 に張り付きやすく）、複数店の比較では低評価率の併用が有効です。
- 双峰性係数は補助指標です。強い偏りのある単峰分布でも閾値を超えることがあるため、総合評価は「3★が最小か」などの形も見て判断しています。
- AI の総合評価は、既定では星評価分布のみに基づく判断です（「レビュー本文も解析する」をオンにすると、表示中レビュー本文の一部も加味します）。
- 個々のレビュー本文はページに表示されている分しか読めません（遅延読み込み）。低評価も解析対象に含めたいときは、低評価が見えるところまでスクロールしてから生成してください。
- Google マップの `aria-label` 文言（`○ つ星、クチコミ ○ 件` / `N stars, N reviews`）に依存しています。Google が表記を変えた場合は、`content.js` 内の正規表現の更新が必要です。
- 各プロバイダの無料枠・料金・モデルの提供状況は変わることがあります（OpenAI は従量課金）。

---

## ファイル構成

```
.
├── manifest.json     # Manifest V3 定義
├── content.js        # 解析エンジン + パネル描画（Shadow DOM, 自前SVGグラフ, 多言語）
├── background.js     # Service Worker（Gemini/OpenAI呼び出し・再試行・モデルフォールバック）
├── options.html      # 設定ページ（言語・プロバイダ・APIキー・モデル・自動生成・レビュー解析）
├── options.js        # 設定ページのロジック
└── icons/            # 拡張アイコン（16/48/128）
```

---

## 技術メモ

- Manifest V3、**ビルド不要・依存ライブラリなし**。
- パネルは Shadow DOM で隔離（ページの CSS と干渉しません）。
- AI（Gemini / OpenAI）呼び出しはページの CORS を避けるため Service Worker 経由。
- Gemini 3.x / GPT-5.x の「思考・推論」が出力トークンを消費して本文が途切れる問題に対し、トークン確保＋失敗時の再試行（トークン拡大・モデル切替）を実装。

---

## ライセンス

MIT License. 詳細は [`LICENSE`](./LICENSE) を参照してください。

## 免責

本拡張は Google が提供・承認するものではなく、Google マップの非公式ツールです。表示中のページから公開済みの評価情報を読み取って解析するものですが、利用にあたっては各サービスの利用規約をご確認ください。自己責任でご利用ください。

<br>

---
---

<br>

# Google Maps Review Rating Analyzer (English)

[日本語](#google-map-口コミ評価アナライザー) ・ **English**

A Chrome extension that opens a Google Maps place page, analyzes the star-rating distribution to reveal what the average score hides (how split opinion is, polarization, reliability), and finishes with an **overall "is it worth visiting" verdict**. All math runs in your browser. Optionally, it can add a natural-language verdict from **Gemini or OpenAI**, and optionally fold in some of the visible review text.

> ⚠️ This is an unofficial, personal-use tool and is not affiliated with Google.

---

## Screenshot

<!-- e.g. add docs/screenshot.png -->
`(add docs/screenshot.png here)`

---

## Features

- **Auto-reads per-star counts** — parsed from the page's `aria-label` (e.g. `5 stars, 315 reviews`), so it's resilient to Google's class-name/DOM changes. Works with both Japanese and English Maps.
- **Basic statistics** — median, mean, mode, standard deviation, positive rate (4–5★), negative rate (1–2★), neutral rate (3★).
- **Polarization & reliability metrics** — extreme rate, polarization index, disagreement probability, strong-disagreement probability, mean pairwise gap, normalized entropy, bimodality coefficient.
- **Distribution chart** — an observed bar chart overlaid with a normal approximation of the same mean and SD (self-contained SVG, no external libraries).
- **Overall verdict** — from the distribution pattern, a labeled call such as "clearly worth a visit / largely positive / not for everyone / with caution," with reasons.
- **Optional: AI integration (Gemini / OpenAI)** — set your own API key to auto-generate the verdict in natural language. Pick the provider in settings.
- **Optional: review-text analysis** — when on, some visible review text (no author names) is folded in to reflect common praise/complaints. With AI, the verdict is chaptered into "From the numbers / From the review text / Integrated verdict," including where numbers and reviews agree or diverge.
- **Left-click the toolbar icon to open settings (options).**
- **Optional: Deep analysis (load all reviews)** — auto-scrolls the review list to load as many shown reviews as possible and analyzes using review text only; shows a chaptered write-up plus extracted keywords (statistics hidden; one click to restore). Note: uses many tokens/cost.
- **Language switch (Japanese / English / Auto)** — switches the panel, the settings page, and the AI verdict. "Auto" follows Google Maps' display language (or your browser's).
- Dark-mode support; draggable/collapsible panel; auto-refresh on navigation.
- Everything is computed on-device; the chart has no library dependencies.

---

## Install

1. **Download** this repository (or `git clone` it).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **"Load unpacked"** and choose this folder (the one containing `manifest.json`).
5. Open a place page on Google Maps; the analysis panel appears at the top right.

> Works with Manifest V3 on Chromium browsers (Chrome, Edge, etc.). No build step.

---

## AI verdict (optional · Gemini / OpenAI)

The verdict works with local analysis alone, but you can configure an AI for a more natural write-up. Choose **Google Gemini** or **OpenAI**.

1. Create an API key — Gemini at [Google AI Studio](https://aistudio.google.com/apikey) (has a free tier), OpenAI at [OpenAI Platform](https://platform.openai.com/api-keys) (usage-based).
2. **Left-click** the toolbar icon to open settings (or the extension's details → "Extension options," or the panel's "Open settings" link).
3. Pick the provider under "AI provider," paste the API key, choose a model, then "Save" → "Test connection."
4. From then on, opening a place auto-switches the verdict to AI output (the corner label shows the provider + model; it shows "review text included" when review text was used).

### Review-text analysis (optional)

Turn on "Also analyze review text" in settings, and at generation time some visible review text (up to 10–20 items, **no author names**, ~300 chars each, balanced across stars) is also sent, and the verdict is output in chapters: **"From the numbers / From the review text / Best-fit scenes / Integrated verdict."** The integrated chapter states whether the numbers and reviews agree or diverge (what the stars alone miss). Use it with reviews visible. See the [Privacy section](#privacy--security) for what is sent.

The verdict also includes **"Best-fit scenes"** — which situations and visitors the place suits (and which it doesn't), read from the distribution and reviews.

### Deep analysis (load all reviews · reviews only)

Click **"🔬 Deep analysis"** below the verdict to auto-scroll the review list, load as many of the shown reviews as possible, and analyze using their text only (up to 100 items, **no author names**, balanced across stars). Deep analysis judges from **review content only** and does not use the star statistics (the statistics sections are hidden while it's shown; use **"← Back to normal analysis"** to restore them). The result is chaptered (What reviewers praise / What they complain about / **Suspicious or irrelevant low ratings — review-bombing check** / Who it suits / Verdict) and lists the **key terms used in the analysis**. After you run it once, the button changes to "Re-analyze," which reloads and regenerates.

> ⚠️ Deep analysis sends many review texts to the AI at once, so it uses **far more tokens, cost and time** than the normal verdict (especially on usage-based providers like OpenAI), and more so for places with many reviews. If cost is a concern, use the normal verdict.

> Deep and normal results are each cached for the session, so switching between them does not regenerate (re-send). Use it with the Reviews tab open; only currently shown reviews can be loaded.

### Models

- Gemini default is the stable **`gemini-3.5-flash`**. On overload (503) or rate limits (429) it auto-retries and, if needed, falls back to **`gemini-2.5-flash`**.
- OpenAI default is **`gpt-5.4-mini`** (cheap, fast). You can also pick the higher-tier `gpt-5.5`, the cheapest `gpt-5.4-nano`, etc. (OpenAI is usage-based.)
- For models, pricing and free-tier limits, see the official pages ([Gemini models](https://ai.google.dev/gemini-api/docs/models) · [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) · [OpenAI models](https://platform.openai.com/docs/models)).

### Auto-generation

- "Auto-generate the AI verdict when a place opens" can be toggled in settings (on by default).
- Auto-generation fires after you linger on a place, and results for the same place are cached for the session.

---

## About the verdict (important)

By default, both the AI and local verdicts judge **only from the aggregated star counts and statistics**. Specifics like food, service or price are not inputs. So the output answers "is it worth visiting, judging by how people rate it," and does not guarantee a match with your taste or purpose. If you turn on "Also analyze review text," some visible review text is added as input and common praise/complaints are reflected (see the Privacy section for what is sent).

**On trolling / unfair low ratings:** when review text is analyzed (the verdict with "Also analyze review text" on, or Deep analysis), the AI flags low ratings that look unrelated to the actual experience or like review-bombing, and gives a read with those set aside. This is an **inference from the text, not a verified judgment**. Also, much trolling is posted as star-only low ratings with no text, which the text analysis can't read (they still count in the numbers). And because **recent Google Maps uses AI/ML to auto-remove policy-violating reviews**, blatant trolling is often gone before it's shown — so this feature can only catch the grey-area low ratings that slip through the filter.

---

## What the metrics mean

| Metric | Description |
|---|---|
| Median | The middle star when counts are ordered. A representative value robust to a few extremes. |
| Mean | Weighted average. Easily pulled by a few extreme ratings. |
| Positive/Negative/Neutral rate | Share of 4–5★ / 1–2★ / 3★. |
| Extreme rate | (1★ + 5★) / total. Share of the two ends. |
| Polarization index | mean(\|rating − 3\|) ÷ 2. 0 = centered, 1 = both extremes. |
| Disagreement prob. | Chance two random reviewers differ (1 − Σpᵢ²). |
| Strong disagreement | Chance their ratings differ by 3★ or more. |
| Mean pairwise gap | Average star gap between two random reviewers. |
| Normalized entropy | Spread of the distribution (0–1). Higher = spread across all stars. |
| Bimodality coeff. | Sarle's coefficient. Above 0.56 suggests two peaks (**auxiliary**: a strong skew can also exceed it, so judge with the shape too). |

---

## Privacy & security

- All statistics are computed **on this device** and are not sent anywhere.
- Only when an AI (Gemini/OpenAI) is enabled are the **aggregated star counts and statistics** sent to the selected provider's API. Normally the **place name, location and individual review text are not sent.**
- **Only when "Also analyze review text" is on** is some visible review text (up to ~10–20 items, **no author names**, ~300 chars each) also sent to the AI to reflect common praise/complaints. While it's off (the default), nothing of the sort is sent.
- **Running "Deep analysis" likewise** sends visible review text (up to 100 items, **no author names**) to the AI (deep analysis uses review text only). Because it sends many reviews, the data volume and cost are larger.
- Your API key is stored only in `chrome.storage` (on this device).
- Network access is limited to the selected provider's endpoint (Gemini: `generativelanguage.googleapis.com` / OpenAI: `api.openai.com`) via `host_permissions`.
- **Keep it for personal use; do not distribute.** Sharing the configured folder with others exposes your key.
- On free tiers / default settings, **submitted prompts (which may include review text) can be used for model improvement** (Gemini paid / Vertex AI and the OpenAI API default differ — check each provider's data-use policy).

---

## Limitations

- Because ratings are discrete (1–5), the median is coarse (it tends to sit at 4 or 5); when comparing places, also use the negative rate.
- The bimodality coefficient is auxiliary. A strongly skewed single-peak distribution can exceed the threshold, so the verdict also considers the shape (e.g. whether 3★ is the minimum).
- By default the AI verdict judges from the star distribution only (turning on "Also analyze review text" folds in some visible review text).
- Individual review text can only be read from what's currently shown on the page (lazy loading). To include low ratings, scroll until they're visible before generating.
- It depends on Google Maps' `aria-label` wording (`N stars, N reviews` / `○ つ星、クチコミ ○ 件`). If Google changes the wording, the regex in `content.js` needs updating.
- Each provider's free tier, pricing and model availability can change (OpenAI is usage-based).

---

## File layout

```
.
├── manifest.json     # Manifest V3 definition
├── content.js        # analysis engine + panel rendering (Shadow DOM, hand-rolled SVG chart, i18n)
├── background.js     # Service Worker (Gemini/OpenAI calls, retries, model fallback)
├── options.html      # settings page (language, provider, API key, model, auto-gen, review analysis)
├── options.js        # settings-page logic
└── icons/            # extension icons (16/48/128)
```

---

## Technical notes

- Manifest V3, **no build step, no dependencies**.
- The panel is isolated in a Shadow DOM (it won't clash with the page's CSS).
- AI (Gemini / OpenAI) calls go through the Service Worker to avoid page CORS.
- To counter Gemini 3.x / GPT-5.x "thinking/reasoning" consuming output tokens and truncating the body, generous token budgets plus retries (larger budget, model switch) are implemented.

---

## License

MIT License. See [`LICENSE`](./LICENSE) for details.

## Disclaimer

This extension is not provided or endorsed by Google; it is an unofficial Google Maps tool. It reads and analyzes already-public rating information from the page you are viewing, but please review each service's terms of use. Use at your own risk.
